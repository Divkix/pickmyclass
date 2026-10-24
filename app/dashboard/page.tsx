import { DashboardView } from "@/app/dashboard/DashboardView";
import { requirePageIdentity } from "@/lib/auth/page-session";
import { readWatchlist } from "@/lib/class-watches/watchlist";
import { getDbFromEnv } from "@/lib/db";

export default async function DashboardPage() {
  const identity = await requirePageIdentity();
  const watchlist = await readWatchlist(getDbFromEnv(), identity.userId);

  return <DashboardView initial={watchlist} ownerClerkUserId={identity.clerkUserId} />;
}
