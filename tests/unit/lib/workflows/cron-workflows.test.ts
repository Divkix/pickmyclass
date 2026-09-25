import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers';
import type { ClassCheckMessage } from '@/lib/types/queue';

const { mockExecute, mockGetSectionsToCheck, mockDeletePastTermWatches, mockGetPastTermCodes } =
  vi.hoisted(() => ({
    mockExecute: vi.fn(),
    mockGetSectionsToCheck: vi.fn(),
    mockDeletePastTermWatches: vi.fn(),
    mockGetPastTermCodes: vi.fn((): string[] => []),
  }));

vi.mock('@/lib/db', () => ({ getDb: () => ({ execute: mockExecute }) }));

vi.mock('@/lib/db/queries', () => ({
  getSectionsToCheck: mockGetSectionsToCheck,
  deletePastTermWatches: mockDeletePastTermWatches,
}));

vi.mock('@/lib/asu/terms', () => ({ getPastTermCodes: mockGetPastTermCodes }));

const { MaintenanceWorkflow, SectionCheckWorkflow, staggerGroupFor } =
  await import('@/lib/workflows/cron-workflows');

const sendBatch = vi.fn<Queue<ClassCheckMessage>['sendBatch']>();

const env = {
  // SAFETY: the mocked getDb never reads the Hyperdrive binding.
  HYPERDRIVE: {} as Hyperdrive,
  PICKMYCLASS_QUEUE: { sendBatch },
};

// SAFETY: the workflows never read ctx.
const ctx = {} as ExecutionContext;

const SEND_RESPONSE = { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };

const stepNames: string[] = [];

// Runs each step callback once, like a first attempt that succeeds or exhausts its retries.
const fakeStep = {
  async do<T>(name: string, _config: WorkflowStepConfig, callback: () => Promise<T>): Promise<T> {
    stepNames.push(name);

    return callback();
  },
};

// SAFETY: the workflows only call step.do(name, config, callback).
const step = fakeStep as WorkflowStep;

function scheduledEvent(scheduledTime: string): WorkflowEvent<unknown> {
  return {
    payload: {},
    timestamp: new Date(),
    instanceId: 'instance-1',
    workflowName: 'pickmyclass-section-check',
    schedule: { cron: '0,30 * * * *', scheduledTime: Date.parse(scheduledTime) },
  };
}

function sections(count: number, term = '2261') {
  return Array.from({ length: count }, (_, i) => ({ class_nbr: String(10000 + i), term }));
}

function sentBodies(): ClassCheckMessage[] {
  return sendBatch.mock.calls.flatMap(([messages]) =>
    Array.from(messages, (message) => message.body)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  stepNames.length = 0;
  mockExecute.mockResolvedValue([{ expired: 0 }]);
  sendBatch.mockResolvedValue(SEND_RESPONSE);
  mockGetPastTermCodes.mockReturnValue([]);
});

describe('staggerGroupFor', () => {
  it('alternates by half hour', () => {
    expect(staggerGroupFor(new Date('2026-09-24T12:00:00Z'))).toBe('even');
    expect(staggerGroupFor(new Date('2026-09-24T12:30:00Z'))).toBe('odd');
  });
});

describe('SectionCheckWorkflow', () => {
  it('enqueues sections in batches of 100 stamped with the scheduled cycle', async () => {
    mockGetSectionsToCheck.mockResolvedValue(sections(250));

    const result = await new SectionCheckWorkflow(ctx, env).run(
      scheduledEvent('2026-09-24T12:30:00.000Z'),
      step
    );

    expect(mockGetSectionsToCheck).toHaveBeenCalledWith(expect.anything(), 'odd');
    expect(sendBatch).toHaveBeenCalledTimes(3);
    expect(sentBodies()).toHaveLength(250);
    expect(sentBodies()[0]).toMatchObject({
      class_nbr: '10000',
      term: '2261',
      cycle: '2026-09-24T12:30:00.000Z:odd',
    });
    expect(stepNames).toEqual([
      'expire stale notifications',
      'load sections',
      'enqueue batch 1/3',
      'enqueue batch 2/3',
      'enqueue batch 3/3',
    ]);
    expect(result).toEqual({
      cycle: '2026-09-24T12:30:00.000Z:odd',
      sections_enqueued: 250,
      batches: 3,
    });
  });

  it('skips past-term sections', async () => {
    mockGetPastTermCodes.mockReturnValue(['2254']);
    mockGetSectionsToCheck.mockResolvedValue([...sections(2), ...sections(3, '2254')]);

    await new SectionCheckWorkflow(ctx, env).run(scheduledEvent('2026-09-24T12:00:00Z'), step);

    expect(sentBodies().map((body) => body.term)).toEqual(['2261', '2261']);
  });

  it('still checks sections when the stale-notification sweep fails', async () => {
    mockExecute.mockRejectedValue(new Error('db down'));
    mockGetSectionsToCheck.mockResolvedValue(sections(1));

    await new SectionCheckWorkflow(ctx, env).run(scheduledEvent('2026-09-24T12:00:00Z'), step);

    expect(sendBatch).toHaveBeenCalledOnce();
  });

  it('enqueues the other batches, then errors, when one batch keeps failing', async () => {
    mockGetSectionsToCheck.mockResolvedValue(sections(250));
    sendBatch.mockResolvedValueOnce(SEND_RESPONSE).mockRejectedValueOnce(new Error('queue down'));

    await expect(
      new SectionCheckWorkflow(ctx, env).run(scheduledEvent('2026-09-24T12:00:00Z'), step)
    ).rejects.toThrow('1/3 enqueue batches failed: queue down');
    expect(sendBatch).toHaveBeenCalledTimes(3);
  });

  it('uses the trigger time for a manually triggered instance', async () => {
    mockGetSectionsToCheck.mockResolvedValue(sections(1));

    const event = {
      ...scheduledEvent('2026-09-24T12:00:00Z'),
      schedule: undefined,
      timestamp: new Date('2026-09-24T09:45:00Z'),
    };

    await new SectionCheckWorkflow(ctx, env).run(event, step);

    expect(sentBodies()[0]?.cycle).toBe('2026-09-24T09:45:00.000Z:odd');
  });

  it('does nothing past loading when there are no sections', async () => {
    mockGetSectionsToCheck.mockResolvedValue([]);

    const result = await new SectionCheckWorkflow(ctx, env).run(
      scheduledEvent('2026-09-24T12:00:00Z'),
      step
    );

    expect(sendBatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sections_enqueued: 0, batches: 0 });
  });
});

describe('MaintenanceWorkflow', () => {
  it('expires stale notifications and sweeps past-term watches', async () => {
    mockExecute.mockResolvedValue([{ expired: 4 }]);
    mockGetPastTermCodes.mockReturnValue(['2254']);
    mockDeletePastTermWatches.mockResolvedValue(7);

    const result = await new MaintenanceWorkflow(ctx, env).run(
      scheduledEvent('2026-09-24T04:05:00Z'),
      step
    );

    expect(mockDeletePastTermWatches).toHaveBeenCalledWith(expect.anything(), ['2254']);
    expect(result).toEqual({ expired: 4, swept: 7 });
  });

  it('runs the sweep even when expiry fails, then errors', async () => {
    mockExecute.mockRejectedValue(new Error('db down'));
    mockDeletePastTermWatches.mockResolvedValue(0);

    await expect(
      new MaintenanceWorkflow(ctx, env).run(scheduledEvent('2026-09-24T04:05:00Z'), step)
    ).rejects.toThrow('Maintenance failed: db down');
    expect(mockDeletePastTermWatches).toHaveBeenCalledOnce();
  });
});
