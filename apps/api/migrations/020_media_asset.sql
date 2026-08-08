-- TRI-918 · Admin image upload → validation → CDN (Cloudflare R2) publish pipeline.
-- The admin console can upload an image; the API validates it (magic-byte sniff, size + type allow-list,
-- best-effort dimension parse), content-addresses it by SHA-256, publishes the bytes to the Cloudflare R2
-- bucket behind cdn.tripkoach.com, and records the canonical public URL here. Blog hero images, tour
-- imagery, etc. reference `media_asset.url` — a real https://cdn.tripkoach.com/... URL — so nothing
-- image-shaped ever lands in the app tree or the DB as bytes (RUNTIME.md CDN invariant, TRI-914).
--
-- MIGRATION NUMBERING: 019 is TRI-917 (blog CMS). This file takes 020. It only creates a new table
-- (+ its own indexes) with a nullable FK to the existing staff_user (006) — no cross-branch dependency —
-- so it applies standalone and stays monotonic on merge.

CREATE TABLE IF NOT EXISTS media_asset (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Content-addressed object key inside the R2 bucket (e.g. media/ab/<sha256>.jpg). Deterministic from
  -- the bytes → re-uploading identical bytes maps to the same key (natural idempotency / dedupe).
  storage_key       text NOT NULL UNIQUE,
  -- Canonical public URL the app references, e.g. https://cdn.tripkoach.com/media/ab/<sha256>.jpg.
  url               text NOT NULL,
  sha256            text NOT NULL,
  content_type      text NOT NULL,
  ext               text NOT NULL,
  byte_size         integer NOT NULL,
  -- Best-effort parsed pixel dimensions (null when the parser can't read them for a valid image).
  width             integer,
  height            integer,
  original_filename text,
  alt_text          text,
  -- Lifecycle: an upload row is created 'validating', flips to 'ready' once bytes are published to R2,
  -- or 'failed' if validation/publish errors (error carries the reason). 'deleted' tombstones a purge.
  status            text NOT NULL DEFAULT 'ready'
                      CHECK (status IN ('validating','ready','failed','deleted')),
  error             text,
  uploaded_by       uuid REFERENCES staff_user(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Admin media library lists newest-first.
CREATE INDEX IF NOT EXISTS media_asset_created_idx ON media_asset (created_at DESC);
-- Fast dedupe lookup: is this content already published?
CREATE INDEX IF NOT EXISTS media_asset_sha_ready_idx ON media_asset (sha256) WHERE status = 'ready';
