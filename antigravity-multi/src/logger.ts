const SECRET_PATTERNS = [
  /"refreshToken"\s*:\s*"[^"]+"/gi,
  /"access"\s*:\s*"[^"]+"/gi,
  /"refresh"\s*:\s*"[^"]+"/gi,
  /"token"\s*:\s*"[^"]+"/gi,
  /Bearer\s+[A-Za-z0-9._\-]+/gi
];

export function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match) => {
      if (match.startsWith("Bearer ")) {
        return "Bearer [REDACTED]";
      }

      const separatorIndex = match.indexOf(":");
      if (separatorIndex >= 0) {
        return `${match.slice(0, separatorIndex + 1)} \"[REDACTED]\"`;
      }

      return "[REDACTED]";
    });
  }
  return redacted;
}

export function formatSafeError(error: unknown): string {
  if (error instanceof Error) {
    return redactSecrets(error.message);
  }

  if (typeof error === "string") {
    return redactSecrets(error);
  }

  try {
    return redactSecrets(JSON.stringify(error));
  } catch {
    return "Unknown error";
  }
}
