# Deploy GWS Studio to Vercel with Neon

## Project settings

Import `Marvinhaemke/GWS-Studio` into the existing Vercel project `gws-studio` (team `marvin-hamkes-projects-c4baca5d`). Select the hosting migration branch for a preview, or merge its PR into `main` for Git-based production deployments.

- Framework: Other
- Node.js: 24.x
- Install: `npm install --no-audit --no-fund`
- Build: `npm run build`
- Output directory: `public`
- Function: `api/studio.js`

`vercel.json` supplies routing and build settings. Requests to `/api/auth/*`, `/api/frameio/*`, and `/api/studio/session` are rewritten to the same Function, preserving OAuth query parameters and request bodies. There is no `listen()` call in the deployed function. The small loopback server exists only for local development.

## Connect the existing Neon database

In Vercel, open Storage/Marketplace → your existing Neon resource → Connect Project → `gws-studio`. Choose the intended database and preview/development branches; do not share production credentials with untrusted previews. This should inject `DATABASE_URL` and usually `DATABASE_URL_UNPOOLED`. No new Neon database is provisioned by the source code.

Use the pooled Neon connection at runtime. The migration command prefers the unpooled connection when present. Keep the TLS options provided by Neon. Place the Function region near your Neon database once its region is known; the repository does not guess the location.

## Environment

Required for Studio login:

- `DATABASE_URL`: injected by Neon, server-only.
- `BETTER_AUTH_SECRET`: independent random value, at least32 characters.
- `APP_ORIGIN`: the exact HTTPS production origin. On Vercel previews, the app can derive a stable `.vercel.app` origin from Vercel system variables; no request Host header is trusted. For local development, use `http://127.0.0.1:4173`.

Required when Frame.io is connected:

- `SESSION_SECRET`: separate random encryption key, at least32 characters.
- `FRAMEIO_CLIENT_ID` and `FRAMEIO_CLIENT_SECRET`.
- `FRAMEIO_REDIRECT_URI`: `<APP_ORIGIN>/api/frameio/callback`, exactly registered in Adobe.

Optional: `DATABASE_URL_UNPOOLED` for migration execution and `FRAMEIO_WEBHOOK_SECRET` for signed webhooks. Keep all secrets in Vercel environment variables or ignored `.env.local`, never in source or public `VITE_*`/`NEXT_PUBLIC_*` variables. A `.env.example` lists names only.

## Apply schema once, after linking and verifying the environment

```sh
vercel link --scope marvin-hamkes-projects-c4baca5d --project gws-studio
vercel env pull .env.local --yes --scope marvin-hamkes-projects-c4baca5d
npm run db:migrate -- --confirm-environment
```

The command validates local project linkage and the TLS-enabled connection string, then applies the two additive migrations in a transaction with an advisory lock and checksum ledger. Tables are namespaced `gws_*`; existing Neon data is not replaced. Migrations never run during a request or build. For Production, deliberately pull the intended Production environment rather than accidentally applying to development.

Create the first team account:

```sh
npm run user:create -- --email you@example.com --name "Your Name"
```

The password is read twice from hidden input. This invokes Better Auth's internal signup API only in the CLI; the deployed HTTP server disables public signup. Existing credentials and roles from other Neon apps are not imported. Log in at `/login`.

## Verify

1. `npm test` and `npm run build` pass.
2. `/api/studio/session` reports configured:true and authenticated:false before login, then a verified user after login.
3. `/api/auth/sign-up/email` is denied, and caller-supplied Sites identity headers do not authenticate requests.
4. Connect Frame.io, choose a file, switch versions, add a timestamped comment, and confirm it appears in Frame.io.
5. After refresh or a new function instance, the session persists in Neon.

Without database/secrets the deployment serves the interface and a truthful setup-needed login state. That is a deployment preview, not a verified live integration. Shared tasks/chat and production role permissions are separate future work.
