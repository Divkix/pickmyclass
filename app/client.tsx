// First: sets Zod's config before any imported module builds a schema.
import "@/lib/utils/zod-jitless";
import { StartClient } from "@tanstack/react-start/client";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { startBrowserTelemetry } from "@/lib/telemetry/browser";

startBrowserTelemetry();

hydrateRoot(
  document,
  <StrictMode>
    <StartClient />
  </StrictMode>,
);
