# Bubble Vote

A community-powered PS1, PS3, and Sega game ranking board. Games grow as they collect votes, so the most-loved classics become the biggest bubbles.

## Cloudflare setup

1. Create a D1 database in the Cloudflare dashboard named `bubble-vote-db`.
2. Replace `REPLACE_WITH_DATABASE_ID` in `wrangler.toml` with that database ID.
3. Run the migration from the dashboard, or with Wrangler in your CI pipeline:

   ```sh
   npx wrangler d1 migrations apply bubble-vote-db --remote
   ```

4. Connect the repository to Cloudflare Workers Builds. Use `npm ci` as the install command, `npm run build` as the build command, and `dist` as the asset directory if requested.

The Worker serves the built static site and exposes authentication, arena, game, and voting APIs. Users register/login, arena creators become that arena's admins, and only the admin can add games. Voting requires an account and uses a secure device cookie plus D1 uniqueness rules, so one device cannot vote for the same game twice—even with multiple accounts. This project does not deploy automatically from the local machine.

## Local preview

```sh
npm install
npm run dev
```

When using Vite locally, accounts, arenas, games, and device vote limits are stored in that browser's localStorage so registration works without a Cloudflare connection. This is development-only storage; Cloudflare uses D1 SQL for persistent users, sessions, arenas, games, and votes.

For Cloudflare, apply all migrations in order, including `0002_arenas_auth.sql` and `0003_device_votes.sql`.

Checks used for this project:

```sh
npm run typecheck
npm run build
```
