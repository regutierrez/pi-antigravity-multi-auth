import { getModels } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";

import { getAntigravitySourceModels } from "../src/models.js";

describe("models", () => {
  it("mirrors built-in google-antigravity model ids", () => {
    const sourceIds = getModels("google-antigravity")
      .map((model) => model.id)
      .sort();

    const extensionIds = getAntigravitySourceModels()
      .map((model) => model.id)
      .sort();

    expect(extensionIds).toEqual(sourceIds);
  });

  it("preserves key model capabilities", () => {
    const sourceModel = getModels("google-antigravity").find((model) => model.id === "claude-sonnet-4-5");
    const extensionModel = getAntigravitySourceModels().find((model) => model.id === "claude-sonnet-4-5");

    expect(sourceModel).toBeDefined();
    expect(extensionModel).toBeDefined();
    expect(extensionModel?.reasoning).toBe(sourceModel?.reasoning);
    expect(extensionModel?.input).toEqual(sourceModel?.input);
    expect(extensionModel?.contextWindow).toBe(sourceModel?.contextWindow);
    expect(extensionModel?.maxTokens).toBe(sourceModel?.maxTokens);
  });
});
