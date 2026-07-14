import { createClassWatchSchema } from '@/lib/api/schemas';
import { getSelectableTerms } from '@/lib/asu/terms';
import type { ClassWatchRow } from '@/lib/types/class-watch';

const CREATE_CLASS_WATCH_ERROR = 'Failed to add class watch';

export type ClassWatchCreationInput = {
  term: string;
  class_nbr: string;
};

type Request = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isClassWatchRow(value: unknown): value is ClassWatchRow {
  return (
    isRecord(value) &&
    typeof value.catalog_nbr === 'string' &&
    typeof value.created_at === 'string' &&
    typeof value.id === 'string' &&
    typeof value.subject === 'string' &&
    typeof value.term === 'string' &&
    typeof value.class_nbr === 'string' &&
    typeof value.user_id === 'string'
  );
}

async function readPayload(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const payload: unknown = await response.json();
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function createClassWatchClient(request?: Request) {
  return {
    getOptions() {
      const terms = getSelectableTerms();
      return {
        terms,
        defaultTerm: terms[0]?.code ?? '',
      };
    },

    async create(input: ClassWatchCreationInput): Promise<ClassWatchRow> {
      const validation = createClassWatchSchema.safeParse(input);
      if (!validation.success) {
        throw new Error(validation.error.issues[0]?.message ?? CREATE_CLASS_WATCH_ERROR);
      }

      let response: Response;
      try {
        response = await (request ?? globalThis.fetch)('/api/class-watches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validation.data),
        });
      } catch {
        throw new Error(CREATE_CLASS_WATCH_ERROR);
      }
      const payload = await readPayload(response);

      if (!response.ok) {
        const error = typeof payload?.error === 'string' ? payload.error.trim() : '';
        throw new Error(error || CREATE_CLASS_WATCH_ERROR);
      }
      if (
        !isClassWatchRow(payload?.watch) ||
        payload.watch.term !== validation.data.term ||
        payload.watch.class_nbr !== validation.data.class_nbr
      ) {
        throw new Error(CREATE_CLASS_WATCH_ERROR);
      }

      return payload.watch;
    },
  };
}

export const classWatchCreation = createClassWatchClient();
