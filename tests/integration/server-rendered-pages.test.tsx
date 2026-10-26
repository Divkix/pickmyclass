import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MotionProvider } from "@/components/MotionProvider";
import { DashboardView } from "@/components/dashboard/DashboardView";
import type { AuthorizationState } from "@/lib/auth/authorization-state";
import type { SessionIdentity } from "@/lib/auth/clerk-session";
import type { Watchlist } from "@/lib/class-watches/watchlist";
import type { Database } from "@/lib/db";
import { renderWithRouter } from "@/tests/helpers/render-with-router";
import { createScriptedPostgres } from "../mocks/scripted-postgres";

const {
  getDbFromEnv,
  getSessionIdentity,
  readAuthorizationState,
  revokeSession,
  appendResponseHeader,
} = vi.hoisted(() => ({
  getDbFromEnv: vi.fn<() => Database>(),
  getSessionIdentity: vi.fn<() => Promise<SessionIdentity | null>>(),
  readAuthorizationState: vi.fn<() => Promise<AuthorizationState | null>>(),
  revokeSession: vi.fn<(sessionId: string) => Promise<void>>(),
  appendResponseHeader: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDbFromEnv }));

vi.mock("@/lib/auth/clerk-session", () => ({ getSessionIdentity, revokeSession }));

vi.mock("@/lib/auth/authorization-state", () => ({ readAuthorizationState }));

vi.mock("@/lib/db/users", () => ({
  readUserVerification: async () => ({
    email: "sparky@asu.edu",
    email_confirmed_at: "2026-01-01T00:00:00Z",
  }),
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("https://pickmyclass.app/_serverFn/page"),
  appendResponseHeader,
}));

// Run the server handlers directly; the HTTP transport is not part of these page tests.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({ handler: <T,>(handler: () => T) => handler }),
}));

// Clerk has not loaded during SSR: the page must not depend on it.
vi.mock("@/lib/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, session: null, loading: true, signOut: async () => {} }),
}));

import { Route as DashboardRoute } from "@/app/routes/dashboard/index";
import { Route as SettingsRoute } from "@/app/routes/settings";
import { requirePageAccess } from "@/lib/auth/page-access";

const identity: SessionIdentity = {
  userId: "user-123",
  clerkUserId: "clerk_123",
  sessionId: "sess_123",
};

const authorized: AuthorizationState = {
  has_consent: true,
  is_admin: false,
  is_disabled: false,
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

function loadDashboard() {
  // SAFETY: This loader ignores its context and calls the mocked server handler directly.
  const loader = DashboardRoute.options.loader as () => Promise<{
    watchlist: Watchlist;
    ownerClerkUserId: string;
  }>;

  return loader();
}

function loadSettings() {
  // SAFETY: This loader ignores its context and calls the mocked server handler directly.
  const loader = SettingsRoute.options.loader as () => Promise<{
    account: { email: string; created_at: string } | undefined;
  }>;

  return loader();
}

async function renderDashboard() {
  const { watchlist, ownerClerkUserId } = await loadDashboard();

  return renderWithRouter(
    <MotionProvider>
      <DashboardView initial={watchlist} ownerClerkUserId={ownerClerkUserId} />
    </MotionProvider>,
  );
}

describe("server-rendered authenticated pages", () => {
  const fetchSpy = vi.fn<typeof fetch>();

  beforeEach(() => {
    getSessionIdentity.mockResolvedValue(identity);
    readAuthorizationState.mockResolvedValue(authorized);
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

    const html = await renderDashboard();

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

    expect(await renderDashboard()).toContain("Your watchlist is empty");
  });

  it("redirects to sign-in without reading data when the session is missing", async () => {
    getSessionIdentity.mockResolvedValue(null);

    await expect(loadDashboard()).rejects.toMatchObject({ options: { href: "/sign-in" } });
    expect(getDbFromEnv).not.toHaveBeenCalled();
  });

  it("redirects an unconsented visitor using the protected page path, not the RPC path", async () => {
    getDbFromEnv.mockReturnValue(createScriptedPostgres().db);
    readAuthorizationState.mockResolvedValue({ ...authorized, has_consent: false });

    await expect(loadSettings()).rejects.toMatchObject({
      options: { href: "/consent?next=%2Fsettings" },
    });
  });

  it("revokes and clears a disabled visitor's session", async () => {
    getDbFromEnv.mockReturnValue(createScriptedPostgres().db);
    readAuthorizationState.mockResolvedValue({ ...authorized, is_disabled: true });

    await expect(requirePageAccess("/dashboard")).rejects.toMatchObject({
      options: { href: "/sign-in?error=account_disabled" },
    });
    expect(revokeSession).toHaveBeenCalledWith(identity.sessionId);
    expect(appendResponseHeader).toHaveBeenCalledWith("Set-Cookie", expect.any(Array));
  });

  it("renders the account email from the user's own row in settings", async () => {
    const pg = createScriptedPostgres(() => [
      { email: "sparky@asu.edu", created_at: "2026-01-01T12:00:00Z" },
    ]);

    getDbFromEnv.mockReturnValue(pg.db);
    const data = await loadSettings();
    vi.spyOn(SettingsRoute, "useLoaderData").mockReturnValue(data);
    const component = SettingsRoute.options.component;

    if (!component) throw new Error("Settings route must have a component");

    const html = await renderWithRouter(createElement(component));

    expect(html).toContain("sparky@asu.edu");
    expect(html).toContain("2026");
    expect(pg.statements[0]?.params).toContain(identity.userId);
  });
});
