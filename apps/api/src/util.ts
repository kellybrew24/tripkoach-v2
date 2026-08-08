// Small pure helpers shared by seed + read endpoints.

/** Whole-currency (e.g. 65 USD) → integer minor units (6500 cents). Never store floats. */
export function toMinor(amount: number): number {
  return Math.round(amount * 100);
}
/** Integer minor units → whole-currency number for API output (6500 → 65). */
export function fromMinor(minor: number | null | undefined): number {
  return minor == null ? 0 : minor / 100;
}

export function slugify(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Authored display category → canonical enum (Phase 0 §2: cultural|adventure|city|luxury).
const CATEGORY_MAP: Record<string, string> = {
  'city tour': 'city',
  'cultural discovery': 'cultural',
  'adventure': 'adventure',
  'luxury': 'luxury',
};
export function categoryEnum(label: string): string {
  return CATEGORY_MAP[label.toLowerCase().trim()] || 'cultural';
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Parse an authored display date like "Sat 15 Aug 2026" or "18 Aug 2026" into a Date (UTC noon),
 *  or null if it doesn't match. Used to give reviews/departures a real created_at/depart_on while the
 *  human label is preserved verbatim for the SPA. */
export function parseDisplayDate(s: string): Date | null {
  if (!s) return null;
  const m = s.match(/(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const mon = MONTHS[m[2].toLowerCase()];
  const year = Number(m[3]);
  if (mon == null) return null;
  return new Date(Date.UTC(year, mon, day, 12, 0, 0));
}

/** Format a created_at timestamp back to the SPA's review-date style, e.g. "18 Aug 2026". */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatReviewDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return '';
  return `${dt.getUTCDate()} ${MONTH_NAMES[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

/** Two-letter initials from an author name (e.g. "Ama Mensah" → "AM", "anon" → "AN"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
