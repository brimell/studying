import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

interface AlertWarningInput {
  key: string;
  title: string;
  message: string;
  severity: "warning" | "critical";
}

function sanitizeWarnings(input: unknown): AlertWarningInput[] {
  if (!Array.isArray(input)) return [];
  const warnings: AlertWarningInput[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const value = item as Record<string, unknown>;
    const key = typeof value.key === "string" ? value.key.trim().slice(0, 120) : "";
    const title = typeof value.title === "string" ? value.title.trim().slice(0, 120) : "";
    const message = typeof value.message === "string" ? value.message.trim().slice(0, 300) : "";
    const severity = value.severity === "critical" ? "critical" : "warning";
    if (!key || !title || !message) continue;
    warnings.push({ key, title, message, severity });
    if (warnings.length >= 20) break;
  }
  return warnings;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(session as { user?: { email?: string } }).user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return NextResponse.json({ ok: false, skipped: true, reason: "RESEND_API_KEY not set" });
  }

  const sender = process.env.ALERT_FROM_EMAIL;
  if (!sender) {
    return NextResponse.json({ ok: false, skipped: true, reason: "ALERT_FROM_EMAIL not set" });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const warnings = sanitizeWarnings((body as { warnings?: unknown })?.warnings);
  if (warnings.length === 0) {
    return NextResponse.json({ ok: false, skipped: true, reason: "No warnings" });
  }

  const toEmail =
    process.env.ALERT_TO_EMAIL ||
    ((session as { user?: { email?: string } }).user?.email as string);

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
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: sender,
      to: [toEmail],
      subject,
      text: textBody,
    }),
  });

  const payload = (await response.json()) as { id?: string; message?: string };
  if (!response.ok) {
    return NextResponse.json(
      { error: payload.message || "Failed to send alert email" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, id: payload.id || null });
}
