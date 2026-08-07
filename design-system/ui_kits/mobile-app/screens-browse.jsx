const { TourCard, SearchField, Chip, Button, IconButton, Icon, Skeleton, EmptyState, Alert, Pagination, Select, CurrencyToggle } = window.TripKoachDesignSystem_c9e4af;

const M_PRICE = [{ label: "Under $200", test: p => p < 200 }, { label: "$200–600", test: p => p >= 200 && p <= 600 }, { label: "$600–1,200", test: p => p > 600 && p <= 1200 }, { label: "$1,200+", test: p => p > 1200 }];
const M_DUR = [{ label: "Half day", test: d => /half day|hrs/i.test(d) }, { label: "Full day", test: d => /full day/i.test(d) }, { label: "Multi-day", test: d => /days|nights?/i.test(d) }];
function mMatches(t, f) {
  if (f.region.length && !f.region.includes(t.region)) return false;
  if (f.category.length && !f.category.includes(t.category)) return false;
  if (f.price.length && !f.price.some(l => (M_PRICE.find(b => b.label === l) || {}).test?.(t.price))) return false;
  if (f.duration.length && !f.duration.some(l => (M_DUR.find(b => b.label === l) || {}).test?.(t.duration))) return false;
  return true;
}
const M_EMPTY = { region: [], price: [], duration: [], category: [] };

function FilterSheet({ open, onClose, filters, onApply, count }) {
  const [draft, setDraft] = React.useState(filters);
  React.useEffect(() => { if (open) setDraft(filters); }, [open]);
  if (!open) return null;
  const toggle = (key, val) => setDraft(f => ({ ...f, [key]: f[key].includes(val) ? f[key].filter(x => x !== val) : [...f[key], val] }));
  const cats = [...new Set(window.TK_DATA.tours.map(t => t.category))];
  const shown = window.TK_DATA.tours.filter(t => mMatches(t, draft)).length;
  const groups = [["Region", "region", window.TK_DATA.regions.slice(0, 6)], ["Price per person", "price", M_PRICE.map(b => b.label)], ["Duration", "duration", M_DUR.map(b => b.label)], ["Category", "category", cats]];
  return (
    <div className="tk-scrim" style={{ position: "absolute", alignItems: "flex-end", padding: 0 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tk-sheet" style={{ position: "relative" }} role="dialog" aria-modal="true" aria-label="Filter tours">
        <span className="tk-sheet__grip" />
        <div className="tk-stack" style={{ gap: "var(--space-4)" }}>
          <h2 className="tk-h4">Filter tours</h2>
          {groups.map(([label, key, opts]) => (
            <div className="tk-stack" key={key} style={{ gap: "var(--space-2)" }}>
              <span className="tk-label">{label}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {opts.map(o => { const on = draft[key].includes(o); return <Chip key={o} active={on} onClick={() => toggle(key, o)} onRemove={on ? () => toggle(key, o) : undefined}>{o}</Chip>; })}
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" onClick={() => setDraft(M_EMPTY)}>Clear all</Button>
            <Button block onClick={() => { onApply(draft); onClose(); }}>Show {shown} {shown === 1 ? "tour" : "tours"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BrowseScreen({ go, state, setState }) {
  const [sheet, setSheet] = React.useState(false);
  const filters = state.filters || M_EMPTY;
  const setFilters = (f) => setState({ filters: f });
  const removeChip = (key, val) => setFilters({ ...filters, [key]: filters[key].filter(x => x !== val) });
  const view = state.browseView || "results";
  const q = state.q || "";
  const tours = window.TK_DATA.tours;
  const shown = tours.filter(t => mMatches(t, filters) && (!q || (t.title + t.region + t.category).toLowerCase().includes(q.toLowerCase())));
  const applied = ["region", "price", "duration", "category"].flatMap(k => filters[k].map(v => ({ k, v })));
  const isEmpty = view === "empty" || (view === "results" && shown.length === 0);
  return (
    <div style={{ position: "relative", minHeight: "100%" }}>
      <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <div>
          <p className="tk-overline">Ghana · 9 regions</p>
          <h1 className="tk-h2" style={{ marginTop: 4 }}>Find your next trip</h1>
        </div>
        <SearchField value={q} onChange={(e) => setState({ q: e.target.value })} onClear={() => setState({ q: "" })} />
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
          <Button size="sm" variant="secondary" iconStart="sliders-horizontal" onClick={() => setSheet(true)}>Filters{applied.length ? " · " + applied.length : ""}</Button>
          {applied.map(({ k, v }) => <Chip key={k + v} active onRemove={() => removeChip(k, v)}>{v}</Chip>)}
        </div>
        <div className="tk-row" style={{ justifyContent: "space-between", gap: 8 }}>
          <p className="tk-caption" aria-live="polite">
            {view === "loading" ? "Loading tours…" : isEmpty ? "No tours match" : shown.length + " " + (shown.length === 1 ? "tour" : "tours") + " across Ghana"}
          </p>
          <div className="tk-row" style={{ gap: 8 }}>
            <CurrencyToggle value={state.currency || "USD"} onChange={(c) => setState({ currency: c })} />
            <Select aria-label="Sort tours" style={{ width: 130, minHeight: 36, padding: "4px 34px 4px 10px", fontSize: 13 }}
              options={[{ value: "pop", label: "Most popular" }, { value: "price", label: "Price: low to high" }, { value: "soon", label: "Departing soon" }]} />
          </div>
        </div>

        {state.offline && (
          <Alert tone="warning" title="You are offline">Showing tours saved on this device. Prices may have changed.</Alert>
        )}

        {view === "loading" && (
          <div aria-busy="true" style={{ display: "grid", gap: "var(--space-4)" }}>
            {[0,1,2].map(i => (
              <div className="tk-card" key={i}><Skeleton height={150} radius="0" />
                <div className="tk-card__body"><Skeleton height={10} width="40%" /><Skeleton height={16} /><Skeleton height={16} width="70%" />
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}><Skeleton height={22} width={110} /><Skeleton height={32} width={70} radius="var(--radius-sm)" /></div>
                </div></div>
            ))}
            <span className="tk-sr-only" role="status">Loading tours</span>
          </div>
        )}

        {view !== "loading" && isEmpty && (
          <EmptyState icon="compass" title="No tours match those filters"
            body="Try widening the price range or clearing a region — there are 11 tours running this season."
            action={<Button variant="secondary" onClick={() => { setFilters(M_EMPTY); setState({ browseView: "results", q: "" }); }}>Clear filters</Button>} />
        )}

        {view !== "loading" && !isEmpty && (
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            {shown.map(t => (
              <div key={t.id} onClick={() => go("tour", { tour: t })}>
                <TourCard {...t} price={window.tkCvt(t.price, state.currency || "USD")} currency={state.currency || "USD"} reviewCount={t.reviews} href="#" />
              </div>
            ))}
            <Pagination page={1} pages={1} resultsLabel={"Showing " + shown.length + " of " + tours.length + " tours"} />
          </div>
        )}
      </div>
      <FilterSheet open={sheet} onClose={() => setSheet(false)} filters={filters} onApply={setFilters} />
    </div>
  );
}
Object.assign(window, { BrowseScreen, FilterSheet });
