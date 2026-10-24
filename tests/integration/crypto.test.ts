import { describe, expect, it } from "vite-plus/test";

import { timingSafeCompare } from "@/lib/utils/crypto";

describe("timingSafeCompare", () => {
  it.each([
    ["same secret", "same secret", true],
    ["", "", true],
    ["sëcret", "sëcret", true],
    ["secret-a", "secret-b", false],
    ["short", "a much longer secret", false],
    ["a much longer secret", "short", false],
    ["", "secret", false],
  ])("compares %j and %j without throwing", (left, right, equal) => {
    expect(timingSafeCompare(left, right)).toBe(equal);
  });
});
