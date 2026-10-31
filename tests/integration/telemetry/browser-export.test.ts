import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vite-plus/test";

type Input =
  | string
  | number
  | boolean
  | null
  | undefined
  | Uint8Array
  | Input[]
  | { [key: string]: Input };

interface Attribute {
  key: string;
  value: object;
}

const bundle = readFileSync(new URL(import.meta.resolve("@hyperdx/browser")), "utf8");
// These pinned functions contain no brace literals; count their block/object
// braces to execute the installed exporter, not a copy of its behavior.
function serializerSource(name: string): string {
  const start = bundle.indexOf(`function ${name}(`);
  if (start < 0) throw new Error("HyperDX OTLP serializer patch needs updating");
  const body = bundle.indexOf("{", start);
  let depth = 0;

  for (let index = body; index < bundle.length; index += 1) {
    if (bundle[index] === "{") depth += 1;
    if (bundle[index] === "}") depth -= 1;
    if (depth === 0) return bundle.slice(start, index + 1);
  }

  throw new Error("Incomplete HyperDX OTLP serializer");
}

const declarations = ["uL", "lL"].map(serializerSource);

// SAFETY: the two SDK functions only need Uint8Array and the supplied bytes encoder.
const serialize = runInNewContext(`${declarations.join(";")}; uL`, { Uint8Array }) as (
  attributes: Record<string, Input>,
  encoder: { encodeUint8Array: (value: Uint8Array) => string },
) => Attribute[];

const encoder = { encodeUint8Array: (value: Uint8Array) => Buffer.from(value).toString("base64") };

// A JSON round trip is the exact boundary where NaN/Infinity previously became
// null doubles, which OpenObserve v1.1.2 rejects for the entire batch with 400.
const exported = (attributes: Record<string, Input>) =>
  JSON.parse(JSON.stringify(serialize(attributes, encoder)));

describe("browser OTLP exporter compatibility", () => {
  it("omits undefined session resource getters instead of emitting an empty AnyValue", () => {
    expect(
      exported({
        get "rum.sessionId"() {
          return undefined;
        },
        "service.name": "pickmyclass-web",
      }),
    ).toEqual([{ key: "service.name", value: { stringValue: "pickmyclass-web" } }]);
  });

  it.each([NaN, Infinity, -Infinity])(
    "omits a non-finite metric %s without inventing zero",
    (value) => {
      expect(exported({ metric: value, valid: 1.5 })).toEqual([
        { key: "valid", value: { doubleValue: 1.5 } },
      ]);
    },
  );

  it("filters null and invalid values recursively, preserving valid array and object data", () => {
    expect(
      exported({
        nested: { missing: undefined, bad: Infinity, text: "kept" },
        list: [null, NaN, undefined, 2],
      }),
    ).toEqual([
      {
        key: "nested",
        value: { kvlistValue: { values: [{ key: "text", value: { stringValue: "kept" } }] } },
      },
      { key: "list", value: { arrayValue: { values: [{ intValue: 2 }] } } },
    ]);
  });

  it("emits unsafe integers as finite doubles rather than overflowing int64", () => {
    expect(exported({ large: 2 ** 64, small: -(2 ** 64), safe: Number.MAX_SAFE_INTEGER })).toEqual([
      { key: "large", value: { doubleValue: 2 ** 64 } },
      { key: "small", value: { doubleValue: -(2 ** 64) } },
      { key: "safe", value: { intValue: Number.MAX_SAFE_INTEGER } },
    ]);
  });

  it("repairs lone UTF-16 surrogates while preserving complete emoji", () => {
    expect(exported({ ["bad\ud800"]: "start\ud800\ud83d\ude00\udfffend" })).toEqual([
      { key: "bad\ufffd", value: { stringValue: "start\ufffd\ud83d\ude00\ufffdend" } },
    ]);
  });

  it("preserves booleans, byte arrays and intentionally empty containers", () => {
    expect(exported({ enabled: true, bytes: new Uint8Array([1, 2]), array: [], object: {} })).toEqual([
      { key: "enabled", value: { boolValue: true } },
      { key: "bytes", value: { bytesValue: "AQI=" } },
      { key: "array", value: { arrayValue: { values: [] } } },
      { key: "object", value: { kvlistValue: { values: [] } } },
    ]);
  });
});
