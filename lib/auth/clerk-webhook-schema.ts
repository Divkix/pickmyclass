import { z } from "zod";

/**
 * The fields of a Clerk `user.created` / `user.updated` payload the mirror
 * reads. The signature proves Clerk sent it, not that the shape still matches
 * what this code expects, so it is parsed before it reaches the database.
 */
export const clerkWebhookUserSchema = z.object({
  id: z.string().min(1),
  external_id: z.string().nullish(),
  primary_email_address_id: z.string().nullish(),
  email_addresses: z.array(
    z.object({
      id: z.string(),
      email_address: z.string(),
      verification: z.object({ status: z.string() }).nullish(),
    }),
  ),
  created_at: z.number(),
  last_sign_in_at: z.number().nullish(),
  public_metadata: z
    .object({ age_verified: z.unknown(), agreed_to_terms: z.unknown() })
    .partial()
    .nullish(),
});

export type ClerkWebhookUser = z.infer<typeof clerkWebhookUserSchema>;
