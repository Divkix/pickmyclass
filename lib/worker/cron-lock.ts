import { z } from 'zod';
import { isRecord, type JsonValue, type WirePayload } from '@/lib/api/wire';

const CRON_LOCK_NAME = 'pickmyclass-cron-lock';

const CRON_LOCK_TIMEOUT_MS = 25 * 60 * 1000;

export type CronLockState = {
  locked: boolean;
  lockAcquiredAt: number | null;
  lockHolder: string | null;
};

interface CronLockStore {
  load(): Promise<JsonValue | undefined>;
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

const storedStateSchema = z.union([
  z.object({ locked: z.literal(false), lockAcquiredAt: z.null(), lockHolder: z.null() }),
  z.object({
    locked: z.literal(true),
    lockAcquiredAt: z.number(),
    lockHolder: z.string().min(1),
  }),
]);

// SAFETY: type guard validates unknown DO storage value before narrowing to CronLockState
function isStoredState(value: unknown): value is CronLockState {
  return storedStateSchema.safeParse(value).success;
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

      // Persist the acquisition first: a failed save must leave the lock unlocked in memory
      // (and retryable next tick) instead of pinning a lock that was never durable.
      const acquiredState: CronLockState = {
        locked: true,
        lockAcquiredAt: now(),
        lockHolder: holder,
      };

      await store.save(acquiredState);
      state = acquiredState;

      return {
        acquired: true,
        message: 'Lock acquired successfully',
        lockHolder: holder,
        lockedSince: acquiredState.lockAcquiredAt,
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

async function readWireResponse(response: Response): Promise<WirePayload> {
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

const acquireResponseSchema = z.object({
  acquired: z.boolean(),
  message: z.string(),
  lockHolder: z.string().optional(),
});

function isAcquireResponse(
  payload: WirePayload
): payload is WirePayload & { acquired: boolean; message: string } {
  return acquireResponseSchema.safeParse(payload).success;
}

const releaseResponseSchema = z.object({ released: z.boolean(), message: z.string() });

function isReleaseResponse(
  payload: WirePayload
): payload is WirePayload & { released: boolean; message: string } {
  return releaseResponseSchema.safeParse(payload).success;
}

const statusResponseSchema = z.object({
  locked: z.boolean(),
  lockHolder: z.string().nullable(),
  lockAcquiredAt: z.number().nullable(),
  timeHeldMs: z.number().nullable(),
  expiresAt: z.number().nullable(),
});

function isStatusResponse(payload: WirePayload): payload is WirePayload & CronLockStatus {
  return statusResponseSchema.safeParse(payload).success;
}

/** The slice of `DurableObjectNamespace` the lock client needs, generic over the object id. */
export interface CronLockNamespace<Id = DurableObjectId> {
  idFromName(name: string): Id;
  get(id: Id): { fetch(input: string, init?: RequestInit): Promise<Response> };
}

export function createCronLockClient<Id = DurableObjectId>(namespace?: CronLockNamespace<Id>) {
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

      const acquired = payload.acquired;

      // SAFETY: acquire schema validated lockHolder as string-or-absent; currentHolder is optional
      const currentHolder = payload.lockHolder as string;

      return {
        configured: true,
        acquired,
        message: payload.message,
        currentHolder,
        async release() {
          if (!acquired) return;

          const releaseResponse = await lockStub.fetch(
            `http://do/release?holder=${encodeURIComponent(holder)}`,
            { method: 'POST' }
          );

          const releasePayload = await readWireResponse(releaseResponse);

          if (!isReleaseResponse(releasePayload)) throw new Error('Invalid cron lock response');

          if (!releasePayload.released) throw new Error(releasePayload.message);
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
