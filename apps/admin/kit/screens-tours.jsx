const NS = window.TripKoachDesignSystem_c9e4af;
const { DataTable, FilterBar, Badge, Button, IconButton, Icon, Price, Modal, Alert, SearchField, EmptyState,
  FormField, Input, Textarea, Select, Drawer, MediaManager, Toast, Switch, StatusBadge } = NS;

/* ── Tours list ────────────────────────────────────────── */
function ToursAdmin({ go, state, setState }) {
  const A = window.TK_ADMIN;
  const [q, setQ] = React.useState("");
  const [sort, setSort] = React.useState({ key: "title", dir: "asc" });
  const [del, setDel] = React.useState(null);
  const [region, setRegion] = React.useState(null);
  const [status, setStatus] = React.useState(null);
  const [cat, setCat] = React.useState(null);
  const [menu, setMenu] = React.useState(null);
  const published = { "accra-city-tour": true, "discover-ghana-in-10-days": true, "a-christmas-like-no-other": true, "coastal-festival-trio": true, "coastal-history-trail": true, "aburi-akosombo-and-boti-falls": true, "volta-mountains-and-monkeys": true, "northern-savannah-safari": true, "upper-east-bolga-paga-and-sirigu": true, "luxury-wellness-tour": false, "edina-bakatue-festival-2026": false };
  // TRI-998: the live /tours projection ships departures as a COUNT (number); fixtures
  // carry an array. Handle both, and surface the bookable "upcoming" count so a
  // published tour with none can be flagged before customers hit the empty state.
  let rows = A.tours.map(t => {
    const depCount = typeof t.departures === "number" ? t.departures : (t.departures || []).length;
    const upcoming = typeof t.upcomingDepartures === "number" ? t.upcomingDepartures : depCount;
    return { ...t, published: published[t.id] !== false, departures: depCount, upcomingDepartures: upcoming };
  });
  const regions = [...new Set(A.tours.map(t => t.region))].sort();
  const cats = [...new Set(A.tours.map(t => t.category))].sort();
  if (q) rows = rows.filter(t => (t.title + t.region).toLowerCase().includes(q.toLowerCase()));
  if (region) rows = rows.filter(t => t.region === region);
  if (cat) rows = rows.filter(t => t.category === cat);
  if (status) rows = rows.filter(t => status === "live" ? t.published : !t.published);
  const applied = [];
  if (region) applied.push({ id: "region", label: "Region: " + region, onRemove: () => setRegion(null) });
  if (status) applied.push({ id: "status", label: "Status: " + (status === "live" ? "Live" : "Draft"), onRemove: () => setStatus(null) });
  if (cat) applied.push({ id: "cat", label: "Category: " + cat, onRemove: () => setCat(null) });
  const menus = {
    region: { pos: 12, opts: regions.map(r => ({ id: r, label: r, on: () => { setRegion(r); setMenu(null); }, sel: region === r })) },
    status: { pos: 118, opts: [{ id: "live", label: "Live" }, { id: "draft", label: "Draft" }].map(s => ({ id: s.id, label: s.label, on: () => { setStatus(s.id); setMenu(null); }, sel: status === s.id })) },
    cat: { pos: 216, opts: cats.map(c => ({ id: c, label: c, on: () => { setCat(c); setMenu(null); }, sel: cat === c })) },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="tk-tablewrap" style={{ position: "relative" }}>
        <FilterBar onClear={() => { setRegion(null); setStatus(null); setCat(null); }} applied={applied}
          facets={[
            { id: "region", label: region ? "Region: " + region : "Region", active: !!region || menu === "region", onClick: () => setMenu(menu === "region" ? null : "region") },
            { id: "status", label: status ? "Status: " + (status === "live" ? "Live" : "Draft") : "Status", active: !!status || menu === "status", onClick: () => setMenu(menu === "status" ? null : "status") },
            { id: "cat", label: cat ? "Category: " + cat : "Category", active: !!cat || menu === "cat", onClick: () => setMenu(menu === "cat" ? null : "cat") },
          ]}>
          <div style={{ minWidth: 240 }}><SearchField value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} placeholder="Search tours" /></div>
        </FilterBar>
        {menu && <><div onClick={() => setMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 5 }} /><div style={{ position: "absolute", top: 52, insetInlineStart: menus[menu].pos, zIndex: 6, minWidth: 190, maxHeight: 280, overflowY: "auto", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-lg)", padding: 6 }}>
          {menus[menu].opts.map(o => (
            <button key={o.id} type="button" onClick={o.on} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%", textAlign: "start", padding: "8px 10px", border: 0, borderRadius: "var(--radius-sm)", background: o.sel ? "var(--brand-wash)" : "transparent", color: "var(--text-strong)", fontWeight: o.sel ? 700 : 500, fontSize: 13.5, cursor: "pointer" }}>{o.label}{o.sel && <Icon name="check" size={15} />}</button>
          ))}
        </div></>}
        <DataTable sort={sort} onSortChange={setSort} onRowClick={(r) => go("tour-edit", r.id)}
          columns={[
            { key: "title", header: "Tour", strong: true, sortable: true, render: r => (
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ flex: "none", width: 44, height: 32, borderRadius: 6, overflow: "hidden", background: "var(--bg-sunken)" }}><img src={r.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></span>
                <span style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
              </span>) },
            { key: "region", header: "Region", sortable: true },
            { key: "category", header: "Category" },
            { key: "published", header: "Status", render: r => r.published ? <Badge tone="soft" style={{ color: "var(--success-fg)", background: "var(--success-bg)" }}>Live</Badge> : <Badge tone="neutral">Draft</Badge> },
            { key: "price", header: "From", align: "end", sortable: true, render: r => <Price amount={r.price} currency="USD" size="sm" /> },
            // TRI-998: a published tour with no upcoming (bookable) departures shows a
            // warning here — those customers hit a "No upcoming departures" empty state.
            { key: "departures", header: "Departures", align: "end", render: r => (
              r.published && r.upcomingDepartures === 0
                ? <Badge tone="soft" style={{ color: "var(--warning-fg)", background: "var(--warning-bg)" }}
                    title="Published, but no upcoming departures — customers see a “No upcoming departures” empty state. Add a departure.">
                    <Icon name="triangle-alert" size={12} style={{ verticalAlign: "-1px", marginInlineEnd: 4 }} />No upcoming
                  </Badge>
                : r.departures
            ) },
            { key: "rating", header: "Rating", align: "end", render: r => r.rating ? "★ " + r.rating : "—" },
          ]}
          rows={rows} getRowId={r => r.id}
          rowActions={(r) => (
            <span onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 2 }}>
              <IconButton icon="calendar-days" label="Departures" variant="ghost" size="sm" onClick={() => go("departures", r.id)} />
              <IconButton icon="trash-2" label={"Delete " + r.title} variant="ghost" size="sm" onClick={() => setDel(r)} />
            </span>)}
          empty={<EmptyState icon="compass" title="No tours yet" body="Create your first tour to start taking bookings." action={<Button onClick={() => go("tour-edit", "new")}>Create tour</Button>} />} />
      </div>
      <Modal open={!!del} tone="danger" title={del ? "Delete " + del.title + "?" : ""}
        description="This removes the tour and its departures from the catalogue. Existing bookings are kept but the tour can no longer be booked. Consider setting it to Draft instead."
        onClose={() => setDel(null)}
        actions={<><Button variant="secondary" onClick={() => setDel(null)}>Keep tour</Button><Button variant="danger" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.deleteTour(del._apiId || del.id), () => { if (window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API) { const arr = window.TK_DATA.tours, i = arr.findIndex(x => x.id === del.id); if (i > -1) arr.splice(i, 1); window.tkToast("Tour deleted"); } setDel(null); })}>Delete tour</Button></>} />
    </div>
  );
}

/* ── Tour create / edit (full page) ────────────────────── */
function TourEdit({ go, state }) {
  const A = window.TK_ADMIN;
  const isNew = state.editId === "new";
  const live = !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API);
  const blank = { title: "", region: "", category: "", price: "", currency: "USD", blurb: "", image: "", images: [] };
  const listTour = isNew ? null : (A.tours.find(x => x.id === state.editId) || A.tours[0] || null);
  const apiId = isNew ? "new" : ((listTour && listTour._apiId) || state.editId);

  // TRI-928 / data-safety: live edits load the FULL tour detail before rendering.
  // The tours *list* projection omits blurb/highlights/tiers/images, and
  // updateTour treats an empty string/array as a write — so editing off the list
  // and saving would blank those fields. Fixtures (flag off) already hold the
  // rich record, so seed synchronously there.
  const [detail, setDetail] = React.useState(isNew ? blank : (live ? null : (listTour || blank)));
  const [loadErr, setLoadErr] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [published, setPublished] = React.useState(isNew ? false : (listTour ? !!listTour.published : true));
  const [toast, setToast] = React.useState(null);
  const [regions, setRegions] = React.useState(window.TK_DATA.regions.slice());
  const [region, setRegion] = React.useState((listTour && listTour.region) || "");
  const [addingRegion, setAddingRegion] = React.useState(false);
  const [newRegion, setNewRegion] = React.useState("");

  // Media gallery (TRI-928): ordered [{id, src, alt, uploading?, progress?, error?}].
  // Ready tiles carry a cdn.tripkoach.com src; in-flight tiles show a local
  // objectURL preview + upload %. Persisted via images[] (cover first) on save.
  const [media, setMedia] = React.useState([]);
  const [cover, setCover] = React.useState(null);
  const uidRef = React.useRef(0);
  const nextId = () => "m" + (uidRef.current++);

  // Tracks (TRI-989): route variants a traveller picks on the tour page. Persisted
  // as `packages` on the tour. Controlled state (repeatable rows), seeded from the
  // loaded detail alongside the gallery. Each track carries a local `_uid` for keys,
  // its stored `slug` (blank for new tracks — server derives one from the name), and
  // its own price tiers. `defaultTrack` holds the _uid of the preselected track.
  const [tracks, setTracks] = React.useState([]);
  const [defaultTrack, setDefaultTrack] = React.useState(null);
  const tuidRef = React.useRef(0);
  const nextTrackId = () => "t" + (tuidRef.current++);
  const seedTracks = (pkgs, defSlug) => {
    const rows = (Array.isArray(pkgs) ? pkgs : []).map(p => ({
      _uid: nextTrackId(), slug: p.id || "", name: p.name || "", tag: p.tag || "",
      duration: p.duration || "", blurb: p.blurb || "",
      stops: (p.stops || []).join("\n"), includes: (p.includes || []).join("\n"),
      tiers: (p.tiers && p.tiers.length ? p.tiers : [{ minPax: 1, price: "" }]).map(t => ({ minPax: t.minPax, price: t.price })),
    }));
    setTracks(rows);
    const def = rows.find(r => r.slug && r.slug === defSlug) || null;
    setDefaultTrack(def ? def._uid : (rows[0] ? rows[0]._uid : null));
  };
  const seedMedia = (imgs, coverImg) => {
    const arr = (Array.isArray(imgs) && imgs.length ? imgs : (coverImg ? [coverImg] : [])).slice();
    const items = arr.map(src => ({ id: nextId(), src: src, alt: "" }));
    setMedia(items);
    setCover(items.length ? items[0].id : null);
  };
  const touch = () => setDirty(true);

  // Flag-off / new: seed the gallery + tracks synchronously from the initial record.
  React.useEffect(() => { if (!(live && !isNew)) { seedMedia(detail && detail.images, detail && detail.image); seedTracks(detail && detail.packages, detail && detail.defaultPackage); } }, []);
  // Live existing tour: fetch full detail, then hydrate fields + gallery + tracks.
  React.useEffect(() => {
    if (isNew || !live) return;
    let alive = true;
    window.TK_ADMIN_API.getTour(apiId)
      .then(d => { if (!alive || !d) return; setDetail(d); setPublished(!!d.published); if (d.region) setRegion(d.region); seedMedia(d.images, d.image); seedTracks(d.packages, d.defaultPackage); })
      .catch(() => { if (alive) { setDetail(listTour || blank); setLoadErr(true); } });
    return () => { alive = false; };
  }, [state.editId]);

  // Track handlers (TRI-989). Editing tracks is a real change → mark dirty.
  const addTrack = () => { setTracks(ts => ts.concat([{ _uid: nextTrackId(), slug: "", name: "", tag: "", duration: "", blurb: "", stops: "", includes: "", tiers: [{ minPax: 1, price: "" }] }])); touch(); };
  const removeTrack = (uid) => { setTracks(ts => ts.filter(t => t._uid !== uid)); setDefaultTrack(d => d === uid ? null : d); touch(); };
  const setTrackField = (uid, field, value) => { setTracks(ts => ts.map(t => t._uid === uid ? Object.assign({}, t, { [field]: value }) : t)); touch(); };
  const addTrackTier = (uid) => { setTracks(ts => ts.map(t => t._uid === uid ? Object.assign({}, t, { tiers: t.tiers.concat([{ minPax: "", price: "" }]) }) : t)); touch(); };
  const removeTrackTier = (uid, i) => { setTracks(ts => ts.map(t => t._uid === uid ? Object.assign({}, t, { tiers: t.tiers.filter((_, j) => j !== i) }) : t)); touch(); };
  const setTrackTier = (uid, i, field, value) => { setTracks(ts => ts.map(t => t._uid === uid ? Object.assign({}, t, { tiers: t.tiers.map((tier, j) => j === i ? Object.assign({}, tier, { [field]: value }) : tier) }) : t)); touch(); };

  const commitRegion = () => { const v = newRegion.trim(); if (!v) return; window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.createRegion(v), () => { window.TK_ADD_REGION(v); setRegions(window.TK_DATA.regions.slice()); setRegion(v); setNewRegion(""); setAddingRegion(false); touch(); setToast("Region “" + v + "” added — now live in browse filters and the Regions page"); }); };

  // Gallery handlers — cover tracked by tile id so reorder/remove never mislabels it.
  const removeMedia = (id) => { setMedia(ms => { const next = ms.filter(m => m.id !== id); setCover(c => c === id ? (next.length ? next[0].id : null) : c); return next; }); touch(); };
  const reorderMedia = (from, to) => { setMedia(ms => { if (to < 0 || to >= ms.length || from < 0 || from >= ms.length) return ms; const next = ms.slice(); const x = next.splice(from, 1)[0]; next.splice(to, 0, x); return next; }); touch(); };
  const setCoverMedia = (id) => { setCover(id); touch(); };
  const uploadFiles = (files) => {
    Array.prototype.slice.call(files || []).forEach(file => {
      const id = nextId();
      let preview = ""; try { preview = (window.URL || window.webkitURL).createObjectURL(file); } catch (_) {}
      setMedia(ms => ms.concat([{ id, src: preview, alt: "", uploading: live, progress: live ? 0 : 100 }]));
      setCover(c => c || id);
      touch();
      if (!live) return; // prototype/offline: local preview only, nothing to persist
      window.TK_ADMIN_API.uploadMedia(file, pct => setMedia(ms => ms.map(m => m.id === id ? Object.assign({}, m, { progress: pct }) : m)))
        .then(url => { setMedia(ms => ms.map(m => m.id === id ? { id, src: url, alt: "", uploading: false, progress: 100 } : m)); })
        .catch(err => { setMedia(ms => ms.map(m => m.id === id ? Object.assign({}, m, { uploading: false, error: true }) : m)); setToast((err && err.message) ? err.message : "Upload failed"); });
    });
  };

  const t = detail || blank;

  // Collect the form (DS FormField injects each field's id onto its control, so
  // the uncontrolled inputs are readable by id) and persist via the write API
  // when live. USD is the currency of record; the server owns pricing/FX. Flag
  // off → the optimistic toast path is exactly the prototype's.
  const val = (id) => { const el = document.getElementById(id); return el ? el.value : ""; };
  const lines = (id) => val(id).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const doSave = () => {
    // Ordered gallery, cover first, ready tiles only (skip in-flight/failed/local blobs).
    const ready = media.filter(m => !m.uploading && !m.error && m.src && m.src.indexOf("blob:") !== 0);
    const coverItem = ready.filter(m => m.id === cover)[0];
    const ordered = (coverItem ? [coverItem].concat(ready.filter(m => m.id !== cover)) : ready).map(m => m.src);
    const body = {
      id: apiId,
      title: val("e-title"), region: region, category: val("e-cat"), duration: val("e-dur"),
      blurb: val("e-blurb"), highlights: lines("e-high"), included: lines("e-inc"), excluded: lines("e-exc"),
      currency: val("e-cur") || "USD", published: published,
    };
    // Only persist images when we hold the authoritative gallery — a failed detail
    // load must not blank stored images with an empty array.
    if (!loadErr) { body.images = ordered; body.image = ordered[0] || ""; }
    // Tracks (TRI-989) → packages[]. Same authoritative-load guard as images: a
    // failed detail load must not wipe the tour's stored tracks. Drop unnamed
    // tracks and blank tier rows; carry the existing slug so the default resolves.
    if (!loadErr) {
      const num = (v) => { const n = parseFloat(String(v)); return Number.isFinite(n) ? n : null; };
      const packages = tracks
        .filter(t => (t.name || "").trim())
        .map(t => {
          const tiers = (t.tiers || [])
            .map(tr => ({ minPax: num(tr.minPax), price: num(tr.price) }))
            .filter(tr => tr.minPax != null && tr.price != null);
          const p = { name: t.name.trim(), tag: (t.tag || "").trim(), blurb: (t.blurb || "").trim(),
            duration: (t.duration || "").trim(),
            stops: (t.stops || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean),
            includes: (t.includes || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean),
            tiers };
          if (t.slug) p.slug = t.slug;
          return p;
        });
      body.packages = packages;
      const def = tracks.find(t => t._uid === defaultTrack && (t.name || "").trim());
      if (def) body.defaultPackage = def.slug || def.name.trim();
    }
    const optimistic = () => { setDirty(false); setToast(isNew ? "Tour created" : "Tour saved"); };
    window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.saveTour(body), optimistic);
  };

  if (detail == null) {
    return <div style={{ minHeight: 240, display: "grid", placeItems: "center" }}><span className="tk-spin" style={{ width: 30, height: 30, borderRadius: "50%", border: "3px solid var(--border-subtle)", borderTopColor: "var(--brand)", display: "inline-block" }} /></div>;
  }

  const Section = ({ title, hint, children }) => (
    <div className="tk-formsection">
      <div className="tk-formsection__aside"><h3>{title}</h3><p>{hint}</p></div>
      <div className="tk-formsection__body">{children}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ maxWidth: 900 }}>
        {loadErr && <Alert tone="warning" title="Couldn't load the full tour">We showed the summary we had. Reload before saving — saving now may overwrite fields that didn't load. Images won't be changed.</Alert>}
        <Section title="Basics" hint="The name, region and category travellers see on the tour card.">
          <FormField id="e-title" label="Tour title" required><Input defaultValue={t.title} placeholder="Cape Coast Castle & Kakum" onChange={touch} /></FormField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <FormField id="e-region" label="Region" required help="Adding a new region here makes it available across the public site.">
              {addingRegion ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <Input id="e-region-new" autoFocus value={newRegion} placeholder="e.g. Bono East" onChange={(e) => setNewRegion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitRegion(); } }} />
                  <Button size="sm" iconStart="check" disabled={!newRegion.trim()} onClick={commitRegion}>Add</Button>
                  <Button size="sm" variant="secondary" onClick={() => { setAddingRegion(false); setNewRegion(""); }}>Cancel</Button>
                </div>
              ) : (
                <Select id="e-region" value={region} onChange={(e) => { if (e.target.value === "__add") { setAddingRegion(true); return; } setRegion(e.target.value); touch(); }} placeholder="Choose a region" options={[...regions.map(r => ({ value: r, label: r })), { value: "__add", label: "＋ Add a new region…" }]} />
              )}
            </FormField>
            <FormField id="e-cat" label="Category" required><Select defaultValue={t.category} onChange={touch} placeholder="Choose a category" options={["Cultural Discovery", "Adventure", "City Tour", "Luxury"].map(c => ({ value: c, label: c }))} /></FormField>
          </div>
          <FormField id="e-dur" label="Duration" help="As shown on the card, e.g. 'Full day · 12 hrs' or '10 days'"><Input defaultValue={t.duration} onChange={touch} /></FormField>
        </Section>

        <Section title="Description" hint="The intro paragraph and the selling points on the tour detail page.">
          <FormField id="e-blurb" label="Overview" required><Textarea rows={4} defaultValue={t.blurb} onChange={touch} placeholder="What makes this trip worth it?" /></FormField>
          <FormField id="e-high" label="Highlights" help="One per line. Shown as a ticked list."><Textarea rows={4} onChange={touch} defaultValue={(t.highlights || []).join("\\n")} placeholder={"Guided castle tour\\nKakum canopy walkway"} /></FormField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <FormField id="e-inc" label="Included" help="One per line"><Textarea rows={4} onChange={touch} defaultValue={(t.included || []).join("\\n")} /></FormField>
            <FormField id="e-exc" label="Not included" help="One per line"><Textarea rows={4} onChange={touch} defaultValue={(t.excluded || []).join("\\n")} /></FormField>
          </div>
        </Section>

        <Section title="Media" hint="Photos for the gallery. The cover image is used on cards and search.">
          <MediaManager items={media} coverId={cover} onSetCover={setCoverMedia} onRemove={removeMedia} onReorder={reorderMedia} onUpload={uploadFiles} />
        </Section>

        <Section title="Group pricing" hint="Per-person rate by party size. The largest-group rate is the 'from' price on cards. The website and app apply these tiers automatically at checkout.">
          <FormField id="e-cur" label="Currency"><Select defaultValue="USD" onChange={touch} options={[{ value: "USD", label: "USD ($)" }, { value: "GHS", label: "GHS (GH₵)" }]} /></FormField>
          <div className="tk-tablewrap">
            <table className="tk-table" data-density="compact">
              <thead><tr><th>Party size</th><th style={{ textAlign: "end" }}>Price / person</th><th /></tr></thead>
              <tbody>
                {(t.tiers || [{ minPax: 1, price: t.price || 0 }]).map((tier, i, arr) => (
                  <tr key={i}>
                    <td style={{ width: 200 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Input defaultValue={tier.minPax} onChange={touch} inputMode="numeric" style={{ width: 70 }} aria-label="Minimum travellers" />
                        <span className="tk-caption">or more{i < arr.length - 1 ? " (up to " + (arr[i + 1].minPax - 1) + ")" : ""}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: "end", width: 160 }}><Input defaultValue={tier.price} onChange={touch} inputMode="numeric" iconStart="wallet" /></td>
                    <td className="tk-rowkebab"><IconButton icon="trash-2" label="Remove tier" variant="ghost" size="sm" onClick={touch} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button variant="secondary" size="sm" iconStart="plus" onClick={touch} style={{ alignSelf: "flex-start" }}>Add price tier</Button>
        </Section>

        <Section title="Tracks" hint="Optional route variants a traveller picks on the tour page (e.g. the Accra City Tour's three half-day routes). Leave empty for a single-itinerary tour.">
          {tracks.length === 0 ? (
            <p className="tk-caption" style={{ margin: "0 0 4px" }}>No tracks — this tour books as a single itinerary.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {tracks.map((tr, ti) => (
                <div key={tr._uid} className="tk-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <strong style={{ flex: 1 }}>{(tr.name || "").trim() || "Track " + (ti + 1)}</strong>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }} className="tk-caption">
                      <input type="radio" name="track-default" checked={defaultTrack === tr._uid} onChange={() => { setDefaultTrack(tr._uid); touch(); }} aria-label="Preselected track" />
                      Default
                    </label>
                    <IconButton icon="trash-2" label="Remove track" variant="ghost" size="sm" onClick={() => removeTrack(tr._uid)} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <FormField id={"trk-name-" + tr._uid} label="Track name" required><Input value={tr.name} onChange={(e) => setTrackField(tr._uid, "name", e.target.value)} placeholder="Classic Capital Loop" /></FormField>
                    <FormField id={"trk-tag-" + tr._uid} label="Tag" optional help="Short label under the name."><Input value={tr.tag} onChange={(e) => setTrackField(tr._uid, "tag", e.target.value)} placeholder="Heritage & Food · half day" /></FormField>
                  </div>
                  <FormField id={"trk-dur-" + tr._uid} label="Duration" optional><Input value={tr.duration} onChange={(e) => setTrackField(tr._uid, "duration", e.target.value)} placeholder="Half day · 3–4 hrs" /></FormField>
                  <FormField id={"trk-blurb-" + tr._uid} label="Overview" optional><Textarea rows={2} value={tr.blurb} onChange={(e) => setTrackField(tr._uid, "blurb", e.target.value)} placeholder="What makes this route worth it?" /></FormField>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <FormField id={"trk-stops-" + tr._uid} label="Stops" optional help="One per line."><Textarea rows={4} value={tr.stops} onChange={(e) => setTrackField(tr._uid, "stops", e.target.value)} placeholder={"Hotel pickup\nBlack Star Gate\nMakola Market"} /></FormField>
                    <FormField id={"trk-inc-" + tr._uid} label="Included" optional help="One per line."><Textarea rows={4} value={tr.includes} onChange={(e) => setTrackField(tr._uid, "includes", e.target.value)} placeholder={"Private transport\nProfessional guide"} /></FormField>
                  </div>
                  <div>
                    <span className="tk-caption" style={{ fontWeight: 600 }}>Group pricing (per person, USD)</span>
                    <div className="tk-tablewrap" style={{ marginTop: 6 }}>
                      <table className="tk-table" data-density="compact">
                        <thead><tr><th>Party size (min)</th><th style={{ textAlign: "end" }}>Price / person</th><th /></tr></thead>
                        <tbody>
                          {tr.tiers.map((tier, i) => (
                            <tr key={i}>
                              <td style={{ width: 200 }}><Input value={tier.minPax} onChange={(e) => setTrackTier(tr._uid, i, "minPax", e.target.value)} inputMode="numeric" style={{ width: 90 }} aria-label="Minimum travellers" /></td>
                              <td style={{ textAlign: "end", width: 160 }}><Input value={tier.price} onChange={(e) => setTrackTier(tr._uid, i, "price", e.target.value)} inputMode="numeric" iconStart="wallet" aria-label="Price per person" /></td>
                              <td className="tk-rowkebab"><IconButton icon="trash-2" label="Remove tier" variant="ghost" size="sm" onClick={() => removeTrackTier(tr._uid, i)} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Button variant="ghost" size="sm" iconStart="plus" onClick={() => addTrackTier(tr._uid)} style={{ marginTop: 6 }}>Add price tier</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Button variant="secondary" size="sm" iconStart="plus" onClick={addTrack} style={{ alignSelf: "flex-start", marginTop: 12 }}>Add track</Button>
        </Section>

        <Section title="Visibility" hint="Drafts are hidden from the website until published.">
          <Switch id="e-pub" label={published ? "Published — live on the website" : "Draft — hidden from travellers"} checked={published} onChange={() => { setPublished(!published); touch(); }} />
        </Section>
      </div>

      <div className="tk-stickysave">
        <span className="tk-caption">{dirty ? <span style={{ color: "var(--warning-fg)", fontWeight: 600 }}><Icon name="info" size={13} /> Unsaved changes</span> : "All changes saved"}</span>
        <div style={{ display: "flex", gap: 10 }}>
          <Button variant="secondary" onClick={() => go("tours")}>{dirty ? "Discard" : "Back"}</Button>
          <Button iconStart="check" disabled={!dirty && !isNew} onClick={doSave}>{isNew ? "Create tour" : "Save changes"}</Button>
        </div>
      </div>
      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </div>
  );
}

/* ── Departures & inventory ────────────────────────────── */
function DeparturesAdmin({ go, state, setState }) {
  const A = window.TK_ADMIN;
  const scoped = state.editId && state.editId !== "new";
  let rows = A.departures;
  if (scoped) rows = rows.filter(d => d.tourId === state.editId);
  const [cancelDep, setCancelDep] = React.useState(null);
  const [capDep, setCapDep] = React.useState(null);   // TRI-974: departure whose capacity is being edited
  const [capVal, setCapVal] = React.useState(0);
  const [endDep, setEndDep] = React.useState(null);
  const [ended, setEnded] = React.useState({});
  const [toast, setToast] = React.useState(null);
  const [adding, setAdding] = React.useState(false);
  const tourOpts = A.tours.map(t => ({ value: t.id, label: t.title }));
  const [form, setForm] = React.useState({ tourId: "", packageId: "", date: "", time: "08:00", capacity: 12, price: "", guide: "", repeat: false, notes: "" });
  const openAdd = () => { const tid = scoped ? state.editId : (A.tours[0] && A.tours[0].id) || ""; const tt = A.tours.find(t => t.id === tid); setForm({ tourId: tid, packageId: tt ? (tt.defaultPackage || (tt.packages && tt.packages[0] && tt.packages[0].id) || "") : "", date: "", time: "08:00", capacity: 12, price: "", guide: "", repeat: false, notes: "" }); setAdding(true); };
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setTour = (id) => { const tt = A.tours.find(t => t.id === id); setForm(f => ({ ...f, tourId: id, packageId: tt ? (tt.defaultPackage || (tt.packages && tt.packages[0] && tt.packages[0].id) || "") : "" })); };
  const chosenTour = A.tours.find(t => t.id === form.tourId);
  const pkgOpts = (chosenTour && chosenTour.packages && chosenTour.packages.length) ? chosenTour.packages.map(p => ({ value: p.id, label: p.name })) : [{ value: "", label: "Standard · no package types defined" }];
  const chosenPkg = chosenTour && chosenTour.packages && chosenTour.packages.find(p => p.id === form.packageId);
  const fromPrice = chosenPkg && chosenPkg.tiers && chosenPkg.tiers.length ? chosenPkg.tiers[chosenPkg.tiers.length - 1].price : (chosenTour && chosenTour.tiers && chosenTour.tiers.length ? chosenTour.tiers[chosenTour.tiers.length - 1].price : (chosenTour && chosenTour.price));
  const canSave = form.tourId && form.date && form.capacity > 0;
  React.useEffect(() => { const h = () => openAdd(); window.addEventListener("tk-add-departure", h); return () => window.removeEventListener("tk-add-departure", h); });
  const save = () => {
    const optimistic = () => { setAdding(false); setToast("Departure added — " + (chosenTour ? chosenTour.title : "tour") + (chosenPkg ? " · " + chosenPkg.name : "") + (form.date ? " on " + form.date : "") + (form.repeat ? " (+ weekly repeats)" : "")); };
    window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.createDeparture({
      tourId: (chosenTour && chosenTour._apiId) || form.tourId, packageId: form.packageId || undefined,
      date: form.date, time: form.time, capacity: +form.capacity,
      price: form.price === "" ? undefined : +form.price, guideId: form.guide || undefined,
      repeatWeekly: !!form.repeat, notes: form.notes || undefined, currency: "USD",
    }), optimistic);
  };

  const util = (d) => Math.round((d.booked / d.capacity) * 100);
  const capBar = (d) => {
    const pct = util(d);
    const tone = d.status === "sold-out" ? "var(--n-500)" : pct >= 90 ? "var(--danger-solid)" : pct >= 70 ? "var(--warning-solid)" : "var(--success-solid)";
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 150 }}>
        <span style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--bg-sunken)", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: pct + "%", background: tone }} /></span>
        <span className="tk-num" style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 54 }}>{d.booked}/{d.capacity}</span>
      </span>
    );
  };
  const depStatus = (d) => ended[d.id]
    ? <span className="tk-badge tk-badge--confirmed" style={{ background: "var(--brand-wash)", color: "var(--brand-ink)" }}>Completed · invites sent</span>
    : d.status === "sold-out"
    ? <Badge tone="neutral">Sold out</Badge>
    : util(d) >= 90 ? <span className="tk-badge tk-badge--pending">Nearly full</span>
    : <span className="tk-badge tk-badge--confirmed">Scheduled</span>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {scoped && <Alert tone="info" title={"Showing departures for one tour"} action={<Button variant="link" size="sm" onClick={() => setState({ editId: null })}>Show all</Button>}>Filtered to a single tour's schedule.</Alert>}
      <div className="tk-tablewrap">
        <div className="tk-tabletools"><strong style={{ fontSize: 14 }}>{rows.length} departures</strong><span className="tk-caption" style={{ marginInlineStart: 8 }}>Watch the utilization bar — red means near capacity.</span><Button size="sm" iconStart="plus" style={{ marginInlineStart: "auto" }} onClick={openAdd}>Add departure</Button></div>
        <DataTable density="compact"
          columns={[
            { key: "tour", header: "Tour", strong: true, render: r => <span style={{ display: "inline-block", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>{r.tour}</span> },
            { key: "date", header: "Date", render: r => <span><div style={{ fontWeight: 600, color: "var(--text-strong)" }}>{r.date}</div><div className="tk-caption">{r.time}</div></span> },
            { key: "price", header: "Price", align: "end", render: r => <Price amount={r.price} currency="USD" size="sm" /> },
            { key: "cap", header: "Capacity", render: r => capBar(r), width: 190 },
            { key: "spotsLeft", header: "Left", align: "end", render: r => <span style={{ fontWeight: 700, color: r.spotsLeft === 0 ? "var(--text-muted)" : r.spotsLeft <= 3 ? "var(--warning-fg)" : "var(--text-strong)" }}>{r.spotsLeft}</span> },
            { key: "status", header: "Status", render: r => depStatus(r) },
          ]}
          rows={rows} getRowId={r => r.id}
          rowActions={(r) => (
            <span onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 2 }}>
              {!ended[r.id] && r.booked > 0 && <IconButton icon="circle-check-big" label="End departure and request reviews" variant="ghost" size="sm" onClick={() => setEndDep(r)} />}
              <IconButton icon="sliders-horizontal" label="Adjust capacity" variant="ghost" size="sm" onClick={() => { setCapDep(r); setCapVal(r.capacity); }} />
              <IconButton icon="x" label="Cancel departure" variant="ghost" size="sm" onClick={() => setCancelDep(r)} />
            </span>)}
          empty={<EmptyState icon="calendar-days" title="No departures scheduled" body="Add a departure so travellers can book this tour." action={<Button iconStart="plus" onClick={openAdd}>Add departure</Button>} />} />
      </div>

      <Drawer open={adding} title="Add departure" subtitle="Schedule a new date travellers can book" onClose={() => setAdding(false)}
        footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button iconStart="plus" disabled={!canSave} onClick={save} style={{ marginInlineStart: "auto" }}>Add departure</Button></>}>
        <FormField id="dep-tour" label="Tour" hint={scoped ? "Locked to the tour you're viewing." : undefined}>
          <Select id="dep-tour" value={form.tourId} disabled={scoped} onChange={(e) => setTour(e.target.value)} options={tourOpts} />
        </FormField>
        <FormField id="dep-package" label="Package / type" hint={chosenPkg ? chosenPkg.blurb : "This tour has no package types — departures use the standard rate."}>
          <Select id="dep-package" value={form.packageId} disabled={!(chosenTour && chosenTour.packages && chosenTour.packages.length)} onChange={(e) => upd("packageId", e.target.value)} options={pkgOpts} />
        </FormField>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
          <FormField id="dep-date" label="Departure date"><Input id="dep-date" type="date" value={form.date} onChange={(e) => upd("date", e.target.value)} /></FormField>
          <FormField id="dep-time" label="Start time"><Input id="dep-time" type="time" value={form.time} onChange={(e) => upd("time", e.target.value)} /></FormField>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
          <FormField id="dep-cap" label="Capacity" hint="Max travellers on this date."><Input id="dep-cap" type="number" min="1" value={form.capacity} onChange={(e) => upd("capacity", +e.target.value)} /></FormField>
          <FormField id="dep-price" label="Price per person" optional hint={fromPrice ? "Tour default: $" + fromPrice : undefined}>
            <Input id="dep-price" type="number" min="0" value={form.price} placeholder={fromPrice ? String(fromPrice) : ""} onChange={(e) => upd("price", e.target.value)} />
          </FormField>
        </div>
        <FormField id="dep-guide" label="Lead guide" optional hint={<>Manage the roster in <a href="#" onClick={(e) => { e.preventDefault(); go("guides"); }} style={{ color: "var(--brand-ink)", fontWeight: 600 }}>Guides</a>.</>}><Select id="dep-guide" value={form.guide} onChange={(e) => { if (e.target.value === "__add") { go("guides"); setTimeout(() => window.dispatchEvent(new CustomEvent("tk-add-guide")), 60); return; } upd("guide", e.target.value); }} options={[{ value: "", label: "Assign later" }, ...((A.guides || []).filter(g => g.status === "active").map(g => ({ value: g.id, label: g.name + " · " + g.base }))), { value: "__add", label: "＋ Add a new guide…" }]} /></FormField>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "12px 14px", background: "var(--bg-sunken)", borderRadius: "var(--radius-md)" }}>
          <span style={{ maxWidth: "38ch" }}><strong style={{ fontSize: 14, color: "var(--text-strong)" }}>Repeat weekly</strong><p className="tk-body-sm tk-muted" style={{ margin: "2px 0 0" }}>Also create this departure for the next 8 weeks.</p></span>
          <Switch id="dep-repeat" checked={form.repeat} onChange={(e) => upd("repeat", e.target.checked)} />
        </div>
        <FormField id="dep-notes" label="Internal note" optional><Textarea id="dep-notes" rows={2} value={form.notes} placeholder="Only staff see this." onChange={(e) => upd("notes", e.target.value)} /></FormField>
        {chosenTour && form.capacity > 0 && <Alert tone="info" title="Ready to publish">Opens {form.capacity} spots on {chosenTour.title}{form.date ? " for " + form.date : ""} at ${form.price || fromPrice || 0}/person.</Alert>}
      </Drawer>
      <Modal open={!!endDep} title="End departure & request reviews"
        description={endDep ? endDep.tour + " on " + endDep.date + " — " + endDep.booked + " traveller" + (endDep.booked === 1 ? "" : "s") + " travelled." : ""}
        onClose={() => setEndDep(null)}
        actions={<><Button variant="secondary" onClick={() => setEndDep(null)}>Not yet</Button><Button iconStart="mail" onClick={() => { const n = endDep.booked; const id = endDep.id; setEnded(e => ({ ...e, [id]: true })); setEndDep(null); setToast("Departure closed — " + n + " personal review invite" + (n === 1 ? "" : "s") + " sent"); }}>Send {endDep ? endDep.booked : 0} review invites</Button></>}>
        {endDep && <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Alert tone="info" title="Each traveller gets their own private link">Only people who were on this departure can review it. The link is tied to their booking, so every review comes back marked <strong>Verified booking</strong> — then waits for your approval before it's public.</Alert>
          <div>
            <span className="tk-label" style={{ display: "block", marginBottom: 6 }}>Invites will go to</span>
            <div style={{ display: "grid", gap: 6 }}>
              {window.TK_PARTICIPANTS(endDep.id, Math.min(endDep.booked, 5)).map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--bg-sunken)", borderRadius: "var(--radius-md)" }}>
                  <span style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--brand-ink)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12, flex: "none" }}>{p.initials}</span>
                  <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}><strong style={{ fontSize: 13.5 }}>{p.name}</strong><span className="tk-caption">{p.email}</span></span>
                </div>
              ))}
              {endDep.booked > 5 && <span className="tk-caption">+ {endDep.booked - 5} more traveller{endDep.booked - 5 === 1 ? "" : "s"}</span>}
            </div>
          </div>
        </div>}
      </Modal>
      {/* TRI-974 · Adjust a departure's seat capacity. Saves via PATCH /departures/:id; the
          server refuses a capacity below already-booked seats and the error surfaces as a toast. */}
      <Modal open={!!capDep} title="Adjust capacity"
        description={capDep ? capDep.tour + " on " + capDep.date + (capDep.time ? " · " + capDep.time : "") : ""}
        onClose={() => setCapDep(null)}
        actions={<><Button variant="secondary" onClick={() => setCapDep(null)}>Cancel</Button>
          <Button iconStart="check" disabled={!capDep || !(+capVal >= Math.max(1, capDep.booked)) || +capVal === capDep.capacity} onClick={() => {
            const dep = capDep, next = +capVal;
            window.TK_ADMIN_ACT(
              () => window.TK_ADMIN_API.updateDeparture(dep.id, { capacity: next }),
              (res) => {
                const cap = (res && res.capacity != null) ? res.capacity : next;
                dep.capacity = cap;
                dep.booked = (res && res.booked != null) ? res.booked : dep.booked;
                dep.spotsLeft = (res && res.spotsLeft != null) ? res.spotsLeft : Math.max(0, cap - dep.booked);
                setCapDep(null);
                setToast("Capacity updated — " + dep.tour + " on " + dep.date + " now seats " + cap + " (" + dep.spotsLeft + " left)");
              });
          }}>Save capacity</Button></>}>
        {capDep && <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <FormField id="cap-edit" label="Seat capacity" hint={capDep.booked > 0 ? "Can't go below " + capDep.booked + " already-booked seat" + (capDep.booked === 1 ? "" : "s") + "." : "Max travellers on this departure."}>
            <Input id="cap-edit" type="number" min={Math.max(1, capDep.booked)} value={capVal} onChange={(e) => setCapVal(e.target.value)} />
          </FormField>
          <Alert tone={(+capVal >= Math.max(1, capDep.booked)) ? "info" : "warning"} title={(+capVal >= Math.max(1, capDep.booked)) ? "Availability preview" : "Below booked seats"}>
            {(+capVal >= Math.max(1, capDep.booked))
              ? capDep.booked + " booked · " + Math.max(0, (+capVal) - capDep.booked) + " spot" + (Math.max(0, (+capVal) - capDep.booked) === 1 ? "" : "s") + " left after saving."
              : "You can't set capacity below the " + capDep.booked + " seats already booked — that would oversell the departure."}
          </Alert>
        </div>}
      </Modal>
      <Modal open={!!cancelDep} tone="danger" title="Cancel this departure?"
        description={cancelDep ? cancelDep.tour + " on " + cancelDep.date + " has " + cancelDep.booked + " booked traveller" + (cancelDep.booked === 1 ? "" : "s") + "." : ""}
        onClose={() => setCancelDep(null)}
        actions={<><Button variant="secondary" onClick={() => setCancelDep(null)}>Keep departure</Button><Button variant="danger" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.cancelDeparture(cancelDep.id, "Departure cancelled"), () => { setToast("Departure cancelled — " + (cancelDep ? cancelDep.booked : 0) + " bookings flagged for refund"); setCancelDep(null); })}>Cancel departure</Button></>}>
        {cancelDep && cancelDep.booked > 0 && <Alert tone="warning" title="This affects existing bookings">All {cancelDep.booked} bookings on this departure will be marked for cancellation and the customers emailed. Refunds are handled in Payments.</Alert>}
      </Modal>
      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </div>
  );
}
Object.assign(window, { ToursAdmin, TourEdit, DeparturesAdmin });
