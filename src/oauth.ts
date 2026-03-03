import {
  loginAntigravity,
  type OAuthCredentials,
  type OAuthLoginCallbacks
} from "@mariozechner/pi-ai";

import { setActiveAccount, upsertAccount } from "./accounts.js";
import { createEmptyAccountStore, mutateAccountStore, withLoadedAccountStore } from "./storage.js";
import { strOr } from "./utils.js";

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
  return callbacks.signal?.aborted || (error instanceof Error && /cancel|aborted/i.test(error.message)) || false;
}

export async function loginMultiAccount(callbacks: OAuthLoginCallbacks): Promise<MultiAccountManagerCredential> {
  try {
    const existingCount = await withLoadedAccountStore((store) => store.accounts.length);

    let action: LoginPoolAction = "add";
    if (existingCount > 0) {
      action = await promptPoolAction(callbacks, existingCount);
    }

    if (action === "cancel") {
      throw new Error("Login cancelled");
    }

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
      const workingStore = action === "fresh" ? createEmptyAccountStore() : currentStore;

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

    callbacks.onProgress?.(`Added account ${email}. Pool size: ${accountCount}`);

    return buildManagerCredential({
      refreshToken,
      projectId,
      email,
      accessToken,
      accountCount
    });
  } catch (error) {
    if (isLoginCancellation(error, callbacks)) {
      throw new Error("Login cancelled");
    }
    throw error;
  }
}

export async function refreshMultiAccountManagerCredential(
  credentials: OAuthCredentials
): Promise<MultiAccountManagerCredential> {
  const accountCount = await withLoadedAccountStore((store) => store.accounts.length);

  return buildManagerCredential({
    refreshToken: strOr(credentials.refresh, "multi-account-refresh"),
    accessToken: strOr(credentials.access, "multi-account-access"),
    projectId: strOr(credentials["projectId"], "multi-account-project"),
    email: strOr(credentials["email"], "multi-account@antigravity.local"),
    accountCount
  });
}

export function getManagerApiKey(credentials: OAuthCredentials): string {
  return JSON.stringify({
    token: strOr(credentials.access, "multi-account-access"),
    projectId: strOr(credentials["projectId"], "multi-account-project")
  });
}
