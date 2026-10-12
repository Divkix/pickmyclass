import { describe, expect, it } from "vite-plus/test";
import { claimLoginSession, type LoginSessionStore } from "@/lib/analytics/login-session";

function memoryStore(): LoginSessionStore {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("claimLoginSession", () => {
  it("claims a Clerk session once, however many times it is seen", () => {
    const store = memoryStore();

    expect(claimLoginSession(() => store, "sess_first")).toBe(true);
    expect(claimLoginSession(() => store, "sess_first")).toBe(false);
    expect(claimLoginSession(() => store, "sess_first")).toBe(false);
  });

  it("claims again when a new Clerk session starts", () => {
    const store = memoryStore();

    expect(claimLoginSession(() => store, "sess_first")).toBe(true);
    expect(claimLoginSession(() => store, "sess_second")).toBe(true);
    expect(claimLoginSession(() => store, "sess_second")).toBe(false);
  });

  it("does not claim when browser storage is unavailable", () => {
    expect(
      claimLoginSession(() => {
        throw new Error("SecurityError: storage is disabled");
      }, "sess_first"),
    ).toBe(false);
  });
});
