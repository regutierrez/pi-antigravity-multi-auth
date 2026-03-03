import { extractRetryDelay } from "@mariozechner/pi-ai";

export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;

const ROTATE_STATUS_CODES = new Set([429, 503, 529]);

function parseStatusCode(errorMessage: string): number | undefined {
  const statusMatch = errorMessage.match(/\((\d{3})\)/);
  if (!statusMatch?.[1]) {
    return undefined;
  }

  const statusCode = Number.parseInt(statusMatch[1], 10);
  return Number.isFinite(statusCode) ? statusCode : undefined;
}

function hasRateLimitSignal(errorMessage: string): boolean {
  return /resource.?exhausted|rate.?limit|quota|retry delay|overloaded|service.?unavailable/i.test(errorMessage);
}

export function isInvalidGrantError(errorMessage: string): boolean {
  return /invalid_grant|invalid.?refresh|token refresh failed/i.test(errorMessage);
}

export function getRateLimitCooldownMs(errorMessage: string): number {
  const retryDelay = extractRetryDelay(errorMessage);
  if (typeof retryDelay === "number" && retryDelay > 0) {
    return retryDelay;
  }

  return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
}

export function shouldRotateOnError(errorMessage: string): {
  rotate: boolean;
  cooldownMs: number;
  isAuthError: boolean;
} {
  if (isInvalidGrantError(errorMessage)) {
    return {
      rotate: true,
      cooldownMs: 0,
      isAuthError: true
    };
  }

  const statusCode = parseStatusCode(errorMessage);
  if ((typeof statusCode === "number" && ROTATE_STATUS_CODES.has(statusCode)) || hasRateLimitSignal(errorMessage)) {
    return {
      rotate: true,
      cooldownMs: getRateLimitCooldownMs(errorMessage),
      isAuthError: false
    };
  }

  return {
    rotate: false,
    cooldownMs: 0,
    isAuthError: false
  };
}
