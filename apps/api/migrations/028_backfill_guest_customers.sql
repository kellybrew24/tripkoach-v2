-- TRI-1035 · Backfill ops-side `customer` rows for existing GUEST bookings.
--
-- Guest checkout (no account) stores the booker's contact on the lead
-- `booking_traveller` row, but historically never created a `customer` record or set
-- `booking.customer_id`. As a result guest bookers were invisible in Admin → Customers.
-- Going forward the booking write path materialises + links a customer (booking.ts);
-- this migration repairs the pre-existing rows. Idempotent — safe to re-run.

-- 1. One customer per distinct guest lead-email that has no guest customer yet.
INSERT INTO customer (user_id, name, email, phone)
SELECT NULL, l.name, l.email, l.phone
FROM (
  SELECT DISTINCT ON (lower(bt.email)) bt.name, bt.email, bt.phone
  FROM booking b
  JOIN booking_traveller bt ON bt.booking_id = b.id AND bt.is_lead
  WHERE b.user_id IS NULL
    AND b.customer_id IS NULL
    AND bt.email IS NOT NULL AND btrim(bt.email) <> ''
  ORDER BY lower(bt.email), b.created_at DESC
) l
WHERE NOT EXISTS (
  SELECT 1 FROM customer c
  WHERE c.user_id IS NULL AND lower(c.email) = lower(l.email)
);

-- 2. Link those bookings to the matching guest customer (by email).
UPDATE booking b
SET customer_id = c.id
FROM booking_traveller bt, customer c
WHERE bt.booking_id = b.id AND bt.is_lead
  AND b.user_id IS NULL AND b.customer_id IS NULL
  AND bt.email IS NOT NULL AND lower(bt.email) = lower(c.email)
  AND c.user_id IS NULL;

-- 3. Phone-only guest bookings (no email): one customer each, then link.
INSERT INTO customer (user_id, name, email, phone)
SELECT NULL, bt.name, NULL, bt.phone
FROM booking b
JOIN booking_traveller bt ON bt.booking_id = b.id AND bt.is_lead
WHERE b.user_id IS NULL
  AND b.customer_id IS NULL
  AND (bt.email IS NULL OR btrim(bt.email) = '')
  AND bt.phone IS NOT NULL AND btrim(bt.phone) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM customer c
    WHERE c.user_id IS NULL AND c.email IS NULL AND c.phone = bt.phone
  );

UPDATE booking b
SET customer_id = c.id
FROM booking_traveller bt, customer c
WHERE bt.booking_id = b.id AND bt.is_lead
  AND b.user_id IS NULL AND b.customer_id IS NULL
  AND (bt.email IS NULL OR btrim(bt.email) = '')
  AND bt.phone IS NOT NULL AND bt.phone = c.phone
  AND c.user_id IS NULL AND c.email IS NULL;
