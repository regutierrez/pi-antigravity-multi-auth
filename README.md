# antigravity-multi

## Setup

```bash
cd antigravity-multi
npm install
```

## Type safety checks

```bash
npm run typecheck
```

Strict TypeScript settings are enabled in `tsconfig.json` (including `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`).

## Full local checks

```bash
npm run check
```

## Run extension in pi

```bash
pi --extension /home/pael/playground/pi-ag-multi-auth/antigravity-multi/index.ts
```

(Use `/reload` when loading via auto-discovery paths.)

## Storage

Pooled accounts are stored in a JSON file at:
`~/.pi/agent/extensions/antigravity-multi/accounts.json`

This file contains the refresh tokens, project IDs, and rate limit tracking for all added accounts.

## Authentication (`auth.json`)

When you run `/login google-antigravity-multi`, `pi` stores a "manager" credential in its global `auth.json`.

**Purpose of the `auth.json` entry:**
1. **Provider Activation:** It signals to `pi` that the `google-antigravity-multi` provider is authenticated and available for use.
2. **Login Management:** It facilitates the initial OAuth flow and subsequent "add account" flows.
3. **Fallback Credential:** It provides a set of valid credentials that `pi` expects, even though the extension internally handles rotation across the full pool.

## Current commands

- `/login google-antigravity-multi` adds one Antigravity OAuth account per login run.
  - Re-run `/login google-antigravity-multi` to append additional accounts.
  - Supports OAuth callback + manual redirect URL paste fallback (headless-friendly).
  - Escape/Ctrl+C cancels the login flow.
- `/ag-accounts` to list pooled accounts.
- `/ag-accounts enable <index>` / `/ag-accounts disable <index>`.
- `/ag-accounts set-active <claude|gemini> <index|none>`.
- `/ag-accounts remove <index>`.
