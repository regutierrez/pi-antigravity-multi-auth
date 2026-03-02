import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { Value } from "@sinclair/typebox/value";

import {
  ACCOUNT_DIR_MODE,
  ACCOUNT_FILE_MODE,
  ACCOUNT_LOCK_RETRY_MS,
  ACCOUNT_LOCK_STALE_MS,
  ACCOUNT_LOCK_TIMEOUT_MS,
  ACCOUNTS_FILE_PATH,
  ACCOUNTS_LOCK_FILE_PATH,
  EXTENSION_STORAGE_DIR
} from "./config.js";
import { ACCOUNT_STORE_VERSION, AccountStoreSchema, type AccountStore } from "./types.js";

type AccountStoreLock = {
  lockPath: string;
  release: () => Promise<void>;
};

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const { code } = error as { code?: unknown };
  return typeof code === "string" ? code : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatAccountStoreJson(store: AccountStore): string {
  return `${JSON.stringify(store, null, 2)}\n`;
}

function createTempPath(filePath: string): string {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${filePath}.tmp-${suffix}`;
}

export function getAccountStoreLockPath(filePath = ACCOUNTS_FILE_PATH): string {
  return filePath === ACCOUNTS_FILE_PATH ? ACCOUNTS_LOCK_FILE_PATH : `${filePath}.lock`;
}

export function createEmptyAccountStore(): AccountStore {
  return {
    version: ACCOUNT_STORE_VERSION,
    accounts: [],
    activeIndexByFamily: {
      claude: null,
      gemini: null
    }
  };
}

export function isAccountStore(value: unknown): value is AccountStore {
  return Value.Check(AccountStoreSchema, value);
}

export function parseAccountStore(value: unknown, source = "account store"): AccountStore {
  if (Value.Check(AccountStoreSchema, value)) {
    return value;
  }

  const errorDetails = [...Value.Errors(AccountStoreSchema, value)]
    .map((error) => `${error.path || "$"} ${error.message}`)
    .join("; ");

  throw new Error(`Invalid ${source}: ${errorDetails}`);
}

export async function ensureStorageDir(storageDirPath = EXTENSION_STORAGE_DIR): Promise<void> {
  await mkdir(storageDirPath, { recursive: true, mode: ACCOUNT_DIR_MODE });
  await chmod(storageDirPath, ACCOUNT_DIR_MODE);
}

async function isLockStale(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const lockStats = await stat(lockPath);
    return Date.now() - lockStats.mtimeMs > staleMs;
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function acquireAccountStoreLock(
  filePath = ACCOUNTS_FILE_PATH,
  options?: {
    timeoutMs?: number;
    retryMs?: number;
    staleMs?: number;
  }
): Promise<AccountStoreLock> {
  const lockPath = getAccountStoreLockPath(filePath);
  const timeoutMs = options?.timeoutMs ?? ACCOUNT_LOCK_TIMEOUT_MS;
  const retryMs = options?.retryMs ?? ACCOUNT_LOCK_RETRY_MS;
  const staleMs = options?.staleMs ?? ACCOUNT_LOCK_STALE_MS;

  await ensureStorageDir(dirname(lockPath));

  const startTime = Date.now();
  while (true) {
    try {
      const lockFile = await open(lockPath, "wx", ACCOUNT_FILE_MODE);
      let released = false;

      await lockFile.writeFile(`pid=${process.pid} acquiredAt=${new Date().toISOString()}\n`, { encoding: "utf-8" });
      await chmod(lockPath, ACCOUNT_FILE_MODE);

      return {
        lockPath,
        release: async () => {
          if (released) {
            return;
          }
          released = true;

          await lockFile.close().catch(() => {
            // Ignore close errors during lock cleanup.
          });

          await rm(lockPath, { force: true }).catch(() => {
            // Ignore unlink errors during lock cleanup.
          });
        }
      };
    } catch (error) {
      const code = getErrorCode(error);
      if (code !== "EEXIST") {
        throw error;
      }

      if (Date.now() - startTime >= timeoutMs) {
        throw new Error(`Timed out acquiring account store lock at ${lockPath}`);
      }

      if (await isLockStale(lockPath, staleMs)) {
        await rm(lockPath, { force: true }).catch(() => {
          // Ignore stale lock removal races.
        });
        continue;
      }

      await sleep(retryMs);
    }
  }
}

export async function withAccountStoreLock<T>(
  callback: () => Promise<T> | T,
  filePath = ACCOUNTS_FILE_PATH,
  options?: {
    timeoutMs?: number;
    retryMs?: number;
    staleMs?: number;
  }
): Promise<T> {
  const lock = await acquireAccountStoreLock(filePath, options);
  try {
    return await callback();
  } finally {
    await lock.release();
  }
}

export async function readAccountStoreFromDisk(filePath = ACCOUNTS_FILE_PATH): Promise<AccountStore> {
  await ensureStorageDir(dirname(filePath));

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return createEmptyAccountStore();
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Invalid JSON in account store at ${filePath}: ${error.message}`);
    }
    throw new Error(`Invalid JSON in account store at ${filePath}`);
  }

  return parseAccountStore(parsed, `account store at ${filePath}`);
}

export async function writeAccountStoreToDisk(store: AccountStore, filePath = ACCOUNTS_FILE_PATH): Promise<void> {
  const validatedStore = parseAccountStore(store, "account store to write");

  await ensureStorageDir(dirname(filePath));

  const tempPath = createTempPath(filePath);
  try {
    await writeFile(tempPath, formatAccountStoreJson(validatedStore), {
      encoding: "utf-8",
      mode: ACCOUNT_FILE_MODE
    });
    await chmod(tempPath, ACCOUNT_FILE_MODE);
    await rename(tempPath, filePath);
    await chmod(filePath, ACCOUNT_FILE_MODE);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {
      // Best-effort cleanup of failed temp file.
    });
    throw error;
  }
}

export async function withLoadedAccountStore<T>(
  callback: (store: AccountStore) => Promise<T> | T,
  filePath = ACCOUNTS_FILE_PATH,
  options?: {
    timeoutMs?: number;
    retryMs?: number;
    staleMs?: number;
  }
): Promise<T> {
  return withAccountStoreLock(
    async () => {
      const store = await readAccountStoreFromDisk(filePath);
      return callback(store);
    },
    filePath,
    options
  );
}

export async function mutateAccountStore<T>(
  mutator: (store: AccountStore) => Promise<{ store: AccountStore; result: T }> | { store: AccountStore; result: T },
  filePath = ACCOUNTS_FILE_PATH,
  options?: {
    timeoutMs?: number;
    retryMs?: number;
    staleMs?: number;
  }
): Promise<T> {
  return withAccountStoreLock(
    async () => {
      const currentStore = await readAccountStoreFromDisk(filePath);
      const { store, result } = await mutator(currentStore);
      await writeAccountStoreToDisk(store, filePath);
      return result;
    },
    filePath,
    options
  );
}
