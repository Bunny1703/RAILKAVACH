# Google Sign-In setup for RAILKAVACH

## Google Cloud
1. Google Cloud -> Google Auth Platform -> Audience: choose **External** for a personal Gmail-accessible app.
2. Google Auth Platform -> Clients -> your Web application client.
3. For local development, also add this Authorized JavaScript origin:
   `http://localhost:3000`
4. Authorized JavaScript origin for production:
   `https://railkavachh.netlify.app`
5. Do not add `/login.html` to the origin.
6. Authorized redirect URIs can remain empty for Google Identity Services' rendered button.
7. Keep the Client ID in Netlify as `GOOGLE_CLIENT_ID`.

## Current Client ID used by the project
`1099093851823-mlf6n4ieqbgttq87ktnj2u2p6o19iem1.apps.googleusercontent.com`

## Login behavior
Google verifies the account. RAILKAVACH then looks up the email in Supabase. If the email already exists, its database role is used. If it does not exist, a new Google account is created as Operator unless the email is in `ADMIN_EMAILS`.

Users cannot choose their role on the login page.
