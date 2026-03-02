import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { Value } from "@sinclair/typebox/value";

import {
  ACCOUNT_DIR_MODE,
  ACCOUNT_FILE_MODE,
  ACCOUNTS_FILE_PATH,
  EXTENSION_STORAGE_DIR
} from "./config.js";
import { ACCOUNT_STORE_VERSION, AccountStoreSchema, type AccountStore } from "./types.js";

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const { code } = error as { code?: unknown };
  return typeof code === "string" ? code : undefined;
}

function formatAccountStoreJson(store: AccountStore): string {
  return `${JSON.stringify(store, null, 2)}\n`;
}

function createTempPath(filePath: string): string {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${filePath}.tmp-${suffix}`;
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
