import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { requirePageAccess } from "@/lib/auth/page-access";
import { readWatchlist } from "@/lib/class-watches/watchlist";
import { getDbFromEnv } from "@/lib/db";

const loadDashboard = createServerFn().handler(async () => {
  const identity = await requirePageAccess("/dashboard");

  return {
    watchlist: await readWatchlist(getDbFromEnv(), identity.userId),
    ownerClerkUserId: identity.clerkUserId,
  };
});

export const Route = createFileRoute("/dashboard/")({
  loader: () => loadDashboard(),
  component: DashboardPage,
});

function DashboardPage() {
  const { watchlist, ownerClerkUserId } = Route.useLoaderData();

  return <DashboardView initial={watchlist} ownerClerkUserId={ownerClerkUserId} />;
}
