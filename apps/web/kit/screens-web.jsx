const NS = window.TripKoachDesignSystem_c9e4af;
const { Header, Footer, Breadcrumbs, TourCard, SearchField, Chip, Button, Icon, Select, Pagination, CurrencyToggle,
  Rating, Badge, AvailabilityBadge, DeparturePicker, Accordion, Alert, Price, OrderSummary, PromoCode, CheckoutStepper,
  FormField, Input, Textarea, NumberStepper, PaymentForm, Checkbox, BookingRow, StatusBadge, Tabs, EmptyState, Skeleton, IconButton, Modal, Toast } = NS;

/* Amounts in TK_DATA are the currency of record (USD). The header toggle converts
   for display only. The USD→GHS DISPLAY rate is settings-driven (TRI-939): tk-boot
   fetches /config and sets window.TK_FX.GHS from settings.usd_to_ghs_display_rate,
   so ops change it via admin settings without a rebuild. We reference the shared
   window.TK_FX object (not a private literal) so that live override is visible here;
   the 12 fallback matches the current board-set rate for the fixtures/flag-off path. */
const TK_FX = (window.TK_FX = window.TK_FX || { USD: 1, GHS: 12 });
const TK_SYM = { USD: "$", GHS: "GH₵" };
// null is meaningful for tier-priced departures (price varies by party size) — preserve it
// so the DeparturePicker can hide the per-departure price rather than showing "$0". (TRI-932)
function cvt(usd, cur) { return usd == null ? null : (cur === "GHS" ? Math.round(usd * TK_FX.GHS) : usd); }
function money(usd, cur) { return TK_SYM[cur] + cvt(usd, cur).toLocaleString(); }
function cvtDeps(deps, cur) { return (deps || []).map(d => ({ ...d, price: cvt(d.price, cur) })); }

// Group departures under their track (route) with a track selector (TRI-992). A
// tour whose departures carry a packageSlug renders a segmented Route 1 / Route 2 /
// Route 3 selector; only the active track's departures are shown, so the picker is
// never cluttered with every track at once. Departures with no track fall under a
// "Standard" bucket. A tour with a single group (no tracks, or every departure on
// one track) renders a plain picker with no selector — so a no-track tour shows no
// empty section. `packages` (t0.packages) drives track ordering + display names.
function GroupedDeparturePicker({ departures, value, onChange, currency, packages, legend }) {
  // Hook must run unconditionally (departures may hydrate async), so declare first.
  const [activeKey, setActiveKey] = React.useState(null);
  const deps = departures || [];
  const groups = [];
  const bySlug = new Map();
  const push = (key, name, d) => {
    let g = bySlug.get(key);
    if (!g) { g = { key, name, items: [] }; bySlug.set(key, g); groups.push(g); }
    g.items.push(d);
  };
  // Seed named tracks in package order so tabs read Route 1 / Route 2 / Route 3.
  (packages || []).forEach(p => { const g = { key: p.id, name: p.name, items: [] }; bySlug.set(p.id, g); groups.push(g); });
  deps.forEach(d => push(d.packageSlug || "__standard", d.packageName || "Standard", d));
  const nonEmpty = groups.filter(g => g.items.length > 0);
  if (nonEmpty.length <= 1) {
    return <DeparturePicker departures={cvtDeps(deps, currency)} value={value} onChange={onChange} currency={currency} legend={legend} />;
  }
  // Default to the first track (Route 1). If the caller's selected departure lives
  // in another track (e.g. a deep-linked pick), follow it so the shown tab matches.
  const byValue = value ? nonEmpty.find(g => g.items.some(d => d.id === value)) : null;
  const active = nonEmpty.find(g => g.key === activeKey) || byValue || nonEmpty[0];
  const selectTrack = (g) => {
    setActiveKey(g.key);
    // Move the selection into the newly chosen track so Reserve stays valid.
    if (onChange && !g.items.some(d => d.id === value)) onChange(g.items[0].id);
  };
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
      <legend className="tk-label" style={{ marginBottom: "var(--space-3)" }}>{legend}</legend>
      <div role="tablist" aria-label="Route" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
        {nonEmpty.map(g => {
          const on = g.key === active.key;
          return (
            <button key={g.key} type="button" role="tab" aria-selected={on} onClick={() => selectTrack(g)}
              style={{ padding: "6px 14px", borderRadius: "var(--radius-pill, 999px)", cursor: "pointer", fontSize: 14, fontWeight: 600,
                border: "1px solid " + (on ? "var(--brand-ink)" : "var(--border-strong)"),
                background: on ? "var(--brand-ink)" : "transparent",
                color: on ? "var(--brand-ink-contrast, #fff)" : "var(--text-muted)" }}>
              {g.name}
            </button>
          );
        })}
      </div>
      <DeparturePicker departures={cvtDeps(active.items, currency)} value={value} onChange={onChange} currency={currency} legend={active.name} />
    </fieldset>
  );
}

function Stars({ value, size = 15 }) {
  return <span style={{ display: "inline-flex", gap: 1 }} aria-label={value + " out of 5"}>{[1,2,3,4,5].map(i => <Icon key={i} name="star" size={size} style={{ color: i <= Math.round(value) ? "#f5b301" : "var(--border-strong)", fill: i <= Math.round(value) ? "#f5b301" : "transparent" }} />)}</span>;
}
function StarInput({ value, onChange }) {
  const [hover, setHover] = React.useState(0);
  return (
    <div role="radiogroup" aria-label="Your rating" style={{ display: "inline-flex", gap: 4 }} onMouseLeave={() => setHover(0)}>
      {[1,2,3,4,5].map(i => (
        <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={i + " star" + (i > 1 ? "s" : "")} onMouseEnter={() => setHover(i)} onClick={() => onChange(i)}
          style={{ background: "none", border: 0, padding: 4, cursor: "pointer", lineHeight: 0 }}>
          <Icon name="star" size={30} style={{ color: i <= (hover || value) ? "#f5b301" : "var(--border-strong)", fill: i <= (hover || value) ? "#f5b301" : "transparent" }} />
        </button>
      ))}
    </div>
  );
}
function ReviewCard({ r }) {
  return (
    <div className="tk-card" style={{ boxShadow: "none", border: "1px solid var(--border-subtle)" }}><div className="tk-card__body" style={{ gap: "var(--space-2)", padding: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--brand-ink)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 14, flex: "none" }}>{r.initials}</span>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>{r.author}{r.verified && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, fontWeight: 700, color: "var(--success-fg)" }}><Icon name="circle-check-big" size={13} />Verified traveller</span>}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}><Stars value={r.rating} /><span className="tk-caption">{r.date}</span></span>
        </div>
      </div>
      {r.title && <strong style={{ fontSize: 15 }}>{r.title}</strong>}
      <p className="tk-body" style={{ margin: 0, color: "var(--text-body)" }}>{r.text}</p>
      {r.reply && <div style={{ marginTop: 6, padding: "10px 12px", background: "var(--bg-sunken)", borderRadius: "var(--radius-md)", borderInlineStart: "3px solid var(--brand)" }}><span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 12.5, color: "var(--brand-ink)" }}><img src="../../assets/logo-badge.png" width="16" height="16" alt="" />Response from TripKoach</span><p className="tk-body-sm" style={{ margin: "4px 0 0" }}>{r.reply}</p></div>}
    </div></div>
  );
}
// Bookings "Leave a review" modal. When `token` is present (the owner's one-time
// review-invite token surfaced by /me/bookings, TRI-1014) the submit POSTs the
// REAL review against that token via TK_REVIEWS_API.submit — the same verified,
// moderated path the emailed link uses. With no token (the fixture demo / DS
// preview) it keeps the original toast-only behaviour, byte-identical.
function ReviewModal({ tour, token, onClose, onSubmitted }) {
  const [rating, setRating] = React.useState(0);
  const [title, setTitle] = React.useState("");
  const [text, setText] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const ok = rating > 0 && text.trim().length >= 10;
  const live = !!(token && LIVE_REVIEW());

  async function onSubmit() {
    if (!ok || submitting) return;
    if (!live) { onClose(); window.tkToast && window.tkToast("Thanks! Your review is awaiting approval."); return; }
    setErr(null); setSubmitting(true);
    try {
      await window.TK_REVIEWS_API.submit(token, { rating, title, text });
      onSubmitted && onSubmitted();
      onClose();
      window.tkToast && window.tkToast("Thanks! Your review is awaiting approval.");
    } catch (e) {
      const gone = e && e.status === 410;
      setErr(gone ? "You've already left a review for this trip." : ((e && e.message) || "We couldn't submit your review. Please try again."));
      setSubmitting(false);
    }
  }

  return (
    <Modal open title={"Review " + tour.title} description="Share your experience. Reviews are checked by our team before they appear publicly — usually within a day." onClose={submitting ? undefined : onClose}
      actions={<><Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button><Button disabled={!ok || submitting} iconStart="check" onClick={onSubmit}>{submitting ? "Submitting…" : "Submit review"}</Button></>}>
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        {err && <Alert tone="danger" title="We couldn't submit your review">{err}</Alert>}
        <div><span className="tk-label" style={{ display: "block", marginBottom: 4 }}>Your rating</span><StarInput value={rating} onChange={setRating} /></div>
        <FormField id="rv-title" label="Title" optional><Input id="rv-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sum it up in a few words" /></FormField>
        <FormField id="rv-text" label="Your review" required hint="At least 10 characters. Please keep it about the tour."><Textarea id="rv-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="What did you enjoy? How was your guide?" /></FormField>
      </div>
    </Modal>
  );
}
function ReviewsSection({ tour, onWrite }) {
  const reviews = (window.TK_REVIEWS_FOR ? window.TK_REVIEWS_FOR(tour.id) : []);
  const stats = window.TK_REVIEW_STATS ? window.TK_REVIEW_STATS(tour.id) : { count: 0, avg: 0 };
  return (
    <div id="reviews">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: "var(--space-4)" }}>
        <h2 className="tk-h3" style={{ margin: 0 }}>Traveller reviews</h2>
        <span className="tk-caption" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="shield-check" size={14} style={{ color: "var(--success-fg)" }} />From travellers we've hosted</span>
      </div>
      {stats.count ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: "var(--space-4)" }}>
            <span style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, color: "var(--text-strong)" }}>{stats.avg}</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}><Stars value={stats.avg} size={18} /><span className="tk-caption">Based on {stats.count} verified review{stats.count > 1 ? "s" : ""}</span></div>
          </div>
          <div style={{ display: "grid", gap: "var(--space-3)" }}>{reviews.map(r => <ReviewCard key={r.id} r={r} />)}</div>
        </>
      ) : (
        <div className="tk-card" style={{ boxShadow: "none", border: "1px dashed var(--border-strong)" }}><div className="tk-card__body" style={{ padding: "var(--space-5)", textAlign: "center", gap: 6 }}>
          <Stars value={0} size={18} />
          <strong>No reviews yet</strong>
          <p className="tk-body-sm tk-muted" style={{ margin: 0 }}>Reviews open to travellers after their departure — we email each guest a private link.</p>
        </div></div>
      )}
    </div>
  );
}
// Live only when the flag is on AND the redeem client is present. Off ⇒ the
// invite page renders the fixture demo exactly as the prototype (byte-identical).
const LIVE_REVIEW = () => !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API && window.TK_REVIEWS_API);

// Live review-invite landing (TRI-894, Backend sibling TRI-892). Reached via the
// tokenized deep link Backend emails travellers after a departure
// (`/reviews/redeem/:token`). Reads the redeem context to prefill the tour +
// traveller, submits the review against the same token, and renders the DS
// invalid/already-redeemed states for 404/410. Only mounted under the flag with
// a token present, so the fixture demo path below is untouched.
function ReviewInviteLive({ go, token }) {
  const [rating, setRating] = React.useState(0);
  const [title, setTitle] = React.useState("");
  const [text, setText] = React.useState("");
  const [done, setDone] = React.useState(false);
  const [ctx, setCtx] = React.useState(null);
  const [phase, setPhase] = React.useState("loading"); // loading | ready | notfound | gone | error
  const [submitting, setSubmitting] = React.useState(false);
  const [submitErr, setSubmitErr] = React.useState(null);
  const load = (alive) => {
    setPhase("loading");
    return window.TK_REVIEWS_API.redeemContext(token).then(
      (c) => { if (alive !== false) { setCtx(c); setPhase("ready"); } },
      (e) => { if (alive !== false) setPhase(e && e.status === 410 ? "gone" : e && e.status === 404 ? "notfound" : "error"); }
    );
  };
  React.useEffect(() => {
    let alive = true;
    load(alive);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const tour = (ctx && ctx.tour) || { title: "", image: null };
  const who = (ctx && ctx.prefill && ctx.prefill.name) || "";
  const ok = rating > 0 && text.trim().length >= 10;

  async function onSubmit() {
    if (submitting) return;
    setSubmitErr(null); setSubmitting(true);
    try {
      await window.TK_REVIEWS_API.submit(token, { rating, title, text });
      setDone(true);
    } catch (e) {
      const gone = e && e.status === 410;
      setSubmitErr(gone ? "This link has already been used to leave a review." : ((e && e.message) || "We couldn't submit your review. Please try again."));
      setSubmitting(false);
    }
  }

  // ---- Pre-form states (loading / invalid / already-redeemed / error) -------
  const stateCard = (icon, tone, heading, msg, action) => (
    <div className="tk-container" style={{ paddingBlock: "var(--space-9) var(--space-12)", maxWidth: 620 }}>
      <div className="tk-card" style={{ boxShadow: "var(--elev-2)" }}><div className="tk-card__body" style={{ padding: "var(--space-7)", textAlign: "center", gap: "var(--space-3)", alignItems: "center" }}>
        <span style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--" + tone + "-bg)", color: "var(--" + tone + "-fg)", display: "grid", placeItems: "center" }}><Icon name={icon} size={28} /></span>
        <h1 className="tk-h2" style={{ margin: 0 }}>{heading}</h1>
        <p className="tk-body" style={{ margin: 0, color: "var(--text-muted)", maxWidth: "42ch" }}>{msg}</p>
        {action}
      </div></div>
    </div>
  );
  if (phase === "loading") {
    return stateCard("loader", "info", "Checking your link…", "One moment while we open your review invite.", null);
  }
  if (phase === "notfound") {
    return stateCard("circle-alert", "danger", "This link isn't valid", "The review link is incomplete or has expired. If you travelled with us recently, check your latest email for the correct link.", <Button style={{ marginTop: 8 }} onClick={() => go("home")}>Explore tours</Button>);
  }
  if (phase === "gone") {
    return stateCard("circle-check-big", "success", "You've already reviewed this trip", "Thanks — this invite has already been used. Your review is with our team and appears once it's approved.", <Button style={{ marginTop: 8 }} onClick={() => go("home")}>Back to tours</Button>);
  }
  if (phase === "error") {
    return stateCard("triangle-alert", "warning", "Something went wrong", "We couldn't open your review invite just now. Please try again in a moment.", <Button style={{ marginTop: 8 }} onClick={() => load(true)}>Try again</Button>);
  }

  // ---- Ready: the DS invite form (or the post-submit thank-you) -------------
  return (
    <div className="tk-container" style={{ paddingBlock: "var(--space-9) var(--space-12)", maxWidth: 620 }}>
      {done ? (
        <div className="tk-card" style={{ boxShadow: "var(--elev-2)" }}><div className="tk-card__body" style={{ padding: "var(--space-7)", textAlign: "center", gap: "var(--space-3)", alignItems: "center" }}>
          <span style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--success-bg)", color: "var(--success-fg)", display: "grid", placeItems: "center" }}><Icon name="circle-check-big" size={28} /></span>
          <h1 className="tk-h2" style={{ margin: 0 }}>Thank you{who ? ", " + String(who).split(" ")[0] : ""}!</h1>
          <p className="tk-body" style={{ margin: 0, color: "var(--text-muted)", maxWidth: "40ch" }}>Your review is with our team. Once it's approved it'll appear on the {tour.title} page — usually within a day.</p>
          <Button style={{ marginTop: 8 }} onClick={() => go("home")}>Back to tours</Button>
        </div></div>
      ) : (
        <div className="tk-card" style={{ boxShadow: "var(--elev-2)" }}><div className="tk-card__body" style={{ padding: "var(--space-6)", gap: "var(--space-4)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ position: "relative", width: 60, height: 60, borderRadius: "var(--radius-md)", overflow: "hidden", flex: "none" }}><TourImage src={tour.image} alt={tour.title} label={tour.title} gi={0} showLabel={false} /></div>
            <div><span className="tk-overline" style={{ color: "var(--brand-ink)" }}>How was your trip?</span><h1 className="tk-h3" style={{ margin: "2px 0 0" }}>{tour.title}</h1></div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "var(--success-bg)", borderRadius: "var(--radius-md)" }}><Icon name="shield-check" size={16} style={{ color: "var(--success-fg)" }} /><span className="tk-body-sm">Verified traveller — only you can use this private link.</span></div>
          <div><span className="tk-label" style={{ display: "block", marginBottom: 4 }}>Your rating</span><StarInput value={rating} onChange={setRating} /></div>
          <FormField id="iv-title" label="Title" optional><Input id="iv-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sum it up in a few words" /></FormField>
          <FormField id="iv-text" label="Your review" required hint="At least 10 characters."><Textarea id="iv-text" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="What did you enjoy? How was your guide?" /></FormField>
          {submitErr && <Alert tone="error" title="We couldn't submit that">{submitErr}</Alert>}
          <Button size="lg" block disabled={!ok || submitting} iconStart="check" onClick={onSubmit}>{submitting ? "Submitting…" : "Submit review"}</Button>
          <p className="tk-caption" style={{ textAlign: "center", margin: 0 }}>Only you can use this link. Reviews are checked before they appear publicly.</p>
        </div></div>
      )}
    </div>
  );
}

function ReviewInvitePage({ go, token }) {
  if (LIVE_REVIEW() && token) return <ReviewInviteLive go={go} token={token} />;
  const inv = window.TK_INVITE || {};
  const tour = (window.TK_DATA.tours.find(t => t.id === inv.tourId)) || { title: inv.tour, image: null };
  const [rating, setRating] = React.useState(0);
  const [title, setTitle] = React.useState("");
  const [text, setText] = React.useState("");
  const [done, setDone] = React.useState(false);
  const ok = rating > 0 && text.trim().length >= 10;
  return (
    <div className="tk-container" style={{ paddingBlock: "var(--space-9) var(--space-12)", maxWidth: 620 }}>
      {done ? (
        <div className="tk-card" style={{ boxShadow: "var(--elev-2)" }}><div className="tk-card__body" style={{ padding: "var(--space-7)", textAlign: "center", gap: "var(--space-3)", alignItems: "center" }}>
          <span style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--success-bg)", color: "var(--success-fg)", display: "grid", placeItems: "center" }}><Icon name="circle-check-big" size={28} /></span>
          <h1 className="tk-h2" style={{ margin: 0 }}>Thank you, {String(inv.name || "").split(" ")[0]}!</h1>
          <p className="tk-body" style={{ margin: 0, color: "var(--text-muted)", maxWidth: "40ch" }}>Your review is with our team. Once it's approved it'll appear on the {tour.title} page — usually within a day.</p>
          <Button style={{ marginTop: 8 }} onClick={() => go("tour", tour.id || inv.tourId)}>Back to the tour</Button>
        </div></div>
      ) : (
        <div className="tk-card" style={{ boxShadow: "var(--elev-2)" }}><div className="tk-card__body" style={{ padding: "var(--space-6)", gap: "var(--space-4)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ position: "relative", width: 60, height: 60, borderRadius: "var(--radius-md)", overflow: "hidden", flex: "none" }}><TourImage src={tour.image} alt={tour.title} label={tour.title} gi={0} showLabel={false} /></div>
            <div><span className="tk-overline" style={{ color: "var(--brand-ink)" }}>How was your trip?</span><h1 className="tk-h3" style={{ margin: "2px 0 0" }}>{tour.title}</h1></div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "var(--success-bg)", borderRadius: "var(--radius-md)" }}><Icon name="shield-check" size={16} style={{ color: "var(--success-fg)" }} /><span className="tk-body-sm">Verified — you travelled on <strong>{inv.date}</strong> (booking {inv.ref}).</span></div>
          <div><span className="tk-label" style={{ display: "block", marginBottom: 4 }}>Your rating</span><StarInput value={rating} onChange={setRating} /></div>
          <FormField id="iv-title" label="Title" optional><Input id="iv-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sum it up in a few words" /></FormField>
          <FormField id="iv-text" label="Your review" required hint="At least 10 characters."><Textarea id="iv-text" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="What did you enjoy? How was your guide?" /></FormField>
          <Button size="lg" block disabled={!ok} iconStart="check" onClick={() => setDone(true)}>Submit review</Button>
          <p className="tk-caption" style={{ textAlign: "center", margin: 0 }}>Only you can use this link. Reviews are checked before they appear publicly.</p>
        </div></div>
      )}
    </div>
  );
}
Object.assign(window, { Stars, StarInput, ReviewCard, ReviewModal, ReviewsSection, ReviewInviteLive, ReviewInvitePage });

const NAV = [{ label: "Tours", href: "#browse" }, { label: "Regions", href: "#regions" }, { label: "Marketplace", href: "#marketplace" }, { label: "Stories", href: "#blog" }, { label: "About", href: "#about" }];

// Warm brand gradients so a broken/absent CDN photo still reads as an intentional, on-brand panel.
const TK_GRADS = [
  "linear-gradient(145deg,#c67d2a 0%,#9a5a1f 55%,#5c3413 100%)",
  "linear-gradient(145deg,#3f7a63 0%,#255043 100%)",
  "linear-gradient(145deg,#b3702f 0%,#6b3d18 100%)",
  "linear-gradient(145deg,#5a7d8f 0%,#2f4b58 100%)",
  "linear-gradient(145deg,#a8562f 0%,#5e2c18 100%)",
];
function TourImage({ src, alt, label, gi = 0, showLabel = true }) {
  const [err, setErr] = React.useState(false);
  if (err || !src) {
    return (
      <div aria-label={alt} role="img" style={{ position: "absolute", inset: 0, background: TK_GRADS[gi % TK_GRADS.length], display: "grid", placeItems: "center" }}>
        <span style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 90% at 20% 15%, rgba(255,255,255,.16), transparent 60%)" }} />
        {showLabel && <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 7, color: "rgba(255,255,255,.94)", fontWeight: 700, fontSize: 13.5, letterSpacing: ".01em", textShadow: "0 1px 4px rgba(0,0,0,.35)" }}><Icon name="map-pin" size={16} />{label || "Ghana"}</span>}
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setErr(true)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />;
}
function tourGallery(t) {
  const caps = (t.highlights && t.highlights.length) ? t.highlights : [t.region + ", Ghana"];
  const out = [{ src: t.image, caption: t.title, gi: 0 }];
  for (let i = 1; i < 8; i++) out.push({ src: t.image ? window.TK_IMG(t.id, "gallery-" + i) : null, caption: caps[(i - 1) % caps.length], gi: i % TK_GRADS.length });
  return out;
}
function Lightbox({ photos, index, setIndex, onClose }) {
  React.useEffect(() => {
    const h = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setIndex((index + 1) % photos.length);
      else if (e.key === "ArrowLeft") setIndex((index - 1 + photos.length) % photos.length);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [index, photos.length]);
  const p = photos[index];
  const nav = (d) => setIndex((index + d + photos.length) % photos.length);
  const arrow = { position: "absolute", top: "50%", transform: "translateY(-50%)", width: 48, height: 48, borderRadius: "50%", border: "1px solid rgba(255,255,255,.4)", background: "rgba(20,19,18,.5)", color: "#fff", display: "grid", placeItems: "center", cursor: "pointer", zIndex: 2 };
  return (
    <div role="dialog" aria-modal="true" aria-label={"Photo gallery, " + (index + 1) + " of " + photos.length} style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(14,13,12,.95)", display: "flex", flexDirection: "column" }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-4) var(--space-5)", color: "#fff" }}>
        <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: ".02em" }}>{index + 1} / {photos.length}</span>
        <button type="button" onClick={onClose} aria-label="Close gallery" style={{ width: 44, height: 44, borderRadius: "50%", border: "1px solid rgba(255,255,255,.35)", background: "rgba(255,255,255,.08)", color: "#fff", display: "grid", placeItems: "center", cursor: "pointer" }}><Icon name="x" size={20} /></button>
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 0, margin: "0 var(--space-5)" }}>
        <button type="button" onClick={() => nav(-1)} aria-label="Previous photo" style={{ ...arrow, insetInlineStart: 8 }}><Icon name="chevron-left" size={24} /></button>
        <div style={{ position: "absolute", inset: 0, borderRadius: "var(--radius-card)", overflow: "hidden" }}>
          {(!p.src) ? <div role="img" aria-label={p.caption} style={{ position: "absolute", inset: 0, background: TK_GRADS[p.gi % TK_GRADS.length], display: "grid", placeItems: "center" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "rgba(255,255,255,.94)", fontWeight: 700, fontSize: 16, textShadow: "0 1px 6px rgba(0,0,0,.4)" }}><Icon name="map-pin" size={18} />{p.caption}</span></div>
            : <LightboxPhoto src={p.src} alt={p.caption} caption={p.caption} gi={p.gi} />}
        </div>
        <button type="button" onClick={() => nav(1)} aria-label="Next photo" style={{ ...arrow, insetInlineEnd: 8 }}><Icon name="chevron-right" size={24} /></button>
      </div>
      <div style={{ color: "rgba(255,255,255,.9)", textAlign: "center", fontSize: 14, fontWeight: 500, padding: "var(--space-4) var(--space-5) 0" }}>{p.caption}</div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "var(--space-4) var(--space-5) var(--space-5)", justifyContent: "center" }}>
        {photos.map((ph, i) => (
          <button key={i} type="button" onClick={() => setIndex(i)} aria-label={"Photo " + (i + 1)} aria-current={i === index} style={{ position: "relative", flex: "0 0 auto", width: 74, height: 52, borderRadius: "var(--radius-sm)", overflow: "hidden", border: i === index ? "2px solid var(--gold-500)" : "2px solid transparent", padding: 0, cursor: "pointer", opacity: i === index ? 1 : .62 }}>
            {ph.src ? <img src={ph.src} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} /> : null}
            <span style={{ position: "absolute", inset: 0, background: TK_GRADS[ph.gi % TK_GRADS.length], zIndex: -1 }} />
          </button>
        ))}
      </div>
    </div>
  );
}
function LightboxPhoto({ src, alt, caption, gi }) {
  const [err, setErr] = React.useState(false);
  if (err) return <div role="img" aria-label={caption} style={{ position: "absolute", inset: 0, background: TK_GRADS[gi % TK_GRADS.length], display: "grid", placeItems: "center" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "rgba(255,255,255,.94)", fontWeight: 700, fontSize: 16, textShadow: "0 1px 6px rgba(0,0,0,.4)" }}><Icon name="map-pin" size={18} />{caption}</span></div>;
  return <img src={src} alt={alt} onError={() => setErr(true)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", background: "#0e0d0c" }} />;
}
function TourHero({ t, go }) {
  const photos = tourGallery(t);
  const [lb, setLb] = React.useState(null);
  const open = (i) => setLb(i);
  const thumbs = [
    { name: "gallery-1", label: t.highlights && t.highlights[0] },
    { name: "gallery-2", label: t.highlights && t.highlights[1] },
    { name: "gallery-3", label: t.highlights && t.highlights[2] },
    { name: "gallery-4", label: t.highlights && t.highlights[3] },
  ];
  return (
    <>
    <div style={{ borderRadius: "var(--radius-card)", overflow: "hidden", boxShadow: "var(--elev-2)", border: "1px solid var(--border-subtle)" }}>
      <div style={{ position: "relative", aspectRatio: "21/9", minHeight: 320, cursor: "pointer", background: TK_GRADS[0] }} onClick={() => open(0)}>
        <TourImage src={t.image} alt={t.title} label={t.region + ", Ghana"} gi={0} showLabel={true} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(20,19,18,.86) 0%, rgba(20,19,18,.42) 34%, rgba(20,19,18,.05) 60%, rgba(20,19,18,.18) 100%)" }} />
        <div style={{ position: "absolute", insetInline: 0, top: 0, padding: "var(--space-5)", display: "flex", justifyContent: "flex-end" }}>
          <button type="button" onClick={(e) => { e.stopPropagation(); open(0); }}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 40, padding: "0 16px", border: "1px solid rgba(255,255,255,.55)", borderRadius: "var(--radius-pill)", background: "rgba(20,19,18,.4)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
            <Icon name="image" size={16} />View all {photos.length} photos
          </button>
        </div>
        <div style={{ position: "absolute", insetInline: 0, bottom: 0, padding: "var(--space-7) var(--space-6) var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-3)", color: "#fff" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13.5, fontWeight: 600, color: "rgba(255,255,255,.92)" }}>
            <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><Icon name="map-pin" size={15} />{t.region}, Ghana</span>
            <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><Icon name="clock" size={15} />{t.duration}</span>
            <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><Icon name="tag" size={15} />{t.category}</span>
          </div>
          <h1 className="tk-display" style={{ color: "#fff", maxWidth: "20ch", textShadow: "0 2px 14px rgba(0,0,0,.4)", margin: 0 }}>{t.title}</h1>
          <div className="tk-row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {t.rating ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.16)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", borderRadius: "var(--radius-pill)", padding: "5px 12px", fontWeight: 700, fontSize: 13.5 }}><Icon name="star" size={15} style={{ color: "#f5b301" }} />{t.rating} <span style={{ opacity: .8, fontWeight: 500 }}>({t.reviews})</span></span> : null}
            {t.tag ? <span style={{ background: "var(--gold-500)", color: "#2b1c0b", fontWeight: 800, fontSize: 12.5, borderRadius: "var(--radius-pill)", padding: "5px 12px" }}>{t.tag}</span> : null}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(25,120,75,.9)", color: "#fff", fontWeight: 700, fontSize: 12.5, borderRadius: "var(--radius-pill)", padding: "5px 12px" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#8ff0b8" }} />{t.spotsLeft} spots left</span>
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 3, background: "var(--bg-surface)" }}>
        {thumbs.map((th, i) => (
          <button key={i} type="button" onClick={() => open(i + 1)} style={{ position: "relative", aspectRatio: "3/2", border: 0, padding: 0, cursor: "pointer", overflow: "hidden" }}>
            <TourImage src={t.image ? window.TK_IMG(t.id, th.name) : null} alt={th.label || t.title} label={th.label} gi={i + 1} />
            {i === 3 && <span style={{ position: "absolute", inset: 0, background: "rgba(20,19,18,.5)", display: "grid", placeItems: "center", color: "#fff", fontWeight: 800, fontSize: 16 }}>+{photos.length - 4}</span>}
          </button>
        ))}
      </div>
    </div>
    {lb !== null && <Lightbox photos={photos} index={lb} setIndex={setLb} onClose={() => setLb(null)} />}
    </>
  );
}
const FOOT = [
  { title: "Travel", links: [{ label: "Regions", href: "#regions" }, { label: "Tour packages", href: "#browse" }, { label: "Marketplace", href: "#marketplace" }, { label: "eSIM", href: "#esim" }, { label: "Airport pickup", href: "#pickup" }, { label: "Tourism clubs", href: "#club" }] },
  { title: "Company", links: [{ label: "About", href: "#about" }, { label: "Blog", href: "#blog" }, { label: "Contact", href: "#contact" }] },
];

const KNOWN_SCREENS = ["home", "browse", "tour", "checkout", "confirm", "bookings", "reviews", "login", "forgot", "profile", "notifications", "account-settings", "regions", "marketplace", "esim", "pickup", "club", "about", "blog", "contact", "review"];

function MobileMenu({ onClose, go }) {
  const links = [...NAV, { label: "My bookings", href: "#bookings" }, { label: "Sign in", href: "#login" }];
  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(20,19,18,.45)", backdropFilter: "blur(2px)", display: "flex", justifyContent: "flex-end" }}>
      <nav aria-label="Menu" style={{ width: "min(84vw,320px)", background: "var(--bg-surface)", height: "100%", padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: 2, boxShadow: "var(--elev-4)", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
          <img src="../../assets/logo-badge.png" width="34" height="34" alt="TripKoach" />
          <IconButton icon="x" label="Close menu" variant="ghost" onClick={onClose} />
        </div>
        {links.map(l => <a key={l.href} href={l.href} onClick={onClose} className="tk-navlink" style={{ minHeight: 48, fontSize: 16, paddingInline: "var(--space-2)" }}>{l.label}</a>)}
        <Button style={{ marginTop: "var(--space-4)" }} block onClick={() => { onClose(); go && go("contact"); }}>Plan a trip</Button>
      </nav>
    </div>
  );
}

// Account dropdown item (TRI-927 port of the TRI-920 in-nav Settings / Sign out
// menu). `danger` tone colours the Sign out row; hover uses a subtle surface tint.
const ACCT_ITEM = { display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 12px", background: "none", border: 0, borderRadius: "var(--radius-sm, 8px)", cursor: "pointer", font: "inherit", fontSize: 14, fontWeight: 600, color: "var(--text-default)", textAlign: "start" };
function AcctItem({ icon, label, tone, onClick }) {
  const [hov, setHov] = React.useState(false);
  return (
    <button role="menuitem" onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ ...ACCT_ITEM, color: tone === "danger" ? "var(--danger-fg, #b42318)" : ACCT_ITEM.color, background: hov ? "var(--bg-subtle, rgba(0,0,0,.05))" : "none" }}>
      <Icon name={icon} size={16} />{label}
    </button>
  );
}

// Maps the active screen to the nav item that should read as current (TRI-940).
// Tour detail highlights Tours; a blog post highlights Stories. Screens with no
// nav home (home, checkout, account…) map to undefined ⇒ no item is marked active.
const NAV_CURRENT = { browse: "#browse", tour: "#browse", regions: "#regions", marketplace: "#marketplace", blog: "#blog", post: "#blog", about: "#about" };
function Shell({ children, currency, setCurrency, go, screen }) {
  const [menu, setMenu] = React.useState(false);
  // Reactive session state (TRI-922). The prototype hardcoded `signedIn` on the
  // DS <Header> (avatar always) AND always rendered a custom "Sign in" button, so
  // a signed-in user still saw "Sign in". `LIVE_AUTH()` only tells us live-API
  // mode is on — NOT whether a session exists — so we resolve /me and drive the
  // nav off the answer. cachedMe(): undefined = unknown, null = guest, obj = user.
  // Flag off ⇒ `live` is false and authed stays true → nav renders byte-identical
  // to the prototype (avatar + Sign in). We read the cache on every render (App
  // re-renders Shell on nav, and login/logout mutate the cache), and kick a /me
  // fetch + re-render the first time the answer is unknown.
  const live = LIVE_AUTH();
  const [, forceRender] = React.useState(0);
  const cachedMe = live ? window.TK_AUTH.cachedMe() : undefined;
  const authed = !live ? true : (cachedMe === undefined ? null : !!cachedMe);
  React.useEffect(() => {
    if (!live || window.TK_AUTH.cachedMe() !== undefined) return undefined;
    let alive = true;
    window.TK_AUTH.me().then(() => { if (alive) forceRender((n) => n + 1); }, () => {});
    return () => { alive = false; };
  }, [live, authed]);
  // Account dropdown (TRI-927): `acct` holds the viewport anchor (or null when
  // closed). Only opened for a resolved authed user; guests still route to login.
  const [acct, setAcct] = React.useState(null);
  React.useEffect(() => {
    if (!acct) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setAcct(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [acct]);
  const onNav = (e) => {
    const accountBtn = e.target.closest('button[aria-label="Your account"]');
    if (accountBtn) {
      e.preventDefault();
      if (!live) { go && go("profile"); return; } // byte-identical flag-off
      // Authed → open the Settings / Sign out dropdown anchored under the avatar
      // (TRI-927). Guest / brief unknown window → login, no dropdown.
      if (authed !== true) { setAcct(null); go && go("login"); return; }
      const r = accountBtn.getBoundingClientRect();
      setAcct((cur) => cur ? null : { top: Math.round(r.bottom + 8), right: Math.max(12, Math.round(window.innerWidth - r.right)) });
      return;
    }
    // Guest auth CTAs the DS <Header> renders when signedIn is false (TRI-922):
    // wire its "Log in" / "Sign up" buttons to the real screens.
    const authBtn = live && e.target.closest('.tk-header button');
    if (authBtn && authBtn.getAttribute("aria-label") !== "Your account") {
      const txt = (authBtn.textContent || "").trim().toLowerCase();
      if (txt === "log in" || txt === "sign in") { e.preventDefault(); go && go("login"); return; }
      if (txt === "sign up") { e.preventDefault(); go && go("signup"); return; }
    }
    const a = e.target.closest("a");
    if (!a) return;
    if (a.getAttribute("aria-label") === "TripKoach home") { e.preventDefault(); go && go("home"); return; }
    const href = a.getAttribute("href") || "";
    if (href.startsWith("#") && KNOWN_SCREENS.includes(href.slice(1))) { e.preventDefault(); go && go(href.slice(1)); }
  };
  return (
    <div style={{ background: "var(--bg-page)", minHeight: "100%" }} onClick={onNav}>
      <Header items={NAV} current={NAV_CURRENT[screen]} signedIn={authed !== false} logoSrc="../../assets/logo-badge.png"
        right={<>
          <CurrencyToggle value={currency} onChange={setCurrency} />
          <IconButton icon="menu" label="Open menu" variant="ghost" className="tk-only-mobile" onClick={() => setMenu(true)} />
          {!live && <Button variant="ghost" size="sm" className="tk-hide-mobile" onClick={() => go && go("login")}>Sign in</Button>}
          <Button variant="primary" size="sm" className="tk-hide-mobile" onClick={() => go && go("contact")}>Plan a trip</Button>
        </>} />
      <main>{children}</main>
      <Footer columns={FOOT} logoSrc="../../assets/logo-badge.png" />
      {menu && <MobileMenu go={go} onClose={() => setMenu(false)} />}
      {acct && <>
        <div onClick={() => setAcct(null)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
        <div role="menu" aria-label="Account" style={{ position: "fixed", top: acct.top, right: acct.right, zIndex: 61, minWidth: 190, padding: 6, background: "var(--bg-surface, #fff)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md, 12px)", boxShadow: "var(--shadow-lg, 0 12px 32px rgba(16,24,40,.16))", display: "flex", flexDirection: "column", gap: 2 }}>
          <AcctItem icon="user" label="Profile" onClick={() => { setAcct(null); go && go("profile"); }} />
          <AcctItem icon="settings" label="Settings" onClick={() => { setAcct(null); go && go("account-settings"); }} />
          <div style={{ height: 1, background: "var(--border-subtle)", margin: "4px 6px" }} />
          <AcctItem icon="log-out" label="Sign out" tone="danger" onClick={async () => { setAcct(null); try { if (window.TK_AUTH) await window.TK_AUTH.logout(); } catch (_) {} go && go("login"); }} />
        </div>
      </>}
    </div>
  );
}

const PRICE_BANDS = [{ label: "Under $200", test: p => p < 200 }, { label: "$200–600", test: p => p >= 200 && p <= 600 }, { label: "$600–1,200", test: p => p > 600 && p <= 1200 }, { label: "$1,200+", test: p => p > 1200 }];
const DURATIONS = [{ label: "Half day", test: d => /half day|hrs/i.test(d) }, { label: "Full day", test: d => /full day/i.test(d) }, { label: "Multi-day", test: d => /days|nights?/i.test(d) }];
function matchesFilters(t, f) {
  if (f.region.length && !f.region.includes(t.region)) return false;
  if (f.category.length && !f.category.includes(t.category)) return false;
  if (f.price.length && !f.price.some(l => (PRICE_BANDS.find(b => b.label === l) || {}).test?.(t.price))) return false;
  if (f.duration.length && !f.duration.some(l => (DURATIONS.find(b => b.label === l) || {}).test?.(t.duration))) return false;
  return true;
}

function FilterPanel({ tours, filters, toggle, onClear }) {
  const regions = [...new Set(tours.map(t => t.region))];
  const cats = [...new Set(tours.map(t => t.category))];
  const groups = [["Region", "region", regions], ["Price from", "price", PRICE_BANDS.map(b => b.label)], ["Duration", "duration", DURATIONS.map(b => b.label)], ["Category", "category", cats]];
  const anyActive = filters.region.length || filters.price.length || filters.duration.length || filters.category.length;
  return (
    <aside aria-label="Filters" style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", position: "sticky", top: "calc(var(--header-h) + 24px)" }}>
      {groups.map(([title, key, opts]) => (
        <div key={title} className="tk-stack" style={{ gap: "var(--space-3)" }}>
          <h3 className="tk-h6">{title}</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {opts.map(o => { const on = filters[key].includes(o); return <Chip key={o} active={on} onClick={() => toggle(key, o)} onRemove={on ? () => toggle(key, o) : undefined}>{o}</Chip>; })}
          </div>
        </div>
      ))}
      {/* No "Departing" date filter here: the browse catalogue summary carries no
          per-tour departure dates (those are hydrated only on the tour page), so a
          date select could not honestly filter. Date selection lives on the tour
          page's departure picker instead. */}
      {anyActive ? <Button variant="ghost" size="sm" style={{ alignSelf: "flex-start" }} onClick={onClear}>Clear all filters</Button> : null}
    </aside>
  );
}

function BrowseWeb({ go, currency, view, initialRegion }) {
  const tours = window.TK_DATA.tours;
  // Seed the region filter from a /browse?region=<name> deep link (TRI-940). Only
  // apply it when it names a real tour region so a stale/unknown slug is ignored
  // (shown filter always corresponds to actual data) rather than yielding 0 tours.
  const seedRegion = initialRegion && tours.some(t => t.region === initialRegion) ? [initialRegion] : [];
  const [filters, setFilters] = React.useState({ region: seedRegion, price: [], duration: [], category: [] });
  const [query, setQuery] = React.useState("");
  // Keep the region filter in sync with the deep link across in-place route
  // changes (browser back/forward between /browse and /browse?region=…), where
  // BrowseWeb stays mounted and the state initializer above does not re-run.
  React.useEffect(() => {
    const next = initialRegion && tours.some(t => t.region === initialRegion) ? [initialRegion] : [];
    setFilters(f => (f.region.length === next.length && f.region.every((x, i) => x === next[i]) ? f : { ...f, region: next }));
  }, [initialRegion]);
  const toggle = (key, val) => setFilters(f => ({ ...f, [key]: f[key].includes(val) ? f[key].filter(x => x !== val) : [...f[key], val] }));
  const clear = () => setFilters({ region: [], price: [], duration: [], category: [] });
  const [sort, setSort] = React.useState("pop");
  const matched = tours.filter(t => matchesFilters(t, filters) && (!query || (t.title + t.region + t.category).toLowerCase().includes(query.toLowerCase())));
  // Client sort over the summary fields the catalogue actually carries. "Departing
  // soon" is intentionally absent — browse has no per-tour departure dates to sort by.
  const num = (v) => (typeof v === "number" && !isNaN(v) ? v : 0);
  const SORTERS = {
    pop: (a, b) => num(b.reviews) - num(a.reviews) || num(b.rating) - num(a.rating),
    rate: (a, b) => num(b.rating) - num(a.rating) || num(b.reviews) - num(a.reviews),
    pl: (a, b) => num(a.price) - num(b.price),
    ph: (a, b) => num(b.price) - num(a.price),
  };
  const shown = [...matched].sort(SORTERS[sort] || SORTERS.pop);
  return (
    <>
      <section style={{ position: "relative", borderBottom: "1px solid var(--border-subtle)", overflow: "hidden", background: "var(--brand-wash)" }}>
        <img src="https://cdn.tripkoach.com/img/tours/discover-ghana-in-10-days/hero-1440.jpg" alt="" aria-hidden="true"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(20,19,18,.82) 0%, rgba(20,19,18,.62) 45%, rgba(20,19,18,.28) 100%)" }} />
        <div className="tk-container" style={{ position: "relative", paddingBlock: "var(--space-12)", display: "flex", flexDirection: "column", gap: "var(--space-5)", maxWidth: 1200 }}>
          <div className="tk-stack" style={{ gap: "var(--space-3)", maxWidth: "22ch" }}>
            <span className="tk-overline" style={{ color: "var(--gold-300)" }}>Ghana · {window.TK_REGION_COUNT()} regions</span>
            <h1 className="tk-display" style={{ color: "#fff" }}>Ghana, shown by the people who live there</h1>
          </div>
          <p className="tk-body-lg" style={{ maxWidth: "52ch", color: "rgba(255,255,255,.9)" }}>
            Guided day trips and multi-day journeys with local guides. Reserve your spot now and pay before you travel.
          </p>
          {/* Filtering is live-on-type via the field below; a separate "Search"
              button would be redundant, so it's removed rather than left inert. */}
          <div style={{ maxWidth: 640 }}>
            <SearchField value={query} onChange={(e) => setQuery(e.target.value)} onClear={() => setQuery("")} />
          </div>
        </div>
      </section>

      <div className="tk-container" style={{ paddingBlock: "var(--space-10)", display: "grid", gridTemplateColumns: "240px 1fr", gap: "var(--space-10)", maxWidth: 1200 }}>
        <FilterPanel tours={tours} filters={filters} toggle={toggle} onClear={clear} />
        <div className="tk-stack" style={{ gap: "var(--space-5)" }}>
          <div className="tk-row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <h2 className="tk-h3">{shown.length} {shown.length === 1 ? "tour" : "tours"} across Ghana</h2>
            <Select aria-label="Sort" style={{ width: 200 }} value={sort} onChange={(e) => setSort(e.target.value)}
              options={[{ value: "pop", label: "Sort: Most popular" }, { value: "rate", label: "Sort: Top rated" }, { value: "pl", label: "Sort: Price low to high" }, { value: "ph", label: "Sort: Price high to low" }]} />
          </div>
          {view === "loading" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "var(--space-5)" }} aria-busy="true">
              {[0,1,2,3,4,5].map(i => <div className="tk-card" key={i}><Skeleton height={160} radius="0" /><div className="tk-card__body"><Skeleton height={10} width="45%" /><Skeleton height={16} /><Skeleton height={16} width="65%" /></div></div>)}
            </div>
          ) : shown.length === 0 ? (
            <EmptyState icon="compass" title="No tours match those filters" body="Try widening the price range or clearing a region." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "var(--space-5)" }}>
                {shown.map(t => <div key={t.id} onClick={() => go("tour", t.id)}><TourCard {...t} price={cvt(t.price, currency)} currency={currency} reviewCount={t.reviews} /></div>)}
              </div>
              <Pagination page={1} pages={1} resultsLabel={"Showing " + shown.length + " of " + tours.length + " tours"} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

function pkgTour(t, pkgId) {
  const p = (t.packages || []).find(x => x.id === pkgId);
  if (!p) return t;
  return { ...t, tiers: p.tiers, price: p.tiers[p.tiers.length - 1].price, included: (p.includes || t.included), stops: p.stops, packageName: p.name, packageId: p.id, duration: p.duration || t.duration };
}
// TRI-1018 / TRI-999 · empty-departures date-interest capture. Live only when the flag is on AND the
// enquiry client is present — flag off ⇒ this gate is false and the form falls back to a toast, keeping
// the built prototype byte-identical.
const LIVE_INTEREST = () => !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API && window.TK_ENQUIRY && window.TK_ENQUIRY.interest);

// Inline email-only "Notify me when dates open" form shown inside the booking box when a tour has no
// upcoming departures (TRI-999 spec: EmptyState + FormField + Input + Button, no new visual language).
// Persists via POST /tours/:id/interest so ops can schedule a departure; flag-off just toasts thanks.
function DateInterestForm({ tourId, packageId }) {
  const [email, setEmail] = React.useState("");
  const [phase, setPhase] = React.useState("idle"); // idle | submitting | done | error
  const [err, setErr] = React.useState(null);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  async function submit() {
    if (!emailOk || phase === "submitting") return;
    if (!LIVE_INTEREST()) { setPhase("done"); window.tkToast && window.tkToast("Thanks! We'll email you when dates open."); return; }
    setPhase("submitting"); setErr(null);
    try {
      await window.TK_ENQUIRY.interest(tourId, { intent: "notify", email: email.trim(), packageId: packageId || undefined });
      setPhase("done");
    } catch (e) {
      setErr((e && e.message) || "Something went wrong. Please try again.");
      setPhase("error");
    }
  }
  if (phase === "done") return (
    <Alert tone="success" title="You're on the list">We'll email you the moment a date opens for this experience.</Alert>
  );
  return (
    <div className="tk-stack" style={{ gap: "var(--space-3)" }}>
      <FormField id="ti-email" label="Email" error={phase === "error" ? err : undefined}>
        <Input id="ti-email" type="email" placeholder="you@example.com" value={email}
          onChange={(e) => { setEmail(e.target.value); if (phase === "error") setPhase("idle"); }}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      </FormField>
      <Button size="lg" block iconStart="bell" disabled={!emailOk} loading={phase === "submitting"} onClick={submit}>
        Notify me when dates open
      </Button>
    </div>
  );
}

function TourWeb({ go, currency, slug }) {
  // Slug-addressable tour detail (TRI-888/C2). A slug is only ever passed in live
  // mode; without one — the fixture prototype and every flag-off build — this
  // falls back to tours[0], so behaviour there is byte-for-byte unchanged.
  const tours = window.TK_DATA.tours;
  const t0 = (slug && tours.find(t => t.id === slug || t.slug === slug)) || tours[0];
  const [pkgId, setPkgId] = React.useState(t0.defaultPackage || (t0.packages && t0.packages[0].id));
  const t = t0.packages ? pkgTour(t0, pkgId) : t0;
  // Prototype default is the fixture id "d2"; live departures carry their own API
  // ids, so pick a real one (flag off ⇒ always "d2", byte-identical).
  const [dep, setDep] = React.useState(() => {
    if (!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API)) return "d2";
    const deps = t0.departures || [];
    // TRI-998: no "d2" fixture fallback in live mode. When a tour has no bookable
    // departures the selection stays null and the booking box renders an empty state
    // instead of pushing a non-existent departure id into a broken checkout.
    if (!deps.length) return null;
    return deps.some(x => x.id === "d2") ? "d2" : ((deps[1] || deps[0]).id);
  });
  const d = t.departures.find(x => x.id === dep);
  // TRI-998: a tour is bookable only when it has at least one upcoming departure. The
  // API filters departures to bookable slots (scheduled/sold_out + future), so an empty
  // list means "no upcoming departures". Fixtures always carry departures, so the
  // flag-off prototype never hits the empty branch (byte-identical).
  const hasDepartures = (t.departures || []).length > 0;
  return (
    <div className="tk-container" style={{ paddingBlock: "var(--space-6) var(--space-12)", maxWidth: 1200, display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      <Breadcrumbs items={[{ label: "Tours", href: "#" }, { label: t.region, href: "#" }, { label: t.title }]} />
      <TourHero t={t} go={go} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "var(--space-10)", alignItems: "start" }}>
        <div className="tk-stack" style={{ gap: "var(--space-6)" }}>
          <p className="tk-body-lg" style={{ maxWidth: "62ch", marginTop: "var(--space-2)" }}>{t.blurb}</p>
          {t0.packages ? (
            <div className="tk-stack" style={{ gap: "var(--space-3)" }}>
              <h2 className="tk-h3">Choose your route</h2>
              <p className="tk-body" style={{ color: "var(--text-muted)", marginTop: -6 }}>Same great guide, three ways to spend your half day. Group pricing is the same on every route.</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(" + t0.packages.length + ",1fr)", gap: "var(--space-3)" }} role="radiogroup" aria-label="Tour package">
                {t0.packages.map(p => { const on = p.id === pkgId; const from = p.tiers[p.tiers.length - 1].price;
                  return (
                    <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => setPkgId(p.id)} className="tk-card"
                      style={{ textAlign: "start", cursor: "pointer", padding: 0, borderColor: on ? "var(--brand-ink)" : "var(--border-subtle)", borderWidth: on ? 2 : 1, borderStyle: "solid", boxShadow: on ? "var(--elev-2)" : "none", background: on ? "var(--brand-wash)" : "var(--bg-surface)" }}>
                      <div className="tk-card__body" style={{ gap: 6, padding: "var(--space-4)" }}>
                        <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}><strong style={{ fontSize: 15 }}>{p.name}</strong>{on && <Icon name="circle-check-big" size={18} style={{ color: "var(--brand-ink)" }} />}</span>
                        <span className="tk-overline" style={{ color: "var(--gold-700)" }}>{p.tag}</span>
                        <span className="tk-caption">{p.blurb}</span>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}><Icon name="map-pin" size={13} />{p.stops.length} stops · {p.duration}</span>
                      </div>
                    </button>
                  ); })}
              </div>
            </div>
          ) : null}
          <div className="tk-stack" style={{ gap: "var(--space-3)" }}>
            <h2 className="tk-h3">Group pricing</h2>
            <p className="tk-body" style={{ color: "var(--text-muted)", marginTop: -6 }}>{"Per person, in " + currency + ". The bigger your group, the less each traveller pays — the price updates automatically at checkout."}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(" + (t.tiers ? t.tiers.length : 1) + ", 1fr)", gap: "var(--space-4)" }}>
              {(t.tiers || []).map((tier, i) => (
                <div key={i} className="tk-card" style={{ borderColor: i === (t.tiers.length - 1) ? "var(--brand-ink)" : undefined }}><div className="tk-card__body" style={{ padding: "var(--space-5)", gap: 4, alignItems: "flex-start" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontWeight: 600, fontSize: 13 }}><Icon name="users" size={15} />{window.TK_PRICE.band(t.tiers, i)} {window.TK_PRICE.band(t.tiers, i) === "1" ? "traveller" : "travellers"}</span>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 4 }}><span className="tk-num" style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 26, letterSpacing: "-0.02em" }}>{money(tier.price, currency)}</span><span className="tk-caption">/person</span></span>
                  {i === (t.tiers.length - 1) && <span className="tk-badge tk-badge--confirmed">Best value</span>}
                </div></div>
              ))}
            </div>
          </div>
          <div className="tk-stack" style={{ gap: "var(--space-3)" }}>
            <h2 className="tk-h3">Highlights</h2>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {(t.stops ? t.stops.filter(s => !/pickup|drop-?off/i.test(s)).slice(0, 4) : t.highlights).map(h => <li key={h} style={{ display: "flex", gap: 10, fontSize: 15 }}><Icon name="check" size={17} style={{ color: "var(--success-fg)", marginTop: 2 }} />{h}</li>)}
            </ul>
          </div>
          <div>
            <h2 className="tk-h3" style={{ marginBottom: "var(--space-3)" }}>Details</h2>
            <Accordion defaultOpen={["itin"]} items={[
              { id: "itin", title: t.stops ? "Route · stop by stop" : ((t.itinerary && t.itinerary[0] && String(t.itinerary[0][0]).startsWith("Day")) ? "Day by day" : "Itinerary"), content: t.stops ? <ol style={{ margin: 0, paddingInlineStart: 18, display: "grid", gap: 6 }}>{t.stops.map(s => <li key={s}>{s}</li>)}</ol> : <ol style={{ margin: 0, paddingInlineStart: 18, display: "grid", gap: 6 }}>{(t.itinerary || []).map(([time, what]) => <li key={time + what}><strong>{time}</strong> — {what}</li>)}</ol> },
              { id: "inc", title: "What's included", content: <div style={{ display: "grid", gap: 8 }}>{t.included.map(i => <span key={i} style={{ display: "flex", gap: 8 }}><Icon name="check" size={15} style={{ color: "var(--success-fg)" }} />{i}</span>)}{t.excluded.map(i => <span key={i} style={{ display: "flex", gap: 8, color: "var(--text-muted)" }}><Icon name="x" size={15} />{i}</span>)}</div> },
              { id: "meet", title: "Meeting point & getting there", content: <p>Your koach confirms the pickup point when you book — hotel pickup within Accra for day tours, airport pickup at KIA for multi-day trips.</p> },
              { id: "pol", title: "Cancellation policy", content: <p>Free cancellation until 7 days before departure. Between 7 and 2 days, half the total is held. Inside 48 hours the booking is non-refundable.</p> },
            ]} />
          </div>
          <ReviewsSection tour={t0} />
        </div>

        <div style={{ position: "sticky", top: "calc(var(--header-h) + 24px)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div className="tk-card" style={{ boxShadow: "var(--elev-3)" }}><div className="tk-card__body" style={{ gap: "var(--space-4)", padding: "var(--space-5)" }}>
            <div className="tk-stack" style={{ gap: 2 }}>
              {/* TRI-994: headline must map to the tier for the default party size (1 traveller),
                  not the tour's base/6+ ("6 or more") tier. `t.price` is the base (cheapest) tier —
                  showing it here made a solo booker see the biggest-group price. Group pricing table
                  below still lists every tier; the price recomputes at checkout as the count changes. */}
              <Price amount={cvt(window.TK_PRICE.perPerson(t, 1), currency)} currency={currency} size="lg" unit="per person" />
              {t0.packages ? <span className="tk-caption">{t.packageName} package</span> : null}
            </div>
            {hasDepartures ? (<>
              <GroupedDeparturePicker departures={t.departures} value={dep} onChange={setDep} currency={currency} packages={t0.packages} legend="Choose a departure" />
              <Button size="lg" block disabled={!dep} onClick={() => { window.TK_SEL = { tourId: t0.id, apiTourId: t0._apiId, packageId: pkgId, packageName: t.packageName, departureId: dep }; go("checkout"); }}>Reserve my spot</Button>
              <p className="tk-caption" style={{ display: "flex", gap: 6 }}><Icon name="wallet" size={14} />Nothing is charged today. Pay before departure.</p>
            </>) : (
              // TRI-998/TRI-999/TRI-1018: no upcoming departures — replace the picker + "Reserve my spot"
              // with a graceful empty state + a REAL email-interest capture (POST /tours/:id/interest),
              // not a route to the generic contact form. The tour stays discoverable (board default) so
              // travellers can register interest and ops can schedule a departure for them.
              <div className="tk-stack" style={{ gap: "var(--space-3)" }}>
                <EmptyState icon="calendar-days" title="No upcoming departures"
                  body="This experience has no scheduled dates right now. Leave your email and a koach will set a departure up for you." />
                <DateInterestForm tourId={t0._apiId || t0.id} packageId={pkgId} />
                <Button size="lg" block variant="ghost" iconStart="phone" onClick={() => window.open("https://wa.me/233533244042", "_blank")}>Message a koach on WhatsApp</Button>
              </div>
            )}
          </div></div>
          <Alert tone="info" title="Free cancellation">Cancel free until 7 days before departure.</Alert>
        </div>
      </div>
    </div>
  );
}

// Live only when the flag is on AND the booking client is present. Off ⇒ every
// live branch below is dead and the screen renders/behaves as the prototype.
const LIVE_BOOK = () => !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API && window.TK_BOOKING);

function CheckoutWeb({ go, step, setStep, currency = "USD" }) {
  // Resolve the SELECTED tour (TRI-930). The prototype hardcoded tours[0], so in
  // live mode every tour showed the LEAD tour's price at checkout no matter which
  // one the customer chose. TK_SEL.tourId is the tour slug (set on the detail
  // page's "Reserve my spot"); match it against the hydrated catalogue so pricing
  // reflects the real selection. Flag off / no selection ⇒ tours[0] (byte-identical).
  const sel = window.TK_SEL || null;
  const t0 = (sel && window.TK_DATA.tours.find(x => x.id === sel.tourId || x.slug === sel.tourId)) || window.TK_DATA.tours[0];
  const t = (t0.packages && sel && sel.packageId) ? pkgTour(t0, sel.packageId) : t0;
  // Traveller count (TRI-922). The prototype defaulted to 4 AND only exposed the
  // count stepper on step 0 (Departure) — which the user never lands on, since
  // checkout opens on step 1 — so it "assumed 4 travellers" with no way to change
  // it. Live now defaults to 2 and renders a working count control on the
  // travellers step (below); flag off keeps the prototype default 4 (byte-identical).
  // TRI-994: live default is 1 traveller (was 2) — a booking starts as a solo reservation and the
  // count control lets the guest add companions, recomputing the per-person tier price as they go.
  const [pax, setPax] = React.useState(() => LIVE_BOOK() ? 1 : 4);
  const [mode, setMode] = React.useState("later");
  // Live-checkout state (inert when the flag is off; hooks always run so order is stable).
  const live = LIVE_BOOK();
  const [depId, setDepId] = React.useState((window.TK_SEL && window.TK_SEL.departureId) || "d2");
  const [busy, setBusy] = React.useState(false);
  const [payState, setPayState] = React.useState("idle");
  const [err, setErr] = React.useState(null);
  // Promo code (TRI-1013). The prototype rendered an inert <PromoCode state="idle" /> with no onApply and
  // never threaded a code into the booking, so "Apply" did nothing and the charge never moved. Live now
  // prices the code against POST /bookings/quote (a read-only preview — no seat held, no redemption claimed)
  // so the discount shows BEFORE payment, and threads the applied code into POST /bookings, where the
  // backend re-validates + re-applies it authoritatively at charge time. Flag off ⇒ inert (never rendered).
  const [promo, setPromo] = React.useState({ state: "idle", code: "", discount: 0, error: null });
  // Lead traveller prefill from the signed-in account (TRI-920, re-ported in TRI-927).
  // The fields live in state (not the DOM) so they survive the step unmount between
  // Travellers → Review → Payment — previously the values were read from the DOM at
  // pay time, after those inputs had unmounted, and the booking was submitted with an
  // empty lead → POST /bookings 422 (the TRI-926 checkout-blocking bug). Controlled
  // inputs also let the real profile populate once /me resolves. Flag off ⇒ liveAuth
  // is false and the DS prototype defaults render unchanged.
  const liveAuth = live && !!window.TK_AUTH;
  const [leadInfo, setLeadInfo] = React.useState({ name: "", email: "", phone: "", idNumber: "" });
  const leadSeeded = React.useRef(false);
  React.useEffect(() => {
    if (!liveAuth) return undefined;
    let alive = true;
    const seed = (u) => { if (alive && u && !leadSeeded.current) { leadSeeded.current = true; setLeadInfo({ name: u.name || "", email: u.email || "", phone: u.phone || "", idNumber: "" }); } };
    const cached = window.TK_AUTH.cachedMe();
    if (cached && typeof cached === "object") seed(cached);
    else window.TK_AUTH.me().then(seed, () => {});
    return () => { alive = false; };
  }, []);
  const leadField = (k) => (e) => { const v = e && e.target ? e.target.value : ""; setLeadInfo((s) => ({ ...s, [k]: v })); };
  // Selected departure: live picks the chosen one, falling back to a real API
  // departure when the prototype default "d2" doesn't exist. Off ⇒ departures[1].
  const d = (live ? t.departures.find(x => x.id === depId) : null) || t.departures[1] || t.departures[0];
  // Availability ceiling for the count selector: never let the party exceed the
  // seats left on the chosen departure (the backend enforces this too via an
  // atomic guarded reserve + a no-oversell CHECK, but keep the UI honest). Falls
  // back to 12 when a departure exposes no spotsLeft hint.
  const paxMax = (d && d.spotsLeft && d.spotsLeft > 0) ? d.spotsLeft : 12;
  React.useEffect(() => {
    if (live && pax > paxMax) setPax(paxMax);
  }, [live, paxMax, pax]);
  // Live pricing mirrors the backend exactly (TRI-930): booking.ts charges the
  // selected departure's price × pax (unitPriceMinor returns the departure override
  // ahead of any group tier), so surface that same number here — otherwise the
  // checkout would display the tier step-function price while Paystack charged the
  // flat departure price. Falls back to the tier function when a departure carries
  // no explicit price. Flag off ⇒ prototype tier step-function (byte-identical).
  const depPriced = live && d && d.price != null;
  const unit = depPriced ? d.price : window.TK_PRICE.perPerson(t, pax);
  const total = unit * pax;
  const nextTier = depPriced ? null : window.TK_PRICE.nextTier(t, pax);

  // Promo discount + net total (TRI-1013). Amounts are USD (currency of record), matching the backend quote;
  // cvt()/money() convert for display. Backend re-applies the code at charge time, so the charge is always
  // authoritative — this preview just keeps the UI honest before the customer pays.
  const promoTourSlug = (window.TK_SEL && window.TK_SEL.tourId) || t0.id;
  async function applyPromo(rawCode) {
    const code = String(rawCode || "").trim().toUpperCase();
    if (!code) { setPromo({ state: "invalid", code: "", discount: 0, error: "Enter a promo code." }); return; }
    setPromo((p) => ({ ...p, state: "loading", error: null }));
    try {
      const q = await window.TK_BOOKING.quote({ tourSlug: promoTourSlug, departureId: d && d.id, partySize: pax, promoCode: code });
      const disc = (q && q.promo && q.promo.discountUsd) || (q && q.discountUsd) || 0;
      if (!(disc > 0)) { setPromo({ state: "invalid", code, discount: 0, error: "That code doesn't reduce this booking." }); return; }
      setPromo({ state: "applied", code: (q.promo && q.promo.code) || code, discount: disc, error: null });
    } catch (e) {
      setPromo({ state: "invalid", code, discount: 0, error: (e && e.message) || "That code is not valid or has expired." });
    }
  }
  const removePromo = () => setPromo({ state: "idle", code: "", discount: 0, error: null });
  // Re-price an applied code when the party size or departure changes so the shown discount never goes stale.
  const appliedCode = promo.state === "applied" ? promo.code : null;
  React.useEffect(() => {
    if (!live || !appliedCode) return;
    applyPromo(appliedCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pax, depId]);
  const discountUsd = (live && promo.state === "applied") ? Math.min(promo.discount, total) : 0;
  const netTotal = Math.max(0, total - discountUsd);

  const readVal = (id) => { const el = document.getElementById(id); return el && typeof el.value === "string" ? el.value.trim() : ""; };
  const buildTravellers = (lead) => {
    const out = [{ name: lead.name || "Lead traveller", email: lead.email || undefined, phone: lead.phone || undefined, idNumber: lead.idNumber || undefined, lead: true }];
    // Read exactly pax-1 companion fields (w-t2 … w-t{pax}); the fields are
    // rendered dynamically from pax now (TRI-922) rather than a fixed 3.
    for (let i = 1; i < pax; i++) out.push({ name: readVal("w-t" + (i + 1)) || ("Traveller " + (i + 1)), lead: false });
    return out;
  };
  async function onPay() {
    if (busy) return;
    setErr(null); setBusy(true); setPayState("processing");
    try {
      const lead = liveAuth
        ? { name: leadInfo.name.trim(), email: leadInfo.email.trim(), phone: leadInfo.phone.trim(), idNumber: leadInfo.idNumber.trim() }
        : { name: readVal("w-name"), email: readVal("w-email"), phone: readVal("w-phone"), idNumber: readVal("w-id") };
      const bk = await window.TK_BOOKING.create({
        // Backend (TRI-866, deployed) resolves the tour by SLUG; keep the uuid
        // too for tolerance. t0.id / TK_SEL.tourId is the slug; apiTourId the uuid.
        tourSlug: (window.TK_SEL && window.TK_SEL.tourId) || t0.id,
        tourId: (window.TK_SEL && window.TK_SEL.apiTourId) || t0._apiId || t0.id,
        departureId: d && d.id,
        packageId: (t0.packages && sel) ? sel.packageId : undefined,
        partySize: pax,
        travellers: buildTravellers(lead),
        lead: lead,
        specialRequests: readVal("w-notes") || undefined,
        // TRI-1013: thread the applied promo code into the booking so the discount is actually charged.
        // The backend re-validates + re-applies it against the live subtotal (authoritative price of record).
        promoCode: (promo.state === "applied" && promo.code) ? promo.code : undefined,
        agreedTerms: true,
        payMode: mode,
      });
      if (!bk || !bk.ref) throw new Error("We couldn't create your booking. Please try again.");
      window.TK_BOOKING.saveCtx(bk.ref, {
        ref: bk.ref, tourTitle: t.title, packageName: t0.packages ? t.packageName : null,
        departureLabel: d ? (d.date + (d.time ? ", " + d.time : "")) : "",
        partySize: pax, totalUsd: bk.totalUsd != null ? bk.totalUsd : total, email: lead.email, payMode: mode,
      });
      if (mode === "now") {
        const init = await window.TK_BOOKING.initPayment(bk.ref, { callbackUrl: window.location.origin + "/confirm?ref=" + encodeURIComponent(bk.ref) });
        if (!window.TK_BOOKING.redirect(init)) throw new Error("Payment could not be started. Please try again.");
        return; // full-page redirect to Paystack — SPA unloads here
      }
      go("confirm");
      try { window.history.replaceState(window.history.state, "", "/confirm?ref=" + encodeURIComponent(bk.ref)); } catch (_) {}
    } catch (e) {
      setPayState("failed");
      setErr((e && e.message) || "Something went wrong. Please try again.");
      setBusy(false);
    }
  }
  return (
    <div className="tk-container" style={{ paddingBlock: "var(--space-8) var(--space-12)", maxWidth: 1000, display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      <CheckoutStepper steps={["Departure", "Travellers", "Review", "Payment", "Done"]} current={step} onStepClick={setStep} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "var(--space-10)", alignItems: "start" }}>
        <div className="tk-stack" style={{ gap: "var(--space-5)" }}>
          {step === 0 && <>
            <h1 className="tk-h2">When would you like to go?</h1>
            <DeparturePicker departures={cvtDeps(t.departures, currency)} value={live ? depId : "d2"} onChange={live ? setDepId : () => {}} currency={currency} />
            <div className="tk-row" style={{ justifyContent: "space-between", maxWidth: 360 }}>
              <span className="tk-label">Travellers</span><NumberStepper id="pax" value={pax} max={d.spotsLeft} onChange={setPax} />
            </div>
          </>}
          {step === 1 && <>
            <h1 className="tk-h2">Who is travelling?</h1>
            {live && <div className="tk-card"><div className="tk-card__body" style={{ gap: "var(--space-3)", padding: "var(--space-5)" }}>
              {/* Traveller-count selector (TRI-922): the working control the board
                  reported missing. min 1, max = seats left on the chosen departure;
                  changing it recomputes the price below and drives partySize. */}
              <span className="tk-overline">How many travellers?</span>
              <div className="tk-row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "var(--space-3)" }}>
                <span className="tk-body-sm tk-muted">{d && d.spotsLeft != null ? (d.spotsLeft + " spot" + (d.spotsLeft === 1 ? "" : "s") + " left on this departure") : "Choose your party size"}</span>
                <NumberStepper id="pax-travellers" value={pax} min={1} max={paxMax} onChange={setPax} />
              </div>
            </div></div>}
            <div className="tk-card"><div className="tk-card__body" style={{ gap: "var(--space-4)", padding: "var(--space-5)" }}>
              <span className="tk-overline">Lead traveller</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
                <FormField id="w-name" label="Full name" required>{liveAuth ? <Input value={leadInfo.name} onChange={leadField("name")} /> : <Input defaultValue="Ama Mensah" />}</FormField>
                <FormField id="w-email" label="Email address" required>{liveAuth ? <Input value={leadInfo.email} onChange={leadField("email")} /> : <Input defaultValue="ama@example.com" />}</FormField>
                <FormField id="w-phone" label="Phone number" required>{liveAuth ? <Input value={leadInfo.phone} onChange={leadField("phone")} /> : <Input defaultValue="024 555 0142" />}</FormField>
                <FormField id="w-id" label="ID number" optional>{liveAuth ? <Input value={leadInfo.idNumber} onChange={leadField("idNumber")} placeholder="Ghana Card or passport" /> : <Input placeholder="Ghana Card or passport" />}</FormField>
              </div>
            </div></div>
            {live
              ? (pax > 1 && <div className="tk-card"><div className="tk-card__body" style={{ gap: "var(--space-4)", padding: "var(--space-5)" }}>
                  {/* Exactly pax-1 companion fields, matching the chosen count (TRI-922). */}
                  <span className="tk-overline">{pax === 2 ? "Traveller 2" : "Travellers 2–" + pax}</span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
                    {Array.from({ length: pax - 1 }, (_, i) => (
                      <FormField key={i} id={"w-t" + (i + 2)} label={"Traveller " + (i + 2)} required><Input placeholder="Full name" /></FormField>
                    ))}
                  </div>
                </div></div>)
              : <div className="tk-card"><div className="tk-card__body" style={{ gap: "var(--space-4)", padding: "var(--space-5)" }}>
                  <span className="tk-overline">Travellers 2–4</span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
                    <FormField id="w-t2" label="Traveller 2" required><Input placeholder="Full name" /></FormField>
                    <FormField id="w-t3" label="Traveller 3" required error="Enter a name for traveller 3"><Input /></FormField>
                    <FormField id="w-t4" label="Traveller 4" required><Input placeholder="Full name" /></FormField>
                  </div>
                </div></div>}
            <FormField id="w-notes" label="Special requests" optional><Textarea rows={3} placeholder="Dietary needs, mobility, celebrations…" /></FormField>
          </>}
          {step === 2 && <>
            <h1 className="tk-h2">Check everything over</h1>
            <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-5)" }}>
              <strong className="tk-h4">{t.title}</strong>
              {t0.packages ? <div className="tk-summary__line"><span>Package</span><span>{t.packageName}</span></div> : null}
              <div className="tk-summary__line"><span>Departure</span><span>{d.date}, {d.time}</span></div>
              <div className="tk-summary__line"><span>Travellers</span><span>{pax}</span></div>
              <div className="tk-summary__line"><span>Lead traveller</span><span>{liveAuth ? ((leadInfo.name || "—") + " · " + (leadInfo.email || "—")) : "Ama Mensah · ama@example.com"}</span></div>
            </div></div>
            <Checkbox id="w-agree" label="I agree to the booking terms and cancellation policy" />
          </>}
          {step === 3 && <>
            <h1 className="tk-h2">How would you like to pay?</h1>
            <PaymentForm mode={mode} onModeChange={setMode} payNowEnabled amountLabel={money(netTotal, currency)} {...(live ? { state: payState } : {})} />
            {live && err && <Alert tone="error" title="We couldn't complete that">{err}</Alert>}
          </>}
          <div className="tk-row" style={{ gap: 12, justifyContent: "space-between", paddingTop: "var(--space-4)", borderTop: "1px solid var(--border-subtle)" }}>
            <Button variant="secondary" iconStart="arrow-left" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>Back</Button>
            <Button size="lg" disabled={live ? busy : undefined} iconEnd={step === 3 && mode === "now" ? "external-link" : undefined} onClick={() => { if (step !== 3) { setStep(step + 1); return; } if (live) { onPay(); return; } window.__payMode = mode; go("confirm"); }}>{live && busy ? "Processing…" : (step === 3 ? (mode === "now" ? "Pay " + money(netTotal, currency) + " with Paystack" : "Confirm booking") : "Continue")}</Button>
          </div>
        </div>
        <OrderSummary sticky lines={[{ label: money(unit, currency) + "/person × " + pax + " travellers", amount: cvt(total, currency) }]} total={cvt(netTotal, currency)} currency={currency} payMode={mode}
          discount={discountUsd > 0 ? { label: "Promo " + promo.code, amount: cvt(discountUsd, currency) } : undefined}>
          {t0.packages ? <p className="tk-help" style={{ display: "flex", gap: 6 }}><Icon name="ticket" size={14} />{t.packageName} package</p> : null}
          {nextTier && <p className="tk-help" style={{ display: "flex", gap: 6, color: "var(--success-fg)" }}><Icon name="users" size={14} />Add {nextTier.minPax - pax} more and everyone pays {money(nextTier.price, currency)}/person.</p>}
          {live
            ? <PromoCode state={promo.state} code={promo.code} error={promo.error}
                discountLabel={promo.state === "applied" ? ("−" + money(promo.discount, currency)) : undefined}
                onApply={applyPromo} onRemove={removePromo} />
            : <PromoCode state="idle" />}
        </OrderSummary>
      </div>
    </div>
  );
}

function BookingsWeb({ go, currency = "USD" }) {
  const [tab, setTab] = React.useState("all");
  const [reviewFor, setReviewFor] = React.useState(null);
  // Live "my bookings" (TRI-882): GET /me/bookings for the signed-in account
  // (guest bookings are auto-linked at signup/login). Flag off → the DS fixtures.
  const live = LIVE_AUTH();
  const [rows, setRows] = React.useState(null);
  const [loaded, setLoaded] = React.useState(!live);
  React.useEffect(() => {
    if (!live) return;
    let alive = true;
    window.TK_AUTH.me().then((u) => {
      if (!alive) return undefined;
      if (!u) { go("login"); return undefined; }
      return window.TK_AUTH.myBookings().then((bs) => { if (alive) { setRows(bs); setLoaded(true); } });
    }).catch(() => { if (alive) { setRows([]); setLoaded(true); } });
    return () => { alive = false; };
  }, []);
  const dsStatus = (s) => (s === "confirmed" || s === "completed") ? "confirmed" : (s === "cancelled" || s === "expired" ? "cancelled" : "pending");
  const paxLabel = (n) => (Number(n) || 0) + " traveller" + (Number(n) === 1 ? "" : "s");
  if (live) {
    if (!loaded) return (
      <AccountShell current="bookings" go={go} title="Your bookings">
        <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-8)", alignItems: "center" }}><span className="tk-body-sm tk-muted">Loading your bookings…</span></div></div>
      </AccountShell>
    );
    const bookings = (rows || []).map(b => ({ ...b, ds: dsStatus(b.status) }));
    const count = (st) => bookings.filter(b => b.ds === st).length;
    const pendingN = count("pending");
    const shown = tab === "all" ? bookings : bookings.filter(b => b.ds === tab);
    const tourFor = (b) => (window.TK_DATA.tours.find(t => t.title === b.tourTitle) || { id: b.tourSlug || b.ref, title: b.tourTitle });
    const imgFor = (b) => { const t = window.TK_DATA.tours.find(t => t.slug === b.tourSlug || t.title === b.tourTitle); return t ? t.image : undefined; };
    return (
      <AccountShell current="bookings" go={go} title="Your bookings">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "all", label: "All", count: bookings.length }, { id: "pending", label: "Pending", count: pendingN }, { id: "confirmed", label: "Confirmed", count: count("confirmed") }, { id: "cancelled", label: "Cancelled", count: count("cancelled") }]} />
        {pendingN > 0 && <Alert tone="warning" title={pendingN === 1 ? "One booking is waiting for payment" : pendingN + " bookings are waiting for payment"} action={<Button variant="link" size="sm" onClick={() => window.tkToast("Pay by card or mobile money — instructions are in your confirmation email")}>See how to pay</Button>}>Pay before your departure to lock in your spots.</Alert>}
        {bookings.length === 0
          ? <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-8)", alignItems: "center", textAlign: "center", gap: 10 }}><span className="tk-body-sm tk-muted">No bookings yet. When you book a tour it'll show up here.</span><Button variant="secondary" size="sm" onClick={() => go("browse")}>Browse tours</Button></div></div>
          : <div style={{ display: "grid", gap: 12 }}>
            {shown.map(b => {
              const rv = b.review || { state: "none" };
              return (
              <div key={b.ref} style={{ display: "grid", gap: 8 }}>
                <BookingRow reference={b.ref} title={b.tourTitle} date={b.departureLabel || b.date} travellers={paxLabel(b.partySize)} total={cvt(b.total, currency)} currency={currency} status={b.ds} image={imgFor(b)} onClick={() => go("booking", b.ref)} />
                {rv.state === "open" && <div style={{ display: "flex", justifyContent: "flex-end" }}><Button variant="secondary" size="sm" iconStart="pencil" onClick={() => setReviewFor({ tour: tourFor(b), token: rv.token, ref: b.ref })}>Leave a review</Button></div>}
                {rv.state === "submitted" && <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, color: "var(--success-fg)" }}><Icon name="circle-check-big" size={15} /><span className="tk-caption">Review submitted — thanks!</span></div>}
              </div>
              );
            })}
          </div>}
        {reviewFor && <ReviewModal tour={reviewFor.tour} token={reviewFor.token} onClose={() => setReviewFor(null)}
          onSubmitted={() => setRows(prev => (prev || []).map(x => x.ref === reviewFor.ref ? { ...x, review: { state: "submitted", token: "" } } : x))} />}
      </AccountShell>
    );
  }
  const all = window.TK_DATA.bookings;
  const tourFor = (b) => (window.TK_DATA.tours.find(t => t.title === b.tour) || { id: b.ref, title: b.tour });
  return (
    <AccountShell current="bookings" go={go} title="Your bookings">
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "all", label: "All", count: 3 }, { id: "pending", label: "Pending", count: 1 }, { id: "confirmed", label: "Confirmed", count: 1 }, { id: "cancelled", label: "Cancelled", count: 1 }]} />
      <Alert tone="warning" title="One booking is waiting for payment" action={<Button variant="link" size="sm" onClick={() => window.tkToast("Pay by card or mobile money — instructions are in your confirmation email")}>See how to pay</Button>}>TK-4821 is held until 7 Sep.</Alert>
      <div style={{ display: "grid", gap: 12 }}>
        {(tab === "all" ? all : all.filter(b => b.status === tab)).map(b => (
          <div key={b.ref} style={{ display: "grid", gap: 8 }}>
            <BookingRow reference={b.ref} title={b.tour} date={b.date} travellers={b.travellers} total={cvt(b.total, currency)} currency={currency} status={b.status} onClick={() => go("bookings")} />
            {b.status === "confirmed" && <div style={{ display: "flex", justifyContent: "flex-end" }}><Button variant="secondary" size="sm" iconStart="pencil" onClick={() => setReviewFor(tourFor(b))}>Leave a review</Button></div>}
          </div>
        ))}
      </div>
      {reviewFor && <ReviewModal tour={reviewFor} onClose={() => setReviewFor(null)} />}
    </AccountShell>
  );
}

// Live confirmation: reconciles the booking after the Paystack redirect. Reads
// the booking ref (+ any returned txn reference) from the URL / sessionStorage,
// verifies and polls until the payment reaches a terminal state, and renders the
// real booking through the same DS ConfirmationPanel. Only reached under the flag.
function ConfirmWebLive({ go, currency = "USD" }) {
  const { ConfirmationPanel } = NS;
  const params = new URLSearchParams(window.location.search || "");
  const ref = params.get("ref") || window.TK_BOOKING.lastRef();
  const reference = params.get("reference") || params.get("trxref") || "";
  const ctx = window.TK_BOOKING.loadCtx(ref) || {};
  const [bk, setBk] = React.useState(null);
  const [phase, setPhase] = React.useState(ref ? "loading" : "pending");
  React.useEffect(() => {
    let alive = true;
    if (!ref) return;
    const settle = (b) => { if (!alive) return; setBk(b); setPhase(window.TK_BOOKING.isPaid(b) ? "paid" : window.TK_BOOKING.isFailed(b) ? "failed" : "pending"); };
    const p = reference ? window.TK_BOOKING.settle(ref, reference) : window.TK_BOOKING.get(ref);
    p.then(settle, () => { if (alive) setPhase("pending"); });
    return () => { alive = false; };
  }, []);
  const loading = phase === "loading", paid = phase === "paid", failed = phase === "failed";
  const tourTitle = (bk && bk.tourTitle) || ctx.tourTitle || "";
  const departureLabel = (bk && bk.departureLabel) || ctx.departureLabel || "";
  const partySize = (bk && bk.partySize) || ctx.partySize || "";
  const totalUsd = (bk && bk.totalUsd != null) ? bk.totalUsd : ctx.totalUsd;
  const totalStr = totalUsd != null ? money(totalUsd, currency) : "";
  const email = (bk && bk.email) || ctx.email || "you";
  const title = loading ? "Finalising your booking…" : paid ? "You're all set" : failed ? "Payment wasn't completed" : "Your spot is reserved";
  const subtitle = loading
    ? "Confirming your payment with Paystack…"
    : (paid ? "We emailed your receipt to " : failed ? "Nothing was charged and your spots are still held. Details sent to " : "We emailed the details to ")
      + email + (tourTitle ? ". " + tourTitle + (departureLabel ? ", " + departureLabel : "") + "." : ".");
  return (
    <div className="tk-container" style={{ paddingBlock: "var(--space-12)", maxWidth: 720 }}>
      <ConfirmationPanel reference={ref || ""} status={paid ? "confirmed" : "pending"} title={title} subtitle={subtitle}
        actions={<>
          {failed
            ? <Button size="lg" onClick={() => go("checkout")}>Try paying again</Button>
            : <Button size="lg" onClick={() => go("bookings")}>View in my bookings</Button>}
          {/* Only offer a receipt/download when we actually have a booking ref;
              with no ref there's nothing to download, so drop the dead stub. */}
          {ref
            ? <Button variant="secondary" iconStart="download" onClick={() => go("booking", ref)}>View &amp; download receipt</Button>
            : null}
        </>}>
        <div className="tk-card" style={{ width: "100%", textAlign: "start" }}><div className="tk-card__body" style={{ padding: "var(--space-5)" }}>
          <div className="tk-summary__line"><span>Tour</span><span>{tourTitle || "—"}</span></div>
          <div className="tk-summary__line"><span>Departure</span><span>{departureLabel || "—"}</span></div>
          <div className="tk-summary__line"><span>Travellers</span><span>{partySize || "—"}</span></div>
          <div className="tk-summary__total"><span>{paid ? "Total paid" : "Total due"}</span><span className="tk-num" style={{ fontWeight: 800 }}>{totalStr || "—"}</span></div>
        </div></div>
        {loading
          ? <Alert tone="info" title="Just a moment">We're checking your payment status with Paystack.</Alert>
          : paid
          ? <Alert tone="success" title="Payment received">We charged <strong>{totalStr}</strong> via Paystack. Your spots are confirmed — no further action needed.</Alert>
          : failed
          ? <Alert tone="warning" title="Payment not completed">Your payment didn't go through and nothing was charged. Your spots are still held under <strong>{ref}</strong> — try again, or switch to pay later.</Alert>
          : <Alert tone="warning" title="How to pay">Your koach will email payment options (bank transfer, mobile money or card), quoting <strong>{ref}</strong>. Pay at least 5 days before departure to lock in your spots.</Alert>}
      </ConfirmationPanel>
    </div>
  );
}

function ConfirmWeb({ go, currency = "USD" }) {
  if (LIVE_BOOK()) return <ConfirmWebLive go={go} currency={currency} />;
  const { ConfirmationPanel } = NS;
  const paid = window.__payMode === "now";
  const totalStr = money(300, currency);
  return (
    <div className="tk-container" style={{ paddingBlock: "var(--space-12)", maxWidth: 720 }}>
      <ConfirmationPanel reference="TK-4821" status={paid ? "confirmed" : "pending"} title={paid ? "You're all set" : "Your spot is reserved"}
        subtitle={"We emailed " + (paid ? "your receipt" : "the details") + " to ama@example.com. Accra City Tour, Sat 22 Aug 2026."}
        actions={<><Button size="lg" onClick={() => go("bookings")}>View in my bookings</Button><Button variant="secondary" iconStart="download" onClick={() => window.tkToast("Preparing your booking PDF…")}>Download details</Button></>}>
        <div className="tk-card" style={{ width: "100%", textAlign: "start" }}><div className="tk-card__body" style={{ padding: "var(--space-5)" }}>
          <div className="tk-summary__line"><span>Tour</span><span>Accra City Tour</span></div>
          <div className="tk-summary__line"><span>Departure</span><span>Sat 22 Aug 2026, 09:00</span></div>
          <div className="tk-summary__line"><span>Travellers</span><span>4</span></div>
          <div className="tk-summary__total"><span>{paid ? "Total paid" : "Total due"}</span><span className="tk-num" style={{ fontWeight: 800 }}>{totalStr}</span></div>
        </div></div>
        {paid
          ? <Alert tone="success" title="Payment received">We charged your card <strong>{totalStr}</strong> via Paystack. Your spots are confirmed — no further action needed.</Alert>
          : <Alert tone="warning" title="How to pay">Your koach will email payment options (bank transfer, mobile money or card), quoting <strong>TK-4821</strong>. Pay at least 5 days before departure to lock in your spots.</Alert>}
      </ConfirmationPanel>
    </div>
  );
}
// ── Booking detail / confirmation view + downloadable receipt (TRI-938) ───────
// A reopenable, ref-addressable view of a single booking (/booking/:ref), reached
// from /me/bookings (row click) and from the post-payment /confirm page. Renders
// the full confirmed-booking detail and a "Download receipt" action that opens a
// self-contained, print-to-PDF HTML receipt — no third-party libraries. Live only
// (needs TK_BOOKING); the fixture prototype never links here.

// Money formatters for the standalone receipt document (which can't reach the DS).
function tkFmtUsd(n) { return "$" + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function tkFmtGhs(n) { return "GH₵" + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function tkFmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch (_) { return String(iso); }
}
function tkEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
  });
}

// Build a self-contained receipt HTML document from the server booking DTO (the
// full `.raw` payload from GET /bookings/:ref). All figures come straight from the
// API so the printed receipt matches API/DB (amount charged == Paystack GHS).
function tkReceiptHtml(d) {
  d = d || {};
  var q = d.quote || {};
  var pay = d.payment || {};
  var co = d.company || {};
  var dep = d.departure || {};
  var tour = d.tour || {};
  var travellers = Array.isArray(d.travellers) ? d.travellers : [];
  var lead = travellers.find(function (t) { return t.isLead; }) || travellers[0] || {};
  var paid = pay && (pay.status === "paid" || d.status === "confirmed" || d.status === "completed");
  var depLabel = dep.date ? (dep.date + (dep.time ? ", " + dep.time : "")) : "—";
  var rows = [];
  rows.push(["Booking reference", d.ref || "—"]);
  rows.push(["Status", (d.status || "—").toUpperCase()]);
  rows.push(["Booked on", tkFmtDate(d.createdAt)]);
  rows.push(["Tour", tour.title || "—"]);
  rows.push(["Departure", depLabel]);
  rows.push(["Travellers", String(q.partySize || travellers.length || "—")]);
  rows.push(["Lead traveller", lead.name || "—"]);
  rows.push(["Contact email", lead.email || "—"]);

  var lineRows = "";
  lineRows += "<tr><td>" + tkEsc(tour.title || "Tour") + " × " + tkEsc(q.partySize || 1) +
    " @ " + tkEsc(tkFmtUsd(q.unitPrice)) + "</td><td class=\"amt\">" + tkEsc(tkFmtUsd(q.subtotal)) + "</td></tr>";
  if (q.discount) {
    var promoLbl = q.promo && q.promo.code ? "Promo " + q.promo.code : "Discount";
    lineRows += "<tr><td>" + tkEsc(promoLbl) + "</td><td class=\"amt\">−" + tkEsc(tkFmtUsd(q.discount)) + "</td></tr>";
  }

  var infoRows = rows.map(function (r) {
    return "<tr><td class=\"k\">" + tkEsc(r[0]) + "</td><td class=\"v\">" + tkEsc(r[1]) + "</td></tr>";
  }).join("");

  var fxLine = (pay.ghs != null && pay.fxRate)
    ? "Charged in GHS at 1 USD = " + tkFmtGhs(pay.fxRate) + " via Paystack."
    : "Charged in GHS via Paystack.";
  var payBlock = pay && pay.reference ? (
    "<table class=\"info\">" +
    "<tr><td class=\"k\">Payment reference</td><td class=\"v\">" + tkEsc(pay.reference) + "</td></tr>" +
    "<tr><td class=\"k\">Payment status</td><td class=\"v\">" + tkEsc((pay.status || "—").toUpperCase()) + "</td></tr>" +
    (pay.method ? "<tr><td class=\"k\">Method</td><td class=\"v\">" + tkEsc(pay.method) + "</td></tr>" : "") +
    "<tr><td class=\"k\">Payment date</td><td class=\"v\">" + tkEsc(tkFmtDate(pay.at)) + "</td></tr>" +
    (pay.ghs != null ? "<tr><td class=\"k\">Amount charged</td><td class=\"v\"><strong>" + tkEsc(tkFmtGhs(pay.ghs)) + "</strong></td></tr>" : "") +
    "</table>" + "<p class=\"fx\">" + tkEsc(fxLine) + "</p>"
  ) : "<p class=\"fx\">No payment has been recorded for this booking yet.</p>";

  return "<!doctype html><html><head><meta charset=\"utf-8\"><title>Receipt " + tkEsc(d.ref || "") + "</title>" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
    "<style>" +
    "*{box-sizing:border-box}" +
    "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1E1C1A;margin:0;background:#F5F3F0;padding:24px}" +
    ".sheet{max-width:640px;margin:0 auto;background:#fff;border:1px solid #E7E2DB;border-radius:16px;overflow:hidden}" +
    ".head{display:flex;justify-content:space-between;align-items:flex-start;padding:28px 32px;border-bottom:2px solid #1E1C1A}" +
    ".brand{font-size:22px;font-weight:800;letter-spacing:-.02em}" +
    ".brand small{display:block;font-size:12px;font-weight:600;color:#8A8378;letter-spacing:0;margin-top:4px}" +
    ".doc{text-align:right}.doc .t{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8A8378}" +
    ".doc .r{font-size:16px;font-weight:800;margin-top:4px}" +
    ".body{padding:24px 32px}" +
    "h2{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8A8378;margin:24px 0 10px}" +
    "table{width:100%;border-collapse:collapse}" +
    "table.info td{padding:6px 0;font-size:14px;vertical-align:top}" +
    "table.info td.k{color:#8A8378;width:42%}table.info td.v{text-align:right;font-weight:600}" +
    "table.lines td{padding:9px 0;font-size:14px;border-bottom:1px solid #F0ECE6}" +
    "table.lines td.amt{text-align:right;font-weight:600;white-space:nowrap}" +
    ".total{display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:14px;border-top:2px solid #1E1C1A}" +
    ".total .l{font-size:15px;font-weight:700}.total .a{font-size:22px;font-weight:800}" +
    ".fx{font-size:12px;color:#8A8378;margin:10px 0 0}" +
    ".foot{padding:20px 32px 28px;border-top:1px solid #E7E2DB;font-size:12px;color:#8A8378;line-height:1.6}" +
    ".foot strong{color:#1E1C1A}" +
    "@media print{body{background:#fff;padding:0}.sheet{border:none;border-radius:0;max-width:none}.noprint{display:none}}" +
    "</style></head><body>" +
    "<div class=\"sheet\">" +
    "<div class=\"head\"><div class=\"brand\">" + tkEsc(co.name || "TripKoach") + "<small>" + tkEsc(co.location || "") + "</small></div>" +
    "<div class=\"doc\"><div class=\"t\">Receipt</div><div class=\"r\">" + tkEsc(d.ref || "") + "</div></div></div>" +
    "<div class=\"body\">" +
    "<h2>Booking details</h2><table class=\"info\">" + infoRows + "</table>" +
    "<h2>Charges</h2><table class=\"lines\">" + lineRows + "</table>" +
    "<div class=\"total\"><span class=\"l\">" + (paid ? "Total paid" : "Total due") + "</span><span class=\"a\">" + tkEsc(tkFmtUsd(q.total)) + "</span></div>" +
    "<h2>Payment</h2>" + payBlock +
    "</div>" +
    "<div class=\"foot\"><strong>" + tkEsc(co.legalName || co.name || "TripKoach") + "</strong> · " + tkEsc(co.location || "") +
    (co.email ? " · " + tkEsc(co.email) : "") + (co.website ? " · " + tkEsc(co.website) : "") +
    "<br>" + tkEsc(co.note || "") +
    "<br>Receipt generated " + tkEsc(tkFmtDate(new Date().toISOString())) + ". Thank you for travelling with " + tkEsc(co.name || "TripKoach") + "." +
    "</div>" +
    "</div>" +
    "<div class=\"noprint\" style=\"max-width:640px;margin:16px auto 0;text-align:center\">" +
    "<button onclick=\"window.print()\" style=\"font:600 14px/1 inherit;background:#1E1C1A;color:#fff;border:0;border-radius:10px;padding:12px 20px;cursor:pointer\">Print / Save as PDF</button></div>" +
    "</body></html>";
}

// Open the receipt in a new window/tab and offer print → save-as-PDF. Returns
// false if a popup blocker prevented it (caller falls back to a toast).
function tkOpenReceipt(d) {
  var w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(tkReceiptHtml(d));
  w.document.close();
  return true;
}

function BookingDetailWeb({ go, currency = "USD", bref }) {
  const ref = bref || (new URLSearchParams(window.location.search || "").get("ref")) || (window.TK_BOOKING && window.TK_BOOKING.lastRef && window.TK_BOOKING.lastRef()) || "";
  const [dto, setDto] = React.useState(null);
  const [phase, setPhase] = React.useState(ref ? "loading" : "empty");
  React.useEffect(() => {
    if (!ref || !window.TK_BOOKING) return;
    let alive = true;
    window.TK_BOOKING.get(ref).then(
      (bk) => { if (!alive) return; const raw = (bk && bk.raw) || null; setDto(raw); setPhase(raw ? "ready" : "missing"); },
      () => { if (alive) setPhase("missing"); }
    );
    return () => { alive = false; };
  }, [ref]);

  const download = () => {
    if (!dto) return;
    if (!tkOpenReceipt(dto)) window.tkToast("Please allow pop-ups to open your receipt");
  };

  // Standalone page (NOT the auth-gated AccountShell): GET /bookings/:ref is
  // public, and this view is reachable from the post-payment /confirm page where
  // a guest-checkout customer isn't signed in — bouncing them to login would
  // strand them from their own receipt.
  const Wrap = ({ children }) => (
    <div className="tk-container" style={{ paddingBlock: "var(--space-8) var(--space-12)", maxWidth: 720 }}>
      <div className="tk-stack" style={{ gap: "var(--space-5)" }}>
        <h1 className="tk-h2">Your booking</h1>
        {children}
      </div>
    </div>
  );
  if (phase === "loading") return (
    <Wrap>
      <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-8)", alignItems: "center" }}><span className="tk-body-sm tk-muted">Loading your booking…</span></div></div>
    </Wrap>
  );
  if (phase !== "ready" || !dto) return (
    <Wrap>
      <EmptyState title="Booking not found" description={ref ? ("We couldn't find booking " + ref + ".") : "No booking reference was provided."}
        action={<Button variant="secondary" onClick={() => go("bookings")}>Back to my bookings</Button>} />
    </Wrap>
  );

  const q = dto.quote || {};
  const dep = dto.departure || {};
  const pay = dto.payment || {};
  const travellers = Array.isArray(dto.travellers) ? dto.travellers : [];
  const lead = travellers.find((t) => t.isLead) || travellers[0] || {};
  const paid = pay && (pay.status === "paid" || dto.status === "confirmed" || dto.status === "completed");
  const depLabel = dep.date ? (dep.date + (dep.time ? ", " + dep.time : "")) : "—";
  const line = (label, value, opts) => (
    <div className="tk-summary__line" style={opts && opts.strong ? { fontWeight: 700 } : undefined}><span>{label}</span><span>{value}</span></div>
  );

  return (
    <Wrap>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Button variant="ghost" size="sm" iconStart="arrow-left" onClick={() => go("bookings")}>My bookings</Button>
          <StatusBadge status={paid ? "confirmed" : (dto.status === "cancelled" || dto.status === "expired" ? "cancelled" : "pending")} />
        </div>
        <Button variant="secondary" size="sm" iconStart="download" onClick={download}>Download receipt</Button>
      </div>

      {paid
        ? <Alert tone="success" title="Booking confirmed">Payment received — your spots are locked in. Download your receipt for your records.</Alert>
        : (dto.status === "cancelled" || dto.status === "expired")
        ? <Alert tone="warning" title="This booking is no longer active">Reference {dto.ref} is {dto.status}.</Alert>
        : <Alert tone="warning" title="Payment pending">Your spots are held under {dto.ref}. Complete payment to confirm.</Alert>}

      <div className="tk-card" style={{ textAlign: "start" }}><div className="tk-card__body" style={{ padding: "var(--space-5)" }}>
        <h3 className="tk-h6" style={{ margin: "0 0 10px" }}>{dto.tour && dto.tour.title}</h3>
        {line("Booking reference", dto.ref)}
        {line("Booked on", tkFmtDate(dto.createdAt))}
        {line("Departure", depLabel)}
        {line("Travellers", String(q.partySize || travellers.length || "—"))}
        {line("Lead traveller", lead.name || "—")}
        {line("Contact email", lead.email || "—")}
      </div></div>

      <div className="tk-card" style={{ textAlign: "start" }}><div className="tk-card__body" style={{ padding: "var(--space-5)" }}>
        <h3 className="tk-h6" style={{ margin: "0 0 10px" }}>Price breakdown</h3>
        {line((dto.tour && dto.tour.title ? dto.tour.title : "Tour") + " × " + (q.partySize || 1) + " @ " + money(q.unitPrice, currency), money(q.subtotal, currency))}
        {q.discount ? line(q.promo && q.promo.code ? ("Promo " + q.promo.code) : "Discount", "−" + money(q.discount, currency)) : null}
        <div className="tk-summary__total"><span>{paid ? "Total paid" : "Total due"}</span><span className="tk-num" style={{ fontWeight: 800 }}>{money(q.total, currency)}</span></div>
      </div></div>

      {pay && pay.reference && (
        <div className="tk-card" style={{ textAlign: "start" }}><div className="tk-card__body" style={{ padding: "var(--space-5)" }}>
          <h3 className="tk-h6" style={{ margin: "0 0 10px" }}>Payment</h3>
          {line("Payment reference", pay.reference)}
          {line("Payment status", (pay.status || "—").toUpperCase())}
          {pay.method ? line("Method", pay.method) : null}
          {line("Payment date", tkFmtDate(pay.at))}
          {pay.ghs != null ? line("Amount charged", tkFmtGhs(pay.ghs), { strong: true }) : null}
          {pay.ghs != null && pay.fxRate
            ? <p className="tk-help" style={{ marginTop: 8 }}>Charged in GHS at 1 USD = {tkFmtGhs(pay.fxRate)} via Paystack.</p>
            : null}
        </div></div>
      )}
    </Wrap>
  );
}

Object.assign(window, { Shell, BrowseWeb, TourWeb, CheckoutWeb, BookingsWeb, ConfirmWeb, BookingDetailWeb, FilterPanel });
