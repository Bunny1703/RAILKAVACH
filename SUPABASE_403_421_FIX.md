# RAILKAVACH — Supabase 403 / 421 Fix

The previous server implementation could produce HTTP 421 because it connected to a Cloudflare/Supabase IP while the HTTP `Host` header did not match the Supabase hostname. The new version uses the Supabase hostname first and only uses `SUPABASE_IPV4` as an optional network fallback with the correct Host header.

## 1. Configure `.env`

Copy `.env.example` to `.env` and set:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_SERVER_SIDE_SECRET_KEY
SESSION_SECRET=use-a-long-random-string-at-least-32-characters
ADMIN_EMAILS=your-email@example.com
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
NODE_ENV=development
PORT=3000
```

`SUPABASE_SECRET_KEY` is preferred. `SUPABASE_SERVICE_ROLE_KEY` is also supported for projects using the older key name.

**Do not put a server/service key in frontend JavaScript or commit `.env`.**

## 2. Check Supabase before opening the UI

Run:

```bat
npm install
npm run dev
```

Then open:

`http://localhost:3000/api/health/supabase`

Expected:

```json
{"ok":true,"service":"supabase","users_table":true}
```

If you get `403`, the network is working but Supabase rejected the server key. Replace the server key in `.env` with the current server-side secret/service-role key from your Supabase project and restart Node.

If you get `503`, check the `SUPABASE_URL` and local network/DNS. Only add `SUPABASE_IPV4` if your network genuinely cannot resolve the hostname.

## 3. Database

Make sure the project's Supabase SQL migrations have been run, especially the base schema and the latest user/auth migration. The app's custom authentication reads the `users` table through the server-side key.

## 4. Why the UI was failing

`/api/me` checks the session by reading the user from Supabase. If that database request fails, the dashboard cannot establish the logged-in user. Fixing the database connection therefore fixes the login/dashboard flow as well.
