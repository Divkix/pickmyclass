import { Data, Effect, Schema } from "effect";
import { ASU_REQUEST_TIMEOUT_MS } from "@/lib/config";
import type { SectionRef } from "@/lib/section-ref";
import type { ClassDetails } from "@/lib/types/class";
import type { Env } from "@/lib/types/env";
import { buildUrl } from "@/lib/utils/url";

export class AsuNotFound extends Data.TaggedError("AsuNotFound")<{ message: string }> {}

export class AsuAuth extends Data.TaggedError("AsuAuth")<{ message: string }> {}

export class AsuRateLimited extends Data.TaggedError("AsuRateLimited")<{
  message: string;
  retryAfterSeconds?: number;
}> {}

export class AsuUpstream extends Data.TaggedError("AsuUpstream")<{
  message: string;
  status?: number;
}> {}

export type AsuError = AsuNotFound | AsuAuth | AsuRateLimited | AsuUpstream;

const AsuApiClassItem = Schema.Struct({
  CLASSNBR: Schema.String,
  SUBJECT: Schema.String,
  CATALOGNBR: Schema.String,
  TITLE: Schema.optionalKey(Schema.String),
  COURSETITLELONG: Schema.optionalKey(Schema.String),
  ENRLCAP: Schema.optionalKey(Schema.String),
  ENRLTOT: Schema.optionalKey(Schema.String),
  FACILITYID: Schema.optionalKey(Schema.String),
  MON: Schema.optionalKey(Schema.String),
  TUES: Schema.optionalKey(Schema.String),
  WED: Schema.optionalKey(Schema.String),
  THURS: Schema.optionalKey(Schema.String),
  FRI: Schema.optionalKey(Schema.String),
  WAITTOT: Schema.optionalKey(Schema.String),
  WAITCAP: Schema.optionalKey(Schema.String),
  INSTRUCTORSLIST: Schema.optionalKey(Schema.Array(Schema.String)),
  STARTTIME: Schema.optionalKey(Schema.NullOr(Schema.String)),
  ENDTIME: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

type AsuApiClassItem = typeof AsuApiClassItem.Type;

const AsuApiResponse = Schema.Struct({
  hits: Schema.Struct({
    total: Schema.Struct({ value: Schema.Finite }),
    hits: Schema.Array(Schema.Struct({ _source: AsuApiClassItem })),
  }),
});

const CLASS_SEARCH_ENDPOINT_PATH = "search/classes";

/** `Retry-After` as delta-seconds or an HTTP date; undefined when absent or unparseable. */
export function parseRetryAfterSeconds(
  header: string | null,
  now = Date.now(),
): number | undefined {
  if (!header) return undefined;

  const seconds = Number(header);

  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));

  const date = Date.parse(header);

  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - now) / 1000));
}

function formatTime(time: string): string {
  const [hourStr, minuteStr] = time.split(":");
  let hour = Number.parseInt(hourStr, 10);
  const minute = minuteStr || "00";
  const period = hour >= 12 ? "PM" : "AM";

  if (hour === 0) hour = 12;
  else if (hour > 12) hour -= 12;

  return `${hour}:${minute} ${period}`;
}

function composeMeetingTimes(item: AsuApiClassItem): string {
  const days: string[] = [];

  if (item.MON === "Y") days.push("M");

  if (item.TUES === "Y") days.push("Tu");

  if (item.WED === "Y") days.push("W");

  if (item.THURS === "Y") days.push("Th");

  if (item.FRI === "Y") days.push("F");

  if (days.length === 0 || !item.STARTTIME || !item.ENDTIME) {
    return "TBD";
  }

  return `${days.join("")} ${formatTime(item.STARTTIME)}-${formatTime(item.ENDTIME)}`;
}

function mapToClassDetails(item: AsuApiClassItem): ClassDetails {
  const rawCap = Number.parseInt(item.ENRLCAP || "0", 10);
  const rawTot = Number.parseInt(item.ENRLTOT || "0", 10);
  const rawWait = Number.parseInt(item.WAITTOT || "0", 10);
  const enrlCap = Number.isNaN(rawCap) ? 0 : rawCap;
  const enrlTot = Number.isNaN(rawTot) ? 0 : rawTot;
  const waitTot = Number.isNaN(rawWait) ? 0 : rawWait;

  return {
    subject: item.SUBJECT,
    catalog_nbr: item.CATALOGNBR,
    title: item.COURSETITLELONG || item.TITLE || "Unknown",
    instructor_name: item.INSTRUCTORSLIST?.[0] || "Staff",
    seats_available: Math.max(0, enrlCap - enrlTot),
    seats_capacity: enrlCap,
    non_reserved_seats: Math.max(0, enrlCap - enrlTot - waitTot),
    location: item.FACILITYID || "TBD",
    meeting_times: composeMeetingTimes(item),
  };
}

function buildClassSearchUrl(baseUrl: string, classNbr: string, term: string): string {
  return buildUrl(baseUrl, CLASS_SEARCH_ENDPOINT_PATH, { classNbr, term });
}

function normalizeAuthHeader(token: string): string {
  const trimmed = token.trim();

  if (trimmed.length === 0) return trimmed;

  if (/^Bearer\s+/i.test(trimmed)) return trimmed;

  return `Bearer ${trimmed}`;
}

/** Fresh ASU observation; the Promise adapter owns the UI cache. */
export function fetchClassEffect(
  ref: SectionRef,
  env: Pick<Env, "ASU_API_BASE_URL" | "ASU_API_TOKEN">,
): Effect.Effect<ClassDetails, AsuError> {
  return Effect.acquireUseRelease(
    Effect.sync(() => new AbortController()),
    (controller) =>
      Effect.gen(function* () {
        if (!env.ASU_API_BASE_URL || !env.ASU_API_TOKEN) {
          return yield* new AsuUpstream({
            message: "ASU API environment variables not configured",
          });
        }

        const url = buildClassSearchUrl(env.ASU_API_BASE_URL, ref.class_nbr, ref.term);

        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(url, {
              headers: { Authorization: normalizeAuthHeader(env.ASU_API_TOKEN) },
              signal: controller.signal,
            }),
          catch: () => new AsuUpstream({ message: "ASU API request failed" }),
        });

        if (response.status === 401 || response.status === 403) {
          return yield* new AsuAuth({ message: "ASU API token expired or invalid" });
        }

        if (response.status === 429) {
          return yield* new AsuRateLimited({
            message: "ASU API rate limit hit",
            retryAfterSeconds: parseRetryAfterSeconds(response.headers.get("retry-after")),
          });
        }

        if (!response.ok) {
          return yield* new AsuUpstream({
            message: `ASU API returned ${response.status}`,
            status: response.status,
          });
        }

        const body = yield* Effect.tryPromise({
          try: () => response.json(),
          catch: () =>
            new AsuUpstream({ message: "ASU API returned invalid JSON", status: response.status }),
        });

        const data = yield* Schema.decodeUnknownEffect(AsuApiResponse)(body).pipe(
          Effect.mapError(
            () =>
              new AsuUpstream({
                message: "ASU API returned an invalid response",
                status: response.status,
              }),
          ),
        );

        if (data.hits.hits.length === 0)
          return yield* new AsuNotFound({ message: `Section ${ref.class_nbr} not found` });
        const matching = data.hits.hits.find((hit) => hit._source.CLASSNBR === ref.class_nbr);

        if (!matching)
          return yield* new AsuNotFound({
            message: `Section ${ref.class_nbr} not found in response`,
          });

        return mapToClassDetails(matching._source);
      }),
    (controller) => Effect.sync(() => controller.abort()),
  ).pipe(
    Effect.timeoutOrElse({
      duration: ASU_REQUEST_TIMEOUT_MS,
      orElse: () =>
        Effect.fail(new AsuUpstream({ message: "ASU API request timed out", status: 408 })),
    }),
  );
}
