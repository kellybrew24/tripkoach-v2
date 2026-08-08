/* ==========================================================================
 * TRI-917 · Blog seed generator (dev-time, run once when content changes).
 *
 * Produces apps/api/src/blog-seed.json — the committed, box-reproducible source
 * the importer (src/blog-import.ts) upserts into blog_post. We merge two SoTs:
 *   • list metadata (slug, tag, readTime, date, title, excerpt, hero) from the
 *     v2 web kit fixture apps/web/kit/blog.js (window.TK_BLOG) — already what the
 *     site shows, so the imported catalogue is byte-consistent with the prototype;
 *   • the full article BODY, converted to the consumer's block array, from the
 *     production Astro repo's markdown (src/content/posts/*.md) — the real text.
 *
 * The block vocabulary the consumer renders (web/kit/screens-blog.jsx):
 *   { t:'p', x } | { t:'h2', x } | { t:'ul', x:[…] } | { t:'credit', x }
 *
 * Usage:  node scripts/generate-blog-seed.mjs [POSTS_DIR]
 *   POSTS_DIR defaults to the local Astro checkout's src/content/posts.
 * ======================================================================== */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const FIXTURE = join(ROOT, 'apps/web/kit/blog.js');
const OUT = join(ROOT, 'apps/api/src/blog-seed.json');
const POSTS_DIR = process.argv[2] ||
  '/home/iamsk/.paperclip/instances/default/companies/dbc2f65a-7447-4c93-ae20-10ebbd69ab7d/repos/tripkoach/src/content/posts';

// ── load fixture metadata (evaluate the `window.TK_BLOG = [...]` assignment) ──
function loadFixture() {
  const src = readFileSync(FIXTURE, 'utf8');
  const sandbox = { window: {} };
  // eslint-disable-next-line no-new-func
  new Function('window', src)(sandbox.window);
  return { posts: sandbox.window.TK_BLOG || [], tags: sandbox.window.TK_BLOG_TAGS || [] };
}

// ── markdown → plain text (strip inline emphasis / links, keep the words) ────
function inlineText(s) {
  return String(s)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')            // images → drop
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')          // [text](url) → text
    .replace(/`([^`]*)`/g, '$1')                       // `code` → code
    .replace(/\*\*([^*]+)\*\*/g, '$1')                // **bold** → bold
    .replace(/__([^_]+)__/g, '$1')                     // __bold__ → bold
    .replace(/(^|[\s(])\*([^*]+)\*/g, '$1$2')         // *italic* → italic
    .replace(/(^|[\s(])_([^_]+)_/g, '$1$2')            // _italic_ → italic
    .replace(/\s+#\w[\w-]*(?=\s|$)/g, '')             // trailing brand hashtags → drop
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function frontMatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const fm = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const km = line.match(/^([A-Za-z_]+):\s*(.*)$/);
      if (!km) continue;
      let v = km[2].trim();
      if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
      fm[km[1]] = v;
    }
  }
  return { fm, body: m ? raw.slice(m[0].length) : raw };
}

// Convert a markdown article body to the consumer block array.
function toBlocks(md) {
  const blocks = [];
  const paras = md.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const raw of paras) {
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    // Heading (##, ###)
    if (/^#{2,6}\s+/.test(lines[0])) {
      const x = inlineText(lines[0].replace(/^#{2,6}\s+/, ''));
      if (x) blocks.push({ t: 'h2', x });
      continue;
    }
    // Bullet list
    if (lines.every((l) => /^[-*]\s+/.test(l))) {
      const x = lines.map((l) => inlineText(l.replace(/^[-*]\s+/, ''))).filter(Boolean);
      if (x.length) blocks.push({ t: 'ul', x });
      continue;
    }
    // Photo credit (an italic trailing line beginning "Hero photo" / "Photo")
    if (/^[*_]?\s*(hero photo|photo|image credit)/i.test(lines[0])) {
      const x = inlineText(lines.join(' '));
      if (x) blocks.push({ t: 'credit', x });
      continue;
    }
    // Paragraph
    const x = inlineText(lines.join(' '));
    if (x) blocks.push({ t: 'p', x });
  }
  return blocks;
}

// ── build ────────────────────────────────────────────────────────────────────
const { posts: fixture } = loadFixture();
if (!existsSync(POSTS_DIR)) {
  console.error(`[blog-seed] posts dir not found: ${POSTS_DIR}`);
  process.exit(1);
}
const mdBySlug = {};
for (const f of readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'))) {
  const raw = readFileSync(join(POSTS_DIR, f), 'utf8');
  const { fm, body } = frontMatter(raw);
  const slug = fm.slug || f.replace(/\.md$/, '');
  mdBySlug[slug] = { fm, blocks: toBlocks(body) };
}

const seed = [];
let withBody = 0;
for (const p of fixture) {
  const md = mdBySlug[p.slug];
  const blocks = md ? md.blocks : [];
  if (blocks.length) withBody++;
  seed.push({
    slug: p.slug,
    tag: p.tag ?? null,
    readTime: typeof p.readTime === 'number' ? p.readTime : (p.readTime ? Number(p.readTime) : null),
    date: p.date || null,
    title: p.title,
    excerpt: p.excerpt || '',
    hero: p.hero || null,
    heroAlt: (md && (md.fm.heroAlt || md.fm.heroalt)) || null,
    author: (md && md.fm.author) || 'TripKoach',
    body: blocks,
  });
}

writeFileSync(OUT, JSON.stringify(seed, null, 2) + '\n');
console.log(`[blog-seed] wrote ${seed.length} posts (${withBody} with full body) → ${OUT}`);
const missing = fixture.filter((p) => !mdBySlug[p.slug]).map((p) => p.slug);
if (missing.length) console.warn(`[blog-seed] no markdown for: ${missing.join(', ')}`);
