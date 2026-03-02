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
