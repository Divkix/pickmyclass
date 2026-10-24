import type * as Navigation from "next/navigation";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MotionProvider } from "@/components/MotionProvider";
import type { SessionIdentity } from "@/lib/auth/clerk-session";
import type { Database } from "@/lib/db";
import { createScriptedPostgres } from "../mocks/scripted-postgres";

const { getDbFromEnv, getSessionIdentityFromHeaders, redirect } = vi.hoisted(() => ({
  getDbFromEnv: vi.fn<() => Database>(),
  getSessionIdentityFromHeaders: vi.fn<(headers: Headers) => Promise<SessionIdentity | null>>(),
  redirect: vi.fn<(path: string) => never>(),
}));

vi.mock("@/lib/db", () => ({ getDbFromEnv }));

vi.mock("@/lib/auth/clerk-session", () => ({ getSessionIdentityFromHeaders }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof Navigation>()),
  redirect,
}));

// Clerk has not loaded during SSR: the page must not depend on it.
vi.mock("@/lib/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, session: null, loading: true, signOut: async () => {} }),
}));

import DashboardPage from "@/app/dashboard/page";
import SettingsPage from "@/app/settings/page";

const identity: SessionIdentity = {
  userId: "user-123",
  clerkUserId: "clerk_123",
  sessionId: "sess_123",
};

// Key order matches each select: the scripted driver maps array-mode rows positionally.
const watchRow = {
  id: "watch-1",
  class_nbr: "12345",
  term: "2267",
  subject: "CSE",
  catalog_nbr: "240",
  created_at: "2026-06-15T12:00:00Z",
};

const stateRow = {
  id: "state-1",
  class_nbr: "12345",
  term: "2267",
  subject: "CSE",
  catalog_nbr: "240",
  title: "Intro to Programming",
  instructor_name: "John Doe",
  seats_available: 0,
  seats_capacity: 50,
  non_reserved_seats: null,
  location: "COOR 120",
  meeting_times: "MWF 9:00 AM-9:50 AM",
  last_checked_at: "2026-06-15T12:00:00Z",
  last_changed_at: "2026-06-15T11:00:00Z",
  consecutive_not_found_count: 0,
  start_date: null,
  end_date: null,
  session_code: null,
  alerts_ended: false,
};

const completedProfile = {
  onboarding_completed_at: "2026-01-01T00:00:00Z",
  onboarding_skipped_at: null,
};

describe("server-rendered authenticated pages", () => {
  const fetchSpy = vi.fn<typeof fetch>();

  beforeEach(() => {
    getSessionIdentityFromHeaders.mockResolvedValue(identity);
    redirect.mockImplementation((path) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the user's watch cards into the dashboard HTML before Clerk loads", async () => {
    const pg = createScriptedPostgres((statement) => {
      if (statement.sql.includes('from "class_states"')) return [stateRow];

      if (statement.sql.includes('"user_profiles"')) return [completedProfile];

      return [watchRow];
    });

    getDbFromEnv.mockReturnValue(pg.db);

    const html = renderToStaticMarkup(<MotionProvider>{await DashboardPage()}</MotionProvider>);

    expect(html).toContain("12345");
    expect(html).toContain("Intro to Programming");
    expect(html).not.toContain("opacity:0");
    expect(pg.statements.find((s) => s.sql.includes('from "class_watches"'))?.params).toContain(
      identity.userId,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders the empty watchlist when the user has no watches", async () => {
    const pg = createScriptedPostgres((statement) =>
      statement.sql.includes('"user_profiles"') ? [completedProfile] : [],
    );

    getDbFromEnv.mockReturnValue(pg.db);

    const html = renderToStaticMarkup(<MotionProvider>{await DashboardPage()}</MotionProvider>);

    expect(html).toContain("Your watchlist is empty");
  });

  it("redirects to sign-in without reading data when the session is missing", async () => {
    getSessionIdentityFromHeaders.mockResolvedValue(null);

    await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(getDbFromEnv).not.toHaveBeenCalled();
  });

  it("renders the account email from the user's own row in settings", async () => {
    const pg = createScriptedPostgres(() => [
      { email: "sparky@asu.edu", created_at: "2026-01-01T12:00:00Z" },
    ]);

    getDbFromEnv.mockReturnValue(pg.db);

    const html = renderToStaticMarkup(await SettingsPage());

    expect(html).toContain("sparky@asu.edu");
    expect(html).toContain("2026");
    expect(pg.statements[0]?.params).toContain(identity.userId);
  });
});
