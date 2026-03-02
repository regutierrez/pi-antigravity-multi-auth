# antigravity-multi

Development workspace for the `google-antigravity-multi` pi extension.

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

## Current commands

- `/login google-antigravity-multi` to add one or more Antigravity OAuth accounts.
  - Supports callback-server login with manual redirect URL paste fallback.
  - Escape/Ctrl+C cancels the login flow.
- `/ag-accounts` to list pooled accounts.
- `/ag-accounts enable <index>` / `/ag-accounts disable <index>`.
- `/ag-accounts set-active <claude|gemini> <index|none>`.
- `/ag-accounts remove <index>`.
