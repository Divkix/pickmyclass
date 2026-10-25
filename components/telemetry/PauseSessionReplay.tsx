import { useEffect } from "react";
import { pauseSessionReplay, resumeSessionReplay } from "@/lib/telemetry/browser";

/** Stops session replay while mounted: admin URLs and pages carry other users' data. */
export function PauseSessionReplay() {
  useEffect(() => {
    pauseSessionReplay();

    return resumeSessionReplay;
  }, []);

  return null;
}
