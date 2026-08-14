-- TRI-1095: high-entropy capability token for the guest booking-lookup link.
--
-- The human ref (TK-XXXXXX) is ~30 bits of entropy — display-friendly but
-- enumerable despite the TRI-1063 per-IP rate limit. New bookings additionally
-- mint a >=128-bit random `public_token`; the guest email / receipt / confirm
-- link carries it (?t=<token>) and the UNAUTHENTICATED GET /bookings/:ref
-- (plus payment init/verify) requires a matching token when token_required=true.
-- Authenticated owners still resolve via their session cookie without a token.
--
-- Back-compat: existing rows are backfilled a token but keep token_required=false
-- so their ALREADY-SENT ref-only confirmation links keep resolving (no breakage).
-- Only bookings created after this migration are token-gated.

ALTER TABLE booking ADD COLUMN IF NOT EXISTS public_token   TEXT;
ALTER TABLE booking ADD COLUMN IF NOT EXISTS token_required BOOLEAN NOT NULL DEFAULT false;

-- Backfill a token for every legacy row. gen_random_uuid() is core (PG13+, no
-- pgcrypto needed) and v4-random; two concatenated give 256 bits of hex. Legacy
-- rows keep token_required=false, so token strength here is belt-and-braces only.
UPDATE booking
   SET public_token = replace(gen_random_uuid()::text, '-', '')
                   || replace(gen_random_uuid()::text, '-', '')
 WHERE public_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS booking_public_token_key ON booking (public_token);
