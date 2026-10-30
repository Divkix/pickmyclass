import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createElement } from "react";
import type { EffectCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { requestClassStates, useRealtimeClassStates } from "@/lib/hooks/useRealtimeClassStates";
import type {
  UseRealtimeClassStatesOptions,
  UseRealtimeClassStatesReturn,
} from "@/lib/hooks/useRealtimeClassStates";
import type { ClassStateRow } from "@/lib/types/class-watch";

const mountEffects: EffectCallback[] = vi.hoisted(() => []);

vi.mock(import("react"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEffect: (effect: EffectCallback) => {
    mountEffects.push(effect);
  },
}));

vi.mock("@/lib/contexts/AuthContext", () => ({
  useAuth: () => ({ refreshSession: async () => {} }),
}));

const state = { class_nbr: "12345", term: "2267", seats_available: 3 };

function stubFetch(...statuses: number[]) {
  const fetchMock = vi.fn(async () => {
    const status = statuses.shift() ?? 500;

    return Response.json(status === 200 ? { classStates: [state] } : { error: "x" }, { status });
  });

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

describe("requestClassStates session recovery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refreshes the session after a 401 and returns the retried poll's states", async () => {
    const fetchMock = stubFetch(401, 200);
    const refreshSession = vi.fn(async () => {});

    const states = await requestClassStates("12345", new AbortController().signal, refreshSession);

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(states).toEqual({ "2267:12345": { ...state, consecutive_not_found_count: 0 } });
  });

  it("retries only once when the refreshed session is still rejected", async () => {
    const fetchMock = stubFetch(401, 401);
    const refreshSession = vi.fn(async () => {});

    await expect(
      requestClassStates("12345", new AbortController().signal, refreshSession),
    ).rejects.toThrow("Failed to fetch class states: 401");
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not refresh the session for non-auth failures", async () => {
    const fetchMock = stubFetch(403);
    const refreshSession = vi.fn(async () => {});

    await expect(
      requestClassStates("12345", new AbortController().signal, refreshSession),
    ).rejects.toThrow("Failed to fetch class states: 403");
    expect(refreshSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useRealtimeClassStates initial state", () => {
  const cleanups: (() => void)[] = [];

  const seedStates = {
    "2267:12345": {
      ...state,
      id: "state-1",
      subject: "CSE",
      catalog_nbr: "240",
      title: "Intro to Programming",
      instructor_name: "John Doe",
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
    },
  } satisfies Record<string, ClassStateRow>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    mountEffects.length = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function mount(options: UseRealtimeClassStatesOptions) {
    const results: UseRealtimeClassStatesReturn[] = [];

    function Probe() {
      results.push(useRealtimeClassStates(options));

      return null;
    }

    renderToStaticMarkup(createElement(Probe));

    // Run the real mount effects after SSR to cover fetches in the node-only test environment.
    for (const effect of mountEffects.splice(0)) {
      const cleanup = effect();

      if (cleanup) cleanups.push(cleanup);
    }

    return results[0];
  }

  it("starts ready with fully seeded states without fetching", () => {
    const fetchMock = stubFetch(200);
    const result = mount({ classNumbers: ["12345"], seedStates });

    expect(result).toMatchObject({ classStates: seedStates, loading: false, error: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts loading and fetches when no states are seeded", () => {
    const fetchMock = stubFetch(200);
    const result = mount({ classNumbers: ["12345"] });

    expect(result).toMatchObject({ classStates: {}, loading: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("starts loading and fetches when only some states are seeded", () => {
    const fetchMock = stubFetch(200);
    const result = mount({ classNumbers: ["12345", "67890"], seedStates });

    expect(result).toMatchObject({ classStates: {}, loading: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
