/**
 * Browser telemetry through `@hyperdx/browser`: traces, console logs, errors
 * and product actions (no session replay), posted to the Worker's `/otel`
 * proxy. The SDK is about 190 KB gzipped, so it loads after the page's `load`
 * event in its own chunk. Calls made before then queue on the import.
 *
 * Keep the pnpm SDK exporter patch: its session resource getter can be
 * undefined, and automatic metrics can contain non-finite numbers. OpenObserve
 * v1.1.2 rejects their empty/null AnyValues with HTTP 400. The patch filters
 * them and repairs truncated UTF-16 before serialization; the proxy also
 * sanitizes old SDK payloads already running in browser tabs.
 */
import { errorFields } from "@/lib/log";

type HyperDX = (typeof import("@hyperdx/browser"))["default"];

// A type alias, not an interface, so it passes as OTel `Attributes`.
type BoundaryErrorFields = { boundary: "app" };

/** Product actions and their fields: opaque ids only, never emails or names. */
interface BrowserActionMap {
  onboarding_started: Record<never, never>;
  onboarding_completed: Record<never, never>;
  data_exported: Record<never, never>;
  user_logged_in: Record<never, never>;
  user_logged_out: Record<never, never>;
}

let sdk: Promise<HyperDX> | undefined;

function afterLoad(): Promise<void> {
  if (document.readyState === "complete") return Promise.resolve();

  return new Promise((resolve) => window.addEventListener("load", () => resolve(), { once: true }));
}

async function loadSdk(): Promise<HyperDX> {
  await afterLoad();
  const { default: hyperdx } = await import("@hyperdx/browser");

  hyperdx.init({
    url: `${location.origin}/otel`,
    // Required by the type. The proxy drops it and attaches the real key.
    apiKey: "proxy",
    service: "pickmyclass-web",
    // Same-origin requests always carry traceparent. Listing only our own
    // origin keeps it off Clerk, Umami and every other third party.
    tracePropagationTargets: [location.origin],
    consoleCapture: true,
    // Request and response bodies carry emails and Clerk tokens.
    advancedNetworkCapture: false,
    // Off: admin pages show other users' data, and replay is gzipped protobuf
    // the proxy can't scrub.
    disableReplay: true,
    disableIntercom: true,
    // Same build-time tags as the Worker's logs (vite.config.ts `define`).
    otelResourceAttributes: {
      "service.version": __BUILD_COMMIT__,
      "deployment.environment": __DEPLOYMENT_ENVIRONMENT__,
    },
  });

  return hyperdx;
}

function withSdk(use: (hyperdx: HyperDX) => void): void {
  // A failed chunk load leaves telemetry off rather than throwing at callers.
  void sdk?.then(use, () => undefined);
}

/** Called once from `app/client.tsx`; a no-op everywhere else. */
export function startBrowserTelemetry(): void {
  sdk ??= loadSdk();
}

export function trackBrowserAction<E extends keyof BrowserActionMap>(
  action: E,
  fields: BrowserActionMap[E],
): void {
  withSdk((hyperdx) => hyperdx.addAction(action, fields));
}

/** Tags every later span with the Clerk user id; `null` clears it on sign-out. */
export function setTelemetryUser(clerkUserId: string | null): void {
  withSdk((hyperdx) => hyperdx.setGlobalAttributes({ userId: clerkUserId ?? "" }));
}

/**
 * Reports a caught error with the same scrubbing as server logs. React's own
 * console.error of the raw error is captured too; the /otel proxy redacts
 * emails in it.
 */
export function recordBrowserError(cause: unknown, attributes: BoundaryErrorFields): void {
  const fields = errorFields(cause);
  const error = new Error(fields["error.message"]);
  error.name = fields["error.name"];

  if (fields.stack) error.stack = fields.stack;

  withSdk((hyperdx) => hyperdx.recordException(error, attributes));
}
