import { desc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getWatchedClassStates } from "@/lib/db/queries";
import { classWatches } from "@/lib/db/schema";
import { errorFields, log } from "@/lib/log";
import { type OnboardingPayload, readOnboardingState, toOnboardingState } from "@/lib/onboarding";
import { sectionRefKey } from "@/lib/section-ref";
import type { ClassStateRow, UserClassWatch } from "@/lib/types/class-watch";

export const MAX_WATCHES_PER_USER = parseInt(process.env.MAX_WATCHES_PER_USER || "10", 10);

type WatchWithState = UserClassWatch & { class_state: ClassStateRow | null };

export interface Watchlist {
  watches: WatchWithState[];
  maxWatches: number;
  onboarding: OnboardingPayload;
}

/** The dashboard's data: shared by `GET /api/class-watches` and the server-rendered page. */
export async function readWatchlist(db: Database, userId: string): Promise<Watchlist> {
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
      .where(eq(classWatches.user_id, userId))
      .orderBy(desc(classWatches.created_at)),
    readOnboardingState(db, userId).catch((error) => {
      log("API").error("Failed to read onboarding state", errorFields(error));

      return toOnboardingState(null);
    }),
  ]);

  const classNumbers = watches.map((watch) => watch.class_nbr);
  const joinedStates = await getWatchedClassStates(db, userId, classNumbers);

  const statesMap: Record<string, ClassStateRow> = Object.fromEntries(
    joinedStates.map((state) => [sectionRefKey(state), state]),
  );

  return {
    watches: watches.map((watch) => ({
      ...watch,
      class_state: statesMap[sectionRefKey(watch)] ?? null,
    })),
    maxWatches: MAX_WATCHES_PER_USER,
    onboarding,
  };
}
