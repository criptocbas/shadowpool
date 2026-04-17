# ShadowPool — frontend

Next.js 16 + React 19 + Tailwind v4 app that ships the public landing
and the vault dashboard.

## Local development

```bash
yarn install
cp .env.example .env.local   # fill in NEXT_PUBLIC_RPC_URL
yarn dev                     # http://localhost:3000
```

Routes:

- `/` — landing (editorial hero + protocol flow + market data)
- `/vault` — dashboard (create vault → initialize strategy → actions)

## Build & verify

```bash
yarn tsc --noEmit            # type-check (~2s)
yarn build                   # production build (~20s with Turbopack)
```

## Deploying to Vercel

The repository ships a root-level [`vercel.json`](../vercel.json) that
points Vercel at the `app/` sub-directory (monorepo-style layout —
the outer workspace also holds the Anchor program, Arcis circuits,
and the `shadowpool-math` crate).

**One-shot deploy from the repo root:**

```bash
# First-time setup (from repo root — the one with vercel.json)
vercel link
# When prompted for "Root Directory", accept the default (".") —
# vercel.json's buildCommand handles the cd into app/.

# Environment variables: either set via dashboard (Project → Settings
# → Environment Variables) or import from .env.local:
vercel env pull

# Deploy
vercel --prod
```

**Environment variables to configure in the Vercel dashboard:**

See [`.env.example`](.env.example) for the current list. The
critical one is `NEXT_PUBLIC_RPC_URL` — set this to a **paid Helius
devnet endpoint** (the free tier drops Arcium uploads under load).

**DNS:** after the initial deploy, attach your custom domain in
Vercel → Domains. No extra config needed on the app side.

## Design system

The UI uses an institutional-ops aesthetic (Bloomberg terminal /
Palantir mission-control) rather than the standard web3 template.
Three-channel typography: Geist Sans (body), Geist Mono (data),
Instrument Serif (editorial). Everything else — color tokens in
OKLCH, motif classes like `.hex-dump`, `.flow-rail`, `.ticker-track`,
`.stream-log`, `.hero-terminal` — is in
[`src/app/globals.css`](src/app/globals.css).

See the root [`README.md`](../README.md) for the overall project
architecture and the [whitepaper](../WHITEPAPER.md) for the protocol
design.
