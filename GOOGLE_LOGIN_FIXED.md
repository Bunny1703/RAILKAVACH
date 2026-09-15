# Google Login Fix

The local authentication backend now uses Node 18+ native `fetch()` to call the
Supabase REST API through the real Supabase hostname. The previous implementation
manually connected to Cloudflare IP addresses, which could produce 403 responses.

Before testing:
1. Put a valid server-side Supabase secret key in `.env`.
2. Keep the secret key only on the backend.
3. Add `http://localhost:3000` to the Google OAuth client's Authorized JavaScript origins.
4. Run `npm install`.
5. Run `npm run dev`.
6. Open `http://localhost:3000/login.html`.
7. Click Sign in with Google.

The Google Client ID is public and remains in `google-config.js`.
