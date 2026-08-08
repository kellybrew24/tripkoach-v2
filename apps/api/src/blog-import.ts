// TRI-917 · Blog import. Upserts the curated story catalogue (apps/api/src/blog-seed.json, generated from
// the site's own list metadata + the production markdown bodies — see scripts/generate-blog-seed.mjs) into
// blog_post. Idempotent by slug: re-running refreshes content in place and never duplicates. Imported posts
// are marked 'published' so the consumer web renders them immediately.
//
// Run:  npm run blog-import        (uses DATABASE_URL / config env like the other CLI tools)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from './config.ts';
import { createDb, type Db } from './db.ts';
import { parseDisplayDate } from './util.ts';

interface SeedPost {
  slug: string; tag: string | null; readTime: number | null; date: string | null;
  title: string; excerpt: string; hero: string | null; heroAlt: string | null;
  author: string | null; body: unknown[];
}

function loadSeed(): SeedPost[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(join(here, 'blog-seed.json'), 'utf8'));
}

export async function importBlog(db: Db, seed: SeedPost[] = loadSeed(), log: (m: string) => void = () => {}): Promise<number> {
  let n = 0;
  for (const p of seed) {
    const publishedAt = p.date ? parseDisplayDate(p.date) : null;
    await db.query(
      `INSERT INTO blog_post (slug, tag, read_time, published_at, title, excerpt, hero_url, hero_alt, author, body, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'published')
       ON CONFLICT (slug) DO UPDATE SET
         tag = EXCLUDED.tag, read_time = EXCLUDED.read_time, published_at = EXCLUDED.published_at,
         title = EXCLUDED.title, excerpt = EXCLUDED.excerpt, hero_url = EXCLUDED.hero_url,
         hero_alt = EXCLUDED.hero_alt, author = EXCLUDED.author, body = EXCLUDED.body,
         status = 'published', updated_at = now()`,
      [
        p.slug, p.tag ?? null, p.readTime == null ? null : String(p.readTime),
        publishedAt ? publishedAt.toISOString() : null, p.title, p.excerpt ?? null,
        p.hero ?? null, p.heroAlt ?? null, p.author ?? null, JSON.stringify(p.body ?? []),
      ]);
    n++;
    log(`upserted ${p.slug}`);
  }
  return n;
}

// CLI entrypoint (skip when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  const db = await createDb(cfg);
  try {
    const n = await importBlog(db, undefined, (m) => console.log(`[blog-import] ${m}`));
    console.log(`[blog-import] done — ${n} post(s) upserted`);
  } finally {
    await db.close();
  }
}
