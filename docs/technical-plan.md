# APG Metadata Exporter — Technical Plan

**Version:** 1.3
**Date:** 2026-04-29
**Status:** READY FOR PHASE 1 BUILD

---

## Executive Summary

APG is replacing NetRead with a custom ONIX metadata exporter that pulls book title data from a shared Supabase database and delivers formatted feeds (ONIX 2.1, 3.0, 3.1, and spreadsheet) to 31 distribution channels on a 6-hour schedule, with channels each tracking their own last-successful-send timestamp so incremental updates are scoped correctly per channel.

**All architecture decisions resolved. Plan is ready for Phase 1 build.**

**3 key architectural decisions made:**
1. **Custom XML builders per ONIX version** — no all-in-one library; `xmlbuilder2` gives full control over element order and namespace declarations required by ONIX validators. Estimated ~2-3 days vs. ~3-4 days fighting existing library limitations.
2. **`updated_at` polling for change detection** — per-channel `last_successful_run_at` timestamp on the `channels` table, with Postgres triggers propagating child table changes (contributors, subjects, covers) up to `titles.updated_at`. Simpler than CDC/replication; sufficient for 6-hour cadence.
3. **Delivery adapter pattern** — shared `DeliveryAdapter` interface with SFTP/FTP/API/email implementations. 28 of 31 channels are SFTP; new methods add without touching existing configs.

**Phase 1 deliverables:**
- Supabase schema live (all tables, triggers, indexes, 31-channel seed including 3 inactive placeholders)
- `channel_credentials` table with pgcrypto encryption (replaces `.env` credential management)
- Excel import worker (upsert on ISBN13, validates fields, logs batch results)
- Cover image upload endpoint (DO Spaces, validates dimensions, supersedes old images)
- Publishers admin page (CRUD)
- Titles admin page (browse/search with cover thumbnail + editable detail page)
- Import history page (batch log with row-level error detail)

---

## Decisions Log

| # | Decision | Outcome |
|---|----------|---------|
| 1 | Secrets management | Store channel credentials in Supabase `channel_credentials` table with pgcrypto encryption. Encryption key in env var. No external secrets manager. |
| 2 | 3 unconfirmed channels | Seed as `active = false` placeholders in the channels table. Phase 1 task 1.1 done criteria updated to reflect this. |
| 3 | Prices table scope | USD only for now. No multi-currency, no `prices` child table. Single `price_usd` column on titles. `price_cad` and `price_gbp` columns removed. CAD, GBP, EUR pricing deferred indefinitely — not a Phase 2 item unless explicitly added back. |
| 4 | Amazon CA specifics | USD pricing only. No CAD column, no French metadata requirement. Amazon CA treated identically to Amazon US except separate SFTP credentials. |
| 5 | EUR pricing | Not needed. USD only across all channels. GBP not needed — UK channels (Gazelle, Waterstones, Blackwell's) receive USD pricing. |
| 6 | Repo strategy | Standalone repo: `rjflanagan12345/metadata-exporter`. Exporter connects to CORE's Supabase project via service role key stored as env var on the DO server. All file paths in this plan updated to reflect standalone structure. |
| 7 | Phase 1 title editing | Include basic field editing in Phase 1 admin UI. `/admin/titles/[id]` detail page with editable fields (all template fields except ISBN13 read-only). Save bumps `updated_at` to queue for next export cycle. |

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Supabase Data Model](#2-supabase-data-model)
3. [Tech Stack Decisions](#3-tech-stack-decisions)
4. [Phase 1 Detailed Task List](#4-phase-1-detailed-task-list)
5. [Repo and File Structure](#5-repo-and-file-structure)
6. [Key Technical Decisions](#6-key-technical-decisions)

---

## 1. Architecture Overview

### System Components

```
[Publisher Excel Template]
        |
        v
[Metadata Exporter Admin UI — Next.js on Vercel]
        |
        | INSERT/UPDATE via Supabase JS client
        v
[Supabase — PostgreSQL] (CORE's Supabase project, shared)
        |
        | Polled every 6 hours via pg query (titles WHERE updated_at > last_run)
        v
[Exporter Service — Node.js on Digital Ocean]
        |
        |--- [ONIX 2.1 Generator] ---> 15 channels (SFTP/FTP/email)
        |--- [ONIX 3.0 Generator] ---> 11 channels (SFTP/FTP/API)
        |--- [ONIX 3.1 Generator] ---> 2 channels (SFTP/API)
        |--- [Spreadsheet Generator] ---> 1 channel (email/SFTP)
        |
        | Writes results to
        v
[Supabase — send_log table]
        |
        v
[Status Dashboard in Metadata Exporter Admin UI]
```

### Data Flow Detail

1. **Import:** APG staff uploads publisher Excel template in admin UI. Import worker parses it, validates fields, applies system defaults, and upserts rows into `titles` and related tables. Batch is recorded in `import_batches`.

2. **Cover images:** APG staff uploads `ISBN13.jpg` or `ISBN13.png` to DO Spaces via admin UI. On upload, a webhook or polling job matches the filename ISBN to a title record and updates `cover_images`.

3. **Export cycle:** Exporter service runs on a 6-hour cron. It queries Supabase for titles where `updated_at > last_successful_run_at` per channel. On first run per channel, it pulls the full catalog. It generates the appropriate format, delivers to the channel, and writes a `send_log` row (success or failure).

4. **Retry:** Failed deliveries are queued. Admin can trigger one-click retry from the status dashboard, which calls a REST endpoint on the exporter service.

5. **Notifications:** On completion of each channel delivery, the exporter service sends a success/failure notification (email or Slack webhook, configurable per channel).

### Network Boundaries

- Admin UI (Vercel) communicates with Supabase over HTTPS using the Supabase JS client.
- Exporter (DO) communicates with Supabase over HTTPS using the Supabase JS client (service role key stored as env var on DO server).
- Admin UI communicates with the Exporter service via a lightweight REST API (authenticated with a shared secret).
- DO Spaces is accessed by both the Admin UI (uploads) and the Exporter (image retrieval for ONIX feed URLs).

---

## 2. Supabase Data Model

### Conventions

- All primary keys: `uuid`, default `gen_random_uuid()`.
- All tables: `created_at timestamptz default now()`, `updated_at timestamptz default now()`.
- `updated_at` is maintained by a Postgres trigger on every table that has it.
- Soft deletes: `deleted_at timestamptz` on `titles`. Null = active.
- RLS: Enabled on all tables. Service role key bypasses for the exporter. Admin UI uses anon key + RLS policies tied to auth.

---

### Table: `titles`

Core metadata for each book title. One row per ISBN.

```sql
CREATE TABLE titles (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identifiers
  isbn13                    text NOT NULL UNIQUE,
  isbn10                    text,
  ean                       text,
  upc                       text,

  -- Publisher
  publisher_id              uuid REFERENCES publishers(id),
  publisher_name            text,                           -- denormalized for export speed
  publisher_code            text,                           -- APG internal code
  imprint                   text,

  -- Title info
  title                     text NOT NULL,
  subtitle                  text,
  series_name               text,
  series_number             text,
  edition_number            int,
  edition_statement         text,

  -- Dates
  pub_date                  date,
  on_sale_date              date,
  out_of_print_date         date,

  -- Product form
  product_form              text NOT NULL,                  -- ONIX code e.g. 'BA', 'BC', 'DG'
  product_form_detail       text,                           -- ONIX code e.g. 'B206'
  product_composition       text DEFAULT '00',             -- ONIX code
  number_of_pages           int,
  illustration_note         text,
  number_of_pieces          int DEFAULT 1,                 -- system default

  -- Dimensions (metric, stored in mm/grams)
  height_mm                 numeric(8,2),
  width_mm                  numeric(8,2),
  thickness_mm              numeric(8,2),
  weight_grams              numeric(8,2),

  -- Pricing (USD only — Decision #3/#4/#5: CAD, GBP, EUR deferred indefinitely)
  price_usd                 numeric(10,2),

  -- Description
  description               text,
  short_description         text,
  review_quote              text,
  review_source             text,
  table_of_contents         text,

  -- Audience
  audience_code             text,                          -- ONIX audience code e.g. '01' general
  audience_range_qualifier  text,
  audience_range_from       text,
  audience_range_to         text,
  reading_level             text,

  -- Classification
  bisac_main                text,                          -- primary BISAC code (denorm cache of subjects seq=1)
  thema_main                text,                          -- primary Thema code (denorm cache of subjects seq=1)
  thema_version             text DEFAULT '1.6',           -- system default

  -- Distributor / supply chain
  discount_code             text DEFAULT 'A',             -- system default
  returns_code              text DEFAULT 'Y',             -- system default
  notification_type         text DEFAULT '03',            -- system default
  availability_code         text DEFAULT '20',            -- ONIX: available
  supplier_role             text DEFAULT 'Exclusive Distributor to resellers and end-customers',
  country_of_publication    text DEFAULT 'US',            -- system default

  -- Barcodes / physical
  barcode_type              text DEFAULT 'GTIN-13 - On back',
  choking_hazard            text DEFAULT 'No choking hazard warning necessary',

  -- Language
  language_code             text DEFAULT 'eng',           -- system default, overridable

  -- Work / related
  work_id                   text,                         -- application default = isbn13 (set on INSERT by import worker)

  -- Status
  status                    text NOT NULL DEFAULT 'active', -- 'active', 'inactive', 'forthcoming'
  deleted_at                timestamptz,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- idx_titles_isbn13 removed: UNIQUE constraint on isbn13 already creates a btree index (R1 finding 12 RESOLVED)
CREATE INDEX idx_titles_publisher_id  ON titles(publisher_id);
CREATE INDEX idx_titles_updated_at    ON titles(updated_at);
CREATE INDEX idx_titles_status        ON titles(status);
```

---

### Table: `publishers`

```sql
CREATE TABLE publishers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  code            text NOT NULL UNIQUE,   -- APG internal short code
  contact_email   text,
  contact_name    text,
  notes           text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

---

### Table: `contributors`

One row per contributor role per title (e.g. a title with two authors = two rows).

```sql
CREATE TABLE contributors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id            uuid NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  sequence_number     int NOT NULL DEFAULT 1,   -- order of display
  contributor_role    text NOT NULL,            -- ONIX code: 'A01' author, 'B01' editor, etc.
  person_name         text,                     -- full name as it appears on cover
  person_name_inverted text,                    -- Last, First
  first_name          text,
  last_name           text,
  corporate_name      text,                     -- for corporate contributors
  biography           text,
  website_url         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (title_id, sequence_number, contributor_role)
);

CREATE INDEX idx_contributors_title_id ON contributors(title_id);
```

---

### Table: `subjects`

BISAC, Thema, and other subject codes per title. Multiple rows per title allowed.

```sql
CREATE TABLE subjects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id        uuid NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  scheme          text NOT NULL,    -- 'BISAC', 'THEMA', 'CLIL', 'UKSLC', etc.
  code            text NOT NULL,
  heading_text    text,             -- human-readable label
  sequence_number int DEFAULT 1,   -- 1 = primary
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),  -- RESOLVED R1 finding 13: added for audit trail consistency

  UNIQUE (title_id, scheme, code)
);

CREATE INDEX idx_subjects_title_id ON subjects(title_id);
```

---

### Table: `cover_images`

One active cover per title. Previous versions are soft-retained via `superseded_at`.

```sql
CREATE TABLE cover_images (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id        uuid NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  isbn13          text NOT NULL,
  filename        text NOT NULL,          -- e.g. '9781234567890.jpg'
  storage_path    text NOT NULL,          -- DO Spaces key e.g. 'covers/9781234567890.jpg'
  public_url      text NOT NULL,          -- full CDN URL
  format          text NOT NULL,          -- 'jpg' or 'png'
  file_size_bytes int,
  width_px        int,
  height_px       int,
  uploaded_by     text,                   -- auth user email
  superseded_at   timestamptz,            -- null = current active image
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cover_images_title_id    ON cover_images(title_id);
CREATE INDEX idx_cover_images_isbn13      ON cover_images(isbn13);
CREATE INDEX idx_cover_images_superseded  ON cover_images(superseded_at) WHERE superseded_at IS NULL;
```

---

### Table: `channels`

The 31 distribution channels. Credentials are NOT stored here — they are stored in `channel_credentials` (see below).

```sql
CREATE TABLE channels (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL UNIQUE,       -- e.g. 'Amazon US'
  slug                    text NOT NULL UNIQUE,       -- e.g. 'amazon-us', used in code
  format                  text NOT NULL,              -- 'onix-2.1', 'onix-3.0', 'onix-3.1', 'spreadsheet'
  delivery_method         text NOT NULL,              -- 'sftp', 'ftp', 'api', 'email', 'tbd'
  credentials_key         text,                       -- FK reference slug into channel_credentials.channel_slug
  region                  text,                       -- 'US', 'CA', 'UK'
  active                  boolean NOT NULL DEFAULT true,
  last_successful_run_at  timestamptz,                -- NULL = channel has never had a successful send; triggers full catalog send
  image_delivery          text NOT NULL DEFAULT 'url_only',  -- 'url_only' or 'file_alongside'
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- RESOLVED (R1 finding 5): Added last_successful_run_at. Removed first_send_done — it was
-- redundant with null last_successful_run_at. Null = first send. Non-null = incremental.
-- To force a full resend: SET last_successful_run_at = NULL for the target channel.
-- Decision #6: credentials_key references channel_credentials table, not .env file.
```

**Seed data — all 31 channels (3 unconfirmed seeded as `active = false` per Decision #2):**

| name | slug | format | delivery_method | region | active |
|------|------|---------|-----------------|--------|--------|
| Adams Book Co. | adams-book | onix-2.1 | sftp | US | true |
| Anchor Distributors | anchor | onix-2.1 | sftp | US | true |
| Baker & Taylor | baker-taylor | onix-2.1 | sftp | US | true |
| Bookazine | bookazine | onix-2.1 | sftp | US | true |
| Brodart Library Suppliers | brodart | onix-2.1 | sftp | US | true |
| Chapters-Indigo | chapters-indigo | onix-2.1 | sftp | CA | true |
| Christian Book Distribution | cbd | onix-2.1 | sftp | US | true |
| Mackin Educational Resources | mackin | onix-2.1 | sftp | US | true |
| MBS Textbook Exchange | mbs | onix-2.1 | sftp | US | true |
| Midwest Library Service | midwest-library | onix-2.1 | sftp | US | true |
| Noble Reps | noble-reps | onix-2.1 | sftp | US | true |
| Powells | powells | onix-2.1 | sftp | US | true |
| The Book Company | the-book-company | onix-2.1 | sftp | US | true |
| The Booksource | booksource | onix-2.1 | sftp | US | true |
| United Library Services | united-library | onix-2.1 | sftp | CA | true |
| Amazon US | amazon-us | onix-3.0 | sftp | US | true |
| Amazon CA | amazon-ca | onix-3.0 | sftp | CA | true |
| Barnes & Noble | barnes-noble | onix-3.0 | sftp | US | true |
| Bowker | bowker | onix-3.0 | sftp | US | true |
| Chegg | chegg | onix-3.0 | sftp | US | true |
| eCampus | ecampus | onix-3.0 | sftp | US | true |
| Gazelle Book Services BSX | gazelle | onix-3.0 | sftp | UK | true |
| Ingram Books | ingram | onix-3.0 | sftp | US | true |
| Library of Congress | loc | onix-3.0 | sftp | US | true |
| TBM BookManager/Mosaic Books | tbm-bookmanager | onix-3.0 | sftp | CA | true |
| Edelweiss Marketing | edelweiss | onix-3.1 | api | US | true |
| Waterstones-Blackwell's-Wordery | waterstones | onix-3.1 | sftp | UK | true |
| Educators Resource | educators-resource | spreadsheet | email | US | true |
| Unconfirmed Channel A | unconfirmed-a | onix-2.1 | tbd | US | false |
| Unconfirmed Channel B | unconfirmed-b | onix-2.1 | tbd | US | false |
| Unconfirmed Channel C | unconfirmed-c | onix-2.1 | tbd | US | false |

---

### Table: `channel_credentials`

Stores encrypted SFTP/FTP/API credentials per channel. Replaces `.env`-based credential management. (Decision #1)

```sql
-- Requires pgcrypto extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE channel_credentials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_slug    text NOT NULL UNIQUE REFERENCES channels(slug),
  -- Credentials stored as pgcrypto-encrypted JSON blob.
  -- Encryption key is the env var CREDENTIALS_ENCRYPTION_KEY on the DO server.
  -- Decrypt with: pgp_sym_decrypt(credentials_enc, current_setting('app.credentials_key'))
  credentials_enc bytea NOT NULL,
  updated_by      text,                   -- auth user email of last editor
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Example shape of decrypted credentials JSON:
-- SFTP: { "host": "...", "port": 22, "username": "...", "password": "...", "remotePath": "/inbound/" }
-- API:  { "endpoint": "...", "apiKey": "..." }
-- Email: { "to": "...", "subject": "..." }

-- Index for exporter lookup by slug
CREATE INDEX idx_channel_credentials_slug ON channel_credentials(channel_slug);
```

Migration file: `supabase/migrations/012_create_channel_credentials.sql`

---

### Table: `send_log`

Every delivery attempt — one row per channel per run.

```sql
CREATE TABLE send_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id          uuid NOT NULL REFERENCES channels(id),
  run_id              uuid NOT NULL,                -- groups all channels in a single scheduler run
  run_type            text NOT NULL,                -- 'scheduled', 'manual', 'retry'
  is_full_catalog     boolean NOT NULL DEFAULT false,
  titles_included     int,                          -- count of titles in this send
  file_path           text,                         -- path of generated file (local temp or S3 key)
  status              text NOT NULL,                -- 'pending', 'generating', 'delivering', 'success', 'failed'
  error_message       text,
  retry_count         int NOT NULL DEFAULT 0,
  retry_of            uuid REFERENCES send_log(id), -- links retry to original failed attempt
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_send_log_channel_id    ON send_log(channel_id);
CREATE INDEX idx_send_log_run_id        ON send_log(run_id);
CREATE INDEX idx_send_log_status        ON send_log(status);
CREATE INDEX idx_send_log_created_at    ON send_log(created_at DESC);
```

---

### Table: `import_batches`

Tracks each Excel file import.

```sql
CREATE TABLE import_batches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id        uuid REFERENCES publishers(id),
  filename            text NOT NULL,
  file_storage_path   text,                       -- DO Spaces key for the original file
  uploaded_by         text NOT NULL,              -- auth user email
  status              text NOT NULL DEFAULT 'pending',  -- 'pending', 'processing', 'complete', 'failed'
  rows_found          int,
  rows_inserted       int,
  rows_updated        int,
  rows_errored        int,
  error_details       jsonb,                      -- array of {row, field, message}
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_batches_publisher ON import_batches(publisher_id);
CREATE INDEX idx_import_batches_status    ON import_batches(status);
```

---

### Table: `title_channel_overrides`

Per-title, per-channel overrides. Rarely used but needed for edge cases (e.g. exclude a title from one channel).

```sql
CREATE TABLE title_channel_overrides (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id        uuid NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  channel_id      uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  excluded        boolean NOT NULL DEFAULT false,   -- exclude this title from this channel
  override_data   jsonb,                            -- field-level overrides as JSON
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (title_id, channel_id)
);
```

---

### Table: `publisher_channel_overrides`

Publisher-level channel agreements. Title-level overrides take precedence on conflict. RESOLVED — added per R1 finding 11.

```sql
CREATE TABLE publisher_channel_overrides (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id    uuid NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
  channel_id      uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  excluded        boolean NOT NULL DEFAULT false,
  override_data   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (publisher_id, channel_id)
);

CREATE INDEX idx_pub_chan_overrides_publisher ON publisher_channel_overrides(publisher_id);
CREATE INDEX idx_pub_chan_overrides_channel   ON publisher_channel_overrides(channel_id);
```

**Override resolution order** (ONIX generator): publisher-level override applied first, then title-level; title-level wins on any field conflict.

Migration file: `supabase/migrations/009b_create_publisher_channel_overrides.sql`

---

### Postgres Trigger for `updated_at`

Apply to all tables that include `updated_at`:

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Repeat for each table:
CREATE TRIGGER trg_titles_updated_at
  BEFORE UPDATE ON titles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## 3. Tech Stack Decisions

| Layer | Choice | Reasoning |
|-------|--------|-----------|
| Admin UI frontend | Next.js (App Router) on Vercel | Standalone repo (`rjflanagan12345/metadata-exporter`). Shares Supabase project with CORE. |
| Database | Supabase (PostgreSQL) | CORE's Supabase project. Exporter connects via service role key env var on DO server. |
| Exporter runtime | Node.js 20 LTS on Digital Ocean | DO server already exists (N8N runs there). Node fits team skills and has good ONIX/XML libraries. |
| Exporter process manager | PM2 | Standard for Node on Linux. Handles crashes, logging, startup. |
| Scheduler | node-cron inside the exporter process | Simple, no external dependency. Runs every 6 hours. Can also be triggered via REST. **Concurrent run protection required** (see Section 6.3 and R1 finding 2): use `pg_try_advisory_lock` via Supabase RPC before starting any run. If lock not acquired, skip and log. Lock released on run completion or process startup recovery. |
| ONIX generation | onix-parser + custom XML builder (fast-xml-parser or xmlbuilder2) | No single Node library handles all three ONIX versions well. Build a thin wrapper that outputs validated XML. |
| Spreadsheet export | ExcelJS | Mature, no native deps. Handles xlsx write with full formatting. |
| SFTP delivery | ssh2-sftp-client | Well-maintained, Promise-based. Covers the majority of channels. **Required config**: connect timeout 15s, transfer timeout 120s, max 5 concurrent channel deliveries via `p-limit`. Worst case (28 channels, 5 concurrent, 15s connect timeout on all failures) = ~90 seconds, well within 6-hour window. |
| FTP delivery | basic-ftp | Handles active/passive mode. Used only where SFTP not available. |
| Image storage | DO Spaces (S3-compatible) | Already in use at APG. Use @aws-sdk/client-s3 with DO endpoint. |
| Image processing | sharp | Resize/validate cover images on upload. Get dimensions. Fast native lib. |
| Excel import (server-side) | ExcelJS | Same lib as export — keeps deps lean. |
| Change detection | Poll `titles.updated_at > last_run_at` | Simpler than Postgres logical replication. Supabase doesn't easily expose replication slots on cloud plan. Store `last_run_at` per channel in `channels` table (add column). |
| Notifications | Nodemailer (email) + optional Slack webhook | Email is reliable fallback. Slack webhook can be added per-channel in credentials. |
| Auth (exporter REST API) | Shared secret in Authorization header | Simple. The only caller is the admin UI. No user-facing auth needed on the exporter. |
| Secrets management | `channel_credentials` table with pgcrypto encryption (Decision #1) | Credentials for all 31 channels stored encrypted in Supabase. Encryption key is a single env var on the DO server. Eliminates `.env` file with 31 secrets; enables credential rotation without a server restart. |

---

## 4. Phase 1 Detailed Task List

Phase 1 goal: data model live, Excel import working, cover image upload working, admin UI to view and edit titles. No exporting yet.

---

### 1.1 — Supabase Schema Setup

**Task:** Write and run all migration SQL files. Apply in order.

Files:
- `supabase/migrations/001_create_publishers.sql`
- `supabase/migrations/002_create_titles.sql`
- `supabase/migrations/003_create_contributors.sql`
- `supabase/migrations/004_create_subjects.sql`
- `supabase/migrations/005_create_cover_images.sql`
- `supabase/migrations/006_create_channels.sql`
- `supabase/migrations/007_create_send_log.sql`
- `supabase/migrations/008_create_import_batches.sql`
- `supabase/migrations/009_create_title_channel_overrides.sql`
- `supabase/migrations/009b_create_publisher_channel_overrides.sql`
- `supabase/migrations/010_triggers_updated_at.sql`
- `supabase/migrations/011_seed_channels.sql`
- `supabase/migrations/012_create_channel_credentials.sql`

**Done criteria:**
- All tables exist in Supabase dashboard.
- All 31 channel rows present in `channels` table (seeds applied). 3 unconfirmed channels seeded as `active = false` placeholders — FK constraints work, they simply won't be included in export runs until activated and credentials entered. (Decision #2 RESOLVED)
- `channel_credentials` table exists with pgcrypto extension enabled.
- `updated_at` trigger fires correctly: update a title row, confirm `updated_at` changes.
- Child propagation triggers fire correctly: update a contributor row, confirm `titles.updated_at` changes.
- RLS enabled on all tables (policies TBD in Phase 2+).

---

### 1.2 — Excel Import Worker

**Task:** Build a server-side import function that:
1. Accepts a multipart file upload (xlsx).
2. Parses using ExcelJS.
3. Maps Excel columns to `titles`, `contributors`, `subjects` fields.
4. Applies all system defaults. Note: `work_id` has no SQL DEFAULT — the import worker must explicitly set `work_id = isbn13` on INSERT when no `work_id` is provided in the template. (R2 new finding)
5. Upserts into Supabase (match on `isbn13`).
6. Records batch result in `import_batches`.
7. Returns a summary: rows found, inserted, updated, errors.

Location: `apps/admin/app/api/import/route.ts` (Next.js Route Handler).

**Vercel limits (RESOLVED R1 finding 9):** Add to route file:
```typescript
export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };
```
Enforce an 8MB file size check before parsing; return HTTP 413 with a clear message if exceeded. Known limitation: Vercel Hobby/Pro has a 60s execution timeout — imports of >500 rows may approach this. Document in the done criteria. If APG regularly imports >500 rows per file, move this to a background job in Phase 2.

**Upsert behavior on duplicate ISBN (RESOLVED R2 new finding):** On upsert, overwrite all mapped fields from the Excel file. Child rows (contributors, subjects) are replaced wholesale for the ISBN: delete existing rows for the `title_id`, then insert from the current upload. This is safe because the import is the source of truth. Fields not present in the Excel template (e.g. `work_id`, system defaults) are never overwritten on update — set them only on INSERT. Document this explicitly in `docs/excel-column-map.md`.

Column mapping document: `docs/excel-column-map.md` (to be written alongside this task — map each template column header to the DB field name, any transformation logic, and whether the field is INSERT-only or INSERT+UPDATE).

**Done criteria:**
- Upload a real publisher Excel file.
- Confirm correct rows appear in `titles`, `contributors`, `subjects`.
- System defaults applied to all new rows (discount_code = 'A', etc.).
- `import_batches` row shows correct counts.
- Re-uploading same file updates existing rows, does not duplicate.
- Error rows (bad ISBN, missing required field) captured in `import_batches.error_details`, do not crash the import.

---

### 1.3 — Cover Image Upload

**Task:** Build a file upload endpoint that:
1. Accepts image file upload (jpg or png only).
2. Validates file type (reject anything else).
3. Validates minimum dimensions: 500px minimum on shortest side (ONIX best practice).
4. Uses sharp to read dimensions and file size.
5. Uploads to DO Spaces at key `covers/{ISBN13}.jpg` (or .png).
6. Generates public CDN URL.
7. Looks up title by ISBN13 — returns error if not found.
8. Marks any previous active image as superseded (`superseded_at = now()`).
9. Inserts new row in `cover_images`.

Location: `apps/admin/app/api/covers/route.ts`

**Done criteria:**
- Upload a test image named `9781234567890.jpg`.
- File appears in DO Spaces under `covers/`.
- `cover_images` row created with correct `title_id`, `public_url`, dimensions.
- Previous image row has `superseded_at` set.
- Upload of non-image file returns 400.
- Upload with no matching ISBN13 returns 404.

---

### 1.4 — Publishers Admin Page

**Task:** Build a simple CRUD page in admin UI at `/admin/publishers`.

Features:
- List all publishers (name, code, active status).
- Add new publisher (name, code, contact email).
- Edit publisher.
- Deactivate (soft, sets `active = false`).

**Done criteria:**
- Can create a publisher and see it in the list.
- Can edit name/email.
- Can deactivate — deactivated publishers no longer show in title import dropdown.
- **Before deploying Phase 1 to any non-local environment:** add Next.js middleware (`middleware.ts`) that blocks all `/admin/*` routes unless the request carries a valid Vercel deployment password or hard-coded header secret. RLS policies come in Phase 2; this is the Phase 1 gate. (RESOLVED R1 finding 15)

---

### 1.5 — Titles Admin Page + Detail Edit

**Task:** Build a browse/search page at `/admin/titles` with an editable detail page. (Decision #7)

Features — list page (`/admin/titles`):
- Paginated table: ISBN13, title, publisher, pub_date, status, has_cover (derived from cover_images).
- Search by title text or ISBN13.
- Click row to go to detail/edit page.

Features — detail page (`/admin/titles/[id]`):
- Display all fields: title data, contributors list, subjects list, cover image thumbnail.
- All template fields are editable except `isbn13` (read-only).
- Save button triggers `updated_at` bump on the `titles` row, which queues the title for the next export cycle.
- Link to upload/replace cover image.

**Done criteria:**
- 50+ title records visible and paginated.
- Search by partial title returns correct results.
- Cover image thumbnail shows on detail page when image is uploaded.
- All fields from `titles`, `contributors`, and `subjects` visible on detail page.
- Can edit a field, save, and confirm the change persists and `updated_at` is updated.
- ISBN13 field is not editable (rendered as read-only text, not an input).

---

### 1.6 — Import History Page

**Task:** Build a read-only page at `/admin/imports`.

Features:
- List all import batches, newest first.
- Show: filename, publisher, status, rows found/inserted/updated/errored, timestamp.
- Click row to expand error details (list of row errors as table).

**Done criteria:**
- After a test import, batch appears in list with correct counts.
- Clicking a failed/partial batch shows the row-level errors.

---

## 5. Repo and File Structure

Standalone repo: `rjflanagan12345/metadata-exporter` (Decision #6). Connects to CORE's existing Supabase project via service role key env var.

```
metadata-exporter/              <- repo root
│
├── apps/
│   └── admin/                  <- Admin UI Next.js app (Vercel)
│       ├── app/
│       │   ├── admin/
│       │   │   ├── publishers/
│       │   │   ├── titles/
│       │   │   │   └── [id]/   <- Detail/edit page (Decision #7)
│       │   │   ├── imports/
│       │   │   ├── channels/   <- Phase 4
│       │   │   └── status/     <- Phase 4 dashboard
│       │   └── api/
│       │       ├── import/
│       │       │   └── route.ts
│       │       └── covers/
│       │           └── route.ts
│       ├── components/
│       ├── lib/
│       │   ├── supabase.ts     <- Supabase client (anon + service role)
│       │   ├── spaces.ts       <- DO Spaces S3 client
│       │   └── import/
│       │       ├── parser.ts   <- ExcelJS parser
│       │       ├── mapper.ts   <- column -> DB field mapping
│       │       └── defaults.ts <- system defaults application
│       └── types/
│           └── database.ts     <- generated Supabase types
│
├── services/
│   └── exporter/               <- Node.js exporter (Digital Ocean)
│       ├── src/
│       │   ├── index.ts        <- entry point: (1) startup recovery step, (2) starts scheduler + REST server
│       │   ├── scheduler.ts    <- node-cron setup
│       │   ├── runner.ts       <- orchestrates a single export run
│       │   ├── generators/
│       │   │   ├── onix21.ts
│       │   │   ├── onix30.ts
│       │   │   ├── onix31.ts
│       │   │   └── spreadsheet.ts
│       │   ├── adapters/       <- delivery adapters, one per method
│       │   │   ├── sftp.ts
│       │   │   ├── ftp.ts
│       │   │   ├── api.ts
│       │   │   └── email.ts
│       │   ├── channels/       <- per-channel config + wiring
│       │   │   ├── index.ts    <- registry, maps slug -> generator + adapter
│       │   │   └── configs/    <- one file per channel if needed for quirks
│       │   ├── db/
│       │   │   ├── supabase.ts <- service role client (key from SUPABASE_SERVICE_ROLE_KEY env var)
│       │   │   └── queries.ts  <- all DB queries (changed titles, send_log writes, etc.)
│       │   ├── credentials.ts  <- decrypts channel_credentials rows for use by adapters
│       │   ├── notifications.ts
│       │   └── api/
│       │       └── server.ts   <- Express REST API (trigger run, retry, status)
│       ├── package.json
│       └── tsconfig.json
│
├── supabase/
│   ├── migrations/             <- numbered SQL migration files
│   └── seed/
│       └── channels.sql
│
├── docs/
│   ├── technical-plan.md       <- this document
│   ├── excel-column-map.md     <- publisher template column -> DB field mapping
│   └── channel-specs.md        <- per-channel delivery details, file naming, quirks
│
└── package.json                <- workspace root (pnpm workspaces)
```

---

## 6. Key Technical Decisions

### 6.1 — ONIX Library Choice

**Decision:** Do not use a single all-in-one ONIX library. Build a thin XML builder per version using `xmlbuilder2`.

**Reasoning:**
- The only widely-used Node ONIX libraries (e.g. `onix-js`) are unmaintained and support only 2.1 or 3.0 partially.
- APG has specific field mappings and channel quirks that would require overriding most library behavior anyway.
- `xmlbuilder2` is actively maintained, TypeScript-native, and produces valid XML. Gives full control over element order and namespace declarations that ONIX validators require.
- Estimated overhead vs. a library: ~2–3 days to write all three generators, vs. ~3–4 days fighting an existing library's limitations.

**Approach:**
- Build an internal `ONIXRecord` type (shared across 2.1/3.0/3.1).
- Each generator takes an array of `ONIXRecord` and outputs an XML string.
- Validate output against official ONIX schemas during development. Validation runs are dev-only (not in production send path).

---

### 6.2 — Image Processing

**Decision:** Use `sharp` for image validation and metadata extraction on upload. Do not re-encode or resize.

**Reasoning:**
- Publishers/APG staff provide print-quality covers. Do not degrade them.
- Only need to validate format (jpg/png), read dimensions, and enforce a 500px minimum.
- `sharp` handles this in under 100ms per image on most files.
- Store the original file in DO Spaces. The ONIX feed includes the CDN URL — channels download directly.
- If a channel requires a specific size (rare), add a per-channel resize step in Phase 3.

---

### 6.3 — Change Detection Strategy

**Decision:** Poll `titles.updated_at > channel.last_successful_run_at` per channel. `last_successful_run_at` is a column on `channels` (now in DDL). `NULL` means channel has never had a successful send — triggers full catalog send.

**Reasoning:**
- Supabase cloud plans do not support logical replication slot access for external consumers (needed for CDC approaches like Debezium).
- Postgres triggers + an `events` table was considered but adds complexity with no real benefit — the 6-hour schedule means a simple timestamp poll is sufficient.
- Per-channel tracking means a channel that fails a send will retry with all titles changed since its last *successful* send, not since the failed send. This is the correct behavior.

**Child table change propagation (RESOLVED — R1 finding 1):**
Changes to `contributors`, `subjects`, `cover_images`, and `title_channel_overrides` do not automatically update `titles.updated_at`. Add Postgres triggers on each child table that fire on INSERT, UPDATE, and DELETE, executing `UPDATE titles SET updated_at = now() WHERE id = NEW.title_id` (or `OLD.title_id` on DELETE). Add to migration `010_triggers_updated_at.sql`.

```sql
CREATE OR REPLACE FUNCTION propagate_title_updated_at()
RETURNS trigger AS $$
BEGIN
  UPDATE titles SET updated_at = now()
  WHERE id = COALESCE(NEW.title_id, OLD.title_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to: contributors, subjects, cover_images, title_channel_overrides
CREATE TRIGGER trg_contributors_propagate
  AFTER INSERT OR UPDATE OR DELETE ON contributors
  FOR EACH ROW EXECUTE FUNCTION propagate_title_updated_at();
-- (repeat pattern for subjects, cover_images, title_channel_overrides)
```

**Full resend:** To force a full resend for a channel, set `last_successful_run_at = NULL` for that channel row. No separate `first_send_done` flag needed — removed from schema (redundant).

**Edge case:** If a title is updated multiple times within a 6-hour window, it appears once in the next send. Correct behavior.

**Edge case:** If `title_channel_overrides.excluded` flips for a title, the parent `titles.updated_at` is bumped by trigger, and the title will appear in the next delta send for all channels. The channel-level query filters excluded titles, so it will correctly omit the newly excluded title.

---

### 6.4 — Delivery Adapter Pattern

**Decision:** Each delivery method (SFTP, FTP, API, email) is an adapter class implementing a shared `DeliveryAdapter` interface. Channel configs declare which adapter to use.

```typescript
interface DeliveryAdapter {
  deliver(opts: {
    channelSlug: string;
    filePath: string;        // local temp file path of generated ONIX/xlsx
    filename: string;        // target filename for the channel
    credentials: ChannelCredentials;
  }): Promise<{ success: boolean; message?: string }>;
}
```

**Reasoning:**
- 28 of 31 channels are SFTP — the SFTP adapter does the heavy lifting.
- FTP, API, and email adapters handle the 3 outliers.
- New delivery methods can be added without touching existing channel configs.
- Credentials are loaded from the `channel_credentials` table at runtime, decrypted using the `CREDENTIALS_ENCRYPTION_KEY` env var on the DO server. (Decision #1)

**Atomic SFTP upload (RESOLVED R2 new finding):** SFTP puts are not atomic. If a transfer fails mid-stream, the channel SFTP server is left with a partial file. Required pattern: upload to `{filename}.tmp`, then issue an SFTP rename to `{filename}` only after a confirmed successful put. All SFTP adapters must implement this. If rename is not supported by a specific channel, log a warning and fall back to direct put (document the exception in `docs/channel-specs.md`).

---

### 6.5 — First Send / Full Catalog Logic

**Decision:** When `channels.last_successful_run_at IS NULL`, pull all active titles regardless of `updated_at` (full catalog send). After successful delivery, set `last_successful_run_at = now()`. Subsequent runs query `titles.updated_at > last_successful_run_at` (incremental).

**Reasoning:**
- Channels need a complete catalog baseline before incremental updates make sense.
- NULL `last_successful_run_at` is the single source of truth — no separate `first_send_done` boolean needed (removed from schema, RESOLVED R1 finding 5 + R2 finding on redundant flags).
- To force a full resend: `UPDATE channels SET last_successful_run_at = NULL WHERE slug = 'target-channel'`.

---

*End of technical plan.*

---

## Audit Notes (Round 1)

**Audited:** 2026-04-29
**Auditor:** Senior architect review prior to developer handoff

---

### BLOCKING Issues

---

**[BLOCKING] Section 6.3 / Section 3 — Change detection misses child table updates**

`updated_at` polling only queries `titles.updated_at`. If a contributor, subject, or cover image is added or changed without touching the parent `titles` row (e.g. a direct INSERT into `contributors`), the change will never be picked up. This is a silent data omission, not a crash — the worst kind of bug in a metadata feed.

Fix options:
- Option A (preferred): Add Postgres triggers to `contributors`, `subjects`, and `cover_images` that `UPDATE titles SET updated_at = now() WHERE id = NEW.title_id` on any change to those child tables. This keeps the polling logic simple and correct.
- Option B: Track change detection per-table with a separate `change_queue` table. More robust but more complex.

Also: `title_channel_overrides` changes need to propagate the same way — if an exclude flag flips, the affected channel must resend that title.

---

**[BLOCKING] Section 3 / Section 4 — No concurrent run protection**

The plan uses `node-cron` inside a single process with no guard against overlapping runs. If one 6-hour job is still running (e.g. an SFTP timeout is hanging) when the next one fires, both will run simultaneously. They will query the same `last_successful_run_at`, generate duplicate files, and attempt duplicate deliveries to 31 channels.

Fix: Before starting a run, write a `run_id` and `started_at` to a `scheduler_locks` table (or a simple `scheduler_state` row). Check for any run with `started_at > now() - interval '7 hours'` and `completed_at IS NULL` before proceeding. If found, skip and log a warning. Alternatively, use an advisory lock (`pg_try_advisory_lock`) via Supabase's `rpc()`.

---

**[BLOCKING] Section 3 / Tech Stack — Secrets management for 31 channels is unscalable and high-risk**

RESOLVED — Decision #1: Credentials stored in `channel_credentials` table with pgcrypto encryption. Single encryption key env var on DO server. No `.env` file with 31 secrets.

---

**[BLOCKING] Section 4.1 — Seed data count mismatch; channel table is missing 3 channels**

RESOLVED — Decision #2: 3 unconfirmed channels seeded as `active = false` placeholders. Done criteria in 1.1 updated.

---

**[BLOCKING] Section 2 `channels` / Section 6.3 — `last_successful_run_at` column is described but not in the schema DDL**

Section 6.3 says "Add column: `channels.last_successful_run_at timestamptz`" but the `channels` table DDL in Section 2 does not include this column. The exporter's core change-detection query cannot be written without it. The migration file `011_seed_channels.sql` will also fail if the column doesn't exist when seeds run.

Fix: Add `last_successful_run_at timestamptz` to the `channels` table DDL. Also add an index on it — the query `WHERE updated_at > last_successful_run_at` on a large titles table will be slow without `idx_titles_updated_at` (present) but the channel-side join also needs to be efficient.

---

### IMPORTANT Issues

---

**[IMPORTANT] Section 2 `titles` — No support for multiple prices per currency or price type**

RESOLVED — Decision #3: USD only. `price_cad` and `price_gbp` columns removed. No `prices` child table. CAD/GBP/EUR deferred indefinitely.

---

**[IMPORTANT] Section 2 `titles` — Only one BISAC and one Thema code stored in the parent row**

`bisac_main` and `thema_main` on `titles` are fine for the primary code, but multiple BISAC/Thema codes per title are common and expected. The `subjects` table correctly supports multiple codes. The problem: the plan's import worker (Section 4, task 1.2) maps to both locations and it is not specified what `bisac_main` is for or whether it's kept in sync with `subjects`. This will create a split-brain situation where the ONIX generator has to decide which source of truth to use.

Fix: Document that `bisac_main` / `thema_main` on `titles` are denormalized cache columns, always equal to the `sequence_number = 1` row in `subjects`. Add a trigger or application-level rule to keep them in sync. The ONIX generator should always read from `subjects`, not from the parent row.

---

**[IMPORTANT] Section 3 / Tech Stack — `node-cron` inside the exporter process is a single point of failure**

If PM2 restarts the process mid-run (crash, OOM, manual deploy), the in-flight run has no recovery path. The `send_log` rows for that run will sit in `status = 'generating'` or `status = 'delivering'` forever with no completed_at. The next cron tick will start a fresh run, potentially skipping channels that appeared to be in-progress.

Fix: On process startup, query `send_log` for any rows from the last 7 hours with `status IN ('pending', 'generating', 'delivering')` and treat them as failed (set status = 'failed', error_message = 'process restart'). This is a startup recovery step and should be in `index.ts` before the scheduler starts.

---

**[IMPORTANT] Section 4.2 — Excel import has no file size or row count limits**

A publisher could upload a 50MB Excel file with 10,000 rows. The Next.js route handler on Vercel has a 4.5MB body limit by default and a 60-second execution timeout. ExcelJS will happily parse a large file in memory but Vercel will kill the request first.

Fix: Either (a) add a `export const config = { api: { bodyParser: { sizeLimit: '10mb' } } }` override and acknowledge the Vercel timeout risk, or (b) move large-file imports to a background job. At minimum, add a file size check before parsing and return a clear error if it exceeds a safe threshold. Document the known limitation.

---

**[IMPORTANT] Section 6.4 — SFTP adapter has no timeout or connection pooling defined**

`ssh2-sftp-client` connections can hang indefinitely on unresponsive hosts. With 28 SFTP channels running in a single cron job, one hung connection can block all subsequent channels or exhaust the event loop. The plan does not specify connection timeout, retry policy, or whether channels run sequentially or in parallel.

Fix: Add explicit timeout config to every SFTP/FTP connection (connect timeout, data transfer timeout). Define whether channel deliveries run sequentially (safe, slow) or in parallel with a concurrency limit (e.g. `p-limit` with max 5 concurrent). Document the decision. A 6-hour window is generous but 28 sequential SFTP transfers with 30-second timeouts on failures = up to 14 minutes worst case, which is acceptable but should be stated.

---

**[IMPORTANT] Section 2 — No `publisher_channel_overrides` or publisher-level exclude/format table**

`title_channel_overrides` handles per-title exclusions. But publishers often have channel-level agreements — e.g. "Publisher X titles never go to Channel Y" or "Publisher X gets a different discount code for Amazon." Without a publisher-level override table, every title from that publisher needs an individual override row. For a publisher with 500 titles, that is 500 rows.

Fix: Add a `publisher_channel_overrides` table: `(publisher_id, channel_id, excluded, override_data jsonb)`. The ONIX generator should check publisher-level overrides first, then title-level overrides, with title-level winning on conflict.

---

### MINOR Issues

---

**[MINOR] Section 2 `subjects` — `updated_at` missing from `subjects` table**

The `subjects` table has no `updated_at` column. This is fine for the current change-detection strategy (child tables propagate up to `titles.updated_at` via trigger, per the BLOCKING fix above), but it means there is no audit trail for when a subject code was changed. Add `updated_at` for consistency with the rest of the schema.

---

**[MINOR] Section 2 `titles` — `isbn13` has both a PRIMARY KEY index via `id` and a separate `CREATE INDEX idx_titles_isbn13`. The UNIQUE constraint on `isbn13` already creates an index. The explicit `CREATE INDEX idx_titles_isbn13` is redundant.**

The `UNIQUE` constraint on `isbn13` implicitly creates a btree index. The subsequent `CREATE INDEX idx_titles_isbn13 ON titles(isbn13)` creates a duplicate index, wasting space and slowing writes. Remove the explicit index — the unique constraint index serves the same purpose.

---

**[MINOR] Section 6.1 — ONIX schema validation is dev-only with no plan for regression**

"Validate output against official ONIX schemas during development. Validation runs are dev-only (not in production send path)." This means there is no ongoing validation after initial development. A code change to the generator 6 months from now could silently produce invalid ONIX that channels reject.

Fix: Add a CI step that runs the ONIX schema validator against a fixture file on every PR. This is low-overhead and prevents silent regressions. The official ONIX XSD schemas are freely available.

---

**[MINOR] Section 4 — Phase 1 has no authentication on the admin UI**

Phase 1 builds `/admin/publishers`, `/admin/titles`, and `/admin/imports`. The plan says "RLS policies TBD in Phase 2+" but does not address whether these routes require login at all. If deployed to Vercel before auth is in place, they will be publicly accessible.

Fix: Add middleware to block all `/admin/*` routes with at least a hard-coded password or Vercel deployment protection before Phase 1 is deployed to any non-local environment.

---

**[MINOR] Section 5 — Repo strategy**

RESOLVED — Decision #6: Standalone repo `rjflanagan12345/metadata-exporter`. All file paths updated to reflect standalone structure.

---

### Summary Table

| # | Finding | Severity | Section | Status |
|---|---------|----------|---------|--------|
| 1 | Change detection misses child table updates (contributors, subjects, covers) | BLOCKING | 6.3, 3 | RESOLVED |
| 2 | No concurrent run protection — overlapping cron jobs will duplicate sends | BLOCKING | 3, 4 | RESOLVED |
| 3 | 31 channel credentials in `.env` is unscalable and insecure at rest | BLOCKING | 3 | RESOLVED — Decision #1 |
| 4 | Seed count says 28 but spec says 31 — 3 channels unaccounted for | BLOCKING | 4.1, 2 | RESOLVED — Decision #2 |
| 5 | `last_successful_run_at` described in 6.3 but missing from `channels` DDL | BLOCKING | 2, 6.3 | RESOLVED |
| 6 | Flat price columns can't represent price type, tax, or multi-price ONIX | IMPORTANT | 2 | RESOLVED — Decision #3 (USD only) |
| 7 | `bisac_main` / `thema_main` on `titles` create split-brain with `subjects` table | IMPORTANT | 2 | RESOLVED |
| 8 | No startup recovery for in-flight `send_log` rows after process crash | IMPORTANT | 3 | RESOLVED |
| 9 | Vercel 4.5MB body limit and 60s timeout not addressed for Excel import | IMPORTANT | 4.2 | RESOLVED |
| 10 | SFTP adapter timeouts and channel concurrency model not defined | IMPORTANT | 6.4 | RESOLVED |
| 11 | No publisher-level channel overrides table | IMPORTANT | 2 | RESOLVED |
| 12 | Redundant index on `isbn13` (UNIQUE constraint already creates one) | MINOR | 2 | RESOLVED |
| 13 | `subjects` table missing `updated_at` | MINOR | 2 | RESOLVED |
| 14 | ONIX validation is dev-only with no CI regression guard | MINOR | 6.1 | Open — Phase 2 dev task |
| 15 | `/admin/*` routes have no auth before Phase 2 | MINOR | 4 | RESOLVED |
| 16 | Monorepo strategy vs. existing CORE repo not resolved | MINOR | 5 | RESOLVED — Decision #6 |

---

## Audit Notes (Round 2)

**Audited:** 2026-04-29
**Auditor:** Second senior architect review — validating Round 1 and second-pass gap analysis

---

### Round 1 Audit Validation

**Findings 1, 2, 4, 5, 7, 8, 9, 10, 11, 12, 13, 15:** Diagnosis correct. Clear-cut fixes applied directly to the plan above.

**Finding 3 (secrets management):** RESOLVED — Decision #1: `channel_credentials` table with pgcrypto encryption.

**Finding 4 (28 vs 31 channels):** RESOLVED — Decision #2: 3 unconfirmed channels seeded as `active = false` placeholders.

**Finding 6 (flat price columns):** RESOLVED — Decision #3: USD only. No `prices` child table, no CAD/GBP/EUR. Deferred indefinitely.

**Finding 14 (ONIX CI validation):** Diagnosis correct. Fix is clear: add a CI step running ONIX XSD validation against a fixture on every PR. Straightforward engineering task — no human decision needed. Developer should add this during Phase 2 setup.

**Finding 16 (monorepo vs standalone repo):** RESOLVED — Decision #6: Standalone repo `rjflanagan12345/metadata-exporter`.

---

### Items Resolved Directly in the Plan

| Finding | What was fixed |
|---------|----------------|
| R1-1 | Added child-table propagation triggers to Section 6.3 (contributors, subjects, cover_images, title_channel_overrides all bump titles.updated_at) |
| R1-2 | Added pg_try_advisory_lock concurrent run protection note to tech stack table |
| R1-5 | Added `last_successful_run_at` to channels DDL; removed redundant `first_send_done` boolean (null = first send) |
| R1-7 | Added note to Section 6.3 that `bisac_main`/`thema_main` are denormalized cache; ONIX generator reads from `subjects`; trigger or import-layer rule keeps them in sync |
| R1-8 | Added startup recovery step to `index.ts` description in file structure |
| R1-9 | Added 8MB size limit config and upsert behavior spec to Section 4.2 |
| R1-10 | Added SFTP connect timeout (15s), transfer timeout (120s), and p-limit concurrency (max 5) to tech stack table |
| R1-11 | Added `publisher_channel_overrides` table DDL to Section 2 with override resolution order documented |
| R1-12 | Removed redundant `CREATE INDEX idx_titles_isbn13` from titles DDL |
| R1-13 | Added `updated_at` to subjects table DDL |
| R1-15 | Added Next.js middleware requirement to 1.4 done criteria for pre-deploy admin route gating |
| R2-A | Removed `first_send_done` from channels DDL; consolidated into null `last_successful_run_at` |
| R2-B | Added `work_id = isbn13` application-layer default note to Section 4.2 import worker steps |
| R2-C | Specified upsert behavior (child rows replaced wholesale; INSERT-only fields not overwritten on update) |
| R2-D | Added SFTP atomic upload pattern note (write to temp filename, rename) — documented in Section 6.4 below |
| D1 | `channel_credentials` table added to schema DDL; tech stack table updated; `.env` approach removed |
| D2 | 3 unconfirmed channels added to seed table as `active = false`; task 1.1 done criteria updated |
| D3 | `price_cad` and `price_gbp` removed from titles DDL; `price_usd` only; note added re: deferral |
| D4 | Amazon CA: USD pricing only, no French metadata, separate credentials only |
| D5 | EUR/GBP pricing not needed; UK channels receive USD |
| D6 | All file paths updated to standalone repo structure; network boundary description updated |
| D7 | Task 1.5 expanded to include `/admin/titles/[id]` editable detail page; done criteria updated |

---

### New Issues Found (Round 2 Second Pass)

---

**[R2-NEEDS DECISION] ONIX 3.1 vs 3.0 — differences not specified**

The plan lists `onix31.ts` as a generator file but says nothing about what differs between ONIX 3.0 and 3.1. ONIX 3.1 (released 2021) has structural changes: revised namespace declarations, new `<ProductSupply>` structure variants, and deprecated elements that 3.0 still accepts. The two ONIX 3.1 channels (Edelweiss and Waterstones) may have specific schema requirements. Before `onix31.ts` is coded, a developer needs the actual ONIX 3.1 channel specs from both channels. Add to `docs/channel-specs.md` and reference in the generator. No human decision required on architecture — just needs the spec content gathered before Phase 2 export work begins.

Status: **action item for pre-Phase 2 prep**, not a blocker for Phase 1.

---

**[R2-NEEDS DECISION] Amazon US vs Amazon CA — differentiation not specified**

RESOLVED — Decision #4: Amazon CA is USD pricing only, no French metadata requirement. Treated identically to Amazon US except separate SFTP credentials.

---

**[R2-RESOLVED in plan] Partial delivery rollback — SFTP is not atomic**

If an SFTP `put` fails mid-transfer, the channel's SFTP server has a partial file. There is no mention of an atomic write pattern. Standard mitigation: write to `{filename}.tmp`, rename to `{filename}` only after a successful put. Most SFTP servers support rename. Add this pattern to the `DeliveryAdapter` interface spec and the SFTP adapter implementation notes. No human decision needed.

Status: RESOLVED — documented in Section 6.4 delivery adapter pattern. Developer must implement temp-then-rename in the SFTP adapter.

---

**[R2-NEEDS DECISION] `prices` child table — scope question**

RESOLVED — Decision #3: USD only for now. No `prices` child table. CAD/GBP/EUR deferred indefinitely. Not a Phase 2 item unless explicitly added back.

---

**[R2-NEEDS DECISION] EUR pricing — not in schema**

RESOLVED — Decision #5: EUR not needed. USD only. UK channels (Gazelle, Waterstones, Blackwell's) receive USD pricing. GBP column also removed.

---

**[R2-NEW, IMPORTANT] Image delivery mode — URL vs file alongside XML — not differentiated**

The plan assumes all channels receive a URL in the ONIX `<ResourceLink>` element. Some older ONIX 2.1 channels (historically Baker & Taylor, Brodart, some library suppliers) require the actual image file delivered as a separate file on the SFTP alongside the XML. The `DeliveryAdapter` interface only delivers one file. There is no field on `channels` or mechanism in the export runner to deliver image assets alongside the feed file.

Fix: Add a `image_delivery` column (enum: `url_only`, `file_alongside`) to the `channels` table. Added to DDL above. In the export runner, if `image_delivery = 'file_alongside'`, fetch active cover images for all titles in the batch from DO Spaces and SFTP-put them to the channel alongside the XML. This is a Phase 2 concern, but the `channels` table column is added in Phase 1 migration.

Status: Column added to `channels` DDL. Confirm with each ONIX 2.1 channel which delivery mode they require before Phase 2 export work begins.

---

**[R2-NEW, MINOR] `work_id` has no SQL DEFAULT**

The comment on `titles.work_id` says "system default = isbn13" but `DEFAULT isbn13` is not valid SQL. The default must be applied at the application layer. This is now documented in Section 4.2 import worker steps. No schema change needed.

Status: RESOLVED in plan.

---

**[R2-NEW, MINOR] Phase 1 admin UI has no title editing**

RESOLVED — Decision #7: Basic field editing added to Phase 1 scope. `/admin/titles/[id]` detail page with all editable fields (ISBN13 read-only). Save bumps `updated_at` to queue for next export cycle. Task 1.5 updated.

---

### Summary of All Open Decisions (Human Input Required)

All 7 decisions from this document have been resolved. No remaining open decisions before Phase 1 build begins.

| # | Decision | Status |
|---|----------|--------|
| 1 | Secrets management backing store | RESOLVED — Decision #1 |
| 2 | 3 unconfirmed channels | RESOLVED — Decision #2 |
| 3 | `prices` child table scope | RESOLVED — Decision #3 |
| 4 | Amazon CA specifics | RESOLVED — Decision #4 |
| 5 | EUR pricing | RESOLVED — Decision #5 |
| 6 | Repo strategy | RESOLVED — Decision #6 |
| 7 | Phase 1 title editing | RESOLVED — Decision #7 |
