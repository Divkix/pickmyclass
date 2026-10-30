import { Data, Effect, Option, Schema } from "effect";
import { ASU_REQUEST_TIMEOUT_MS } from "@/lib/config";
import { externalCall } from "@/lib/effect/external-call";
import { errorFields, log } from "@/lib/log";
import { type SectionRef, sectionFields } from "@/lib/section-ref";
import type { ClassDetails } from "@/lib/types/class";
import type { Env } from "@/lib/types/env";
import { buildUrl } from "@/lib/utils/url";

class AsuNotFound extends Data.TaggedError("AsuNotFound")<{ message: string }> {}

class AsuAuth extends Data.TaggedError("AsuAuth")<{ message: string }> {}

class AsuRateLimited extends Data.TaggedError("AsuRateLimited")<{
  message: string;
  retryAfterSeconds?: number;
}> {}

class AsuUpstream extends Data.TaggedError("AsuUpstream")<{
  message: string;
  status?: number;
}> {}

export class AsuTimedOut extends Data.TaggedError("AsuTimedOut")<{ message: string }> {}

/** A 2xx response whose body does not match the API contract; retrying cannot fix it. */
class AsuInvalidResponse extends Data.TaggedError("AsuInvalidResponse")<{
  message: string;
  status?: number;
}> {}

export type AsuError =
  | AsuNotFound
  | AsuAuth
  | AsuRateLimited
  | AsuUpstream
  | AsuTimedOut
  | AsuInvalidResponse;

// Unconfirmed on this endpoint, so an unexpected shape reads as unknown (null)
// instead of failing every Section Check.
const LenientString = Schema.NullOr(Schema.String).pipe(
  Schema.catchDecoding(() => Effect.succeed(Option.some(null))),
);

// ASU omits optional fields on some sections and returns null on others; both mean unknown.
const OptionalNullableString = Schema.optionalKey(Schema.NullOr(Schema.String));
const OptionalNullableStringArray = Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String)));

const AsuApiClassItem = Schema.Struct({
  CLASSNBR: Schema.String,
  SUBJECT: Schema.String,
  CATALOGNBR: Schema.String,
  TITLE: OptionalNullableString,
  COURSETITLELONG: OptionalNullableString,
  ENRLCAP: Schema.String,
  ENRLTOT: Schema.String,
  FACILITYID: OptionalNullableString,
  MON: OptionalNullableString,
  TUES: OptionalNullableString,
  WED: OptionalNullableString,
  THURS: OptionalNullableString,
  FRI: OptionalNullableString,
  WAITTOT: Schema.String,
  WAITCAP: OptionalNullableString,
  INSTRUCTORSLIST: OptionalNullableStringArray,
  STARTTIME: OptionalNullableString,
  ENDTIME: OptionalNullableString,
  SESSIONCODE: Schema.optionalKey(LenientString),
  STARTDATE: Schema.optionalKey(LenientString),
  ENDDATE: Schema.optionalKey(LenientString),
  INSTRUCTIONMODE: Schema.optionalKey(LenientString),
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
    return "Times not listed";
  }

  return `${days.join("")} ${formatTime(item.STARTTIME)}-${formatTime(item.ENDTIME)}`;
}

/** ASU files online and hybrid sections under the "INTRT" facility (DESCR1 "Internet"), not a room. */
function describeLocation(item: AsuApiClassItem): string {
  if (item.FACILITYID === "INTRT") {
    return item.INSTRUCTIONMODE === "HY" ? "Hybrid (online and in person)" : "Online";
  }

  return item.FACILITYID || "Room not listed";
}

const ASU_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]|$)/;

/** ASU's "2026-08-20 00:00:00.0" as "2026-08-20"; null unless it is a real calendar day. */
function parseAsuDate(value: string): string | null {
  const match = ASU_DATE.exec(value.trim());

  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  return date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day)
    ? `${year}-${month}-${day}`
    : null;
}

interface SeatCounts {
  capacity: number;
  enrolled: number;
  waitlisted: number;
}

/** ASU sends counts as digit strings; anything else is unknown and must not become zero. */
function parseSeatCount(value: string): number | null {
  const trimmed = value.trim();

  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

function mapToClassDetails(item: AsuApiClassItem, seats: SeatCounts): ClassDetails {
  return {
    subject: item.SUBJECT,
    catalog_nbr: item.CATALOGNBR,
    title: item.COURSETITLELONG || item.TITLE || "Unknown",
    instructor_name: item.INSTRUCTORSLIST?.[0] || "Staff",
    seats_available: Math.max(0, seats.capacity - seats.enrolled),
    seats_capacity: seats.capacity,
    non_reserved_seats: Math.max(0, seats.capacity - seats.enrolled - seats.waitlisted),
    location: describeLocation(item),
    meeting_times: composeMeetingTimes(item),
    start_date: item.STARTDATE ? parseAsuDate(item.STARTDATE) : null,
    end_date: item.ENDDATE ? parseAsuDate(item.ENDDATE) : null,
    session_code: item.SESSIONCODE?.trim() || null,
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
  return Effect.gen(function* () {
    if (!env.ASU_API_BASE_URL || !env.ASU_API_TOKEN) {
      return yield* new AsuUpstream({
        message: "ASU API environment variables not configured",
      });
    }

    const url = buildClassSearchUrl(env.ASU_API_BASE_URL, ref.class_nbr, ref.term);

    const { response, body } = yield* externalCall(
      async (signal) => {
        const response = await fetch(url, {
          headers: { Authorization: normalizeAuthHeader(env.ASU_API_TOKEN) },
          signal,
        });

        if (response.status === 401 || response.status === 403) {
          throw new AsuAuth({ message: "ASU API token expired or invalid" });
        }

        if (response.status === 429) {
          throw new AsuRateLimited({
            message: "ASU API rate limit hit",
            retryAfterSeconds: parseRetryAfterSeconds(response.headers.get("retry-after")),
          });
        }

        if (!response.ok) {
          throw new AsuUpstream({
            message: `ASU API returned ${response.status}`,
            status: response.status,
          });
        }

        try {
          return { response, body: await response.json() };
        } catch (error) {
          if (signal.aborted) throw error;

          if (error instanceof SyntaxError) {
            log("AsuClient").error("Invalid ASU JSON", {
              ...sectionFields(ref),
              http_status: response.status,
              ...errorFields(error),
            });

            throw new AsuInvalidResponse({
              message: "ASU API returned invalid JSON",
              status: response.status,
            });
          }

          log("AsuClient").error("ASU response read failed", {
            ...sectionFields(ref),
            http_status: response.status,
            ...errorFields(error),
          });

          throw new AsuUpstream({
            message: `ASU API response read failed: ${String(error)}`,
            status: response.status,
          });
        }
      },
      ASU_REQUEST_TIMEOUT_MS,
      (error) =>
        error instanceof AsuAuth ||
        error instanceof AsuRateLimited ||
        error instanceof AsuUpstream ||
        error instanceof AsuInvalidResponse
          ? error
          : new AsuUpstream({ message: "ASU API request failed" }),
      () => new AsuTimedOut({ message: "ASU API request timed out" }),
    );

    const data = yield* Schema.decodeUnknownEffect(AsuApiResponse)(body).pipe(
      Effect.tapError((error) =>
        Effect.sync(() =>
          log("AsuClient").error("Invalid ASU response", {
            ...sectionFields(ref),
            ...errorFields(error),
          }),
        ),
      ),
      Effect.mapError(
        () =>
          new AsuInvalidResponse({
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

    const capacity = parseSeatCount(matching._source.ENRLCAP);
    const enrolled = parseSeatCount(matching._source.ENRLTOT);
    const waitlisted = parseSeatCount(matching._source.WAITTOT);

    if (capacity === null || enrolled === null || waitlisted === null) {
      log("AsuClient").error("Unusable ASU seat counts", {
        ...sectionFields(ref),
        ENRLCAP: matching._source.ENRLCAP,
        ENRLTOT: matching._source.ENRLTOT,
        WAITTOT: matching._source.WAITTOT,
      });

      return yield* new AsuInvalidResponse({
        message: `ASU API returned unusable seat counts for ${ref.class_nbr}`,
        status: response.status,
      });
    }

    return mapToClassDetails(matching._source, { capacity, enrolled, waitlisted });
  });
}
