# GWS Studio

Marketing workspace for Global Wealth Strategists with Editing, Paid, Organic and Sales boards, plus native Frame.io V4 reviews.

## Hosting

The project targets **Vercel Node.js Functions** and **Neon Postgres**. The existing static interface is served from `public/`; `api/studio.js` handles Studio login and Frame.io API requests. No Cloudflare/Sites headers, D1 bindings, SQLite database, or persistent local server are needed in production.

The Vercel project is `gws-studio` in `marvin-hamkes-projects-c4baca5d`. Connect the existing Neon resource to that project; installing Neon in the team alone does not supply a database to this app. Setup steps are in [VERCEL-SETUP.md](VERCEL-SETUP.md).

## Development

Use Node.js24. Run `npm install`, link the intended Vercel project, pull the development environment, and verify the database and secrets before migrations or starting the server:

```sh
vercel link --scope marvin-hamkes-projects-c4baca5d --project gws-studio
vercel env pull .env.local --yes --scope marvin-hamkes-projects-c4baca5d
npm run db:migrate -- --confirm-environment
npm run user:create -- --email you@example.com --name "Your Name"
npm run dev
```

`user:create` reads the password twice from hidden input. Public registration is disabled. `npm test` and `npm run build` do not require live database access and do not run migrations.

## What is stored where

- Neon: Studio accounts, login sessions, rate limits, encrypted Frame.io tokens, temporary OAuth state, webhook events, and duplicate-write protection.
- Frame.io: videos, versions, and review comments.
- Browser-local prototype state: tasks, role previews, and demo chat. These remain a prototype rather than shared team records or production role permissions.

Frame.io setup is in [FRAMEIO-SETUP.md](FRAMEIO-SETUP.md). No live Adobe credentials are included.
