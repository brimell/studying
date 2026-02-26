import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  ApiRouteError,
  apiJson,
  apiLog,
  assertRateLimit,
  checkIdempotencyReplay,
  clientAddress,
  createApiRequestContext,
  handleApiError,
  idempotencyFingerprint,
  parseJsonBody,
  storeIdempotencyResult,
} from "@/lib/api-runtime";
import { getAlertEmailEnv } from "@/lib/env";

const ALERT_DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000;
const alertSendCacheByUser = new Map<string, { summary: string; sentAt: number }>();
const alertEnv = getAlertEmailEnv();

const warningSchema = z.object({
  key: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(300),
  severity: z.enum(["warning", "critical"]).default("warning"),
});

const postBodySchema = z.object({
  warnings: z.array(warningSchema).min(1).max(20),
});

function summarizeWarnings(warnings: z.infer<typeof warningSchema>[]): string {
  return JSON.stringify(warnings.map((item) => `${item.key}:${item.severity}:${item.message}`));
}

export async function POST(req: NextRequest) {
  const context = createApiRequestContext(req, "/api/alerts/notify");

  try {
    const session = await auth();
    const userEmail = (session as { user?: { email?: string } } | null)?.user?.email || null;
    if (!userEmail) {
      throw new ApiRouteError(401, "UNAUTHORIZED", "auth", "Unauthorized");
    }

    assertRateLimit({
      key: `alerts:notify:${userEmail}:${clientAddress(req)}`,
      limit: 12,
      windowMs: 10 * 60 * 1000,
    });

    const body = await parseJsonBody(req, postBodySchema);
    const idempotencyKey = req.headers.get("idempotency-key");
    const fingerprint = idempotencyFingerprint(body);
    const replay = checkIdempotencyReplay(`alerts:notify:${userEmail}`, idempotencyKey, fingerprint);
    if (replay) {
      replay.headers.set("x-request-id", context.requestId);
      return replay;
    }

    if (!alertEnv.resendApiKey) {
      const skippedBody = { ok: false, skipped: true, reason: "RESEND_API_KEY not set" };
      storeIdempotencyResult({
        scope: `alerts:notify:${userEmail}`,
        idempotencyKey,
        fingerprint,
        status: 200,
        body: skippedBody,
      });
      return apiJson(skippedBody, context);
    }
    if (!alertEnv.alertFromEmail) {
      const skippedBody = { ok: false, skipped: true, reason: "ALERT_FROM_EMAIL not set" };
      storeIdempotencyResult({
        scope: `alerts:notify:${userEmail}`,
        idempotencyKey,
        fingerprint,
        status: 200,
        body: skippedBody,
      });
      return apiJson(skippedBody, context);
    }

    const warnings = body.warnings;
    if (warnings.length === 0) {
      const skippedBody = { ok: false, skipped: true, reason: "No warnings" };
      storeIdempotencyResult({
        scope: `alerts:notify:${userEmail}`,
        idempotencyKey,
        fingerprint,
        status: 200,
        body: skippedBody,
      });
      return apiJson(skippedBody, context);
    }

    const warningSummary = summarizeWarnings(warnings);
    const now = Date.now();
    for (const [key, value] of alertSendCacheByUser.entries()) {
      if (now - value.sentAt > ALERT_DEDUPE_WINDOW_MS) {
        alertSendCacheByUser.delete(key);
      }
    }

    const lastSent = alertSendCacheByUser.get(userEmail);
    if (lastSent && lastSent.summary === warningSummary && now - lastSent.sentAt < ALERT_DEDUPE_WINDOW_MS) {
      const dedupedBody = { ok: true, skipped: true, deduped: true };
      storeIdempotencyResult({
        scope: `alerts:notify:${userEmail}`,
        idempotencyKey,
        fingerprint,
        status: 200,
        body: dedupedBody,
      });
      return apiJson(dedupedBody, context);
    }

    const toEmail = alertEnv.alertToEmail || userEmail;
    const subjectPrefix = warnings.some((item) => item.severity === "critical")
      ? "Critical Study Alerts"
      : "Study Alerts";
    const subject = `${subjectPrefix} (${warnings.length})`;
    const textBody = [
      "Study Stats warning summary:",
      "",
      ...warnings.map((item, index) => `${index + 1}. ${item.title}\n${item.message}`),
      "",
      `Generated at: ${new Date().toISOString()}`,
    ].join("\n");

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alertEnv.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: alertEnv.alertFromEmail,
        to: [toEmail],
        subject,
        text: textBody,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!response.ok) {
      throw new ApiRouteError(
        502,
        "EMAIL_PROVIDER_ERROR",
        "upstream",
        payload.message || "Failed to send alert email."
      );
    }

    alertSendCacheByUser.set(userEmail, {
      summary: warningSummary,
      sentAt: now,
    });

    const responseBody = { ok: true, id: payload.id || null };
    storeIdempotencyResult({
      scope: `alerts:notify:${userEmail}`,
      idempotencyKey,
      fingerprint,
      status: 200,
      body: responseBody,
    });
    apiLog("info", context, "alert_email_sent", {
      userEmail,
      warningCount: warnings.length,
      criticalCount: warnings.filter((item) => item.severity === "critical").length,
    });
    return apiJson(responseBody, context);
  } catch (error: unknown) {
    return handleApiError(error, context, "Failed to process alert notification.");
  }
}
