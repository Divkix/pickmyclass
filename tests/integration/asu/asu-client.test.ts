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
import { AsuTimedOut, fetchClassEffect, parseRetryAfterSeconds } from "@/lib/asu/asu-client";
import { ASU_REQUEST_TIMEOUT_MS } from "@/lib/config";

const ref = { class_nbr: "98765", term: "2267" };

const env = { ASU_API_BASE_URL: "https://asu.test/api/", ASU_API_TOKEN: " token " };

type BodyReadError = Error | DOMException;

function erroredResponse(error: BodyReadError): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.error(error);
      },
    }),
    { status: 200 },
  );
}

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

  it.each<[number, typeof ApiError, number]>([
    [401, AuthError, 401],
    [403, AuthError, 401],
    [429, RateLimitError, 429],
    [500, ApiError, 500],
  ])(
    "preserves legacy error classes and status for HTTP %s",
    async (status, expected, legacyStatus) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(new Response(null, { status, headers: { "retry-after": "123" } })),
      );
      const pending = fetchClassFromASU(ref, env, { useCache: false });

      await expect(pending).rejects.toBeInstanceOf(expected);
      await expect(pending).rejects.toMatchObject({ status: legacyStatus, retryable: true });

      if (status === 429) await expect(pending).rejects.toMatchObject({ retryAfterSeconds: 123 });
    },
  );

  it.each<[string, number | undefined]>([
    ["Thu, 15 Oct 2026 12:02:00 GMT", 120],
    ["invalid", undefined],
  ])("preserves Retry-After %s through the legacy adapter", async (header, retryAfterSeconds) => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-15T12:00:00Z"));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 429, headers: { "retry-after": header } })),
    );

    await expect(fetchClassFromASU(ref, env, { useCache: false })).rejects.toMatchObject({
      name: "RateLimitError",
      status: 429,
      retryAfterSeconds,
    });
  });

  it("keeps transport failures retryable without an HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(fetchClassFromASU(ref, env, { useCache: false })).rejects.toMatchObject({
      name: "ApiError",
      message: "ASU API request failed",
      status: undefined,
      retryable: true,
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
        status: 200,
        message: expect.stringContaining("invalid response"),
        retryable: false,
      });
    },
  );

  it("records one asu_request event per network fetch, with its outcome", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body())));
    await fetchClassFromASU(ref, env, { useCache: false });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body("other"))));
    await expect(fetchClassFromASU(ref, env, { useCache: false })).rejects.toThrow();

    expect(info.mock.calls.map(([line]) => line)).toEqual([
      expect.objectContaining({ event: "asu_request", ...ref, outcome: "ok", http_status: 200 }),
      expect.objectContaining({ event: "asu_request", outcome: "NotFoundError", http_status: 404 }),
    ]);
  });

  it("maps invalid JSON to a non-retryable ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON")));
    await expect(fetchClassFromASU(ref, env, { useCache: false })).rejects.toMatchObject({
      name: "ApiError",
      status: 200,
      retryable: false,
    });
  });

  it.each<[string, BodyReadError]>([
    ["network error", new TypeError("network error")],
    ["abort", new DOMException("The operation was aborted.", "AbortError")],
  ])("keeps a failed response body read retryable (%s)", async (_name, error) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(erroredResponse(error)));

    await expect(fetchClassFromASU(ref, env, { useCache: false })).rejects.toMatchObject({
      name: "ApiError",
      status: 200,
      retryable: true,
      message: expect.stringContaining("read failed"),
    });
  });

  it("includes body reads in the total timeout and maps their abort to a retryable 408", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;

    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          bodyController = controller;
        },
      }),
    );

    const json = vi.spyOn(response, "json");

    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, options: RequestInit) => {
        if (options.signal) {
          requestSignal = options.signal;
          options.signal.addEventListener(
            "abort",
            () =>
              bodyController?.error(new DOMException("The operation was aborted.", "AbortError")),
            { once: true },
          );
        }

        const { promise, resolve } = Promise.withResolvers<Response>();
        setTimeout(() => resolve(response), ASU_REQUEST_TIMEOUT_MS / 2);

        return promise;
      }),
    );

    const pending = fetchClassFromASU(ref, env, { useCache: false }).then(
      () => undefined,
      (error: Error) => error,
    );

    await vi.advanceTimersByTimeAsync(ASU_REQUEST_TIMEOUT_MS / 2);
    expect(json).toHaveBeenCalledOnce();
    expect(requestSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(ASU_REQUEST_TIMEOUT_MS / 2);
    const error = await pending;

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: "ASU API request timed out",
      status: 408,
      retryable: true,
    });
    expect(requestSignal?.aborted).toBe(true);
  });

  it("aborts the request when interrupted during a body read", async () => {
    const readingBody = Promise.withResolvers<void>();
    let requestSignal: AbortSignal | undefined;

    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, options: RequestInit) => {
        requestSignal = options.signal ?? undefined;
        const response = new Response();
        vi.spyOn(response, "json").mockImplementation(() => {
          readingBody.resolve();

          return Promise.withResolvers<never>().promise;
        });

        return Promise.resolve(response);
      }),
    );
    const controller = new AbortController();

    const pending = Effect.runPromise(fetchClassEffect(ref, env), {
      signal: controller.signal,
    }).then(
      () => undefined,
      (error: Error) => error,
    );

    await readingBody.promise;
    controller.abort();
    expect(await pending).toBeInstanceOf(Error);
    expect(requestSignal?.aborted).toBe(true);
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
    expect(error).toBeInstanceOf(AsuTimedOut);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("ASU API request timed out");
    expect(requestSignal?.aborted).toBe(true);
  }),
);
