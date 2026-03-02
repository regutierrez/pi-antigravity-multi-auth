import { describe, expect, it } from "vitest";

import { formatSafeError, redactSecrets } from "../src/logger.js";

describe("logger redaction", () => {
  it("redacts bearer tokens", () => {
    expect(redactSecrets("Authorization: Bearer abc123")).toContain("Bearer [REDACTED]");
  });

  it("redacts JSON token fields", () => {
    const input = JSON.stringify({ token: "abc", refreshToken: "def", access: "ghi" });
    const output = redactSecrets(input);

    expect(output).toContain('"token": "[REDACTED]"');
    expect(output).toContain('"refreshToken": "[REDACTED]"');
    expect(output).toContain('"access": "[REDACTED]"');
  });

  it("formats unknown errors safely", () => {
    const message = formatSafeError({ token: "abc" });
    expect(message).toContain("[REDACTED]");
  });
});
