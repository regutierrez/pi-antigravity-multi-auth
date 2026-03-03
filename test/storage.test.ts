import { access, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ACCOUNT_FILE_MODE } from "../src/config.js";
import {
  acquireAccountStoreLock,
  createEmptyAccountStore,
  ensureStorageDir,
  getAccountStoreLockPath,
  isAccountStore,
  mutateAccountStore,
  parseAccountStore,
  readAccountStoreFromDisk,
  withLoadedAccountStore,
  writeAccountStoreToDisk
} from "../src/storage.js";
import { ACCOUNT_STORE_VERSION, type AccountStore } from "../src/types.js";

const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ag-multi-storage-test-"));
  tempDirectories.push(directory);
  return directory;
}

function createStoreWithClaudeActive(): AccountStore {
  return {
    version: ACCOUNT_STORE_VERSION,
    accounts: [
      {
        email: "alice@example.com",
        refreshToken: "refresh-token",
        projectId: "project-123",
        enabled: true,
        addedAt: 1_700_000_000_000,
        lastUsed: null,
        rateLimitResetTimes: {
          claude: 1_700_000_010_000
        }
      }
    ],
    activeIndexByFamily: {
      claude: 0,
      gemini: null
    }
  };
}

function createStoreWithGeminiActive(): AccountStore {
  return {
    version: ACCOUNT_STORE_VERSION,
    accounts: [
      {
        email: "bob@example.com",
        refreshToken: "refresh-2",
        projectId: "project-456",
        enabled: false,
        addedAt: 1_700_000_000_001,
        lastUsed: 1_700_000_020_000,
        rateLimitResetTimes: {
          gemini: 1_700_000_030_000
        },
        verificationRequired: true
      }
    ],
    activeIndexByFamily: {
      claude: null,
      gemini: 0
    }
  };
}

afterEach(async () => {
  await Promise.all(tempDirectories.map(async (directory) => rm(directory, { recursive: true, force: true })));
  tempDirectories.length = 0;
});

describe("storage schema helpers", () => {
  it("creates an empty v1 account store", () => {
    expect(createEmptyAccountStore()).toEqual({
      version: ACCOUNT_STORE_VERSION,
      accounts: [],
      activeIndexByFamily: {
        claude: null,
        gemini: null
      }
    });
  });

  it("validates and parses a valid account store", () => {
    const store = createStoreWithClaudeActive();

    expect(isAccountStore(store)).toBe(true);
    expect(parseAccountStore(store)).toEqual(store);
  });

  it("throws on invalid account store", () => {
    const invalid = {
      version: 999,
      accounts: [],
      activeIndexByFamily: {
        claude: null,
        gemini: null
      }
    };

    expect(() => parseAccountStore(invalid, "test data")).toThrowError(/Invalid test data/);
  });
});

describe("storage file helpers", () => {
  it("creates the storage directory", async () => {
    const root = await createTempDirectory();
    const nestedDirectory = join(root, "nested", "storage");

    await ensureStorageDir(nestedDirectory);

    const directoryStats = await stat(nestedDirectory);
    expect(directoryStats.isDirectory()).toBe(true);
  });

  it("returns empty store when file does not exist", async () => {
    const root = await createTempDirectory();
    const filePath = join(root, "accounts.json");

    const store = await readAccountStoreFromDisk(filePath);

    expect(store).toEqual(createEmptyAccountStore());
  });

  it("reads and validates a stored account file", async () => {
    const root = await createTempDirectory();
    const filePath = join(root, "accounts.json");

    const store = createStoreWithGeminiActive();

    await writeFile(filePath, JSON.stringify(store), "utf-8");

    await expect(readAccountStoreFromDisk(filePath)).resolves.toEqual(store);
  });

  it("writes account store atomically", async () => {
    const root = await createTempDirectory();
    const filePath = join(root, "accounts.json");
    const store = createStoreWithClaudeActive();

    await writeAccountStoreToDisk(store, filePath);

    await expect(readAccountStoreFromDisk(filePath)).resolves.toEqual(store);

    const files = await readdir(root);
    expect(files.some((file) => file.startsWith("accounts.json.tmp-"))).toBe(false);
  });

  it("writes account file with secure permissions", async () => {
    if (process.platform === "win32") {
      return;
    }

    const root = await createTempDirectory();
    const filePath = join(root, "accounts.json");

    await writeAccountStoreToDisk(createStoreWithGeminiActive(), filePath);

    const fileStats = await stat(filePath);
    expect(fileStats.mode & 0o777).toBe(ACCOUNT_FILE_MODE);
  });

  it("rejects invalid account store values when writing", async () => {
    const root = await createTempDirectory();
    const filePath = join(root, "accounts.json");

    const invalidStore = {
      version: 999,
      accounts: [],
      activeIndexByFamily: {
        claude: null,
        gemini: null
      }
    } as unknown as AccountStore;

    await expect(writeAccountStoreToDisk(invalidStore, filePath)).rejects.toThrowError(/Invalid account store to write/);
    await expect(readAccountStoreFromDisk(filePath)).resolves.toEqual(createEmptyAccountStore());
  });

  it("throws on invalid JSON", async () => {
    const root = await createTempDirectory();
    const filePath = join(root, "accounts.json");

    await writeFile(filePath, "{not-json", "utf-8");

    await expect(readAccountStoreFromDisk(filePath)).rejects.toThrowError(/Invalid JSON in account store/);
  });

  it("throws on invalid schema", async () => {
    const root = await createTempDirectory();
    const filePath = join(root, "accounts.json");

    await writeFile(
      filePath,
      JSON.stringify({
        version: 999,
        accounts: [],
        activeIndexByFamily: {
          claude: null,
          gemini: null
        }
      }),
      "utf-8"
    );

    await expect(readAccountStoreFromDisk(filePath)).rejects.toThrowError(/Invalid account store at/);
  });
});

describe("storage lock helpers", () => {
  it("derives lock path from account store path", () => {
    expect(getAccountStoreLockPath("/tmp/accounts.json")).toBe("/tmp/accounts.json.lock");
  });

  it("creates and releases an exclusive lock file", async () => {
    const root = await createTempDirectory();
    const filePath = join(root, "accounts.json");
    const lockPath = getAccountStoreLockPath(filePath);

    const lock = await acquireAccountStoreLock(filePath, { timeoutMs: 1_000, retryMs: 10, staleMs: 500 });

    await expect(access(lockPath)).resolves.toBeUndefined();

    const lockBody = await readFile(lockPath, "utf-8");
    expect(lockBody).toMatch(/pid=/);

    await lock.release();

    await expect(access(lockPath)).rejects.toBeDefined();
  });

  it("loads store under lock", async () => {
    const root = await createTempDirectory();
    const filePath = join(root, "accounts.json");
    const initialStore = createStoreWithClaudeActive();

    await writeAccountStoreToDisk(initialStore, filePath);

    const loadedStore = await withLoadedAccountStore((store) => store, filePath);

    expect(loadedStore).toEqual(initialStore);
  });

  it("mutates and persists store under lock", async () => {
    const root = await createTempDirectory();
    const filePath = join(root, "accounts.json");

    const result = await mutateAccountStore(
      (store) => {
        const nextStore: AccountStore = {
          ...store,
          accounts: [
            ...store.accounts,
            {
              email: "charlie@example.com",
              refreshToken: "refresh-3",
              projectId: "project-789",
              enabled: true,
              addedAt: 1_700_000_040_000,
              lastUsed: null,
              rateLimitResetTimes: {}
            }
          ]
        };

        return {
          store: nextStore,
          result: nextStore.accounts.length
        };
      },
      filePath
    );

    expect(result).toBe(1);

    const persistedStore = await readAccountStoreFromDisk(filePath);
    expect(persistedStore.accounts).toHaveLength(1);
    expect(persistedStore.accounts[0]?.email).toBe("charlie@example.com");
  });
});
