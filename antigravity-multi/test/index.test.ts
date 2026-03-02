import { describe, expect, it } from "vitest";

import extension from "../index.js";

describe("extension entrypoint", () => {
  it("registers provider and account command", () => {
    const providerCalls: Array<{ name: string; config: unknown }> = [];
    const commandCalls: Array<{ name: string; config: unknown }> = [];

    extension({
      registerProvider: (name: string, config: unknown) => {
        providerCalls.push({ name, config });
      },
      registerCommand: (name: string, config: unknown) => {
        commandCalls.push({ name, config });
      }
    } as never);

    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]?.name).toBe("google-antigravity-multi");

    const providerConfig = providerCalls[0]?.config as {
      models?: Array<{ id: string }>;
      oauth?: { name: string; usesCallbackServer?: boolean };
      streamSimple?: unknown;
    };

    expect(providerConfig.models?.length).toBeGreaterThan(0);
    expect(providerConfig.oauth?.name).toContain("Antigravity");
    expect(providerConfig.oauth?.usesCallbackServer).toBe(true);
    expect(typeof providerConfig.streamSimple).toBe("function");

    expect(commandCalls.some((command) => command.name === "ag-accounts")).toBe(true);
  });
});
