# Project Instructions

## Architecture

- `apps/console` is the private operator-facing builder UI.
- `apps/shell` is the public audience runtime used by app links, QR codes, stage mode, and projector mode.
- `convex` is the shared realtime backend and build/deployment control plane.
- `packages/runtime-sdk` and `packages/ui-kit` are bundled into generated audience apps by `pnpm vendor`.

## Local setup

```bash
pnpm install --frozen-lockfile
set -a; source apps/console/.env.local; set +a
pnpm dev
```

Sourcing the console environment before `pnpm dev` makes `VITE_CONVEX_URL` and `VITE_SHELL_URL` available to both Vite apps. The default ports are `5173` for the console and `5174` for the audience shell.

Keep `.env`, `.env.local`, `.operator-key`, and all secret values untracked and out of command output.

## Verification

```bash
pnpm test
pnpm typecheck
pnpm --filter console build
pnpm --filter shell build
```

## Deployments

- Builder console: `https://blockhack-forge-console.vercel.app`
- Audience shell: `https://blockhack-forge-shell.vercel.app`
- Convex development deployment: `https://outgoing-warbler-572.convex.cloud`

`scripts/deploy.sh` deploys backend code and synchronizes provider credentials to Convex. It has cloud side effects and should only be run when a backend deployment is intended.
