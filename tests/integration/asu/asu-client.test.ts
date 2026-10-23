import { it as effectIt } from "@effect/vitest";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import {
  ApiError,
  AuthError,
  fetchClassFromASU,
  NotFoundError,
  RateLimitError,
} from "@/lib/asu/api";
import { AsuUpstream, fetchClassEffect, parseRetryAfterSeconds } from "@/lib/asu/asu-client";
import { ASU_REQUEST_TIMEOUT_MS } from "@/lib/config";

const ref = { class_nbr: "98765", term: "2267" };

const env = { ASU_API_BASE_URL: "https://asu.test/api/", ASU_API_TOKEN: " token " };

function body(classNbr = ref.class_nbr, extra: Record<string, string | number | null> = {}) {
  return {
    hits: {
      total: { value: 1 },
      hits: [
        {
          _source: {
            CLASSNBR: classNbr,
            SUBJECT: "CSE",
            CATALOGNBR: "110",
            TITLE: "Programming",
            ENRLCAP: "30",
            ENRLTOT: "25",
            WAITTOT: "2",
            INSTRUCTORSLIST: ["Professor"],
            MON: "Y",
            WED: "Y",
            STARTTIME: "13:15",
            ENDTIME: "14:30",
            ...extra,
          },
        },
      ],
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ASU Promise compatibility", () => {
  it("preserves Retry-After parsing for seconds, dates, and invalid headers", () => {
    expect(parseRetryAfterSeconds("1.2")).toBe(2);
    expect(parseRetryAfterSeconds("-2")).toBe(0);
    expect(parseRetryAfterSeconds(null)).toBeUndefined();
    expect(parseRetryAfterSeconds("invalid")).toBeUndefined();
    expect(
      parseRetryAfterSeconds("Thu, 15 Oct 2026 12:02:00 GMT", Date.parse("2026-10-15T12:00:00Z")),
    ).toBe(120);
  });
  it("decodes and maps ASU data, passes auth, and scopes the URL by SectionRef", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(body()));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchClassFromASU(ref, env, { useCache: false })).toMatchObject({
      subject: "CSE",
      title: "Programming",
      seats_available: 5,
      non_reserved_seats: 3,
      instructor_name: "Professor",
      meeting_times: "MW 1:15 PM-2:30 PM",
      start_date: null,
      end_date: null,
      session_code: null,
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("classNbr=98765&term=2267"),
      expect.objectContaining({
        headers: { Authorization: "Bearer token" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("maps ASU session dates and code when present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          body(ref.class_nbr, {
            SESSIONCODE: " C ",
            STARTDATE: "2026-08-20 00:00:00.0",
            ENDDATE: "2026-12-04 00:00:00.0",
          }),
        ),
      ),
    );
    expect(await fetchClassFromASU(ref, env, { useCache: false })).toMatchObject({
      start_date: "2026-08-20",
      end_date: "2026-12-04",
      session_code: "C",
    });
  });

  it.each([
    { SESSIONCODE: "", STARTDATE: "2026-02-30 00:00:00.0", ENDDATE: "12/04/2026" },
    { SESSIONCODE: 7, STARTDATE: 1787184000000, ENDDATE: null },
  ])("reads unusable session fields as unknown instead of failing the check", async (extra) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body(ref.class_nbr, extra))));
    expect(await fetchClassFromASU(ref, env, { useCache: false })).toMatchObject({
      seats_available: 5,
      start_date: null,
      end_date: null,
      session_code: null,
    });
  });

  it("reads null optional fields as unknown instead of failing the check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          body(ref.class_nbr, {
            TITLE: null,
            COURSETITLELONG: null,
            WAITCAP: null,
            FACILITYID: null,
            MON: null,
            TUES: null,
            WED: null,
            THURS: null,
            FRI: null,
            INSTRUCTORSLIST: null,
            STARTTIME: null,
            ENDTIME: null,
          }),
        ),
      ),
    );

    expect(await fetchClassFromASU(ref, env, { useCache: false })).toMatchObject({
      title: "Unknown",
      seats_available: 5,
      seats_capacity: 30,
      instructor_name: "Staff",
      meeting_times: "TBD",
      location: "TBD",
    });
  });

  it.each<Record<string, string | number | null>>([
    { ENRLCAP: null },
    { ENRLTOT: null },
    { WAITTOT: null },
    { ENRLTOT: "not-a-number" },
    { ENRLTOT: "" },
  ])("rejects unusable seat counts instead of reporting false availability", async (extra) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body(ref.class_nbr, extra))));

    await expect(fetchClassFromASU(ref, env, { useCache: false })).rejects.toMatchObject({
      name: "ApiError",
      retryable: false,
      message: expect.stringMatching(/invalid response|unusable seat counts/),
    });
  });

  it.each([401, 403, 429, 500])("preserves legacy error classes for HTTP %s", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status, headers: { "retry-after": "123" } })),
    );
    const expected = status === 429 ? RateLimitError : status < 429 ? AuthError : ApiError;
    await expect(fetchClassFromASU(ref, env, { useCache: false })).rejects.toBeInstanceOf(expected);

    if (status === 429)
      await expect(fetchClassFromASU(ref, env, { useCache: false })).rejects.toMatchObject({
        retryAfterSeconds: 123,
      });
  });

  it.each([
    {},
    { hits: { total: { value: 1 }, hits: [{}] } },
    { hits: { total: { value: 1 }, hits: [{ _source: { CLASSNBR: 98765 } }] } },
  ])(
    "treats malformed success payloads as upstream failures, preventing false retirement",
    async (value) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(() => Promise.resolve(Response.json(value))),
      );
      await expect(fetchClassFromASU(ref, env, { useCache: false })).rejects.toMatchObject({
        name: "ApiError",
        message: expect.stringContaining("invalid response"),
        retryable: false,
      });
    },
  );

  it("maps invalid JSON to a non-retryable ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON")));
    await expect(fetchClassFromASU(ref, env, { useCache: false })).rejects.toMatchObject({
      name: "ApiError",
      retryable: false,
    });
  });

  it.each([{ hits: { total: { value: 0 }, hits: [] } }, body("other")])(
    "keeps valid empty and unmatched responses as NotFound",
    async (value) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(value)));
      await expect(fetchClassFromASU(ref, env, { useCache: false })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    },
  );

  it("uses the cache for UI reads and bypasses it for fresh observations", async () => {
    const unique = { ...ref, class_nbr: "cache-check" };

    const fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json(body(unique.class_nbr))));

    vi.stubGlobal("fetch", fetch);
    await fetchClassFromASU(unique, env);
    await fetchClassFromASU(unique, env);
    expect(fetch).toHaveBeenCalledOnce();
    await fetchClassFromASU(unique, env, { useCache: false });
    expect(fetch).toHaveBeenCalledTimes(2);
    await fetchClassFromASU({ ...unique, term: "2271" }, env);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

effectIt.effect("times out and aborts the ASU request with TestClock", () =>
  Effect.gen(function* () {
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, options: RequestInit) => {
        if (options.signal) requestSignal = options.signal;

        return new Promise<Response>(() => {});
      }),
    );
    const fiber = yield* fetchClassEffect(ref, env).pipe(Effect.flip, Effect.forkChild);
    yield* TestClock.adjust(ASU_REQUEST_TIMEOUT_MS);
    const error = yield* Fiber.join(fiber);
    expect(error).toBeInstanceOf(AsuUpstream);
    expect(error).toMatchObject({ status: 408 });
    expect(requestSignal?.aborted).toBe(true);
  }),
);
