import { DrizzleQueryError } from "drizzle-orm/errors";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { errorFields, log, logRequestError, redactEmails, tagLogs } from "@/lib/log";

describe("log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes one object per line with level, scope, msg and fields", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    log("Queue").warn("Section Check failed", { class_nbr: "12345", attempts: 2 });

    expect(warnSpy).toHaveBeenCalledWith({
      level: "warn",
      scope: "Queue",
      msg: "Section Check failed",
      class_nbr: "12345",
      attempts: 2,
      "service.version": "dev",
      "deployment.environment": "development",
    });
  });

  it("tags lines with the Worker version once an entrypoint supplies it", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    tagLogs("9f2c1d7e-version");
    log("Queue").info("tagged", { "service.version": "spoofed" });
    tagLogs(undefined);
    log("Queue").info("untagged");

    expect(infoSpy.mock.calls.map(([line]) => line)).toEqual([
      expect.objectContaining({ msg: "tagged", "service.version": "9f2c1d7e-version" }),
      expect.objectContaining({ msg: "untagged", "service.version": "dev" }),
    ]);
  });

  it("never lets a field overwrite level, scope or msg", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    log("Queue").info("real", { msg: "fake", level: "error", scope: "Other" });

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ level: "info", scope: "Queue", msg: "real" }),
    );
  });
});

describe("errorFields", () => {
  it("keeps the message, name and stack of an Error", () => {
    const fields = errorFields(new TypeError("boom"));

    expect(fields).toMatchObject({ "error.message": "boom", "error.name": "TypeError" });
    expect(fields.stack).toMatch(/^TypeError: boom\n\s+at /);
  });

  it("drops Drizzle's bound params from the message and the stack", () => {
    const driverError = Object.assign(new Error("duplicate key value"), { code: "23505" });

    const error = new DrizzleQueryError(
      "insert into users (email) values ($1)",
      ["student@asu.edu"],
      driverError,
    );

    const fields = errorFields(error);

    expect(fields).toMatchObject({ "error.message": "duplicate key value", "error.code": "23505" });
    expect(JSON.stringify(fields)).not.toContain("student@asu.edu");
    expect(JSON.stringify(fields)).not.toContain("params");
  });

  it("redacts email addresses a provider echoes back", () => {
    const fields = errorFields(new Error("recipient student@asu.edu is not verified"));

    expect(fields["error.message"]).toBe("recipient [email] is not verified");
    expect(fields.stack).not.toContain("student@asu.edu");
  });

  it("keeps Firefox and Safari frames, which have no `at` prefix", () => {
    const error = new Error("boom");
    error.stack =
      "onClick@https://pickmyclass.app/assets/app.js:1:200\n@https://pickmyclass.app/assets/app.js:2:10";

    expect(errorFields(error).stack).toBe(
      "Error: boom\nonClick@https://pickmyclass.app/assets/app.js:1:200\n@https://pickmyclass.app/assets/app.js:2:10",
    );
  });

  it("redacts a megabyte of hostile text without catastrophic backtracking", () => {
    const hostile = `${"a".repeat(1 << 20)}@b ${"x@".repeat(1 << 18)} student@asu.edu`;

    expect(redactEmails(hostile).endsWith(" [email]")).toBe(true);
  });

  it("caps long messages", () => {
    expect(errorFields(new Error("x".repeat(5000)))["error.message"]).toHaveLength(1000);
  });

  it("tolerates non-Error throws", () => {
    expect(errorFields("plain string")).toEqual({
      "error.message": "plain string",
      "error.name": "NonError",
    });
    expect(errorFields(undefined)).toEqual({
      "error.message": "undefined",
      "error.name": "NonError",
    });
  });
});

describe("logRequestError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the stack, method and path without the query string", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logRequestError(
      new Error("boom"),
      new Request("https://pickmyclass.app/api/unsubscribe?token=secret"),
    );

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [line] = errorSpy.mock.calls[0];
    expect(line).toMatchObject({
      level: "error",
      scope: "RequestError",
      method: "GET",
      path: "/api/unsubscribe",
      "error.message": "boom",
    });
    expect(line.stack).toContain("Error: boom");
    expect(line.stack).toContain("log.test.ts");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("secret");
  });

  it("names the server function that failed", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logRequestError(
      new Error("boom"),
      new Request("https://pickmyclass.app/_serverFn/loadDashboard", { method: "POST" }),
      "loadDashboard",
    );

    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      method: "POST",
      server_fn: "loadDashboard",
    });
  });

  it("logs a non-Error throw instead of crashing", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const thrown = { name: "Thrown", message: "nope", toString: () => "thrown: nope" };

    logRequestError(thrown, new Request("https://pickmyclass.app/api/x", { method: "POST" }));

    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      "error.name": "Thrown",
      "error.message": "nope",
    });
  });
});
