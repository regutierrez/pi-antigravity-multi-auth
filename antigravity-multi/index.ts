import type { ExtensionAPI, ProviderConfig } from "@mariozechner/pi-coding-agent";

import { registerAccountCommands } from "./src/commands.js";
import { ANTIGRAVITY_BASE_URL, PROVIDER_API_ID, PROVIDER_ID } from "./src/config.js";
import { getAntigravitySourceModels } from "./src/models.js";
import { getManagerApiKey, loginMultiAccount, refreshMultiAccountManagerCredential } from "./src/oauth.js";
import { streamWithAccountRotation } from "./src/stream.js";

const oauthConfigWithCallbackServer = {
  name: "Google Antigravity (Multi)",
  login: loginMultiAccount,
  refreshToken: refreshMultiAccountManagerCredential,
  getApiKey: getManagerApiKey,
  usesCallbackServer: true
};

export default function antigravityMultiExtension(pi: ExtensionAPI): void {
  pi.registerProvider(PROVIDER_ID, {
    baseUrl: ANTIGRAVITY_BASE_URL,
    api: PROVIDER_API_ID,
    models: getAntigravitySourceModels(),
    oauth: oauthConfigWithCallbackServer as unknown as NonNullable<ProviderConfig["oauth"]>,
    streamSimple: streamWithAccountRotation
  });

  registerAccountCommands(pi);
}
