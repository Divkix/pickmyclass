import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { methodNotAllowed, ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/withAuth";
import { type ClassDetails, fetchClassFromASU } from "@/lib/asu/api";
import { getDbFromEnv } from "@/lib/db";
import { getMostWatchedClass } from "@/lib/db/queries";
import { errorFields, log } from "@/lib/log";
import { getSelectableTerms } from "@/lib/asu/terms";
import type { PopularClass } from "@/lib/types/class";

export const Route = createFileRoute("/api/onboarding/popular-class")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return withAuth(request, async () => {
          try {
            const selectableTerms = getSelectableTerms();
            const currentTerm = selectableTerms[0]?.code;

            if (!currentTerm) {
              return ok({ popularClass: null });
            }

            const popular = await getMostWatchedClass(getDbFromEnv(), currentTerm);

            if (!popular) {
              return ok({ popularClass: null });
            }

            // SAFETY: ASU base URL and token are required secrets validated at deploy
            const asuEnv = env as { ASU_API_BASE_URL: string; ASU_API_TOKEN: string };

            let details: ClassDetails;

            try {
              details = await fetchClassFromASU(popular, asuEnv);
            } catch (error) {
              log("Onboarding").warn("Popular class failed ASU validation", {
                class_nbr: popular.class_nbr,
                term: popular.term,
                ...errorFields(error),
              });

              return ok({ popularClass: null });
            }

            return ok({
              popularClass: {
                class_nbr: popular.class_nbr,
                term: popular.term,
                details,
              } satisfies PopularClass,
            });
          } catch (error) {
            // The modal treats a missing popular class as optional, so a lookup
            // failure must not break onboarding.
            log("Onboarding").error("Popular class error", errorFields(error));

            return ok({ popularClass: null });
          }
        });
      },
      ANY: methodNotAllowed,
    },
  },
});
