import { z } from 'zod';
import { createClassWatchSchema } from '@/lib/api/schemas';
import { parseOrThrow } from '@/lib/api/validation';
import { isRecord, type WirePayload } from '@/lib/api/wire';
import { getSelectableTerms } from '@/lib/asu/terms';
import type { ClassWatchRow } from '@/lib/types/class-watch';

const CREATE_CLASS_WATCH_ERROR = 'Failed to add class watch';

export type ClassWatchCreationInput = {
  term: string;
  class_nbr: string;
};

type Request = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const classWatchRowSchema = z.object({
  catalog_nbr: z.string(),
  created_at: z.string(),
  id: z.string(),
  subject: z.string(),
  term: z.string(),
  class_nbr: z.string(),
  user_id: z.string(),
});

const errorEnvelopeSchema = z.object({ error: z.string() });

// SAFETY: type guard validates unknown payload shape for ClassWatchRow before narrowing
function isClassWatchRow(value: unknown): value is ClassWatchRow {
  return classWatchRowSchema.safeParse(value).success;
}

async function readPayload(response: Response): Promise<WirePayload | null> {
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
      let validated: ClassWatchCreationInput;

      try {
        validated = parseOrThrow(createClassWatchSchema, input);
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : CREATE_CLASS_WATCH_ERROR);
      }

      let response: Response;

      try {
        response = await (request ?? globalThis.fetch)('/api/class-watches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validated),
        });
      } catch {
        throw new Error(CREATE_CLASS_WATCH_ERROR);
      }

      const payload = await readPayload(response);

      if (!response.ok) {
        const parsedError = errorEnvelopeSchema.safeParse(payload);
        const error = parsedError.success ? parsedError.data.error.trim() : '';
        throw new Error(error || CREATE_CLASS_WATCH_ERROR);
      }

      if (
        !isClassWatchRow(payload?.watch) ||
        payload.watch.term !== validated.term ||
        payload.watch.class_nbr !== validated.class_nbr
      ) {
        throw new Error(CREATE_CLASS_WATCH_ERROR);
      }

      return payload.watch;
    },
  };
}

export const classWatchCreation = createClassWatchClient();
