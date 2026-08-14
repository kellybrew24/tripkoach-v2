const NS = window.TripKoachDesignSystem_c9e4af;
const { Button, Icon, TourCard, SearchField, Rating, Badge } = NS;
const IMG = (slug) => "https://cdn.tripkoach.com/img/tours/" + slug + "/hero-480.jpg";

const REGIONS = [
  { name: "Central", count: 3, slug: "coastal-history-trail", note: "Castles & canopy" },
  { name: "Greater Accra", count: 2, slug: "accra-city-tour", note: "City & coast" },
  { name: "Eastern", count: 2, slug: "aburi-akosombo-and-boti-falls", note: "Gardens & falls" },
  { name: "Western", count: 1, slug: "a-christmas-like-no-other", note: "Festivals & surf" },
  { name: "Volta", count: 1, slug: "volta-mountains-and-monkeys", note: "Mountains & monkeys" },
  { name: "Northern", count: 1, slug: "northern-savannah-safari", note: "Mole & mosques" },
  { name: "Upper East", count: 1, slug: "upper-east-bolga-paga-and-sirigu", note: "Crocodiles & crafts" },
  // "Savannah" was a dead card: it duplicated Northern's slug (so it rendered
  // Northern's photo) and no catalogue tour carries that region, so the live
  // count-filter below already dropped it. Removed to kill the duplicate slug;
  // when Savannah tours ship, re-add with a real representative slug.
];

const TESTIMONIALS = [
  { initials: "ML", name: "Marcus & Lia", meta: "First-time visitors · London",
    quote: "We almost did not come — too many what-ifs. TripKoach handled every one. The pickup, the eSIM, the koach who answered our eleven o'clock questions. Worth every cedi." },
  { initials: "KA", name: "Kojo Asante", meta: "Returning · third trip",
    quote: "I have booked direct, gone solo, used the big platforms. TripKoach is the only one that felt like family was meeting me at arrivals." },
  { initials: "AO", name: "Ama Owusu-Afriyie", meta: "Diaspora visit · Toronto",
    quote: "Five days, two regions, no friction. The itinerary read like a friend wrote it — because the koach who built it had actually been there last month." },
];

function Section({ children, style }) {
  return <section className="tk-container" style={{ maxWidth: 1200, paddingBlock: "var(--space-14)", ...style }}>{children}</section>;
}

// Homepage hero carousel (TRI-1132). Cross-fades the same CDN image set the
// LIVE apex hero slider uses (window.TK_HERO_SLIDES). Auto-advances, pauses on
// hover/focus and honours prefers-reduced-motion; fully keyboard operable —
// prev/next buttons + a dot tablist (Left/Right/Home/End). Inactive slides are
// aria-hidden; the active slide carries alt text. All frames hotlink
// cdn.tripkoach.com via TK_HERO_SRCSET (responsive 480/960/1440, TRI-1117).
function HeroSlider() {
  const slides = window.TK_HERO_SLIDES || [];
  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const dotsRef = React.useRef(null);
  const n = slides.length;
  const go = React.useCallback((i) => setIndex(((i % n) + n) % n), [n]);

  // Auto-advance ~6s, unless paused (hover/focus) or the user prefers reduced motion.
  React.useEffect(() => {
    if (n < 2 || paused) return;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = setInterval(() => setIndex((p) => (p + 1) % n), 6000);
    return () => clearInterval(id);
  }, [n, paused]);

  const onDotKey = (e) => {
    let next = null;
    if (e.key === "ArrowRight") next = (index + 1) % n;
    else if (e.key === "ArrowLeft") next = (index - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next === null) return;
    e.preventDefault();
    setIndex(next);
    const btns = dotsRef.current && dotsRef.current.querySelectorAll("[role=tab]");
    if (btns && btns[next]) btns[next].focus();
  };

  if (!n) return null;

  const navBtn = {
    position: "absolute", top: "50%", transform: "translateY(-50%)", zIndex: 3,
    width: 44, height: 44, borderRadius: "50%", border: "1px solid rgba(255,255,255,.35)",
    background: "rgba(20,19,18,.32)", backdropFilter: "blur(6px)", color: "var(--n-0)",
    display: "grid", placeItems: "center", cursor: "pointer",
  };

  return (
    <div
      aria-roledescription="carousel" aria-label="Ghana highlights"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}
      style={{ position: "absolute", inset: 0 }}
    >
      {slides.map((s, i) => (
        <img
          key={s.base}
          src={window.TK_HERO_IMG(s.base, 1440)}
          srcSet={window.TK_HERO_SRCSET(s.base)}
          sizes={window.TK_SIZES.hero}
          alt={i === index ? s.alt : ""}
          aria-hidden={i === index ? undefined : "true"}
          fetchpriority={i === 0 ? "high" : undefined}
          loading={i === 0 ? "eager" : "lazy"}
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover", objectPosition: s.pos, opacity: i === index ? 0.9 : 0,
            transition: "opacity 900ms var(--ease-standard)",
          }}
        />
      ))}

      {n > 1 && (
        <React.Fragment>
          <button type="button" aria-label="Previous slide" onClick={() => go(index - 1)} style={{ ...navBtn, left: "var(--space-5)" }}>
            <Icon name="chevron-left" size={22} />
          </button>
          <button type="button" aria-label="Next slide" onClick={() => go(index + 1)} style={{ ...navBtn, right: "var(--space-5)" }}>
            <Icon name="chevron-right" size={22} />
          </button>
          <div
            ref={dotsRef} role="tablist" aria-label="Choose hero slide" onKeyDown={onDotKey}
            style={{ position: "absolute", zIndex: 3, left: 0, right: 0, bottom: "var(--space-5)", display: "flex", justifyContent: "center", gap: 10 }}
          >
            {slides.map((s, i) => (
              <button
                key={s.base} type="button" role="tab"
                aria-selected={i === index ? "true" : "false"}
                aria-label={"Show slide " + (i + 1) + " of " + n}
                tabIndex={i === index ? 0 : -1}
                onClick={() => setIndex(i)}
                style={{
                  width: i === index ? 30 : 10, height: 10, padding: 0, borderRadius: 999,
                  border: "1px solid rgba(255,255,255,.55)", cursor: "pointer",
                  background: i === index ? "var(--gold-400)" : "rgba(255,255,255,.28)",
                  transition: "width var(--dur-slow) var(--ease-standard), background var(--dur-slow) var(--ease-standard)",
                }}
              />
            ))}
          </div>
        </React.Fragment>
      )}
    </div>
  );
}

function HomeWeb({ go }) {
  const tours = window.TK_DATA.tours;
  // Hero search box (TRI-1146). Previously this field was rendered controlled at
  // a hard-coded value="" with a no-op onChange, so React reset every keystroke
  // and the input silently rejected all typed text. It is now stateful; Enter or
  // the Explore button carries the query to /browse?q=… where BrowseWeb applies
  // it as its live text filter (no separate search backend — browse filters the
  // already-loaded catalogue client-side).
  const [q, setQ] = React.useState("");
  const search = () => go("browse", q.trim() ? { q: q.trim() } : undefined);
  // Rating + review totals derived from the live catalogue — each tour carries
  // its cached rating and review count (tk-boot mapTourSummary). Weight the
  // average by review volume so a 200-review 4.8 outweighs an 18-review 4.9;
  // fall back to plain brand copy when nothing is rated yet (fresh catalogue).
  const rated = tours.filter(t => t.rating != null && Number(t.reviews) > 0);
  const reviewTotal = rated.reduce((n, t) => n + Number(t.reviews), 0);
  const avgRating = reviewTotal
    ? rated.reduce((s, t) => s + Number(t.rating) * Number(t.reviews), 0) / reviewTotal
    : null;
  const ratingStr = avgRating != null ? avgRating.toFixed(1) : null;
  const curated = ["discover-ghana-in-10-days", "accra-city-tour", "a-christmas-like-no-other"]
    .map(id => tours.find(t => t.id === id)).filter(Boolean);
  // Live catalogues won't carry the fixture slugs, so fall back to the first
  // tours (prefer any flagged featured) — keeps the "popular" rail filled from
  // live data. With fixtures all three curated slugs resolve, so this is a no-op
  // and the prototype render is unchanged.
  const featured = tours.filter(t => t.featured);
  const popular = curated.length ? curated : (featured.length ? featured : tours).slice(0, 3);
  // Latest 3 stories for the homepage journal rail (TRI-954). window.TK_BLOG is
  // seeded from fixtures and, in live mode, replaced by GET /api/v1/blog at boot
  // (tk-boot loadBlog) — already newest-first, so the first three are the most
  // recent published posts. BlogCard is published on window by screens-blog.jsx;
  // reading it at render time (not module load) keeps it order-independent.
  const stories = (window.TK_BLOG || []).slice(0, 3);
  const BlogCard = window.BlogCard;

  return (
    <div>
      {/* ── HERO ────────────────────────────────────────── */}
      <section style={{ position: "relative", minHeight: "min(90vh, 760px)", display: "flex", alignItems: "flex-end", overflow: "hidden", background: "var(--n-900)" }}>
        <HeroSlider />
        <div style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", background: "linear-gradient(180deg, rgba(20,19,18,.35) 0%, rgba(20,19,18,.15) 40%, rgba(20,19,18,.82) 100%)" }} />
        <div className="tk-container" style={{ position: "relative", zIndex: 2, maxWidth: 1200, paddingBottom: "var(--space-12)", paddingTop: "var(--space-16)", color: "var(--n-0)" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 0.98, fontSize: "clamp(44px, 6.4vw, 88px)", margin: 0, maxWidth: "16ch", textWrap: "balance" }}>
            Ghana, shown by the people who <em style={{ fontStyle: "normal", color: "var(--gold-400)" }}>live there.</em>
          </h1>
          <p style={{ fontSize: "clamp(17px, 1.5vw, 21px)", lineHeight: 1.5, maxWidth: "52ch", marginTop: "var(--space-5)", color: "rgba(255,255,255,.9)" }}>
            Guided day trips and multi-day journeys with local koaches — from a morning in Accra to a ten-day loop of castles, canopy walks and savanna. Reserve now, pay now or later.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: "var(--space-7)", flexWrap: "wrap", maxWidth: 680 }}>
            <div style={{ flex: "1 1 320px", minWidth: 260 }}>
              <SearchField
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onClear={() => setQ("")}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }}
                placeholder="Search tours, regions, experiences"
              />
            </div>
            <Button size="lg" iconEnd="arrow-right" onClick={search}>Explore tours</Button>
          </div>
          <div style={{ display: "flex", gap: "var(--space-6)", marginTop: "var(--space-7)", flexWrap: "wrap", fontSize: 14 }}>
            {[["star", ratingStr ? ratingStr + " average across " + reviewTotal + " reviews" : "Loved by travelers across Ghana"], ["shield-check", "Verified local guides"], ["wifi", "Free 5GB eSIM on arrival"]].map(([ic, tx]) => (
              <span key={tx} style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "rgba(255,255,255,.92)", fontWeight: 500 }}>
                <Icon name={ic} size={17} style={{ color: "var(--gold-400)" }} />{tx}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── STAT STRIP ──────────────────────────────────── */}
      <section style={{ background: "var(--n-900)", color: "var(--n-0)", borderTop: "1px solid rgba(255,255,255,.08)" }}>
        <div className="tk-container" style={{ maxWidth: 1200, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-6)", paddingBlock: "var(--space-8)" }}>
          {[[String(tours.length), "guided tours"], [String(window.TK_REGION_COUNT()), "regions of Ghana"], [ratingStr ? ratingStr + "★" : "—", "average rating"], ["1", "koach in your pocket"]].map(([n, l]) => (
            <div key={l} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "clamp(30px,3.4vw,46px)", letterSpacing: "-0.03em", color: "var(--gold-400)" }}>{n}</div>
              <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.72)", marginTop: 4, letterSpacing: ".01em" }}>{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── REGIONS ─────────────────────────────────────── */}
      <Section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: "var(--space-8)" }}>
          <div>
            <span className="tk-overline" style={{ color: "var(--gold-700)" }}>Where to go</span>
            <h2 className="tk-h1" style={{ marginTop: 8, maxWidth: "16ch" }}>{window.TK_REGION_COUNT()} regions, more to come.</h2>
          </div>
          <p className="tk-body" style={{ maxWidth: "38ch", color: "var(--text-muted)" }}>
            Pick a region to see who hosts there, what they do, and which trips are running this season.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-4)" }}>
          {REGIONS
            // Count from live data and drop regions with no running tours (e.g.
            // the stale "Savannah" card), so every card deep-links to real results.
            .map(r => ({ ...r, count: window.TK_REGION_TOURS ? window.TK_REGION_TOURS(r.name).length : r.count }))
            .filter(r => r.count > 0)
            .map((r, i) => (
            <a key={r.name} href={"/browse?region=" + encodeURIComponent(r.name)} onClick={(e) => { e.preventDefault(); go("browse", r.name); }} className="tk-region"
              style={{ position: "relative", display: "block", borderRadius: "var(--radius-card)", overflow: "hidden", aspectRatio: i === 0 ? "2 / 1.35" : "1 / 1", gridColumn: i === 0 ? "span 2" : "span 1", gridRow: i === 0 ? "span 1" : "auto", textDecoration: "none", background: "var(--n-800)", boxShadow: "var(--elev-1)" }}>
              <img src={IMG(r.slug)} srcSet={window.TK_SRCSET(r.slug, "hero")} sizes={window.TK_SIZES.card} alt="" loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transition: "transform var(--dur-slow) var(--ease-standard)" }} />
              <span style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(20,19,18,0) 30%, rgba(20,19,18,.78) 100%)" }} />
              <span style={{ position: "absolute", left: 16, right: 16, bottom: 14, color: "var(--n-0)" }}>
                <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: i === 0 ? 26 : 19, letterSpacing: "-0.02em" }}>{r.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, background: "rgba(255,255,255,.18)", padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>{r.count} {r.count === 1 ? "tour" : "tours"}</span>
                </span>
                <span style={{ display: "block", fontSize: 13, color: "rgba(255,255,255,.82)", marginTop: 2 }}>{r.note}</span>
              </span>
            </a>
          ))}
        </div>
      </Section>

      {/* ── POPULAR TOURS ───────────────────────────────── */}
      <div style={{ background: "var(--brand-wash)", borderBlock: "1px solid var(--border-subtle)" }}>
        <Section style={{ paddingBlock: "var(--space-14)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: "var(--space-8)" }}>
            <div>
              <span className="tk-overline" style={{ color: "var(--gold-700)" }}>Handpicked</span>
              <h2 className="tk-h1" style={{ marginTop: 8 }}>Editor's picks.</h2>
            </div>
            <Button variant="secondary" iconEnd="arrow-right" onClick={() => go("browse")}>View all {tours.length} tours</Button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-5)" }}>
            {popular.map(t => <div key={t.id} onClick={() => go("tour", t.id)} style={{ cursor: "pointer" }}><TourCard {...t} reviewCount={t.reviews} /></div>)}
          </div>
        </Section>
      </div>

      {/* ── SERVICES ────────────────────────────────────── */}
      <Section>
        <span className="tk-overline" style={{ color: "var(--gold-700)" }}>More than a tour</span>
        <h2 className="tk-h1" style={{ marginTop: 8, marginBottom: "var(--space-8)", maxWidth: "18ch" }}>Everything sorted before you land.</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-5)" }}>
          {[
            { icon: "wifi", tag: "Free 5GB", title: "eSIM on arrival", body: "Land connected. A Ghana eSIM with 5GB free, activated before you step off the plane — no SIM-swap queues." },
            { icon: "bus", tag: "Fixed price", title: "Airport pickup", body: "A verified driver waiting at KIA arrivals with your name on a board. One price, agreed up front, no haggling at midnight." },
            { icon: "message-circle", tag: "Always on", title: "Your koach in your pocket", body: "A real person who knows the ground answers your questions — before you book and every evening while you travel." },
          ].map(s => (
            <div key={s.title} className="tk-card" style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <span style={{ width: 48, height: 48, borderRadius: "var(--radius-md)", background: "var(--brand-wash)", color: "var(--gold-700)", display: "grid", placeItems: "center" }}>
                <Icon name={s.icon} size={24} />
              </span>
              <span style={{ alignSelf: "flex-start", fontSize: 11.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--gold-700)", background: "var(--gold-50)", padding: "3px 9px", borderRadius: 999 }}>{s.tag}</span>
              <h3 className="tk-h4" style={{ margin: 0 }}>{s.title}</h3>
              <p className="tk-body-sm" style={{ color: "var(--text-muted)", margin: 0 }}>{s.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── MEET KOACH ──────────────────────────────────── */}
      <div style={{ background: "var(--n-900)", color: "var(--n-0)" }}>
        <Section style={{ display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: "var(--space-12)", alignItems: "center" }}>
          <div>
            <span className="tk-overline" style={{ color: "var(--gold-400)" }}>Meet Koach</span>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.02, fontSize: "clamp(32px,3.6vw,52px)", margin: "12px 0 0", maxWidth: "15ch" }}>
              Your travel plan, built in a chat.
            </h2>
            <p style={{ fontSize: 18, lineHeight: 1.55, color: "rgba(255,255,255,.82)", marginTop: "var(--space-4)", maxWidth: "46ch" }}>
              Tell Koach how long you have, what you're into, and your budget. You get a real itinerary you can book in one tap — flights, pickup and connectivity sorted.
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: "var(--space-6)", flexWrap: "wrap" }}>
              <Button size="lg" variant="accent" iconEnd="arrow-right" onClick={() => go("contact")}>Plan a trip</Button>
              <Button size="lg" variant="ghost" style={{ color: "var(--n-0)" }} onClick={() => go("about")}>How it works</Button>
            </div>
          </div>
          <div style={{ background: "var(--n-800)", borderRadius: "var(--radius-xl)", padding: "var(--space-5)", border: "1px solid rgba(255,255,255,.1)", boxShadow: "var(--elev-4)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: "var(--space-4)", borderBottom: "1px solid rgba(255,255,255,.1)", marginBottom: "var(--space-4)" }}>
              <img src="../../assets/logo-badge.png" width="32" height="32" alt="" />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <strong style={{ fontSize: 14 }}>Koach</strong>
                <span style={{ fontSize: 12, color: "var(--gold-400)", display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--gold-400)" }} />Online now</span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ alignSelf: "flex-end", maxWidth: "82%", background: "var(--gold-400)", color: "var(--n-950)", padding: "10px 14px", borderRadius: "16px 16px 4px 16px", fontSize: 14.5, lineHeight: 1.45, fontWeight: 500 }}>
                Crafts and good food, five days in March.
              </div>
              <div style={{ alignSelf: "flex-start", maxWidth: "88%", background: "var(--n-700)", color: "var(--n-0)", padding: "10px 14px", borderRadius: "16px 16px 16px 4px", fontSize: 14.5, lineHeight: 1.45 }}>
                Then start in Bonwire for kente, finish in Accra for night food. I'll draft something — give me a sec.
              </div>
              <div style={{ alignSelf: "flex-start", display: "flex", gap: 5, padding: "10px 14px" }}>
                {[0, 1, 2].map(i => <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "rgba(255,255,255,.5)" }} />)}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "var(--space-4)", background: "var(--n-900)", borderRadius: 999, padding: "8px 8px 8px 16px", border: "1px solid rgba(255,255,255,.12)" }}>
              <span style={{ flex: 1, fontSize: 13.5, color: "rgba(255,255,255,.5)" }}>Message Koach…</span>
              <span style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--gold-400)", color: "var(--n-950)", display: "grid", placeItems: "center" }}><Icon name="arrow-right" size={17} /></span>
            </div>
            <span style={{ display: "block", marginTop: "var(--space-3)", fontSize: 12, color: "rgba(255,255,255,.5)", textAlign: "center" }}>
              Illustrative preview — chat isn't live yet; tap “Plan a trip” to reach a real koach.
            </span>
          </div>
        </Section>
      </div>

      {/* ── TESTIMONIALS ────────────────────────────────── */}
      <Section>
        <span className="tk-overline" style={{ color: "var(--gold-700)" }}>From the field</span>
        <h2 className="tk-h1" style={{ marginTop: 8, marginBottom: 6, maxWidth: "20ch" }}>What travelers tell us when they get home.</h2>
        <p className="tk-caption" style={{ color: "var(--text-muted)", marginTop: 0, marginBottom: "var(--space-8)" }}>Illustrative stories — every tour page carries its own verified traveler reviews.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-5)" }}>
          {TESTIMONIALS.map(t => (
            <figure key={t.name} className="tk-card" style={{ margin: 0, padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              <span style={{ display: "flex", gap: 2, color: "var(--gold-500)" }}>{[0,1,2,3,4].map(i => <Icon key={i} name="star" size={16} style={{ fill: "var(--gold-500)" }} />)}</span>
              <blockquote style={{ margin: 0, fontSize: 16, lineHeight: 1.55, color: "var(--text-body)" }}>“{t.quote}”</blockquote>
              <figcaption style={{ display: "flex", alignItems: "center", gap: 12, marginTop: "auto" }}>
                <span style={{ width: 42, height: 42, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--gold-700)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14 }}>{t.initials}</span>
                <span style={{ display: "flex", flexDirection: "column" }}>
                  <strong style={{ fontSize: 14.5 }}>{t.name}</strong>
                  <span className="tk-caption">{t.meta}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </Section>

      {/* ── LATEST STORIES ──────────────────────────────── */}
      {stories.length && BlogCard ? (
        <div style={{ background: "var(--brand-wash)", borderBlock: "1px solid var(--border-subtle)" }}>
          <Section style={{ paddingBlock: "var(--space-14)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: "var(--space-8)" }}>
              <div>
                <span className="tk-overline" style={{ color: "var(--gold-700)" }}>From the journal</span>
                <h2 className="tk-h1" style={{ marginTop: 8, maxWidth: "18ch" }}>Latest stories from the ground.</h2>
              </div>
              <Button variant="secondary" iconEnd="arrow-right" onClick={() => go("blog")}>All stories</Button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-5)" }}>
              {stories.map(p => <BlogCard key={p.slug} p={p} go={go} />)}
            </div>
          </Section>
        </div>
      ) : null}

      {/* ── CTA ─────────────────────────────────────────── */}
      <Section style={{ paddingTop: 0 }}>
        <div style={{ position: "relative", overflow: "hidden", borderRadius: "var(--radius-2xl)", background: "var(--n-900)", color: "var(--n-0)", padding: "clamp(40px, 6vw, 80px)" }}>
          <img src={IMG("aburi-akosombo-and-boti-falls")} srcSet={window.TK_SRCSET("aburi-akosombo-and-boti-falls", "hero")} sizes={window.TK_SIZES.hero} alt="" loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.28 }} />
          <div style={{ position: "relative", maxWidth: 640 }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.0, fontSize: "clamp(32px,4.4vw,60px)", margin: 0 }}>
              Ready when you are.
            </h2>
            <p style={{ fontSize: 18, lineHeight: 1.55, color: "rgba(255,255,255,.85)", marginTop: "var(--space-4)", maxWidth: "46ch" }}>
              Tell us where you want to go in Ghana and we'll line up a tour, a guide, and the connectivity you need. No pressure, no spam.
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: "var(--space-7)", flexWrap: "wrap" }}>
              <Button size="lg" variant="accent" iconEnd="arrow-right" onClick={() => go("browse")}>Browse tours</Button>
              <Button size="lg" variant="ghost" style={{ color: "var(--n-0)", borderColor: "rgba(255,255,255,.3)" }} onClick={() => go("contact")}>Talk to a koach</Button>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
Object.assign(window, { HomeWeb });
