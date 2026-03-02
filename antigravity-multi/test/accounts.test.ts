import { describe, expect, it } from "vitest";

import {
  detectModelFamily,
  markAccountRateLimited,
  markAccountUsed,
  removeAccountAtIndex,
  selectAccountForFamily,
  setAccountEnabled,
  setActiveAccount,
  upsertAccount
} from "../src/accounts.js";
import { ACCOUNT_STORE_VERSION, type AccountStore } from "../src/types.js";

function createStore(): AccountStore {
  return {
    version: ACCOUNT_STORE_VERSION,
    accounts: [
      {
        email: "one@example.com",
        refreshToken: "refresh-1",
        projectId: "project-1",
        enabled: true,
        addedAt: 10,
        lastUsed: null,
        rateLimitResetTimes: {}
      },
      {
        email: "two@example.com",
        refreshToken: "refresh-2",
        projectId: "project-2",
        enabled: true,
        addedAt: 20,
        lastUsed: null,
        rateLimitResetTimes: {}
      }
    ],
    activeIndexByFamily: {
      claude: 0,
      gemini: 0
    }
  };
}

describe("account family detection", () => {
  it("maps claude models to claude family", () => {
    expect(detectModelFamily("claude-sonnet-4-5")).toBe("claude");
  });

  it("maps non-claude models to gemini family", () => {
    expect(detectModelFamily("gemini-3-pro-high")).toBe("gemini");
    expect(detectModelFamily("gpt-oss-120b-medium")).toBe("gemini");
  });
});

describe("account selection", () => {
  it("uses sticky active account when available", () => {
    const store = createStore();

    const selection = selectAccountForFamily(store, "claude", 1000);

    expect(selection.kind).toBe("selected");
    if (selection.kind === "selected") {
      expect(selection.index).toBe(0);
      expect(selection.account.email).toBe("one@example.com");
    }
  });

  it("rotates to next account when active one is cooling down", () => {
    const store = createStore();
    store.accounts[0]!.rateLimitResetTimes.claude = 5_000;

    const selection = selectAccountForFamily(store, "claude", 1_000);

    expect(selection.kind).toBe("selected");
    if (selection.kind === "selected") {
      expect(selection.index).toBe(1);
      expect(selection.account.email).toBe("two@example.com");
    }
  });

  it("returns wait time when all enabled accounts are cooling down", () => {
    const store = createStore();
    store.accounts[0]!.rateLimitResetTimes.gemini = 9_000;
    store.accounts[1]!.rateLimitResetTimes.gemini = 7_000;

    const selection = selectAccountForFamily(store, "gemini", 2_000);

    expect(selection).toEqual({
      kind: "wait",
      waitMs: 5_000
    });
  });

  it("returns none when all accounts are disabled", () => {
    const store = createStore();
    store.accounts[0]!.enabled = false;
    store.accounts[1]!.enabled = false;

    expect(selectAccountForFamily(store, "claude", 0)).toEqual({ kind: "none", waitMs: 0 });
  });
});

describe("account mutation helpers", () => {
  it("marks account usage and clears cooldown", () => {
    const store = createStore();
    store.accounts[1]!.rateLimitResetTimes.claude = 9_000;

    markAccountUsed(store, "claude", 1, 2_500);

    expect(store.accounts[1]!.lastUsed).toBe(2_500);
    expect(store.accounts[1]!.rateLimitResetTimes.claude).toBeUndefined();
    expect(store.activeIndexByFamily.claude).toBe(1);
  });

  it("marks account rate limited for a family", () => {
    const store = createStore();

    markAccountRateLimited(store, "gemini", 0, 10_000);

    expect(store.accounts[0]!.rateLimitResetTimes.gemini).toBe(10_000);
  });

  it("disables account and unsets active pointers", () => {
    const store = createStore();
    store.activeIndexByFamily.claude = 1;
    store.activeIndexByFamily.gemini = 1;

    setAccountEnabled(store, 1, false);

    expect(store.accounts[1]!.enabled).toBe(false);
    expect(store.activeIndexByFamily.claude).toBeNull();
    expect(store.activeIndexByFamily.gemini).toBeNull();
  });

  it("sets active account only when enabled", () => {
    const store = createStore();
    setAccountEnabled(store, 1, false);

    expect(() => setActiveAccount(store, "claude", 1)).toThrowError(/disabled/);

    setAccountEnabled(store, 1, true);
    setActiveAccount(store, "claude", 1);
    expect(store.activeIndexByFamily.claude).toBe(1);
  });

  it("removes account and shifts active indices", () => {
    const store = createStore();
    store.accounts.push({
      email: "three@example.com",
      refreshToken: "refresh-3",
      projectId: "project-3",
      enabled: true,
      addedAt: 30,
      lastUsed: null,
      rateLimitResetTimes: {}
    });
    store.activeIndexByFamily.claude = 2;
    store.activeIndexByFamily.gemini = 1;

    removeAccountAtIndex(store, 1);

    expect(store.accounts).toHaveLength(2);
    expect(store.activeIndexByFamily.claude).toBe(1);
    expect(store.activeIndexByFamily.gemini).toBeNull();
  });

  it("upserts existing account by refresh token", () => {
    const store = createStore();

    const index = upsertAccount(store, {
      email: "updated@example.com",
      refreshToken: "refresh-2",
      projectId: "project-updated",
      now: 1234
    });

    expect(index).toBe(1);
    expect(store.accounts).toHaveLength(2);
    expect(store.accounts[1]!.email).toBe("updated@example.com");
    expect(store.accounts[1]!.projectId).toBe("project-updated");
  });

  it("adds a new account when no existing match is found", () => {
    const store = createStore();

    const index = upsertAccount(store, {
      email: "new@example.com",
      refreshToken: "refresh-new",
      projectId: "project-new",
      now: 9999
    });

    expect(index).toBe(2);
    expect(store.accounts).toHaveLength(3);
    expect(store.accounts[2]!.addedAt).toBe(9999);
    expect(store.accounts[2]!.enabled).toBe(true);
  });
});
