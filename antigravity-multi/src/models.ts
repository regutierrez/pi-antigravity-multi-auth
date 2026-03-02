import { MODELS } from "@mariozechner/pi-ai/dist/models.generated.js";
import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";

const ANTIGRAVITY_PROVIDER_ID = "google-antigravity" as const;

export function getAntigravitySourceModels(): ProviderModelConfig[] {
  return Object.values(MODELS[ANTIGRAVITY_PROVIDER_ID]).map((model) => ({
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    input: [...model.input],
    cost: {
      input: model.cost.input,
      output: model.cost.output,
      cacheRead: model.cost.cacheRead,
      cacheWrite: model.cost.cacheWrite
    },
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens
  }));
}
