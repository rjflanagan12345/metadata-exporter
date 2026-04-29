# APG Metadata Exporter

Internal tool for managing and distributing book metadata (ONIX feeds) to 31 retail and library channels.

## Structure
- `apps/admin` — Next.js admin UI
- `packages/excel-parser` — Excel import parser
- `supabase/migrations` — Database migrations

## Setup
1. Copy `apps/admin/.env.local.example` to `.env.local` and fill in Supabase credentials
2. Run `npm install` from root
3. Run `npm run dev`
