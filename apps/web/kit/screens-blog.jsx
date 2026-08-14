const NS = window.TripKoachDesignSystem_c9e4af;
const { Button, Icon, Badge, Chip } = NS;

// WhatsApp brand glyph — the DS icon set has no "whatsapp" mark, so we inline it
// here (DS bundle is vendored verbatim and must not be edited). Filled, 24 viewBox.
function WhatsAppGlyph({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" style={{ display: "block" }}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.334.101 11.892c0 2.096.549 4.14 1.595 5.945L0 24l6.335-1.652a12.062 12.062 0 005.71 1.447h.006c6.585 0 11.946-5.335 11.949-11.893a11.821 11.821 0 00-3.487-8.413z" />
    </svg>
  );
}

// X (formerly Twitter) brand glyph — the DS icon set still ships the legacy
// "twitter" bird, so we inline the current X mark here (DS bundle is vendored
// verbatim and must not be edited). Filled, 24 viewBox.
function XGlyph({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" style={{ display: "block" }}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}

// Data-driven share targets — every current and future post gets these with no
// per-post editing. Deep links open the native app on mobile / web on desktop.
function shareTargets(title, url) {
  const t = encodeURIComponent(title);
  const u = encodeURIComponent(url);
  const tu = encodeURIComponent(title + " — " + url);
  return [
    { key: "whatsapp", label: "Share on WhatsApp", color: "#25D366", glyph: <WhatsAppGlyph size={17} />, href: "https://wa.me/?text=" + tu },
    { key: "x", label: "Share on X", color: "var(--text-strong)", glyph: <XGlyph size={15} />, href: "https://twitter.com/intent/tweet?text=" + t + "&url=" + u },
    { key: "facebook", label: "Share on Facebook", color: "#1877F2", glyph: <Icon name="facebook" size={16} />, href: "https://www.facebook.com/sharer/sharer.php?u=" + u },
    { key: "linkedin", label: "Share on LinkedIn", color: "#0A66C2", glyph: <Icon name="linkedin" size={16} />, href: "https://www.linkedin.com/sharing/share-offsite/?url=" + u },
  ];
}

const BLOG_GRADS = ["linear-gradient(145deg,#c67d2a 0%,#7a481c 100%)", "linear-gradient(145deg,#3f7a63 0%,#244b3f 100%)", "linear-gradient(145deg,#5a7d8f 0%,#2f4b58 100%)", "linear-gradient(145deg,#a8562f 0%,#5e2c18 100%)"];
function hashIdx(s, n) { let h = 0; for (let i = 0; i < (s || "").length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % n; }
function BlogImg({ src, alt, seed, overlay }) {
  const [err, setErr] = React.useState(false);
  const gi = hashIdx(seed || src || "", BLOG_GRADS.length);
  return (
    <>
      {(err || !src) ? <div role="img" aria-label={alt} style={{ position: "absolute", inset: 0, background: BLOG_GRADS[gi] }}><span style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 90% at 22% 18%, rgba(255,255,255,.16), transparent 60%)" }} /></div>
         : <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setErr(true)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
      {overlay ? <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(20,19,18,.88) 0%, rgba(20,19,18,.45) 38%, rgba(20,19,18,.08) 68%)" }} /> : null}
    </>
  );
}

function BlogCard({ p, go, big = false }) {
  return (
    <article onClick={() => go("post", p.slug)} className={"tk-card tk-card--interactive" + (big ? " tk-blogfeature" : "")}
      /* Keyboard-operable card (WCAG 2.1.1): the whole card is the click target,
         so expose it as a link, put it in the tab order, and activate on
         Enter/Space like a native link/button (TRI-1119). */
      role="link" tabIndex={0} aria-label={"Read: " + p.title}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go("post", p.slug); } }}
      style={{ cursor: "pointer", display: "flex", flexDirection: big ? "row" : "column", overflow: "hidden", gridColumn: big ? "1 / -1" : "auto" }}>
      <div className="tk-media" style={{ aspectRatio: big ? "16 / 10" : "3 / 2", flex: big ? "0 0 52%" : "none" }}>
        <BlogImg src={p.hero} alt="" seed={p.slug} />
        <span className="tk-media__tag"><span className="tk-badge tk-badge--solid">{p.tag}</span></span>
      </div>
      <div className="tk-card__body" style={{ gap: "var(--space-2)", justifyContent: big ? "center" : "flex-start", padding: big ? "var(--space-8)" : undefined }}>
        <span className="tk-caption">{p.date} · {p.readTime} min read</span>
        <h3 className={big ? "tk-h2" : "tk-h5"} style={{ margin: 0, textWrap: "balance" }}>{p.title}</h3>
        <p className="tk-body-sm" style={{ color: "var(--text-muted)", margin: 0, display: "-webkit-box", WebkitLineClamp: big ? 4 : 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.excerpt}</p>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--gold-700)", fontWeight: 700, fontSize: 14, marginTop: 4 }}>
          Read <Icon name="arrow-right" size={15} />
        </span>
      </div>
    </article>
  );
}

function BlogIndex({ go }) {
  const posts = window.TK_BLOG;
  const [tag, setTag] = React.useState("All");
  const shown = tag === "All" ? posts : posts.filter(p => p.tag === tag);
  const [featured, ...rest] = shown;
  return (
    <div>
      <section style={{ background: "var(--n-900)", color: "var(--n-0)" }}>
        <div className="tk-container" style={{ maxWidth: 1200, paddingBlock: "var(--space-12)" }}>
          <span className="tk-overline" style={{ color: "var(--gold-400)" }}>Stories · field notes &amp; guides</span>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.0, fontSize: "clamp(38px,5vw,68px)", margin: "12px 0 0", maxWidth: "18ch" }}>
            Ghana, written from the ground.
          </h1>
          <p style={{ fontSize: 18, lineHeight: 1.55, color: "rgba(255,255,255,.82)", marginTop: "var(--space-4)", maxWidth: "56ch" }}>
            Practical guides and field notes from the koaches who lead the trips — how to time a canopy walk, catch a festival, or spend your first 24 hours in Accra.
          </p>
        </div>
      </section>

      <section className="tk-container" style={{ maxWidth: 1200, paddingBlock: "var(--space-10)" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: "var(--space-8)" }}>
          {window.TK_BLOG_TAGS.map(t => <Chip key={t} active={tag === t} onClick={() => setTag(t)}>{t}</Chip>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-5)" }}>
          {featured && <BlogCard p={featured} go={go} big />}
          {rest.map(p => <BlogCard key={p.slug} p={p} go={go} />)}
        </div>
      </section>
    </div>
  );
}

// Dynamic "Keep reading": prefer posts sharing the current tag, then fall back
// to a recent list rotated by the current post's position so each story shows a
// distinct set (and never itself), even with a small catalogue.
function relatedPosts(posts, current, n = 3) {
  const rest = posts.filter(x => x.slug !== current.slug);
  const sameTag = rest.filter(x => x.tag === current.tag);
  const idx = posts.findIndex(x => x.slug === current.slug);
  const rotated = idx >= 0 ? [...rest.slice(idx), ...rest.slice(0, idx)] : rest;
  const seen = new Set();
  const out = [];
  for (const x of [...sameTag, ...rotated]) {
    if (seen.has(x.slug)) continue;
    seen.add(x.slug);
    out.push(x);
    if (out.length >= n) break;
  }
  return out;
}

function BlogPost({ go, slug }) {
  const posts = window.TK_BLOG;
  const p = posts.find(x => x.slug === slug) || posts[0];
  const related = relatedPosts(posts, p, 3);
  const url = "https://tripkoach.com/blog/" + p.slug + "/";
  const share = shareTargets(p.title, url);
  const [copied, setCopied] = React.useState(false);
  const copyLink = () => {
    const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(done);
    else done();
  };
  return (
    <div>
      <header style={{ position: "relative", overflow: "hidden" }}>
        <div style={{ position: "relative", minHeight: 340, aspectRatio: "21 / 9", maxHeight: 520 }}>
          <BlogImg src={p.hero} alt="" seed={p.slug} overlay />
          <div className="tk-container" style={{ position: "absolute", insetInline: 0, bottom: 0, maxWidth: 820, paddingBlock: "var(--space-8)", display: "flex", flexDirection: "column", gap: "var(--space-3)", color: "#fff" }}>
            <button type="button" onClick={() => go("blog")} style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.14)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", border: "1px solid rgba(255,255,255,.35)", borderRadius: "var(--radius-pill)", minHeight: 36, padding: "0 14px", cursor: "pointer", color: "#fff", fontWeight: 600, fontSize: 13.5 }}>
              <Icon name="arrow-left" size={15} /> All stories
            </button>
            <span style={{ alignSelf: "flex-start", background: "var(--gold-500)", color: "#2b1c0b", fontWeight: 800, fontSize: 12.5, borderRadius: "var(--radius-pill)", padding: "5px 12px" }}>{p.tag}</span>
            <h1 className="tk-display" style={{ color: "#fff", margin: 0, maxWidth: "20ch", textShadow: "0 2px 16px rgba(0,0,0,.45)" }}>{p.title}</h1>
            <p style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, fontSize: 13.5, fontWeight: 600, color: "rgba(255,255,255,.9)" }}>
              <img src="../../assets/logo-badge.png" width="24" height="24" alt="" style={{ borderRadius: "50%", background: "#fff" }} />
              TripKoach · {p.date} · {p.readTime} min read
            </p>
          </div>
        </div>
      </header>
      <article className="tk-container" style={{ maxWidth: 720, paddingBlock: "var(--space-10)" }}>
        <p className="tk-body-lg" style={{ marginTop: 0, color: "var(--text-strong)", fontWeight: 500 }}>{p.excerpt}</p>

        {p.body ? (
          <div className="tk-prose" style={{ marginTop: "var(--space-5)" }}>
            {p.body.map((b, i) => {
              if (b.t === "h2") return <h2 key={i} className="tk-h3" style={{ marginTop: "var(--space-8)", marginBottom: "var(--space-2)" }}>{b.x}</h2>;
              if (b.t === "ul") return <ul key={i} style={{ margin: "var(--space-3) 0", paddingInlineStart: 20, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>{b.x.map((li, j) => <li key={j} style={{ fontSize: 17, lineHeight: 1.6 }}>{li}</li>)}</ul>;
              if (b.t === "credit") return <p key={i} className="tk-caption" style={{ marginTop: "var(--space-6)", fontStyle: "italic", color: "var(--text-subtle)" }}>{b.x}</p>;
              return <p key={i} style={{ fontSize: 17, lineHeight: 1.68, margin: "var(--space-4) 0", color: "var(--text-body)" }}>{b.x}</p>;
            })}
          </div>
        ) : (
          <div className="tk-card" style={{ marginTop: "var(--space-6)", background: "var(--brand-wash)", border: "1px solid var(--gold-200)" }}>
            <div className="tk-card__body" style={{ gap: "var(--space-3)", padding: "var(--space-5)" }}>
              <h2 className="tk-h5" style={{ margin: 0 }}>Read the full story</h2>
              <p className="tk-body-sm" style={{ color: "var(--text-muted)", margin: 0 }}>The complete guide lives on the TripKoach journal. Open it to read on, or ask a koach to build this trip for you.</p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Button as="a" href={url} iconEnd="external-link">Continue on tripkoach.com</Button>
                <Button variant="secondary" onClick={() => go("browse")}>Browse tours</Button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: "var(--space-8)", paddingTop: "var(--space-5)", borderTop: "1px solid var(--border-subtle)" }}>
          <span className="tk-caption" style={{ fontWeight: 700 }}>Share</span>
          {share.map(s => (
            <a key={s.key}
              href={s.href}
              target="_blank" rel="noopener noreferrer"
              aria-label={s.label} title={s.label}
              style={{ width: 38, height: 38, borderRadius: "50%", border: "1px solid var(--border-default)", display: "grid", placeItems: "center", color: s.color, cursor: "pointer", textDecoration: "none" }}>
              {s.glyph}
            </a>
          ))}
          <button type="button" onClick={copyLink}
            aria-label={copied ? "Link copied" : "Copy link"} title={copied ? "Link copied" : "Copy link"}
            style={{ width: 38, height: 38, borderRadius: "50%", border: "1px solid var(--border-default)", display: "grid", placeItems: "center", color: copied ? "var(--success-fg)" : "var(--text-muted)", cursor: "pointer", background: "transparent" }}>
            <Icon name={copied ? "check" : "link"} size={16} />
          </button>
        </div>
      </article>

      <div style={{ background: "var(--brand-wash)", borderTop: "1px solid var(--border-subtle)" }}>
        <section className="tk-container" style={{ maxWidth: 1200, paddingBlock: "var(--space-12)" }}>
          <h2 className="tk-h3" style={{ marginBottom: "var(--space-6)" }}>Keep reading.</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-5)" }}>
            {related.map(r => <BlogCard key={r.slug} p={r} go={go} />)}
          </div>
        </section>
      </div>
    </div>
  );
}
Object.assign(window, { BlogIndex, BlogPost, BlogCard });
