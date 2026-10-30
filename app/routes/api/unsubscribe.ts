import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { unsubscribeTokenSchema } from "@/lib/api/schemas";
import { parseOrFail } from "@/lib/api/validation";
import { methodNotAllowed, fail, ok } from "@/lib/api/response";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { escapeHtml } from "@/lib/utils/escape-html";

import { getDbFromEnv } from "@/lib/db";
import type { Database } from "@/lib/db";
import { userProfiles } from "@/lib/db/schema";
import { errorFields, log, logEvent } from "@/lib/log";

function redactIdentifier(userId: string): string {
  return createHash("sha256").update(userId).digest("hex");
}

function htmlPage(title: string, content: string, status: number): Response {
  const linkStyles =
    status === 200
      ? `
    a { color: #8C1D40; text-decoration: none; }
    a:hover { text-decoration: underline; }`
      : "";

  return new Response(
    `<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 50px auto;
      padding: 20px;
      text-align: center;
    }
    .error { color: #dc2626; }
    .success { color: #059669; }${linkStyles}
  </style>
</head>
<body>
${content}
</body>
</html>`,
    { status, headers: { "Content-Type": "text/html" } },
  );
}

async function unsubscribeUser(
  db: Database,
  userId: string,
  method: "GET" | "POST",
): Promise<void> {
  try {
    await db
      .update(userProfiles)
      .set({ notifications_enabled: false, unsubscribed_at: new Date().toISOString() })
      .where(eq(userProfiles.user_id, userId));
  } catch (dbError) {
    log("Unsubscribe").error("Database error", errorFields(dbError));
    throw dbError;
  }

  logEvent("user_unsubscribed", { user_id_hash: redactIdentifier(userId), method });
}

export const Route = createFileRoute("/api/unsubscribe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const searchParams = new URL(request.url).searchParams;
        const token = searchParams.get("token");

        const parsed = parseOrFail(unsubscribeTokenSchema, { token });

        if (!parsed.success) {
          return htmlPage(
            "Invalid Unsubscribe Link",
            `  <h1 class="error">Invalid Unsubscribe Link</h1>
  <p>This unsubscribe link is invalid or missing required information.</p>
  <p><a href="/">Return to PickMyClass</a></p>`,
            400,
          );
        }

        const userId = verifyUnsubscribeToken(parsed.data.token);

        if (!userId) {
          return htmlPage(
            "Invalid Unsubscribe Token",
            `  <h1 class="error">Invalid or Expired Token</h1>
  <p>This unsubscribe link is invalid or has expired.</p>
  <p>You can turn email alerts on or off in Settings.</p>
  <p><a href="/">Return to PickMyClass</a></p>`,
            400,
          );
        }

        const encodedToken = encodeURIComponent(parsed.data.token);
        const escapedAction = escapeHtml(`/api/unsubscribe?token=${encodedToken}`);

        return htmlPage(
          "Confirm Unsubscribe",
          `  <h1>Confirm Unsubscribe</h1>
  <p>You are about to unsubscribe from all PickMyClass email notifications.</p>
  <p>Click the button below to confirm.</p>
  <form method="POST" action="${escapedAction}">
    <button type="submit" style="background:#8C1D40;color:#fff;border:none;padding:12px 24px;font-size:16px;border-radius:6px;cursor:pointer;">Confirm Unsubscribe</button>
  </form>
  <p><a href="/">Return to PickMyClass</a></p>`,
          200,
        );
      },

      /**
       * Browser confirmation POSTs receive HTML when requested; one-click
       * email clients keep JSON responses for RFC 8058 List-Unsubscribe-Post.
       */
      POST: async ({ request }) => {
        const acceptsHtml = request.headers.get("Accept")?.includes("text/html");
        const searchParams = new URL(request.url).searchParams;
        const token = searchParams.get("token");

        const parsed = parseOrFail(unsubscribeTokenSchema, { token });

        if (!parsed.success) {
          return acceptsHtml
            ? htmlPage(
                "Invalid Unsubscribe Link",
                `  <h1 class="error">Invalid Unsubscribe Link</h1>
  <p>This unsubscribe link is invalid or missing required information.</p>
  <p><a href="/">Return to PickMyClass</a></p>`,
                400,
              )
            : parsed.response;
        }

        const userId = verifyUnsubscribeToken(parsed.data.token);

        if (!userId) {
          return acceptsHtml
            ? htmlPage(
                "Invalid Unsubscribe Token",
                `  <h1 class="error">Invalid or Expired Token</h1>
  <p>This unsubscribe link is invalid or has expired.</p>
  <p>You can turn email alerts on or off in Settings.</p>
  <p><a href="/">Return to PickMyClass</a></p>`,
                400,
              )
            : fail("Invalid or expired token", 400);
        }

        const db = getDbFromEnv();

        try {
          await unsubscribeUser(db, userId, "POST");

          return acceptsHtml
            ? htmlPage(
                "Unsubscribed",
                `  <h1 class="success">Unsubscribed</h1>
  <p>You have been unsubscribed from all PickMyClass email notifications.</p>
  <p>You can turn email alerts back on in <a href="/settings">Settings → Email alerts</a>.</p>
  <p><a href="/">Return to PickMyClass</a></p>`,
                200,
              )
            : ok(null);
        } catch (error) {
          log("Unsubscribe").error("Error processing unsubscribe", errorFields(error));

          return acceptsHtml
            ? htmlPage(
                "Unsubscribe Failed",
                `  <h1 class="error">Unsubscribe Failed</h1>
  <p>Internal server error</p>
  <p><a href="/">Return to PickMyClass</a></p>`,
                500,
              )
            : fail("Internal server error", 500);
        }
      },
      ANY: methodNotAllowed,
    },
  },
});
