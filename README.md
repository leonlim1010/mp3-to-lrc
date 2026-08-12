# SoniScript - Music Management

FastAPI application for MP3-to-LRC transcription, lyric correction, sync
testing, and ID3 tag management.

## Cloud account setup

1. Create a Supabase project.
2. In **SQL Editor**, run `supabase_schema.sql` from this repository.
3. In **Authentication > Providers**, enable Anonymous and Google. Configure
   Google's client ID/secret and enable manual identity linking so guests can
   retain their files when upgrading.
4. Enable email authentication and use email OTP. Configure production SMTP;
   Supabase's default sender is intended only for testing.
5. Add these Auth redirect URLs:
   - `http://localhost:8000`
   - `https://music-management-l6n6.onrender.com`
6. In **Authentication > Email Templates**, ensure the **Change email address**
   and **Reset password** buttons link to `{{ .ConfirmationURL }}`. Do not use
   `{{ .SiteURL }}` for these buttons because it discards the action-specific
   redirect and makes the link behave like an ordinary sign-in link.
7. Add these Render environment variables:

   ```text
   SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
   GROQ_API_KEY=YOUR_EXISTING_GROQ_KEY
   RATE_LIMIT_SALT=A_LONG_RANDOM_SECRET
   ```

Never expose a Supabase service-role key in browser code. This application
uses the caller's JWT for database requests so Row Level Security enforces
ownership.

## Cloud policies

- Guest: 3 transcriptions/day, 10 minutes maximum per file, 7-day retention.
- Registered: 10 transcriptions/day, 15 minutes maximum per file.
- All uploads: MP3 only and 25 MB maximum.
- MP3 data is temporary. Only LRC text and metadata are persisted.

Guest cleanup can be scheduled using Supabase Cron after reviewing the cleanup
query at the bottom of `supabase_schema.sql`.
