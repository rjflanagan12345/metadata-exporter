# Supabase Migrations

Run migrations in order using the Supabase CLI or by pasting into the SQL Editor in the Supabase dashboard.

## Running migrations
1. `001_initial_schema.sql` — all 13 tables, indexes, triggers
2. `002_seed_channels.sql` — seed 31 distribution channels

## Notes
- pgcrypto must be enabled (handled in 001)
- Run as the `postgres` role (superuser) or the Supabase service role
- Do not modify migration files after running — create a new migration instead
