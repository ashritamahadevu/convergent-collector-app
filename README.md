# Convergent Collector

Pokémon TCG collection app scaffold: Expo (iOS, Android, Web), Supabase (auth, database, storage), and a Hono API deployable on Vercel.

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) (or `npx pnpm@10` from the repo root)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for local Supabase)
- [Vercel CLI](https://vercel.com/docs/cli) (for local API dev and deploy)

## Structure

| Path | Purpose |
|------|---------|
| `apps/mobile` | Expo Router client |
| `apps/api` | Hono API (Vercel serverless) |
| `packages/shared` | Shared Zod schemas and types |
| `supabase/` | Migrations and local Supabase config |

## Setup

```powershell
# Install dependencies
npx pnpm@10 install

# Environment files
copy apps\mobile\.env.example apps\mobile\.env
copy apps\api\.env.example apps\api\.env
```

### Local Supabase

```powershell
npx supabase@latest start
npx supabase@latest status
```

Copy the API URL, anon (publishable) key, and service role key into:

- `apps/mobile/.env` — `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `apps/api/.env` — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

Reset/apply migrations:

```powershell
npx supabase@latest db reset
```

### Run development

```powershell
# All apps (Turbo)
npx pnpm@10 dev

# Or individually:
npx pnpm@10 --filter mobile dev
npx pnpm@10 --filter @convergent/api dev
```

The API `dev` script runs Hono on port 3000 via Node (`src/local.ts`). Use `npx pnpm@10 --filter @convergent/api dev:vercel` to emulate Vercel locally.

- Expo web: press `w` in the Expo terminal, or open the URL shown (often `http://localhost:8081`).
- API health: `GET http://localhost:3000/health`
- Authenticated API: `GET http://localhost:3000/api/v1/me` with header `Authorization: Bearer <supabase_access_token>`

Sign in via the **Settings** tab in the mobile app to obtain a session token for API testing.

## Deploy API (Vercel)

```powershell
cd apps\api
vercel link
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add CORS_ORIGINS
vercel
```

Set `EXPO_PUBLIC_API_URL` in the mobile app to your production API URL.

## Scripts

| Command | Description |
|---------|-------------|
| `npx pnpm@10 dev` | Start mobile + API dev servers |
| `npx pnpm@10 build` | Build packages/apps |
| `npx pnpm@10 typecheck` | TypeScript across the monorepo |
| `npx pnpm@10 lint` | Lint (stubs where not configured) |

## Roadmap hooks

Empty route stubs live under `apps/api/src/routes/` (`scan`, `valuation`, `grading`). Feature folders under `apps/mobile/features/` are placeholders for upcoming MVP work.
