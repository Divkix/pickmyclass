import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowed, ok, fail } from "@/lib/api/response";
import { withAuth } from "@/lib/api/withAuth";
import { getDbFromEnv } from "@/lib/db";
import { getWatchedClassStates } from "@/lib/db/queries";
import { errorFields, log } from "@/lib/log";

export const Route = createFileRoute("/api/class-watches/states")({
  server: {
    handlers: {
      GET: ({ request }) =>
        withAuth(request, async (user) => {
          try {
            const { searchParams } = new URL(request.url);

            const classNumbers = (searchParams.get("classNumbers") || "")
              .split(",")
              .filter(Boolean);

            const states = await getWatchedClassStates(getDbFromEnv(), user.userId, classNumbers);

            return ok({ classStates: states });
          } catch (error) {
            log("API").error("Error fetching class states", errorFields(error));

            return fail("Failed to fetch class states", 500);
          }
        }),
      ANY: methodNotAllowed,
    },
  },
});
