const CRON_LOCK_NAME = 'pickmyclass-cron-lock';
const CRON_LOCK_TIMEOUT_MS = 25 * 60 * 1000;

interface CronLockState {
  locked: boolean;
  lockAcquiredAt: number | null;
  lockHolder: string | null;
}

interface CronLockStore {
  load(): Promise<unknown>;
  save(state: CronLockState): Promise<void>;
}

export interface CronLockStatus {
  locked: boolean;
  lockHolder: string | null;
  lockAcquiredAt: number | null;
  timeHeldMs: number | null;
  expiresAt: number | null;
}

export interface CronLockLease {
  configured: boolean;
  acquired: boolean;
  message: string;
  currentHolder?: string;
  release(): Promise<void>;
}

function unlockedState(): CronLockState {
  return { locked: false, lockAcquiredAt: null, lockHolder: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStoredState(value: unknown): value is CronLockState {
  if (!isRecord(value) || typeof value.locked !== 'boolean') return false;
  if (!value.locked) {
    return value.lockAcquiredAt === null && value.lockHolder === null;
  }
  return (
    typeof value.lockAcquiredAt === 'number' &&
    Number.isFinite(value.lockAcquiredAt) &&
    typeof value.lockHolder === 'string' &&
    value.lockHolder.length > 0
  );
}

export function createCronLockLifecycle(
  store: CronLockStore,
  now: () => number = () => Date.now()
) {
  let state = unlockedState();

  async function expireIfNeeded(): Promise<void> {
    if (
      state.locked &&
      (state.lockAcquiredAt === null || now() - state.lockAcquiredAt >= CRON_LOCK_TIMEOUT_MS)
    ) {
      state = unlockedState();
      await store.save(state);
    }
  }

  return {
    async initialize(): Promise<void> {
      const stored = await store.load();
      if (isStoredState(stored)) {
        state = { ...stored };
      } else {
        state = unlockedState();
        if (stored !== null && stored !== undefined) await store.save(state);
      }
      await expireIfNeeded();
    },

    async acquire(holder: string = 'unknown') {
      await expireIfNeeded();
      if (state.locked) {
        const timeHeld = state.lockAcquiredAt === null ? 0 : now() - state.lockAcquiredAt;
        const timeRemaining = Math.max(0, CRON_LOCK_TIMEOUT_MS - timeHeld);
        return {
          acquired: false,
          message: `Cron lock already held by ${state.lockHolder}. Time remaining: ${Math.ceil(timeRemaining / 1000)}s`,
          lockHolder: state.lockHolder ?? undefined,
          lockedSince: state.lockAcquiredAt ?? undefined,
        };
      }

      state = { locked: true, lockAcquiredAt: now(), lockHolder: holder };
      await store.save(state);
      return {
        acquired: true,
        message: 'Lock acquired successfully',
        lockHolder: holder,
        lockedSince: state.lockAcquiredAt,
      };
    },

    async release(holder: string = 'unknown') {
      await expireIfNeeded();
      if (!state.locked) {
        return { released: false, message: 'Lock was not held' };
      }
      if (state.lockHolder !== holder) {
        return {
          released: false,
          message: `Lock held by different holder (${state.lockHolder})`,
        };
      }

      const timeHeld = state.lockAcquiredAt === null ? 0 : now() - state.lockAcquiredAt;
      state = unlockedState();
      await store.save(state);
      return {
        released: true,
        message: `Lock released after ${Math.floor(timeHeld / 1000)}s`,
      };
    },

    async status(): Promise<CronLockStatus> {
      await expireIfNeeded();
      const timeHeldMs = state.lockAcquiredAt === null ? null : now() - state.lockAcquiredAt;
      const expiresAt =
        state.lockAcquiredAt === null ? null : state.lockAcquiredAt + CRON_LOCK_TIMEOUT_MS;
      return {
        locked: state.locked,
        lockHolder: state.lockHolder,
        lockAcquiredAt: state.lockAcquiredAt,
        timeHeldMs,
        expiresAt,
      };
    },
  };
}

async function readWireResponse(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`Cron lock request failed (${response.status})`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Invalid cron lock response');
  }
  if (!isRecord(payload)) throw new Error('Invalid cron lock response');
  return payload;
}

function isAcquireResponse(payload: Record<string, unknown>): boolean {
  return typeof payload.acquired === 'boolean' && typeof payload.message === 'string';
}

function isReleaseResponse(payload: Record<string, unknown>): boolean {
  return typeof payload.released === 'boolean' && typeof payload.message === 'string';
}

function isStatusResponse(
  payload: Record<string, unknown>
): payload is Record<string, unknown> & CronLockStatus {
  return (
    typeof payload.locked === 'boolean' &&
    (payload.lockHolder === null || typeof payload.lockHolder === 'string') &&
    (payload.lockAcquiredAt === null ||
      (typeof payload.lockAcquiredAt === 'number' && Number.isFinite(payload.lockAcquiredAt))) &&
    (payload.timeHeldMs === null ||
      (typeof payload.timeHeldMs === 'number' && Number.isFinite(payload.timeHeldMs))) &&
    (payload.expiresAt === null ||
      (typeof payload.expiresAt === 'number' && Number.isFinite(payload.expiresAt)))
  );
}

export function createCronLockClient(namespace?: DurableObjectNamespace) {
  function stub() {
    if (!namespace) return null;
    return namespace.get(namespace.idFromName(CRON_LOCK_NAME));
  }

  return {
    async acquire(holder: string): Promise<CronLockLease> {
      const lockStub = stub();
      if (!lockStub) {
        return {
          configured: false,
          acquired: true,
          message: 'Cron lock binding not configured; proceeding without a distributed lock',
          async release() {},
        };
      }

      const response = await lockStub.fetch(
        `http://do/acquire?holder=${encodeURIComponent(holder)}`,
        { method: 'POST' }
      );
      const payload = await readWireResponse(response);
      if (!isAcquireResponse(payload)) throw new Error('Invalid cron lock response');

      const acquired = payload.acquired as boolean;
      return {
        configured: true,
        acquired,
        message: payload.message as string,
        currentHolder: typeof payload.lockHolder === 'string' ? payload.lockHolder : undefined,
        async release() {
          if (!acquired) return;
          const releaseResponse = await lockStub.fetch(
            `http://do/release?holder=${encodeURIComponent(holder)}`,
            { method: 'POST' }
          );
          const releasePayload = await readWireResponse(releaseResponse);
          if (!isReleaseResponse(releasePayload) || releasePayload.released !== true) {
            throw new Error(
              typeof releasePayload.message === 'string'
                ? releasePayload.message
                : 'Invalid cron lock response'
            );
          }
        },
      };
    },

    async status(): Promise<CronLockStatus | null> {
      const lockStub = stub();
      if (!lockStub) return null;
      const payload = await readWireResponse(await lockStub.fetch('http://do/status'));
      if (!isStatusResponse(payload)) throw new Error('Invalid cron lock response');
      return payload;
    },
  };
}
