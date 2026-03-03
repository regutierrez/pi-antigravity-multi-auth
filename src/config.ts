import { homedir } from "node:os";
import { join } from "node:path";

export const EXTENSION_ID = "antigravity-multi" as const;
export const PROVIDER_ID = "google-antigravity-multi" as const;
export const PROVIDER_API_ID = "google-antigravity-multi-api" as const;
export const ANTIGRAVITY_BASE_URL = "https://daily-cloudcode-pa.sandbox.googleapis.com" as const;

export const ACCOUNTS_FILE_NAME = "accounts.json" as const;

export const ACCOUNT_FILE_MODE = 0o600;
export const ACCOUNT_DIR_MODE = 0o700;

export const PI_AGENT_DIR = process.env["PI_CODING_AGENT_DIR"] ?? join(homedir(), ".pi", "agent");
export const EXTENSION_STORAGE_DIR = join(PI_AGENT_DIR, "extensions", EXTENSION_ID);
export const ACCOUNTS_FILE_PATH = join(EXTENSION_STORAGE_DIR, ACCOUNTS_FILE_NAME);
export const ACCOUNTS_LOCK_FILE_PATH = `${ACCOUNTS_FILE_PATH}.lock`;

export const ACCOUNT_LOCK_TIMEOUT_MS = 15_000;
export const ACCOUNT_LOCK_RETRY_MS = 100;
export const ACCOUNT_LOCK_STALE_MS = 120_000;
