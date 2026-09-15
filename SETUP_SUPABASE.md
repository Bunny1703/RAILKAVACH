# RAILKAVACH Supabase + Netlify setup

## 1. Supabase
- Open your RAILKAVACH Supabase project.
- SQL Editor -> New query.
- Run `supabase-schema.sql` if the table is not already created.
- Table Editor -> `users` should contain: id, name, email, password_hash, google_id, role, profile_image, is_active, created_at, updated_at.
- Make sure RLS is enabled.

## 2. First Admin
If your Admin row already exists, keep it. Otherwise run:

```sql
insert into public.users (name, email, role, is_active)
values ('Satya', 'YOUR_ADMIN_EMAIL@gmail.com', 'admin', true);
```

Do not store a plain password in SQL. Create the password through the registration/backend flow, or ask the Admin to use a password login account.

## 3. Netlify variables
In Netlify -> Project configuration -> Environment variables add/update:

- `GOOGLE_CLIENT_ID` = your Google Web Client ID
- `SUPABASE_URL` = your Supabase Project URL
- `SUPABASE_SECRET_KEY` = your Supabase Secret key (`sb_secret_...`)
- `SESSION_SECRET` = long random private string
- `ADMIN_EMAILS` = comma-separated admin emails, e.g. `satya@example.com`

Never put `SUPABASE_SECRET_KEY` in `login.js`, HTML, or `google-config.js`.

## 4. Google
Authorized JavaScript origin for the production site:

`https://railkavachh.netlify.app`

No `/login.html` suffix.

## 5. Deploy
Redeploy the site after changing environment variables. Netlify Functions receive environment variables at runtime.

## 6. Test
- `/login.html` -> email/password or Google.
- `/register.html` -> new users become Operator unless their email is in `ADMIN_EMAILS`.
- `/admin-users.html` -> Admin only.
- `/index.html` -> redirects to login when there is no valid session.
