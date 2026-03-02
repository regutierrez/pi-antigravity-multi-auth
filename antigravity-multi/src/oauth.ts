import {
  loginAntigravity,
  type OAuthCredentials,
  type OAuthLoginCallbacks
} from "@mariozechner/pi-ai";

import { setActiveAccount, upsertAccount } from "./accounts.js";
import { createEmptyAccountStore, mutateAccountStore, withLoadedAccountStore } from "./storage.js";

const MANAGER_CREDENTIAL_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const MANAGER_CREDENTIAL_MODE = "multi-account-manager" as const;

type LoginPoolAction = "add" | "fresh" | "cancel";

export type MultiAccountManagerCredential = OAuthCredentials & {
  mode: typeof MANAGER_CREDENTIAL_MODE;
  accountCount: number;
};

function normalizeEmail(rawEmail: unknown, refreshToken: string): string {
  if (typeof rawEmail === "string" && rawEmail.trim().length > 0) {
    return rawEmail.trim();
  }

  const suffix = refreshToken.slice(-8) || "account";
  return `unknown-${suffix}@antigravity.local`;
}

function parsePoolAction(value: string): LoginPoolAction | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized === "a" || normalized === "add") {
    return "add";
  }
  if (normalized === "f" || normalized === "fresh" || normalized === "reset" || normalized === "replace") {
    return "fresh";
  }
  if (normalized === "c" || normalized === "cancel" || normalized === "q" || normalized === "quit") {
    return "cancel";
  }
  return undefined;
}

function parseYesNo(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

async function promptPoolAction(callbacks: OAuthLoginCallbacks, accountCount: number): Promise<LoginPoolAction> {
  while (true) {
    const response = await callbacks.onPrompt({
      message: `Found ${accountCount} existing Antigravity account(s). Choose: [a]dd, [f]resh, [c]ancel`,
      placeholder: "add"
    });

    const action = parsePoolAction(response);
    if (action) {
      return action;
    }

    callbacks.onProgress?.("Invalid choice. Enter add, fresh, or cancel.");
  }
}

async function promptAddAnother(callbacks: OAuthLoginCallbacks): Promise<boolean> {
  const response = await callbacks.onPrompt({
    message: "Add another Antigravity account? [y/N]",
    placeholder: "n"
  });
  return parseYesNo(response);
}

function buildManagerCredential(params: {
  refreshToken: string;
  projectId: string;
  email: string;
  accessToken: string;
  accountCount: number;
}): MultiAccountManagerCredential {
  return {
    refresh: params.refreshToken,
    access: params.accessToken,
    expires: Date.now() + MANAGER_CREDENTIAL_TTL_MS,
    projectId: params.projectId,
    email: params.email,
    mode: MANAGER_CREDENTIAL_MODE,
    accountCount: params.accountCount
  };
}

function getStringField(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new Error(`Missing ${field} in Antigravity OAuth response`);
}

function createManualCodeInputCallback(callbacks: OAuthLoginCallbacks): () => Promise<string> {
  return () =>
    callbacks.onPrompt({
      message: "Paste redirect URL below, or complete login in browser:",
      placeholder: "http://localhost:51121/oauth-callback?code=..."
    });
}

function isLoginCancellation(error: unknown, callbacks: OAuthLoginCallbacks): boolean {
  if (callbacks.signal?.aborted) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("cancel") || message.includes("aborted");
}

export async function loginMultiAccount(callbacks: OAuthLoginCallbacks): Promise<MultiAccountManagerCredential> {
  let latestCredential: MultiAccountManagerCredential | null = null;

  try {
    const existingCount = await withLoadedAccountStore((store) => store.accounts.length);

    let action: LoginPoolAction = "add";
    if (existingCount > 0) {
      action = await promptPoolAction(callbacks, existingCount);
    }

    if (action === "cancel") {
      throw new Error("Login cancelled");
    }

    let shouldResetStore = action === "fresh";

    while (true) {
      const credentials = await loginAntigravity(
        callbacks.onAuth,
        callbacks.onProgress,
        createManualCodeInputCallback(callbacks)
      );

      const refreshToken = getStringField(credentials.refresh, "refresh token");
      const accessToken = getStringField(credentials.access, "access token");
      const projectId = getStringField(credentials["projectId"], "projectId");
      const email = normalizeEmail(credentials["email"], refreshToken);

      const accountCount = await mutateAccountStore((currentStore) => {
        const workingStore = shouldResetStore ? createEmptyAccountStore() : currentStore;
        shouldResetStore = false;

        const insertedIndex = upsertAccount(workingStore, {
          email,
          refreshToken,
          projectId
        });

        setActiveAccount(workingStore, "claude", insertedIndex);
        setActiveAccount(workingStore, "gemini", insertedIndex);

        return {
          store: workingStore,
          result: workingStore.accounts.length
        };
      });

      latestCredential = buildManagerCredential({
        refreshToken,
        projectId,
        email,
        accessToken,
        accountCount
      });

      callbacks.onProgress?.(`Added account ${email}. Pool size: ${accountCount}`);

      const addAnother = await promptAddAnother(callbacks);
      if (!addAnother) {
        break;
      }
    }

    if (!latestCredential) {
      throw new Error("No Antigravity account was added");
    }

    return latestCredential;
  } catch (error) {
    if (isLoginCancellation(error, callbacks)) {
      if (latestCredential) {
        callbacks.onProgress?.("Login cancelled; keeping accounts added so far.");
        return latestCredential;
      }

      throw new Error("Login cancelled");
    }
    throw error;
  }
}

export async function refreshMultiAccountManagerCredential(
  credentials: OAuthCredentials
): Promise<MultiAccountManagerCredential> {
  const accountCount = await withLoadedAccountStore((store) => store.accounts.length);

  const refreshToken =
    typeof credentials.refresh === "string" && credentials.refresh.length > 0
      ? credentials.refresh
      : "multi-account-refresh";

  const accessToken =
    typeof credentials.access === "string" && credentials.access.length > 0 ? credentials.access : "multi-account-access";

  const projectId =
    typeof credentials["projectId"] === "string" && credentials["projectId"].length > 0
      ? credentials["projectId"]
      : "multi-account-project";

  const email =
    typeof credentials["email"] === "string" && credentials["email"].length > 0
      ? credentials["email"]
      : "multi-account@antigravity.local";

  return buildManagerCredential({
    refreshToken,
    projectId,
    email,
    accessToken,
    accountCount
  });
}

export function getManagerApiKey(credentials: OAuthCredentials): string {
  const token =
    typeof credentials.access === "string" && credentials.access.length > 0 ? credentials.access : "multi-account-access";

  const projectId =
    typeof credentials["projectId"] === "string" && credentials["projectId"].length > 0
      ? credentials["projectId"]
      : "multi-account-project";

  return JSON.stringify({ token, projectId });
}
