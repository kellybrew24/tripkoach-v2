const NS = window.TripKoachDesignSystem_c9e4af;
const { Button, Icon, Badge, Chip } = NS;

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

function BlogPost({ go, slug }) {
  const posts = window.TK_BLOG;
  const p = posts.find(x => x.slug === slug) || posts[0];
  const related = posts.filter(x => x.slug !== p.slug).slice(0, 3);
  const url = "https://tripkoach.com/blog/" + p.slug + "/";
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
          {["twitter", "facebook", "linkedin", "link"].map(ic => (
            <span key={ic} style={{ width: 38, height: 38, borderRadius: "50%", border: "1px solid var(--border-default)", display: "grid", placeItems: "center", color: "var(--text-muted)", cursor: "pointer" }}>
              <Icon name={ic === "twitter" ? "twitter" : ic === "facebook" ? "facebook" : ic === "linkedin" ? "linkedin" : "link"} size={16} />
            </span>
          ))}
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
