// TRI-917 · Blog / CMS read + serialisation. Consumer read paths (published-only) live here; the admin
// authoring CRUD lives in admin.ts (it reuses the block/text helpers exported below). Response shapes match
// the v2 web kit's blog fixture (apps/web/kit/blog.js → window.TK_BLOG) so the DS screens render verbatim:
//   list item  → { slug, tag, readTime:number, date:"5 Aug 2026", title, excerpt, hero }
//   detail     → …+ { heroAlt, author, body:[blockā] }
// where a body block is one of { t:'p', x } | { t:'h2', x } | { t:'ul', x:[…] } | { t:'credit', x }.

import type { Db } from './db.ts';
import { formatReviewDate } from './util.ts';

export type BlogBlock =
  | { t: 'p'; x: string }
  | { t: 'h2'; x: string }
  | { t: 'ul'; x: string[] }
  | { t: 'credit'; x: string };

export interface BlogListItem {
  slug: string; tag: string | null; readTime: number | null; date: string;
  title: string; excerpt: string; hero: string | null;
}
export interface BlogPostDTO extends BlogListItem {
  heroAlt: string | null; author: string | null; status?: string; body: BlogBlock[];
}

// ── block ⇄ plain-text serialisation ─────────────────────────────────────────
// The admin editor works in a friendly plain-text form (blank-line-separated paragraphs; `## ` heading,
// `- ` bullet, `> ` photo credit) and round-trips through these two functions. The canonical stored form is
// always the block array (jsonb) the consumer renders; `bodyText` is only a projection for editing.
export function blocksToText(body: unknown): string {
  const blocks = Array.isArray(body) ? (body as BlogBlock[]) : [];
  return blocks
    .map((b) => {
      if (!b || typeof b !== 'object') return '';
      if (b.t === 'h2') return `## ${b.x}`;
      if (b.t === 'ul') return (Array.isArray(b.x) ? b.x : []).map((li) => `- ${li}`).join('\n');
      if (b.t === 'credit') return `> ${b.x}`;
      return String((b as any).x ?? '');
    })
    .filter((s) => s !== '')
    .join('\n\n');
}

export function textToBlocks(text: string): BlogBlock[] {
  const src = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!src) return [];
  const out: BlogBlock[] = [];
  for (const para of src.split(/\n{2,}/)) {
    const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (lines.every((l) => /^[-*]\s+/.test(l))) {
      out.push({ t: 'ul', x: lines.map((l) => l.replace(/^[-*]\s+/, '').trim()) });
    } else if (/^#{2,}\s+/.test(lines[0])) {
      out.push({ t: 'h2', x: lines[0].replace(/^#{2,}\s+/, '').trim() });
    } else if (/^>\s+/.test(lines[0])) {
      out.push({ t: 'credit', x: lines.map((l) => l.replace(/^>\s+/, '')).join(' ').trim() });
    } else {
      out.push({ t: 'p', x: lines.join(' ') });
    }
  }
  return out;
}

// ── row → DTO ─────────────────────────────────────────────────────────────────
function toListItem(r: any): BlogListItem {
  return {
    slug: r.slug,
    tag: r.tag ?? null,
    readTime: r.read_time == null || r.read_time === '' ? null : Number(r.read_time),
    date: formatReviewDate(r.published_at) || '',
    title: r.title,
    excerpt: r.excerpt ?? '',
    hero: r.hero_url ?? null,
  };
}
function toPostDTO(r: any): BlogPostDTO {
  return {
    ...toListItem(r),
    heroAlt: r.hero_alt ?? null,
    author: r.author ?? null,
    body: Array.isArray(r.body) ? r.body : [],
  };
}

// ── consumer reads (published only) ──────────────────────────────────────────
export async function listBlogPosts(db: Db): Promise<{ posts: BlogListItem[]; tags: string[] }> {
  const { rows } = await db.query(
    `SELECT slug, tag, read_time, published_at, title, excerpt, hero_url
       FROM blog_post
      WHERE status = 'published'
      ORDER BY published_at DESC NULLS LAST, created_at DESC`,
  );
  const posts = rows.map(toListItem);
  // Distinct tags in first-seen (most-recent) order, prefixed with "All" — matches window.TK_BLOG_TAGS.
  const seen = new Set<string>();
  const tags: string[] = ['All'];
  for (const p of posts) if (p.tag && !seen.has(p.tag)) { seen.add(p.tag); tags.push(p.tag); }
  return { posts, tags };
}

export async function getBlogPost(db: Db, slug: string): Promise<BlogPostDTO | null> {
  const { rows } = await db.query(
    `SELECT slug, tag, read_time, published_at, title, excerpt, hero_url, hero_alt, author, body
       FROM blog_post WHERE slug = $1 AND status = 'published'`, [slug]);
  return rows[0] ? toPostDTO(rows[0]) : null;
}
