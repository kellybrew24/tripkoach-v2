// TRI-1116 · Seed hygiene — remove test/QA reviews that leaked into a live catalogue.
//
// QA/E2E runs (Wave2 audit, the tokenized review redeem+submit flow, guest-booking E2E) submit real
// reviews through the public API. On dev those pile up next to the fixture reviews and render on the
// public tour page ("Review Tester — Wave2 audit review", an empty duplicate "Ama Mensah", …). This is
// a targeted, PROD-SAFE scrubber: it deletes ONLY rows that match curated test markers, is a dry-run by
// default, and prints exactly what it would remove so a human can eyeball it before `--apply`.
//
//   node --experimental-strip-types src/scrub-reviews.ts            # dry-run: list matches, delete nothing
//   node --experimental-strip-types src/scrub-reviews.ts --apply    # delete marker matches + reconcile caches
//   node --experimental-strip-types src/scrub-reviews.ts --apply --drop-empty
//                                                                   # also drop blank title+text reviews
//
// `--drop-empty` is opt-in because a rating-only review can legitimately have no text in prod; on dev a
// blank verified review is the empty QA duplicate. Markers alone never touch content-bearing reviews.

import { loadConfig } from './config.ts';
import { createDb, type Db } from './db.ts';

// Case-insensitive markers matched against author_name / title / text. Deliberately conservative — these
// read as obvious non-customer wording, so a false positive on a real Ghana tour review is very unlikely.
export const TEST_MARKERS: RegExp[] = [
  /\btest(er|ing)?\b/i,
  /\bQA\b/i,
  /\bE2E\b/i,
  /\bend[-\s]to[-\s]end\b/i,
  /\bsmoke\b/i,
  /\bwave\s*\d/i,
  /\baudit\b/i,
  /\bdummy\b/i,
  /\bsample\b/i,
  /\bplaceholder\b/i,
  /\blorem ipsum\b/i,
  /example[-.]spam/i,
];

export interface ReviewRow {
  id: string; author_name: string; title: string | null; text: string; status: string;
  booking_id: string | null;
}
export interface ScrubRow extends ReviewRow { reason: string }

/**
 * Pure classifier: which reviews are leaked test/QA junk, and why. Kept separate so it is unit-testable.
 *
 * Only reviews with a booking_id are eligible: the seed inserts fixture reviews with booking_id NULL, so
 * booking_id NOT NULL means the row was submitted through the live app (a QA/E2E test booking on dev). This
 * is what keeps the scrub PROD-SAFE against the seed — it can never delete a curated fixture (e.g. the
 * intentional spam-moderation demo), only app-submitted rows that ALSO read as test data.
 */
export function classifyReviews(rows: ReviewRow[], opts: { dropEmpty?: boolean } = {}): ScrubRow[] {
  const out: ScrubRow[] = [];
  for (const r of rows) {
    if (r.booking_id == null) continue; // fixture / seed row — never scrub
    const hay = `${r.author_name}\n${r.title ?? ''}\n${r.text}`;
    const marker = TEST_MARKERS.find((re) => re.test(hay));
    if (marker) {
      out.push({ ...r, reason: `marker ${marker.source}` });
      continue;
    }
    if (opts.dropEmpty && !(r.title ?? '').trim() && !r.text.trim()) {
      out.push({ ...r, reason: 'blank title+text (--drop-empty)' });
    }
  }
  return out;
}

/** Reconcile the denormalised rating/review_count caches from the surviving approved reviews. */
async function reconcileCaches(db: Db): Promise<void> {
  await db.query(`
    UPDATE tour t SET
      review_count_cached = COALESCE(c.n, 0),
      rating_cached = c.avg
    FROM tour t2
    LEFT JOIN (
      SELECT tour_id, COUNT(*)::int AS n, ROUND(AVG(rating)::numeric, 1) AS avg
      FROM review WHERE status = 'approved' GROUP BY tour_id
    ) c ON c.tour_id = t2.id
    WHERE t.id = t2.id`);
}

export async function scrubReviews(
  db: Db,
  opts: { apply?: boolean; dropEmpty?: boolean } = {},
  log: (m: string) => void = () => {},
): Promise<{ matched: ScrubRow[]; deleted: number }> {
  const { rows } = await db.query<ReviewRow>(
    `SELECT id, author_name, title, text, status, booking_id FROM review`);
  const matched = classifyReviews(rows, opts);

  if (matched.length === 0) {
    log('no test/QA reviews found — nothing to scrub');
    return { matched, deleted: 0 };
  }

  log(`${matched.length} test/QA review(s) matched:`);
  for (const m of matched) {
    log(`  - ${m.id}  [${m.status}]  ${JSON.stringify(m.author_name)} / ${JSON.stringify(m.title ?? '')}  (${m.reason})`);
  }

  if (!opts.apply) {
    log('dry-run: pass --apply to delete the rows above');
    return { matched, deleted: 0 };
  }

  const ids = matched.map((m) => m.id);
  const res = await db.query('DELETE FROM review WHERE id = ANY($1::uuid[])', [ids]);
  await reconcileCaches(db);
  const deleted = res.rowCount ?? ids.length;
  log(`deleted ${deleted} review(s) and reconciled rating/review_count caches`);
  return { matched, deleted };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const apply = process.argv.includes('--apply');
  const dropEmpty = process.argv.includes('--drop-empty');
  const cfg = loadConfig();
  const db = await createDb(cfg);
  try {
    await scrubReviews(db, { apply, dropEmpty }, (m) => console.log(`[scrub-reviews] ${m}`));
  } finally {
    await db.close();
  }
}
