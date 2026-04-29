-- ============================================================
-- 001_initial_schema.sql
-- All 13 tables, indexes, and triggers for metadata-exporter
-- ============================================================

-- Enable pgcrypto for credential encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- TABLES
-- ============================================================

-- 1. publishers
CREATE TABLE publishers (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. titles (core metadata)
CREATE TABLE titles (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  isbn13                TEXT        NOT NULL UNIQUE,
  isbn10                TEXT,
  gtin                  TEXT,
  upc                   TEXT,
  eisbn10_for_print     TEXT,
  eisbn13_for_print     TEXT,
  -- Title
  title                 TEXT        NOT NULL,
  subtitle              TEXT,
  series_name           TEXT,
  series_number         INTEGER,
  -- Publisher
  publisher_id          UUID        NOT NULL REFERENCES publishers(id),
  imprint               TEXT,
  copyright_year        INTEGER,
  copyright_owner       TEXT,
  copyright_statement   TEXT,
  -- Defaults applied by system (not in publisher template)
  work_id               TEXT        GENERATED ALWAYS AS (isbn13) STORED,
  country_of_publication TEXT       NOT NULL DEFAULT 'US',
  -- Format
  product_format_code   TEXT,
  product_form_detail   TEXT,
  edition_number        INTEGER,
  edition_type_code     TEXT,
  -- Subject
  bisac_code_1          TEXT,
  bisac_code_2          TEXT,
  bisac_code_3          TEXT,
  bisac_code_4          TEXT,
  bisac_code_5          TEXT,
  keywords              TEXT,
  thema_code            TEXT,
  thema_description     TEXT,
  -- Audience
  audience_code         TEXT,
  audience_age_from     INTEGER,
  audience_age_to       INTEGER,
  grade_range           TEXT,
  -- Descriptions
  catalog_description   TEXT,
  short_description     TEXT,
  book_excerpt          TEXT,
  toc                   TEXT,
  promo_quote_1         TEXT,
  promo_quote_2         TEXT,
  promo_quote_3         TEXT,
  -- Dates
  pub_date              DATE,
  on_sale_date          DATE,
  ship_date             DATE,
  -- Physical
  height_inches         NUMERIC(5,2),
  width_inches          NUMERIC(5,2),
  spine_thickness_inches NUMERIC(5,2),
  weight_ounces         NUMERIC(6,2),
  num_pages             INTEGER,
  carton_quantity       INTEGER,
  illustration_type     TEXT,
  illustration_notes    TEXT,
  num_illustrations     INTEGER,
  -- Pricing (USD only)
  price_usd             NUMERIC(8,2),
  -- System defaults
  discount_code         TEXT        NOT NULL DEFAULT 'A',
  notification_type     TEXT        NOT NULL DEFAULT '03',
  returns_code          TEXT        NOT NULL DEFAULT 'Y',
  supplier_role         TEXT        NOT NULL DEFAULT 'Exclusive Distributor to resellers and end-customers',
  barcode_type          TEXT        NOT NULL DEFAULT 'GTIN-13 - On back',
  choking_hazard        TEXT        NOT NULL DEFAULT 'No choking hazard warning necessary',
  -- Availability
  publishing_status     TEXT,
  product_availability  TEXT,
  -- Cover
  cover_image_url       TEXT,
  -- Rights
  sales_rights_type_1   TEXT,
  rights_territory_1    TEXT,
  sales_rights_type_2   TEXT,
  rights_territory_2    TEXT,
  -- Language
  language_code         TEXT        NOT NULL DEFAULT 'eng',
  -- Related
  replaces_isbn         TEXT,
  replaced_by_isbn      TEXT,
  -- Metadata
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ
);

-- 3. contributors
CREATE TABLE contributors (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id        UUID        NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  sequence_number INTEGER     NOT NULL,
  name            TEXT        NOT NULL,
  role_code       TEXT        NOT NULL,
  bio             TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(title_id, sequence_number)
);

-- 4. title_subjects
-- BISAC + THEMA subject codes as a normalized table for future extensibility
CREATE TABLE title_subjects (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id        UUID        NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  scheme          TEXT        NOT NULL,  -- 'BISAC', 'THEMA', 'KEYWORD'
  code            TEXT,
  description     TEXT,
  sequence_number INTEGER     NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. cover_images
CREATE TABLE cover_images (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id         UUID        NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  isbn13           TEXT        NOT NULL,
  storage_path     TEXT        NOT NULL,    -- path in DO Spaces
  cdn_url          TEXT        NOT NULL,    -- public HTTPS URL
  file_format      TEXT        NOT NULL,    -- 'jpg' or 'png'
  width_px         INTEGER,
  height_px        INTEGER,
  file_size_bytes  INTEGER,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by      TEXT
);

-- 6. channels
CREATE TABLE channels (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT        NOT NULL UNIQUE,
  region                 TEXT,
  onix_version           TEXT,              -- '2.1', '3.0', '3.1', 'spreadsheet'
  delivery_method        TEXT,              -- 'sftp', 'ftp', 'api', 'email'
  delivery_host          TEXT,
  delivery_path          TEXT,
  image_delivery         TEXT        NOT NULL DEFAULT 'url',  -- 'url' or 'file'
  active                 BOOLEAN     NOT NULL DEFAULT true,
  first_send_done        BOOLEAN     NOT NULL DEFAULT false,
  last_successful_run_at TIMESTAMPTZ,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. channel_credentials (encrypted with pgcrypto)
CREATE TABLE channel_credentials (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id          UUID        NOT NULL UNIQUE REFERENCES channels(id) ON DELETE CASCADE,
  username_encrypted  BYTEA,
  password_encrypted  BYTEA,
  ssh_key_encrypted   BYTEA,
  api_key_encrypted   BYTEA,
  extra_encrypted     BYTEA,          -- JSON blob for any other fields
  encryption_key_ref  TEXT        NOT NULL DEFAULT 'v1',  -- key version label
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. send_log
CREATE TABLE send_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    UUID        NOT NULL REFERENCES channels(id),
  title_id      UUID        NOT NULL REFERENCES titles(id),
  run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  success       BOOLEAN     NOT NULL,
  onix_version  TEXT,
  error_message TEXT,
  retry_count   INTEGER     NOT NULL DEFAULT 0,
  file_name     TEXT
);

-- 9. import_batches
CREATE TABLE import_batches (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name    TEXT        NOT NULL,
  imported_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_by  TEXT,
  total_rows   INTEGER     NOT NULL DEFAULT 0,
  rows_created INTEGER     NOT NULL DEFAULT 0,
  rows_updated INTEGER     NOT NULL DEFAULT 0,
  rows_failed  INTEGER     NOT NULL DEFAULT 0,
  error_detail JSONB
);

-- 10. title_channel_overrides (per-title exclusions/overrides per channel)
CREATE TABLE title_channel_overrides (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id           UUID        NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  channel_id         UUID        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  excluded           BOOLEAN     NOT NULL DEFAULT false,
  override_price_usd NUMERIC(8,2),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(title_id, channel_id)
);

-- 11. publisher_channel_overrides (publisher-level exclusions per channel)
CREATE TABLE publisher_channel_overrides (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id UUID        NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
  channel_id   UUID        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  excluded     BOOLEAN     NOT NULL DEFAULT false,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(publisher_id, channel_id)
);

-- ============================================================
-- INDEXES
-- ============================================================

-- titles
CREATE INDEX idx_titles_publisher_id ON titles(publisher_id);
CREATE INDEX idx_titles_updated_at   ON titles(updated_at);
CREATE INDEX idx_titles_deleted_at   ON titles(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_titles_pub_date     ON titles(pub_date);

-- contributors
CREATE INDEX idx_contributors_title_id ON contributors(title_id);

-- title_subjects
CREATE INDEX idx_title_subjects_title_id ON title_subjects(title_id);

-- cover_images
CREATE INDEX idx_cover_images_isbn13   ON cover_images(isbn13);
CREATE INDEX idx_cover_images_title_id ON cover_images(title_id);

-- send_log
CREATE INDEX idx_send_log_channel_id ON send_log(channel_id);
CREATE INDEX idx_send_log_title_id   ON send_log(title_id);
CREATE INDEX idx_send_log_run_at     ON send_log(run_at);
CREATE INDEX idx_send_log_success    ON send_log(success);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-update updated_at on direct table changes
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER titles_updated_at
  BEFORE UPDATE ON titles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER publishers_updated_at
  BEFORE UPDATE ON publishers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER channels_updated_at
  BEFORE UPDATE ON channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Child table propagation: bump titles.updated_at when contributors/subjects/cover_images change.
-- This ensures the exporter picks up child record changes in the next run.
CREATE OR REPLACE FUNCTION propagate_title_updated_at()
RETURNS TRIGGER AS $$
DECLARE
  target_title_id UUID;
BEGIN
  target_title_id := COALESCE(NEW.title_id, OLD.title_id);
  UPDATE titles SET updated_at = now() WHERE id = target_title_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contributors_propagate_updated_at
  AFTER INSERT OR UPDATE OR DELETE ON contributors
  FOR EACH ROW EXECUTE FUNCTION propagate_title_updated_at();

CREATE TRIGGER title_subjects_propagate_updated_at
  AFTER INSERT OR UPDATE OR DELETE ON title_subjects
  FOR EACH ROW EXECUTE FUNCTION propagate_title_updated_at();

CREATE TRIGGER cover_images_propagate_updated_at
  AFTER INSERT OR UPDATE OR DELETE ON cover_images
  FOR EACH ROW EXECUTE FUNCTION propagate_title_updated_at();
