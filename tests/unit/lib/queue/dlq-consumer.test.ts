import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { handleDLQMessage } from '@/lib/queue/dlq-consumer';
import type { ClassCheckMessage } from '@/lib/types/queue';

function buildMessage(overrides: Partial<ClassCheckMessage> = {}): ClassCheckMessage {
  return {
    class_nbr: '42737',
    term: '2261',
    enqueued_at: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

describe('handleDLQMessage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a greppable failure and does nothing else', () => {
    handleDLQMessage(buildMessage());

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      '[DLQ]',
      'DLQ_SECTION_FAILED section 42737 term 2261 enqueued_at 2026-03-01T00:00:00Z'
    );
  });
});
