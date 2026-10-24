import { z } from "zod";

/**
 * What a queue message must carry before a Section Check runs on it. The
 * producer is our own Workflow, but the queue is an external boundary: a
 * malformed body must not reach the database as a SectionRef.
 */
export const classCheckMessageSchema = z.object({
  class_nbr: z.string().min(1),
  term: z.string().min(1),
  enqueued_at: z.string(),
  cycle: z.string().optional(),
  workflow_instance_id: z.string().optional(),
});
