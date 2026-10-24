import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  formatAbsoluteDate,
  formatRelativeDate,
  formatRelativeTime,
} from "@/lib/utils/time-format";

afterEach(() => vi.useRealTimers());

describe("user-facing timestamps", () => {
  it("defaults to the Arizona calendar day, including during daylight saving time", () => {
    expect(formatAbsoluteDate("2026-07-01T06:30:00Z")).toBe("Jun 30, 2026");
    expect(formatAbsoluteDate("2026-01-01T06:30:00Z")).toBe("Dec 31, 2025");
  });

  it("keeps explicitly UTC publication dates on their published day", () => {
    expect(formatAbsoluteDate("2026-07-01", { timeZone: "UTC" })).toBe("Jul 1, 2026");
  });

  it("retains existing relative date and time labels", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
    expect(formatRelativeTime("2026-10-24T11:59:00Z")).toBe("1m ago");
    expect(formatRelativeDate("2026-10-23T12:00:00Z")).toBe("Yesterday");
    expect(formatRelativeDate(null)).toBeNull();
  });
});
