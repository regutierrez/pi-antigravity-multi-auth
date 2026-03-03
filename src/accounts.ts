import type { Account, AccountStore, ModelFamily } from "./types.js";

export type AccountSelection =
  | {
      kind: "selected";
      index: number;
      account: Account;
      waitMs: 0;
    }
  | {
      kind: "wait";
      waitMs: number;
    }
  | {
      kind: "none";
      waitMs: 0;
    };

export function detectModelFamily(modelId: string): ModelFamily {
  const normalizedModelId = modelId.toLowerCase();
  return normalizedModelId.includes("claude") ? "claude" : "gemini";
}

export function getCooldownMs(account: Account, family: ModelFamily, now = Date.now()): number {
  const resetAt = account.rateLimitResetTimes[family];
  if (typeof resetAt !== "number") {
    return 0;
  }

  return Math.max(0, resetAt - now);
}

export function isAccountReady(account: Account, family: ModelFamily, now = Date.now()): boolean {
  return account.enabled && getCooldownMs(account, family, now) <= 0;
}

function sanitizeActiveIndex(store: AccountStore, family: ModelFamily): number | null {
  const activeIndex = store.activeIndexByFamily[family];
  if (activeIndex === null) {
    return null;
  }

  if (activeIndex < 0 || activeIndex >= store.accounts.length) {
    store.activeIndexByFamily[family] = null;
    return null;
  }

  return activeIndex;
}

function getCircularSearchOrder(store: AccountStore, family: ModelFamily): number[] {
  if (store.accounts.length === 0) {
    return [];
  }

  const activeIndex = sanitizeActiveIndex(store, family);
  const startIndex = activeIndex ?? 0;

  const indices: number[] = [];
  for (let offset = 0; offset < store.accounts.length; offset += 1) {
    indices.push((startIndex + offset) % store.accounts.length);
  }
  return indices;
}

export function selectAccountForFamily(store: AccountStore, family: ModelFamily, now = Date.now()): AccountSelection {
  if (store.accounts.length === 0) {
    return { kind: "none", waitMs: 0 };
  }

  const enabledIndices = store.accounts
    .map((_, i) => i)
    .filter((i) => store.accounts[i]?.enabled);

  if (enabledIndices.length === 0) {
    return { kind: "none", waitMs: 0 };
  }

  const searchOrder = getCircularSearchOrder(store, family);
  for (const index of searchOrder) {
    const account = store.accounts[index];
    if (!account || !isAccountReady(account, family, now)) {
      continue;
    }

    return {
      kind: "selected",
      account,
      index,
      waitMs: 0
    };
  }

  const waitTimes = enabledIndices
    .map((index) => store.accounts[index])
    .filter((account): account is Account => account !== undefined)
    .map((account) => getCooldownMs(account, family, now))
    .filter((waitMs) => waitMs > 0);

  if (waitTimes.length === 0) {
    return { kind: "none", waitMs: 0 };
  }

  return {
    kind: "wait",
    waitMs: Math.min(...waitTimes)
  };
}

export function markAccountUsed(store: AccountStore, family: ModelFamily, index: number, now = Date.now()): void {
  const account = store.accounts[index];
  if (!account) {
    throw new Error(`Cannot mark account at index ${index}: account not found`);
  }

  account.lastUsed = now;
  delete account.rateLimitResetTimes[family];
  store.activeIndexByFamily[family] = index;
}

export function markAccountRateLimited(
  store: AccountStore,
  family: ModelFamily,
  index: number,
  resetAt: number
): void {
  const account = store.accounts[index];
  if (!account) {
    throw new Error(`Cannot mark account at index ${index}: account not found`);
  }

  account.rateLimitResetTimes[family] = resetAt;
}

export function setAccountEnabled(store: AccountStore, index: number, enabled: boolean): void {
  const account = store.accounts[index];
  if (!account) {
    throw new Error(`Cannot update account at index ${index}: account not found`);
  }

  account.enabled = enabled;

  if (!enabled) {
    for (const family of ["claude", "gemini"] as const) {
      if (store.activeIndexByFamily[family] === index) store.activeIndexByFamily[family] = null;
    }
  }
}

export function setActiveAccount(store: AccountStore, family: ModelFamily, index: number | null): void {
  if (index === null) {
    store.activeIndexByFamily[family] = null;
    return;
  }

  const account = store.accounts[index];
  if (!account) {
    throw new Error(`Cannot set active account at index ${index}: account not found`);
  }

  if (!account.enabled) {
    throw new Error(`Cannot set active account at index ${index}: account is disabled`);
  }

  store.activeIndexByFamily[family] = index;
}

export function removeAccountAtIndex(store: AccountStore, index: number): void {
  if (index < 0 || index >= store.accounts.length) {
    throw new Error(`Cannot remove account at index ${index}: account not found`);
  }

  store.accounts.splice(index, 1);

  for (const family of ["claude", "gemini"] as const) {
    const active = store.activeIndexByFamily[family];
    if (active === index) store.activeIndexByFamily[family] = null;
    else if (active !== null && active > index) store.activeIndexByFamily[family] = active - 1;
  }
}

export function upsertAccount(
  store: AccountStore,
  params: {
    email: string;
    refreshToken: string;
    projectId: string;
    now?: number;
  }
): number {
  const now = params.now ?? Date.now();
  const normalizedEmail = params.email.trim().toLowerCase();

  const existingIndex = store.accounts.findIndex(
    (account) =>
      account.refreshToken === params.refreshToken ||
      (normalizedEmail.length > 0 && account.email.trim().toLowerCase() === normalizedEmail)
  );

  if (existingIndex >= 0) {
    const existing = store.accounts[existingIndex];
    if (!existing) {
      throw new Error("Invariant violation: existing account missing");
    }

    existing.email = params.email;
    existing.refreshToken = params.refreshToken;
    existing.projectId = params.projectId;
    existing.enabled = true;
    existing.verificationRequired = false;
    return existingIndex;
  }

  store.accounts.push({
    email: params.email,
    refreshToken: params.refreshToken,
    projectId: params.projectId,
    enabled: true,
    addedAt: now,
    lastUsed: null,
    rateLimitResetTimes: {}
  });

  return store.accounts.length - 1;
}
