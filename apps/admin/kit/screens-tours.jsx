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
  let rows = A.tours.map(t => ({ ...t, published: published[t.id] !== false, departures: (t.departures || []).length }));
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
            { key: "departures", header: "Departures", align: "end" },
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
  const t = isNew ? { title: "", region: "", category: "", price: "", currency: "USD", blurb: "", image: "" } : (A.tours.find(x => x.id === state.editId) || A.tours[0]);
  const [dirty, setDirty] = React.useState(false);
  const [published, setPublished] = React.useState(!isNew);
  const [toast, setToast] = React.useState(null);
  const [regions, setRegions] = React.useState(window.TK_DATA.regions.slice());
  const [region, setRegion] = React.useState(t.region || "");
  const [addingRegion, setAddingRegion] = React.useState(false);
  const [newRegion, setNewRegion] = React.useState("");
  const commitRegion = () => { const v = newRegion.trim(); if (!v) return; window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.createRegion(v), () => { window.TK_ADD_REGION(v); setRegions(window.TK_DATA.regions.slice()); setRegion(v); setNewRegion(""); setAddingRegion(false); touch(); setToast("Region “" + v + "” added — now live in browse filters and the Regions page"); }); };
  const media = (t.image ? [{ id: "m0", src: t.image, alt: t.title }] : []).concat(
    isNew ? [] : [1, 2, 3].map(i => ({ id: "m" + i, src: t.image, alt: "" })));
  const [cover, setCover] = React.useState("m0");
  const touch = () => setDirty(true);

  // Collect the form (DS FormField injects each field's id onto its control, so
  // the uncontrolled inputs are readable by id) and persist via the write API
  // when live. USD is the currency of record; the server owns pricing/FX. Flag
  // off → the optimistic toast path is exactly the prototype's.
  const val = (id) => { const el = document.getElementById(id); return el ? el.value : ""; };
  const lines = (id) => val(id).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const doSave = () => {
    const optimistic = () => { setDirty(false); setToast(isNew ? "Tour created" : "Tour saved"); };
    window.TK_ADMIN_ACT(
      () => window.TK_ADMIN_API.saveTour({
        id: isNew ? "new" : (t._apiId || state.editId),
        title: val("e-title"), region: region, category: val("e-cat"), duration: val("e-dur"),
        blurb: val("e-blurb"), highlights: lines("e-high"), included: lines("e-inc"), excluded: lines("e-exc"),
        currency: val("e-cur") || "USD", published: published,
      }),
      optimistic
    );
  };

  const Section = ({ title, hint, children }) => (
    <div className="tk-formsection">
      <div className="tk-formsection__aside"><h3>{title}</h3><p>{hint}</p></div>
      <div className="tk-formsection__body">{children}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ maxWidth: 900 }}>
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
          <MediaManager items={media} coverId={cover} onSetCover={(id) => { setCover(id); touch(); }} onRemove={touch} onReorder={touch} onUpload={touch} />
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
              <IconButton icon="sliders-horizontal" label="Adjust capacity" variant="ghost" size="sm" onClick={() => window.tkToast("Capacity editor — open the departure to adjust")} />
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
