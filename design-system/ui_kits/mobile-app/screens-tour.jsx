const { Button, IconButton, Icon, Rating, Price, Badge, AvailabilityBadge, DeparturePicker, Accordion, Alert, Breadcrumbs } = window.TripKoachDesignSystem_c9e4af;

const M_GRADS = ["linear-gradient(145deg,#c67d2a 0%,#9a5a1f 55%,#5c3413 100%)", "linear-gradient(145deg,#3f7a63 0%,#255043 100%)", "linear-gradient(145deg,#b3702f 0%,#6b3d18 100%)", "linear-gradient(145deg,#5a7d8f 0%,#2f4b58 100%)", "linear-gradient(145deg,#a8562f 0%,#5e2c18 100%)"];
function mGallery(t) {
  const caps = (t.highlights && t.highlights.length) ? t.highlights : [t.region + ", Ghana"];
  const out = [{ src: t.image, caption: t.title, gi: 0 }];
  for (let i = 1; i < 8; i++) out.push({ src: t.image ? window.TK_IMG(t.id, "gallery-" + i) : null, caption: caps[(i - 1) % caps.length], gi: i % M_GRADS.length });
  return out;
}
function MPhoto({ src, caption, gi, fit }) {
  const [err, setErr] = React.useState(false);
  if (err || !src) return (
    <div role="img" aria-label={caption} style={{ position: "absolute", inset: 0, background: M_GRADS[gi % M_GRADS.length], display: "grid", placeItems: "center", padding: 16 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "rgba(255,255,255,.94)", fontWeight: 700, fontSize: 13.5, textAlign: "center", textShadow: "0 1px 4px rgba(0,0,0,.35)" }}><Icon name="map-pin" size={15} />{caption}</span>
    </div>
  );
  return <img src={src} alt={caption} loading="lazy" decoding="async" onError={() => setErr(true)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: fit || "cover", background: fit === "contain" ? "#0e0d0c" : undefined }} />;
}
function TourCarousel({ photos, onOpen, children }) {
  const [idx, setIdx] = React.useState(0);
  const ref = React.useRef(null);
  const onScroll = () => { const el = ref.current; if (!el) return; const i = Math.round(el.scrollLeft / el.clientWidth); if (i !== idx) setIdx(i); };
  return (
    <div className="tk-media" style={{ aspectRatio: "4/3", padding: 0 }}>
      <div ref={ref} onScroll={onScroll} style={{ position: "absolute", inset: 0, display: "flex", overflowX: "auto", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
        {photos.map((p, i) => (
          <button key={i} type="button" onClick={() => onOpen(i)} aria-label={"Photo " + (i + 1) + " of " + photos.length} style={{ position: "relative", flex: "0 0 100%", scrollSnapAlign: "center", border: 0, padding: 0, background: "none", cursor: "pointer" }}>
            <MPhoto {...p} />
          </button>
        ))}
      </div>
      {children}
      <div style={{ position: "absolute", insetInline: "var(--space-3)", bottom: "var(--space-3)", display: "flex", gap: 6, pointerEvents: "none" }}>
        {photos.map((_, i) => <span key={i} style={{ height: 3, flex: 1, borderRadius: 2, background: i === idx ? "var(--n-0)" : "rgba(255,255,255,.45)", transition: "background var(--dur-1,.15s)" }} />)}
      </div>
      <span style={{ position: "absolute", top: "var(--space-3)", insetInlineStart: "50%", transform: "translateX(-50%)", background: "rgba(20,19,18,.55)", color: "#fff", fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: "var(--radius-pill)", pointerEvents: "none" }}>{idx + 1} / {photos.length}</span>
    </div>
  );
}
function MobileLightbox({ photos, index, onClose }) {
  const ref = React.useRef(null);
  const [idx, setIdx] = React.useState(index);
  React.useEffect(() => { const el = ref.current; if (el) el.scrollLeft = index * el.clientWidth; }, []);
  const onScroll = () => { const el = ref.current; if (!el) return; const i = Math.round(el.scrollLeft / el.clientWidth); if (i !== idx) setIdx(i); };
  return (
    <div role="dialog" aria-modal="true" aria-label="Photo gallery" style={{ position: "absolute", inset: 0, zIndex: 200, background: "rgba(14,13,12,.97)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-3) var(--space-4)", color: "#fff" }}>
        <span style={{ fontWeight: 700, fontSize: 13.5 }}>{idx + 1} / {photos.length}</span>
        <IconButton icon="x" label="Close gallery" variant="outline" onClick={onClose} />
      </div>
      <div ref={ref} onScroll={onScroll} style={{ flex: 1, minHeight: 0, display: "flex", overflowX: "auto", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
        {photos.map((p, i) => (
          <div key={i} style={{ position: "relative", flex: "0 0 100%", scrollSnapAlign: "center" }}><MPhoto {...p} fit="contain" /></div>
        ))}
      </div>
      <div style={{ color: "rgba(255,255,255,.9)", textAlign: "center", fontSize: 13.5, fontWeight: 500, padding: "var(--space-3) var(--space-4) var(--space-5)" }}>{photos[idx].caption}</div>
    </div>
  );
}

function pkgTourM(t, pkgId) {
  const p = (t.packages || []).find(x => x.id === pkgId);
  if (!p) return t;
  return { ...t, tiers: p.tiers, price: p.tiers[p.tiers.length - 1].price, included: (p.includes || t.included), stops: p.stops, packageName: p.name, packageId: p.id };
}
function TourDetailScreen({ go, state, setState }) {
  const t = state.tour || window.TK_DATA.tours[0];
  const [dep, setDep] = React.useState(state.departure || null);
  const [lb, setLb] = React.useState(null);
  const [pkgId, setPkgId] = React.useState(t.defaultPackage || (t.packages && t.packages[0] && t.packages[0].id));
  const pt = t.packages ? pkgTourM(t, pkgId) : t;
  const cur = state.currency || "USD";
  const photos = mGallery(t);
  const selected = (t.departures || []).find(d => d.id === dep);
  return (
    <div style={{ position: "relative", paddingBottom: 96 }}>
      <TourCarousel photos={photos} onOpen={(i) => setLb(i)}>
        <div style={{ position: "absolute", inset: "var(--space-3) var(--space-3) auto", display: "flex", justifyContent: "space-between" }}>
          <IconButton icon="arrow-left" label="Back" variant="outline" onClick={() => go("browse")} />
          <span style={{ display: "flex", gap: 8 }}>
            <IconButton icon="share-2" label="Share" variant="outline" onClick={() => window.tkToast("Share link copied")} />
            <IconButton icon="heart" label="Save this tour" variant="outline" onClick={() => window.tkToast("Saved to your wishlist")} />
          </span>
        </div>
      </TourCarousel>

      <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        <div className="tk-stack" style={{ gap: "var(--space-2)" }}>
          <div className="tk-tourcard__meta">
            <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><Icon name="map-pin" size={14} />{t.region}, Ghana</span>
            <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><Icon name="tag" size={14} />{t.category}</span>
            <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><Icon name="clock" size={14} />{t.duration}</span>
          </div>
          <h1 className="tk-h2">{t.title}</h1>
          <div className="tk-row" style={{ gap: "var(--space-3)", flexWrap: "wrap" }}>
            <Rating value={t.rating} count={t.reviews} />
            {t.tag && <Badge tone="solid">{t.tag}</Badge>}
            <AvailabilityBadge spotsLeft={t.spotsLeft} />
          </div>
          <p className="tk-body" style={{ marginTop: 4 }}>{t.blurb}</p>
        </div>

        <div className="tk-stack" style={{ gap: "var(--space-3)" }}>
          <h2 className="tk-h4">Highlights</h2>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {(pt.stops ? pt.stops.filter(s => !/pickup|drop-?off/i.test(s)).slice(0, 4) : (t.highlights || [])).map(h => (
              <li key={h} style={{ display: "flex", gap: 10, fontSize: "var(--text-body-sm-size)", lineHeight: 1.5 }}>
                <Icon name="check" size={16} style={{ color: "var(--success-fg)", marginTop: 3 }} />{h}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="tk-h4" style={{ marginBottom: "var(--space-2)" }}>{pt.stops ? "Your route, stop by stop" : "The day, hour by hour"}</h2>
          <Accordion defaultOpen={["itin"]} items={[
            { id: "itin", title: pt.stops ? "Route · stop by stop" : ((t.itinerary && t.itinerary[0] && t.itinerary[0][0].startsWith("Day")) ? "Day by day" : "Itinerary"), content: pt.stops ? <ol style={{ margin: 0, paddingInlineStart: 18, display: "flex", flexDirection: "column", gap: 6 }}>{pt.stops.map(s => <li key={s}>{s}</li>)}</ol> : <ol style={{ margin: 0, paddingInlineStart: 18, display: "flex", flexDirection: "column", gap: 6 }}>
                {(t.itinerary || [["09:00","Hotel pickup"],["13:00","Drop-off"]]).map(([time, what]) => <li key={time + what}><strong>{time}</strong> — {what}</li>)}</ol> },
            { id: "inc", title: "What's included", content: <div style={{ display: "grid", gap: 10 }}>
                {(pt.included || []).map(i => <span key={i} style={{ display: "flex", gap: 8 }}><Icon name="check" size={15} style={{ color: "var(--success-fg)" }} />{i}</span>)}
                {(t.excluded || []).map(i => <span key={i} style={{ display: "flex", gap: 8, color: "var(--text-muted)" }}><Icon name="x" size={15} />{i}</span>)}
              </div> },
            { id: "meet", title: "Meeting point", content: <p>Accra Mall car park, Spintex Road. Look for the guide holding a TripKoach board. Please arrive 15 minutes early.</p> },
            { id: "pol", title: "Cancellation policy", content: <p>Free cancellation until 7 days before departure. Between 7 and 2 days, 50% is held. Inside 48 hours the booking is non-refundable. Payments are not live yet, so nothing is charged today — see the full policy at checkout.</p> },
          ]} />
        </div>

        {pt.packages ? (
          <div className="tk-stack" style={{ gap: "var(--space-3)" }}>
            <h2 className="tk-h4">Choose your route</h2>
            <p className="tk-body-sm tk-muted" style={{ marginTop: -4 }}>Three ways to spend your half day. Same group pricing on every route.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }} role="radiogroup" aria-label="Tour route">
              {pt.packages.map(p => { const on = p.id === pkgId;
                return (
                  <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => setPkgId(p.id)}
                    style={{ textAlign: "start", cursor: "pointer", border: on ? "2px solid var(--brand-ink)" : "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", background: on ? "var(--brand-wash)" : "var(--bg-surface)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}><strong style={{ fontSize: 15 }}>{p.name}</strong>{on && <Icon name="circle-check-big" size={18} style={{ color: "var(--brand-ink)" }} />}</span>
                    <span className="tk-overline" style={{ color: "var(--gold-700)" }}>{p.tag}</span>
                    <span className="tk-caption">{p.blurb}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}><Icon name="map-pin" size={13} />{p.stops.length} stops · {p.duration}</span>
                  </button>
                ); })}
            </div>
          </div>
        ) : null}
        <div className="tk-stack" style={{ gap: "var(--space-3)" }}>
          <h2 className="tk-h4">Group pricing</h2>
          <p className="tk-body-sm tk-muted" style={{ marginTop: -4 }}>{"Per person, in " + cur + ". The bigger your party, the less each traveller pays."}</p>
          <div className="tk-card"><div className="tk-card__body" style={{ padding: 0 }}>
            {(pt.tiers || []).map((tier, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: i ? "1px solid var(--border-subtle)" : "none" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "var(--text-strong)" }}><Icon name="users" size={16} style={{ color: "var(--text-muted)" }} />{window.TK_PRICE.band(pt.tiers, i)} {window.TK_PRICE.band(pt.tiers, i) === "1" ? "traveller" : "travellers"}</span>
                <span style={{ display: "flex", alignItems: "baseline", gap: 4 }}><span className="tk-num" style={{ fontWeight: 800, fontSize: 17 }}>{window.tkMoney(tier.price, cur)}</span><span className="tk-caption">/person</span>{i === (pt.tiers.length - 1) && <span className="tk-badge tk-badge--confirmed" style={{ marginInlineStart: 6 }}>Best value</span>}</span>
              </div>
            ))}
          </div></div>
        </div>

        <div className="tk-stack" style={{ gap: "var(--space-3)" }} id="departures">
          <h2 className="tk-h4">Choose a departure</h2>
          <DeparturePicker departures={window.tkDeps(t.departures || [], cur)} value={dep} onChange={setDep} currency={cur} />
          <p className="tk-caption">{"Prices are “from” rates per person in " + cur + ". Your koach confirms the final quote for your dates."}</p>
        </div>

        <Alert tone="info" title="Book with confidence">
          Pay now by card, or reserve free and pay before departure. Free cancellation until 7 days before you travel.
        </Alert>
      </div>

      <div className="tk-stickybar">
        <div className="tk-stack" style={{ gap: 0 }}>
          <Price amount={window.tkCvt(selected ? selected.price : pt.price, cur)} currency={cur} from={!selected} unit="per person" />
          {selected ? <span className="tk-caption">{selected.date}</span> : (pt.packages ? <span className="tk-caption">{pt.packageName} package</span> : null)}
        </div>
        <Button style={{ marginInlineStart: "auto" }} size="lg" variant="primary"
          onClick={() => go(selected ? "checkout" : "tour", { departure: dep, packageId: pkgId, packageName: pt.packageName })}
          disabled={!selected}>
          {selected ? "Reserve my spot" : "Select a departure"}
        </Button>
      </div>
      {lb !== null && <MobileLightbox photos={photos} index={lb} onClose={() => setLb(null)} />}
    </div>
  );
}
Object.assign(window, { TourDetailScreen });
