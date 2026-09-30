/**
 * Post-deploy: submit the live sitemap's URLs to IndexNow. Always exits 0 —
 * the deploy has already shipped, and a missed ping only delays a recrawl.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { log } from "../lib/log";
import { submitSitemapToIndexNow } from "../lib/seo/indexnow";

const indexNowLog = log("IndexNow");

try {
  const outcome = await submitSitemapToIndexNow({
    fetch,
    sleep: (ms) => sleep(ms),
    attempts: 6,
    delayMs: 10_000,
  });

  if (outcome.kind === "submitted") {
    indexNowLog.info(`Submitted ${outcome.urlCount} URLs (HTTP ${outcome.httpStatus})`);
  } else {
    indexNowLog.warn(`Skipped: ${outcome.reason}`);
  }
} catch (error) {
  indexNowLog.warn("Skipped after unexpected error:", error);
}

process.exit(0);
