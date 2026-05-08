# Wizard Online

Multiplayer Wizard for the browser, built as a `pnpm` monorepo with:

- `apps/web`: Vite + React + Tailwind client
- `apps/server`: Fastify + Socket.IO + MySQL backend
- `packages/shared`: shared Wizard rules engine and game types

## Features

- Anonymous room creation and join-by-code
- Real-time multiplayer room state over Socket.IO
- Full round flow: deal, wizard trump choice, bidding, trick play, round scoring, game winner
- Configurable options:
  - player count from 3 to 6
  - hidden bids
  - dealer bid restriction: standard, no-even-total, Canadian
  - exact-bid bonus
  - points per exact trick
  - miss penalty
- MySQL persistence for room state and reconnect-safe sessions

## Local Setup

1. Install dependencies:

```bash
pnpm install
```

2. Start MySQL:

```bash
pnpm db:up
```

This project maps MySQL to host port `3307` by default to avoid conflicts with an existing local MySQL instance.

3. Create a local env file:

```bash
cp .env.example .env
```

The app now uses a single MySQL connection string:

```bash
DATABASE_URL=mysql://wizard:wizard@127.0.0.1:3307/wizard_online
```

4. Start the app:

```bash
pnpm dev
```

The web app talks to the backend through same-origin paths:

- HTTP API: `/api/...`
- Socket.IO: `/api/socket.io`

In local development, Vite proxies `/api` to the server on port `3001`. In production, the Fastify server can serve the built web app directly from `apps/web/dist`, so the browser still talks to the same origin for both the SPA and API.

5. Open:

- Web: `http://localhost:5173`
- API: `http://localhost:3001`

## Verification

Run the core verification suite with:

```bash
pnpm verify
```

That runs:

- shared rule tests
- workspace typecheck
- workspace builds

## Railway Deployment

This repo is set up to deploy as:

- one Railway app service for the Node server and built Vite frontend
- one Railway MySQL service for persistence

The repo includes [railway.json](/Users/me9/dev/wizard-online/railway.json), which tells Railway to:

- build with `pnpm build`
- start with `pnpm start`
- healthcheck `GET /api/health`

### Railway setup

1. Create a new Railway project and connect this repo.
2. Add a MySQL service to the project.
3. In the app service, set:

```bash
DATABASE_URL=${{MySQL.MYSQL_URL}}
NODE_ENV=production
```

4. Deploy the app service.

Railway injects `PORT` automatically, and the server already binds `0.0.0.0` and uses `process.env.PORT`.

After deploy:

- `/` serves the web app
- `/room/<CODE>` serves the SPA route
- `/api/*` serves the backend and Socket.IO endpoints

## Notes

- Room state is persisted in MySQL as JSON snapshots, while active turn updates are broadcast live through Socket.IO.
- Returning to `/room/<CODE>` on the same browser restores the stored anonymous player identity for that room.
