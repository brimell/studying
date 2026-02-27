export const DEFAULT_DISPLAY_NAME = "John Doe";

export function normalizeDisplayName(input: string): string {
  const value = input.trim();
  if (!value) return DEFAULT_DISPLAY_NAME;
  return value.slice(0, 60);
}

export function getDisplayNameFromMetadata(
  metadata: { display_name?: unknown } | null | undefined
): string {
  const raw = metadata?.display_name;
  if (typeof raw !== "string") return DEFAULT_DISPLAY_NAME;
  const normalized = raw.trim();
  return normalized || DEFAULT_DISPLAY_NAME;
}

export function hasExplicitDisplayName(
  metadata: { display_name?: unknown } | null | undefined
): boolean {
  const raw = metadata?.display_name;
  return typeof raw === "string" && raw.trim().length > 0;
}
