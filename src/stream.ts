import {
  createAssistantMessageEventStream,
  refreshAntigravityToken,
  streamSimpleGoogleGeminiCli,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions
} from "@mariozechner/pi-ai";

import {
  detectModelFamily,
  markAccountRateLimited,
  markAccountUsed,
  selectAccountForFamily,
  setAccountEnabled
} from "./accounts.js";
import { formatSafeError } from "./logger.js";
import { shouldRotateOnError } from "./rate-limit.js";
import { updateAccountStore, withLoadedAccountStore } from "./storage.js";
import type { Account, ModelFamily } from "./types.js";
import { formatDuration } from "./utils.js";

type AccountAccessToken = {
  accessToken: string;
  expiresAt: number;
};

const accessTokenCache = new Map<string, AccountAccessToken>();
const ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60_000;
const MAX_ROTATION_ATTEMPTS = 32;

function getCachedAccessToken(account: Account): string | null {
  const cachedToken = accessTokenCache.get(account.refreshToken);
  if (!cachedToken) {
    return null;
  }

  if (cachedToken.expiresAt <= Date.now() + ACCESS_TOKEN_EXPIRY_BUFFER_MS) {
    accessTokenCache.delete(account.refreshToken);
    return null;
  }

  return cachedToken.accessToken;
}

async function getAccessTokenForAccount(account: Account): Promise<string> {
  const cachedToken = getCachedAccessToken(account);
  if (cachedToken) {
    return cachedToken;
  }

  const refreshed = await refreshAntigravityToken(account.refreshToken, account.projectId);
  if (typeof refreshed.access !== "string" || refreshed.access.length === 0) {
    throw new Error("Token refresh failed: missing access token");
  }

  const expiresAt = typeof refreshed.expires === "number" ? refreshed.expires : Date.now() + 5 * 60 * 1000;
  accessTokenCache.set(account.refreshToken, {
    accessToken: refreshed.access,
    expiresAt
  });

  return refreshed.access;
}

const ZERO_USAGE: AssistantMessage["usage"] = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

function createErrorAssistantMessage(model: Model<Api>, message: string, stopReason: "aborted" | "error"): AssistantMessage {
  return {
    role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
    usage: { ...ZERO_USAGE, cost: { ...ZERO_USAGE.cost } },
    stopReason, errorMessage: message, timestamp: Date.now()
  };
}

function toAntigravityModel(model: Model<Api>): Model<"google-gemini-cli"> {
  const { api: _, provider: __, compat: ___, ...rest } = model;
  return {
    ...rest,
    api: "google-gemini-cli",
    provider: "google-antigravity",
    input: [...model.input],
    cost: { ...model.cost },
    ...(model.headers && { headers: { ...model.headers } })
  };
}

function shouldCommitBufferedEvents(event: AssistantMessageEvent): boolean {
  return event.type !== "start";
}

async function markSuccessfulAttempt(index: number, family: ModelFamily): Promise<void> {
  await updateAccountStore((store) => {
    if (!store.accounts[index]) return;
    markAccountUsed(store, family, index);
    store.accounts[index]!.verificationRequired = false;
  });
}

async function markRateLimitedAttempt(index: number, family: ModelFamily, cooldownMs: number): Promise<void> {
  await updateAccountStore((store) => {
    if (!store.accounts[index]) return;
    markAccountRateLimited(store, family, index, Date.now() + Math.max(1_000, cooldownMs));
  });
}

async function disableBrokenAccount(index: number): Promise<void> {
  await updateAccountStore((store) => {
    if (!store.accounts[index]) return;
    store.accounts[index]!.verificationRequired = true;
    setAccountEnabled(store, index, false);
  });
}

async function getSelection(family: ModelFamily) {
  return withLoadedAccountStore((store) => {
    const enabledCount = store.accounts.filter((a) => a.enabled).length;
    return { ...selectAccountForFamily(store, family), enabledCount };
  });
}

export function streamWithAccountRotation(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    try {
      const family = detectModelFamily(model.id);

      for (let attempt = 0; attempt < MAX_ROTATION_ATTEMPTS; attempt += 1) {
        if (options?.signal?.aborted) {
          throw new Error("Request was aborted");
        }

        const selection = await getSelection(family);

        if (selection.kind === "none") {
          throw new Error("No enabled Antigravity accounts available. Run /login google-antigravity-multi.");
        }

        if (selection.kind === "wait") {
          throw new Error(
            `All enabled Antigravity accounts are cooling down. Earliest reset in ${formatDuration(selection.waitMs)}.`
          );
        }

        const selectedAccount = selection.account;

        let accessToken: string;
        try {
          accessToken = await getAccessTokenForAccount(selectedAccount);
        } catch (error) {
          const errorMessage = formatSafeError(error);
          const decision = shouldRotateOnError(errorMessage);

          accessTokenCache.delete(selectedAccount.refreshToken);

          if (decision.isAuthError) {
            await disableBrokenAccount(selection.index);
            continue;
          }

          throw new Error(`Failed to refresh account ${selectedAccount.email}: ${errorMessage}`);
        }

        const apiKey = JSON.stringify({
          token: accessToken,
          projectId: selectedAccount.projectId
        });

        const innerModel = toAntigravityModel(model);
        const innerStream = streamSimpleGoogleGeminiCli(innerModel, context, {
          ...options,
          apiKey
        });

        const bufferedEvents: AssistantMessageEvent[] = [];
        let committed = false;
        let shouldRetry = false;

        for await (const event of innerStream) {
          if (event.type === "error") {
            const errorMessage = event.error.errorMessage || "Unknown Antigravity stream error";
            const decision = shouldRotateOnError(errorMessage);

            if (!committed && decision.rotate) {
              accessTokenCache.delete(selectedAccount.refreshToken);

              if (decision.isAuthError) {
                await disableBrokenAccount(selection.index);
              } else {
                await markRateLimitedAttempt(selection.index, family, decision.cooldownMs);
              }

              shouldRetry = true;
              break;
            }

            if (!committed) {
              for (const bufferedEvent of bufferedEvents) {
                stream.push(bufferedEvent);
              }
              committed = true;
            }

            stream.push(event);
            stream.end();
            return;
          }

          if (!committed) {
            bufferedEvents.push(event);
            if (shouldCommitBufferedEvents(event)) {
              for (const bufferedEvent of bufferedEvents) {
                stream.push(bufferedEvent);
              }
              committed = true;
            }
          } else {
            stream.push(event);
          }

          if (event.type === "done") {
            await markSuccessfulAttempt(selection.index, family);
            stream.end();
            return;
          }
        }

        if (shouldRetry) {
          continue;
        }

        throw new Error("Antigravity stream ended unexpectedly without a terminal event");
      }

      throw new Error(`Exceeded maximum account rotation attempts (${MAX_ROTATION_ATTEMPTS})`);
    } catch (error) {
      const safeError = formatSafeError(error);
      const aborted = /aborted/i.test(safeError);
      const errorMessage = createErrorAssistantMessage(model, safeError, aborted ? "aborted" : "error");

      stream.push({
        type: "error",
        reason: aborted ? "aborted" : "error",
        error: errorMessage
      });
      stream.end();
    }
  })();

  return stream;
}
