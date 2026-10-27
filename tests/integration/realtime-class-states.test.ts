import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { requestClassStates } from "@/lib/hooks/useRealtimeClassStates";

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
