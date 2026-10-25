import { createFileRoute } from "@tanstack/react-router";
import { errorFields, log, logEvent } from "@/lib/log";
import { methodNotAllowed, fail, ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/withAuth";
import { getDbFromEnv } from "@/lib/db";
import { readOnboardingState, skipOnboarding } from "@/lib/onboarding";

export const Route = createFileRoute("/api/user/onboarding")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return await withAuth(request, async (user) => {
            try {
              const payload = await readOnboardingState(getDbFromEnv(), user.userId);

              return ok(payload);
            } catch (error) {
              log("Onboarding").error("Get onboarding state error", errorFields(error));

              return fail("Failed to load onboarding state", 500);
            }
          });
        } catch (error) {
          log("Onboarding").error("Get onboarding state error", errorFields(error));

          return fail("Failed to load onboarding state", 500);
        }
      },

      POST: async ({ request }) => {
        try {
          return await withAuth(request, async (user) => {
            try {
              const payload = await skipOnboarding(getDbFromEnv(), user.userId);

              if (!payload) {
                log("Onboarding").error("Error skipping onboarding: no result returned");

                return fail("Failed to skip onboarding", 500);
              }

              logEvent("onboarding_skipped", { user_id: user.userId });

              return ok(payload);
            } catch (error) {
              log("Onboarding").error("Skip onboarding error", errorFields(error));

              return fail("Failed to skip onboarding", 500);
            }
          });
        } catch (error) {
          log("Onboarding").error("Skip onboarding error", errorFields(error));

          return fail("Failed to skip onboarding", 500);
        }
      },
      ANY: methodNotAllowed,
    },
  },
});
