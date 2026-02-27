import { createHash, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z, type ZodTypeAny } from "zod";

export type ApiErrorCategory =
  | "auth"
  | "validation"
  | "rate_limit"
  | "upstream"
  | "conflict"
  | "internal";

export class ApiRouteError extends Error {
  status: number;
  code: string;
  category: ApiErrorCategory;
  details?: unknown;

  constructor(
    status: number,
    code: string,
    category: ApiErrorCategory,
    message: string,
    details?: unknown
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.category = category;
    this.details = details;
  }
}

interface ApiRequestContext {
  route: string;
  method: string;
  requestId: string;
  startedAt: number;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

interface IdempotencyRecord {
  fingerprint: string;
  status: number;
  body: unknown;
  expiresAt: number;
}

declare global {
  var __studyStatsRateLimitBuckets: Map<string, RateBucket> | undefined;
  var __studyStatsIdempotencyRecords: Map<string, IdempotencyRecord> | undefined;
}

const rateLimitBuckets = globalThis.__studyStatsRateLimitBuckets || new Map<string, RateBucket>();
globalThis.__studyStatsRateLimitBuckets = rateLimitBuckets;

const idempotencyRecords =
  globalThis.__studyStatsIdempotencyRecords || new Map<string, IdempotencyRecord>();
globalThis.__studyStatsIdempotencyRecords = idempotencyRecords;

function nowIso(): string {
  return new Date().toISOString();
}

export function createApiRequestContext(req: NextRequest, route: string): ApiRequestContext {
  const headerId = req.headers.get("x-request-id")?.trim();
  return {
    route,
    method: req.method,
    requestId: headerId || randomUUID(),
    startedAt: Date.now(),
  };
}

export function apiLog(
  level: "info" | "warn" | "error",
  context: ApiRequestContext,
  event: string,
  fields: Record<string, unknown> = {}
): void {
  const payload = {
    timestamp: nowIso(),
    event,
    level,
    requestId: context.requestId,
    route: context.route,
    method: context.method,
    ...fields,
  };
  const serialized = JSON.stringify(payload);
  if (level === "error") {
    console.error(serialized);
    return;
  }
  if (level === "warn") {
    console.warn(serialized);
    return;
  }
  console.info(serialized);
}

function withRequestIdHeader(response: NextResponse, requestId: string): NextResponse {
  response.headers.set("x-request-id", requestId);
  return response;
}

export function apiJson(
  body: unknown,
  context: ApiRequestContext,
  init?: { status?: number; headers?: Record<string, string> }
): NextResponse {
  const response = NextResponse.json(body, {
    status: init?.status,
    headers: init?.headers,
  });
  return withRequestIdHeader(response, context.requestId);
}

function zodIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export async function parseJsonBody<TSchema extends ZodTypeAny>(
  req: NextRequest,
  schema: TSchema
): Promise<z.infer<TSchema>> {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    throw new ApiRouteError(400, "INVALID_JSON", "validation", "Invalid JSON body.");
  }

  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    throw new ApiRouteError(
      400,
      "VALIDATION_ERROR",
      "validation",
      "Request validation failed.",
      zodIssues(parsed.error)
    );
  }
  return parsed.data;
}

export function parseQuery<TSchema extends ZodTypeAny>(
  req: NextRequest,
  schema: TSchema
): z.infer<TSchema> {
  const url = new URL(req.url);
  const rawParams = Object.fromEntries(url.searchParams.entries());
  const parsed = schema.safeParse(rawParams);
  if (!parsed.success) {
    throw new ApiRouteError(
      400,
      "QUERY_VALIDATION_ERROR",
      "validation",
      "Query validation failed.",
      zodIssues(parsed.error)
    );
  }
  return parsed.data;
}

export function clientAddress(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const candidate = forwarded.split(",")[0]?.trim();
    if (candidate) return candidate;
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

export function assertRateLimit(options: {
  key: string;
  limit: number;
  windowMs: number;
}): void {
  const now = Date.now();
  const existing = rateLimitBuckets.get(options.key);
  if (!existing || existing.resetAt <= now) {
    rateLimitBuckets.set(options.key, {
      count: 1,
      resetAt: now + options.windowMs,
    });
    return;
  }

  if (existing.count >= options.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    throw new ApiRouteError(
      429,
      "RATE_LIMITED",
      "rate_limit",
      "Too many requests. Please retry later.",
      { retryAfterSeconds }
    );
  }

  existing.count += 1;
  rateLimitBuckets.set(options.key, existing);
}

export function idempotencyFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
}

export function checkIdempotencyReplay(
  scope: string,
  idempotencyKey: string | null | undefined,
  fingerprint: string
): NextResponse | null {
  if (!idempotencyKey) return null;
  const trimmed = idempotencyKey.trim();
  if (!trimmed) return null;

  const key = `${scope}:${trimmed}`;
  const now = Date.now();
  const record = idempotencyRecords.get(key);
  if (!record) return null;
  if (record.expiresAt <= now) {
    idempotencyRecords.delete(key);
    return null;
  }
  if (record.fingerprint !== fingerprint) {
    throw new ApiRouteError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "conflict",
      "Idempotency key already used with a different payload."
    );
  }
  const response = NextResponse.json(record.body, { status: record.status });
  response.headers.set("x-idempotent-replay", "true");
  return response;
}

export function storeIdempotencyResult(options: {
  scope: string;
  idempotencyKey: string | null | undefined;
  fingerprint: string;
  status: number;
  body: unknown;
  ttlMs?: number;
}): void {
  if (!options.idempotencyKey) return;
  const trimmed = options.idempotencyKey.trim();
  if (!trimmed) return;

  const key = `${options.scope}:${trimmed}`;
  const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  idempotencyRecords.set(key, {
    fingerprint: options.fingerprint,
    status: options.status,
    body: options.body,
    expiresAt: Date.now() + ttlMs,
  });
}

export function handleApiError(
  error: unknown,
  context: ApiRequestContext,
  fallbackMessage: string
): NextResponse {
  if (error instanceof ApiRouteError) {
    apiLog("warn", context, "api_error", {
      category: error.category,
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.details,
      elapsedMs: Date.now() - context.startedAt,
    });
    const response = NextResponse.json(
      {
        error: error.message,
        code: error.code,
        category: error.category,
      },
      { status: error.status }
    );
    return withRequestIdHeader(response, context.requestId);
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  apiLog("error", context, "api_unhandled_error", {
    message,
    elapsedMs: Date.now() - context.startedAt,
  });
  const response = NextResponse.json(
    {
      error: fallbackMessage,
      code: "INTERNAL_ERROR",
      category: "internal",
    },
    { status: 500 }
  );
  return withRequestIdHeader(response, context.requestId);
}
