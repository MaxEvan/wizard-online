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

4. Start the app:

```bash
pnpm dev
```

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

## Notes

- Room state is persisted in MySQL as JSON snapshots, while active turn updates are broadcast live through Socket.IO.
- Returning to `/room/<CODE>` on the same browser restores the stored anonymous player identity for that room.
