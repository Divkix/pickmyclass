import { env } from "cloudflare:workers";
import { and, desc, eq, sql } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { withAuth } from "@/lib/api/withAuth";
import { createClassWatchSchema, deleteClassWatchSchema } from "@/lib/api/schemas";
import { parseJsonOrFail, parseOrFail } from "@/lib/api/validation";
import { AuthError, type ClassDetails, fetchClassFromASU, NotFoundError } from "@/lib/asu/api";
import { getDbFromEnv } from "@/lib/db";
import { getPgError, isRaisedException, isUniqueViolation } from "@/lib/db/pg-errors";
import {
  getWatchedClassStates,
  insertClassStateIfMissing,
  readClassWatchPreflight,
  readSectionAlertsEnded,
} from "@/lib/db/queries";
import { classWatches } from "@/lib/db/schema";
import { errorFields, log, logEvent } from "@/lib/log";
import type { ClassStateRow, ClassWatchRow } from "@/lib/types/class-watch";
import { sectionRefKey } from "@/lib/section-ref";
import { applyFirstWatchGuard, readOnboardingState, toOnboardingState } from "@/lib/onboarding";

const MAX_WATCHES_PER_USER = parseInt(process.env.MAX_WATCHES_PER_USER || "10", 10);

export async function GET(request: NextRequest) {
  try {
    return await withAuth(request, async (user) => {
      const db = getDbFromEnv();

      const [watches, onboarding] = await Promise.all([
        db
          .select({
            id: classWatches.id,
            class_nbr: classWatches.class_nbr,
            term: classWatches.term,
            subject: classWatches.subject,
            catalog_nbr: classWatches.catalog_nbr,
            created_at: classWatches.created_at,
          })
          .from(classWatches)
          .where(eq(classWatches.user_id, user.userId))
          .orderBy(desc(classWatches.created_at)),
        readOnboardingState(db, user.userId).catch((error) => {
          log("API").error("Failed to read onboarding state", errorFields(error));

          return toOnboardingState(null);
        }),
      ]);

      const classNumbers = watches.map((watch) => watch.class_nbr);
      const joinedStates = await getWatchedClassStates(db, user.userId, classNumbers);

      const statesMap: Record<string, ClassStateRow> = Object.fromEntries(
        joinedStates.map((state) => [sectionRefKey(state), state]),
      );

      const watchesWithStates = watches.map((watch) => ({
        ...watch,
        class_state: statesMap[sectionRefKey(watch)] ?? null,
      }));

      return ok({
        watches: watchesWithStates,
        maxWatches: MAX_WATCHES_PER_USER,
        onboarding,
      });
    });
  } catch (error) {
    log("API").error("Error fetching class watches", errorFields(error));

    return fail("Failed to fetch class watches", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    return await withAuth(request, async (user) => {
      const parsed = await parseJsonOrFail(createClassWatchSchema, request);

      if (!parsed.success) {
        return parsed.response;
      }

      const { term, class_nbr } = parsed.data;
      const db = getDbFromEnv();
      const preflight = await readClassWatchPreflight(db, user.userId, { class_nbr, term });

      // Match the RPC's precedence when a duplicate is also at the cap.
      if (preflight.watchCount >= MAX_WATCHES_PER_USER) {
        return fail(
          `Maximum watches limit reached (${MAX_WATCHES_PER_USER}). Delete some watches to add more.`,
          429,
        );
      }

      if (preflight.duplicate) {
        return fail("You are already watching this class", 409);
      }

      // SAFETY: env is Cloudflare Workers bindings; ASU_API_BASE_URL and ASU_API_TOKEN are required secrets validated at deploy
      const asuEnv = env as { ASU_API_BASE_URL: string; ASU_API_TOKEN: string };
      let classDetails: ClassDetails;

      try {
        // Freshness matters: this snapshot seeds a brand-new row, and the
        // pipeline compares against it on the next check.
        classDetails = await fetchClassFromASU({ class_nbr, term }, asuEnv, { useCache: false });
      } catch (error) {
        if (error instanceof NotFoundError) {
          return fail("Class section not found", 404);
        }

        if (error instanceof AuthError) {
          log("API").error("ASU API auth error", errorFields(error));

          return fail("Service temporarily unavailable", 503);
        }

        log("API").error("Failed to fetch class details", errorFields(error));

        return fail("Failed to fetch class details", 500);
      }

      if (await readSectionAlertsEnded(db, classDetails)) {
        return fail(
          "This section's add deadline has passed, so seat alerts have ended for it.",
          409,
        );
      }

      let watchDataRaw: ClassWatchRow | null = null;

      try {
        const { rows } = await db.execute<ClassWatchRow>(
          sql`SELECT * FROM public.create_class_watch_with_limit(
              ${user.userId}::text,
              ${term}::text,
              ${classDetails.subject.toUpperCase()}::text,
              ${classDetails.catalog_nbr}::text,
              ${class_nbr}::text,
              ${MAX_WATCHES_PER_USER}::int
            )`,
        );

        watchDataRaw = rows[0] ?? null;
      } catch (insertError) {
        if (isUniqueViolation(insertError)) {
          return fail("You are already watching this class", 409);
        }

        if (
          isRaisedException(insertError) &&
          getPgError(insertError)?.message?.includes("MAX_WATCHES_EXCEEDED")
        ) {
          return fail(
            `Maximum watches limit reached (${MAX_WATCHES_PER_USER}). Delete some watches to add more.`,
            429,
          );
        }

        throw insertError;
      }

      if (!watchDataRaw) {
        throw new Error("Failed to create class watch");
      }

      try {
        // Seed only — never overwrite an existing pipeline row (it carries
        // the strike counter and the freshest snapshot).
        await insertClassStateIfMissing(db, { class_nbr, term }, classDetails);
      } catch (dbError) {
        log("API").error("Failed to seed class state", errorFields(dbError));
      }

      try {
        await applyFirstWatchGuard(db, user.userId);
      } catch (dbError) {
        log("API").error("Failed to mark onboarding complete", errorFields(dbError));
      }

      logEvent("class_watch_created", { user_id: user.userId, term, class_nbr });

      return ok({ watch: watchDataRaw }, { status: 201 });
    });
  } catch (error) {
    log("API").error("Error creating class watch", errorFields(error));

    return fail("Failed to create class watch", 500);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    return await withAuth(request, async (user) => {
      const { searchParams } = new URL(request.url);
      const watchId = searchParams.get("id");

      const parsed = parseOrFail(deleteClassWatchSchema, { id: watchId });

      if (!parsed.success) {
        return parsed.response;
      }

      const db = getDbFromEnv();

      await db
        .delete(classWatches)
        .where(and(eq(classWatches.id, parsed.data.id), eq(classWatches.user_id, user.userId)));

      logEvent("class_watch_deleted", { user_id: user.userId, watch_id: parsed.data.id });

      return ok(undefined);
    });
  } catch (error) {
    log("API").error("Error deleting class watch", errorFields(error));

    return fail("Failed to delete class watch", 500);
  }
}
