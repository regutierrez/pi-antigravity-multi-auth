import { describe, expect, it } from "vitest";

import {
  DEFAULT_RATE_LIMIT_COOLDOWN_MS,
  getRateLimitCooldownMs,
  isInvalidGrantError,
  shouldRotateOnError
} from "../src/rate-limit.js";

describe("rate limit helpers", () => {
  it("detects invalid_grant auth failures", () => {
    expect(isInvalidGrantError("Token refresh failed: invalid_grant")).toBe(true);
    expect(isInvalidGrantError("Cloud Code Assist API error (429): quota exceeded")).toBe(false);
  });

  it("parses retry delay from Cloud Code Assist text", () => {
    const message = "Cloud Code Assist API error (429): Your quota will reset after 39s";
    expect(getRateLimitCooldownMs(message)).toBeGreaterThanOrEqual(39_000);
  });

  it("falls back to default cooldown when no retry hint exists", () => {
    expect(getRateLimitCooldownMs("Cloud Code Assist API error (503): overloaded")).toBe(
      DEFAULT_RATE_LIMIT_COOLDOWN_MS
    );
  });

  it("rotates on 429/503/529 status errors", () => {
    expect(shouldRotateOnError("Cloud Code Assist API error (429): quota").rotate).toBe(true);
    expect(shouldRotateOnError("Cloud Code Assist API error (503): overloaded").rotate).toBe(true);
    expect(shouldRotateOnError("Cloud Code Assist API error (529): overloaded").rotate).toBe(true);
  });

  it("rotates on rate-limit text signals", () => {
    const decision = shouldRotateOnError("service unavailable due to resource exhausted");
    expect(decision.rotate).toBe(true);
    expect(decision.isAuthError).toBe(false);
  });

  it("marks auth failures separately", () => {
    const decision = shouldRotateOnError("Token refresh failed: invalid_grant");
    expect(decision.rotate).toBe(true);
    expect(decision.isAuthError).toBe(true);
    expect(decision.cooldownMs).toBe(0);
  });

  it("does not rotate on unknown errors", () => {
    expect(shouldRotateOnError("Unexpected JSON parse failure")).toEqual({
      rotate: false,
      cooldownMs: 0,
      isAuthError: false
    });
  });
});
