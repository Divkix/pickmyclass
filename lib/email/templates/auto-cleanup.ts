import {
  AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE,
  DEFAULT_SITE_URL,
  EMAIL_BATCH_DELAY_MS,
  EMAIL_BATCH_SIZE,
  NOTIFICATION_FROM_EMAIL,
} from "@/lib/config";
import { generateUnsubscribeUrl } from "@/lib/email/unsubscribe-token";
import { EmailSendFailed, EmailTimedOut, isFatalEmailCode } from "@/lib/email/errors";
import { sendEmailMessage } from "@/lib/email/transport";
import { errorFields, log } from "@/lib/log";
import { type SectionRef, sectionFields } from "@/lib/section-ref";
import { escapeHtml } from "@/lib/utils/escape-html";
import type { ClassWatcher } from "@/lib/db/queries";
import { buildClassEmailShell } from "./index";

interface BuildAutoCleanupRemovedEmailParams {
  classNbr: string;
  term: string;
  subject?: string | null;
  catalogNbr?: string | null;
  title?: string | null;
  unsubscribeUrl?: string;
}

interface AutoCleanupRemovedEmail {
  html: string;
  text: string;
  subject: string;
}

function buildAutoCleanupRemovedEmail(
  params: BuildAutoCleanupRemovedEmailParams,
): AutoCleanupRemovedEmail {
  const { classNbr, term, subject, catalogNbr, title, unsubscribeUrl } = params;

  const safeClassNbr = escapeHtml(classNbr);
  const safeTerm = escapeHtml(term);
  const safeSubject = subject ? escapeHtml(subject) : "";
  const safeCatalogNbr = catalogNbr ? escapeHtml(catalogNbr) : "";
  const safeTitle = title ? escapeHtml(title) : "";

  const rawSubject = subject?.trim() || "";
  const rawCatalog = catalogNbr?.trim() || "";
  const rawTitle = title?.trim() || "";

  const rawLabel = rawSubject
    ? rawCatalog
      ? `${rawSubject} ${rawCatalog}`
      : rawSubject
    : rawCatalog
      ? `${rawCatalog} ${classNbr}`
      : classNbr;

  const rawIdentifier = (catalogNbr || classNbr).replace(/[<>"'&]/g, "");

  const emailSubject = `Watched class ${rawIdentifier} removed — no longer in ASU catalog`;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL;
  const dashboardUrl = `${siteUrl.replace(/\/+$/, "")}/dashboard`;
  const safeDashboardUrl = escapeHtml(dashboardUrl);

  const classLabel =
    safeSubject && safeCatalogNbr
      ? `${safeSubject} ${safeCatalogNbr}`
      : safeSubject || safeCatalogNbr || safeClassNbr;

  const titleLine = safeTitle ? `: ${safeTitle}` : "";

  const bodyHtml = `
    <p style="font-size: 16px; margin-top: 0;">
      A class you were watching is no longer listed in the ASU catalog.
    </p>

    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #6b7280;">
      <h2 style="margin: 0 0 10px 0; color: #1f2937; font-size: 20px;">
        ${classLabel}${titleLine}
      </h2>
      <p style="margin: 5px 0; color: #6b7280; font-size: 14px;">
        <strong>Section:</strong> ${safeClassNbr}
      </p>
      <p style="margin: 5px 0; color: #6b7280; font-size: 14px;">
        <strong>Term:</strong> ${safeTerm}
      </p>
      ${
        safeTitle
          ? `<p style="margin: 5px 0; color: #6b7280; font-size: 14px;"><strong>Title:</strong> ${safeTitle}</p>`
          : ""
      }
    </div>

    <p style="font-size: 14px; color: #6b7280; margin: 20px 0;">
      We checked the ASU catalog 3 times and this section could not be found. It may have been
      cancelled, renumbered, or removed for this term. Your watch has been removed automatically — no action is needed.
    </p>

    <p style="font-size: 14px; color: #6b7280; margin: 20px 0;">
      You can browse other sections or create a new watch from your dashboard:
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${safeDashboardUrl}" style="display: inline-block; background: linear-gradient(135deg, #6b7280 0%, #374151 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
        Go to Dashboard
      </a>
    </div>
  `.trim();

  const preheader = `Watched class ${rawIdentifier} was removed — no longer in ASU catalog`;

  const html = buildClassEmailShell({
    variant: "removed",
    title: escapeHtml(emailSubject),
    unsubscribeUrl,
    bodyHtml,
    preheader,
  });

  const textLines = [
    `A class you were watching is no longer listed in the ASU catalog.`,
    ``,
    `${rawLabel}${rawTitle ? `: ${rawTitle}` : ""}`,
    `Section: ${classNbr}`,
    `Term: ${term}`,
    ...(rawTitle ? [`Title: ${rawTitle}`] : []),
    ``,
    `We checked the ASU catalog 3 times and this section could not be found. It may have been cancelled, renumbered, or removed for this term. Your watch has been removed automatically — no action is needed.`,
    ``,
    `Manage your watches: ${dashboardUrl}`,
  ];

  if (unsubscribeUrl) {
    textLines.push("", `Unsubscribe: ${unsubscribeUrl}`);
  }

  textLines.push(
    "",
    `You're receiving this email because you're watching this class on PickMyClass.`,
  );

  const text = textLines.join("\n");

  return {
    html,
    text,
    subject: emailSubject,
  };
}

export interface AutoCleanupSendResult {
  success: boolean;
  watchId: string;
  error?: string;
  attempted: boolean;
}

export async function sendAutoCleanupRemovalEmails(
  params: {
    ref: SectionRef;
    classInfo?: {
      subject?: string | null;
      catalog_nbr?: string | null;
      title?: string | null;
    } | null;
    watchers: ClassWatcher[];
  },
  emailBinding: SendEmail,
  fromEmail?: string,
): Promise<AutoCleanupSendResult[]> {
  const { ref, classInfo } = params;
  let watchers = params.watchers;
  const from = fromEmail || NOTIFICATION_FROM_EMAIL;

  if (watchers.length === 0) {
    log("Email").info("Auto-cleanup: no watchers to notify", sectionFields(ref));

    return [];
  }

  if (watchers.length > AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE) {
    log("Email").warn("Auto-cleanup watchers exceed the email cap, truncating", {
      ...sectionFields(ref),
      watchers: watchers.length,
      email_cap: AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE,
      removed_without_email: watchers.length - AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE,
    });
    watchers = watchers.slice(0, AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE);
  }

  log("Email").info("Auto-cleanup: notifying watchers of removed section", {
    ...sectionFields(ref),
    watchers: watchers.length,
  });

  const results: AutoCleanupSendResult[] = [];

  for (let i = 0; i < watchers.length; i++) {
    const watcher = watchers[i];
    const unsubscribeUrl = generateUnsubscribeUrl(watcher.user_id);

    const built = buildAutoCleanupRemovedEmail({
      classNbr: ref.class_nbr,
      term: ref.term,
      subject: classInfo?.subject ?? null,
      catalogNbr: classInfo?.catalog_nbr ?? null,
      title: classInfo?.title ?? null,
      unsubscribeUrl,
    });

    try {
      await sendEmailMessage(emailBinding, {
        to: watcher.email,
        from,
        subject: built.subject,
        html: built.html,
        text: built.text,
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });

      results.push({ success: true, watchId: watcher.watch_id, attempted: true });
    } catch (error) {
      const errorCode =
        error instanceof EmailSendFailed
          ? error.code
          : error instanceof EmailTimedOut
            ? "TIMEOUT"
            : "UNKNOWN";

      const errorMessage = error instanceof Error ? error.message : "Email send failed";

      log("Email").error("Auto-cleanup email send failed", {
        ...sectionFields(ref),
        user_id: watcher.user_id,
        "email.code": errorCode,
        ...errorFields(error),
      });

      results.push({
        success: false,
        watchId: watcher.watch_id,
        error: `${errorCode}: ${errorMessage}`,
        attempted: true,
      });

      if (isFatalEmailCode(errorCode)) {
        for (let j = i + 1; j < watchers.length; j++) {
          const remaining = watchers[j];
          results.push({
            success: false,
            watchId: remaining.watch_id,
            error: `Skipped after ${errorCode}`,
            attempted: false,
          });
        }

        log("Email").warn("Stopped auto-cleanup batch on fatal provider error", {
          ...sectionFields(ref),
          "email.code": errorCode,
          position: i + 1,
          total: watchers.length,
        });
        break;
      }
    }

    if (
      watchers.length > EMAIL_BATCH_SIZE &&
      (i + 1) % EMAIL_BATCH_SIZE === 0 &&
      i < watchers.length - 1
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, EMAIL_BATCH_DELAY_MS));
    }
  }

  const successCount = results.filter((r) => r.success).length;
  log("Email").info("Auto-cleanup batch complete", {
    ...sectionFields(ref),
    sent: successCount,
    total: watchers.length,
  });

  return results;
}
