const NS = window.TripKoachDesignSystem_c9e4af;
const { StatCard, MiniChart, DataTable, StatusBadge, Button, Icon, Price, AuditTimeline, EmptyState, Select } = NS;

const PERIODS = {
  "12h": { label: "Last 12 hours", short: "last 12h", bookings: "7", confirmed: 5, revenue: "$4,120", bDelta: "+3%",
    series: [{label:"08:00",value:0},{label:"09:00",value:1},{label:"10:00",value:0},{label:"11:00",value:2},{label:"12:00",value:1},{label:"13:00",value:0},{label:"14:00",value:1},{label:"15:00",value:0},{label:"16:00",value:1},{label:"17:00",value:0},{label:"18:00",value:1},{label:"19:00",value:0}],
    trend: "Bookings trickled in through the afternoon, peaking mid-morning" },
  "24h": { label: "Last 24 hours", short: "last 24h", bookings: "13", confirmed: 9, revenue: "$8,240", bDelta: "+6%",
    series: [{label:"20:00",value:1},{label:"21:00",value:0},{label:"22:00",value:1},{label:"23:00",value:0},{label:"00:00",value:0},{label:"01:00",value:0},{label:"02:00",value:0},{label:"03:00",value:0},{label:"04:00",value:0},{label:"05:00",value:0},{label:"06:00",value:1},{label:"07:00",value:0},{label:"08:00",value:1},{label:"09:00",value:2},{label:"10:00",value:1},{label:"11:00",value:1},{label:"12:00",value:0},{label:"13:00",value:1},{label:"14:00",value:1},{label:"15:00",value:0},{label:"16:00",value:1},{label:"17:00",value:0},{label:"18:00",value:0},{label:"19:00",value:0}],
    trend: "Bookings quiet overnight, picking up from mid-morning" },
  "7d": { label: "Last 7 days", short: "this week", bookings: "38", confirmed: 24, revenue: "$24,180", bDelta: "+12%",
    series: [{label:"Mon",value:4},{label:"Tue",value:6},{label:"Wed",value:5},{label:"Thu",value:8},{label:"Fri",value:7},{label:"Sat",value:9},{label:"Sun",value:6}],
    trend: "Bookings rose from 4 on Monday to 9 on Sunday" },
  "30d": { label: "Last 30 days", short: "this month", bookings: "164", confirmed: 118, revenue: "$98,600", bDelta: "+9%",
    series: [{label:"Wk 1",value:31},{label:"Wk 2",value:38},{label:"Wk 3",value:44},{label:"Wk 4",value:51}],
    trend: "Bookings climbed week over week, from 31 to 51" },
  "90d": { label: "Last 90 days", short: "this quarter", bookings: "472", confirmed: 361, revenue: "$286,400", bDelta: "+18%",
    series: [{label:"Jun",value:132},{label:"Jul",value:151},{label:"Aug",value:189}],
    trend: "Bookings grew each month, from 132 in June to 189 in August" },
  "ytd": { label: "Year to date", short: "this year", bookings: "1,284", confirmed: 1012, revenue: "$742,900", bDelta: "+26%",
    series: [{label:"Q1",value:298},{label:"Q2",value:372},{label:"Q3",value:441},{label:"Q4",value:173}],
    trend: "Bookings by quarter, peaking at 441 in Q3" },
};

// TRI-1130: "Custom range…" period. When picked the two date inputs drive a live
// getDashboard(from,to) query; until both are set we synthesise an empty P so the
// header/labels read sensibly and the chart falls back to an empty series.
function fmtYMD(ymd) {
  const d = ymd ? new Date(ymd + "T00:00:00") : null;
  if (!d || isNaN(d.getTime())) return ymd || "";
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return d.getDate() + " " + MON[d.getMonth()] + " " + d.getFullYear();
}
function customPeriod(range) {
  const label = (range.from && range.to) ? (fmtYMD(range.from) + " – " + fmtYMD(range.to)) : "custom range";
  return { label: label, short: "in range", bookings: "0", confirmed: 0, revenue: "$0", bDelta: null, series: [], trend: "No bookings in the selected range" };
}

function Dashboard({ go, state, role = "admin" }) {
  const A = window.TK_ADMIN;
  const [period, setPeriod] = React.useState("7d");
  // TRI-1130: custom date range (yyyy-mm-dd) for the "Custom range…" option.
  const [range, setRange] = React.useState({ from: "", to: "" });
  const customActive = period === "custom";
  const rangeReady = customActive && !!range.from && !!range.to;
  const P = PERIODS[period] || customPeriod(range);
  const LIVE = !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API);
  // Live aggregates (TRI-898 GET /dashboard). Pre-hydrated at boot for the default
  // "7d" range; refetched whenever the range changes. Flag off ⇒ stays null and
  // every derived value below falls back to the mock literals (byte-identical).
  const [agg, setAgg] = React.useState(() => (LIVE && A && A.dashboard) || null);
  React.useEffect(() => {
    if (!LIVE || !window.TK_ADMIN_API) return;
    if (customActive && !rangeReady) return; // wait until both range dates are chosen
    let off = false;
    const req = customActive
      ? window.TK_ADMIN_API.getDashboard(null, range.from, range.to)
      : window.TK_ADMIN_API.getDashboard(period);
    req.then(
      (d) => { if (!off && d) { setAgg(d); if (A) A.dashboard = d; } },
      () => {}
    );
    return () => { off = true; };
  }, [period, range.from, range.to]);
  const loading = state.dashView === "loading";
  const empty = state.dashView === "empty";
  const pending = A.bookings.filter(b => b.status === "pending");
  const upcoming = A.departures.filter(d => d.status === "scheduled").slice(0, 5);

  // --- live-derived display values (all default to the prototype literals) ----
  // TRI-1130: while a custom range is half-selected, suppress agg so we show zeros
  // for the range rather than the previously-loaded period's numbers.
  const live = (LIVE && agg && !(customActive && !rangeReady)) ? agg : null;
  const dateInput = { minHeight: 34, padding: "4px 8px", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", background: "var(--bg-surface)", color: "var(--text-strong)", fontSize: 13, colorScheme: "light dark" };
  const bs = live ? (live.bookings.byStatus || {}) : null;
  const n = (v) => (typeof v === "number" ? v : 0);
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const statBookings = live ? n(live.bookings.total).toLocaleString() : P.bookings;
  const statConfirmed = live ? n(bs.confirmed) : P.confirmed;
  const statRevenue = live ? "$" + n(live.revenue.usd).toLocaleString() : P.revenue;
  const statCapacity = live ? (n(live.occupancy.utilizationPct) + "%") : "71%";
  const statPending = live ? String(n(bs.pending)) : "5";
  const statDepartures = live ? String(n(live.departures.upcoming)) : "6";
  const statTravellers = live ? String(n(live.occupancy.seatsReserved)) : "34";
  // Live status breakdown — drives the right-hand donut, and the main chart when
  // the backend returns no time series.
  const statusBars = live ? Object.keys(bs).map((k) => ({ label: cap(k), value: n(bs[k]) })) : null;
  // Main activity chart: prefer the real booking time series (TRI-984 — hourly
  // for 12h/24h, daily/weekly/monthly for longer ranges); fall back to the status
  // breakdown if the backend omits it, and to the mock trend when the flag is off.
  const timeSeries = (live && Array.isArray(live.series) && live.series.length) ? live.series : null;
  const chartType = timeSeries ? "line" : (live ? "bar" : "line");
  const chartData = timeSeries || (live ? statusBars : P.series);
  const seriesTotal = timeSeries ? timeSeries.reduce((s, d) => s + n(d.value), 0) : 0;
  const chartAria = timeSeries
    ? ("New bookings over " + P.label.toLowerCase() + ", " + seriesTotal + " total across " + timeSeries.length + " intervals")
    : (live ? ("Bookings by status: " + statusBars.map((d) => d.value + " " + d.label.toLowerCase()).join(", ")) : P.trend);
  // Right-hand donut: revenue-by-region is fixture-only, so live shows the real
  // bookings-by-status split for both roles.
  const donutTitle = live ? "Bookings by status" : (role === "admin" ? "Revenue by region" : "Bookings by status");
  const donutData = live ? statusBars : (role === "admin"
    ? [{label:"Central",value:9600},{label:"Greater Accra",value:7200},{label:"Eastern",value:4180},{label:"Other",value:3200}]
    : [{label:"Confirmed",value:82},{label:"Pending",value:41},{label:"Cancelled",value:12}]);
  const donutAria = live
    ? ("Bookings by status: " + statusBars.map((d) => d.value + " " + d.label.toLowerCase()).join(", "))
    : (role === "admin"
      ? "Revenue $9,600 Central, $7,200 Greater Accra, $4,180 Eastern, $3,200 other"
      : "82 confirmed, 41 pending, 12 cancelled");

  if (empty) {
    return <EmptyState icon="compass" title="No activity yet"
      body="Once tours are published and bookings start coming in, this dashboard fills with today's numbers."
      action={<Button onClick={() => go("tours")}>Set up your first tour</Button>} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {role === "admin" ? <>
          <StatCard loading={loading} label={"Bookings " + P.short} value={statBookings} icon="ticket" delta={live ? null : P.bDelta} deltaDir="up" hint={"vs previous " + P.label.toLowerCase().replace("last ", "")} />
          <StatCard loading={loading} label="Expected revenue" value={statRevenue} icon="wallet" delta={live ? null : "+8%"} deltaDir="up" hint={P.short} />
          <StatCard loading={loading} label="Capacity utilization" value={statCapacity} icon="users" delta={live ? null : "+4pts"} deltaDir="up" hint="next 30 days" />
          <StatCard loading={loading} label="Pending confirmation" value={statPending} icon="clock" delta={live ? null : "2 over 24h"} deltaDir="down" hint="act soon" />
        </> : <>
          <StatCard loading={loading} label="Pending confirmation" value={statPending} icon="clock" delta={live ? null : "2 over 24h"} deltaDir="down" hint="act soon" />
          <StatCard loading={loading} label={"Departures " + P.short} value={statDepartures} icon="calendar-days" delta={live ? null : "2 today"} deltaDir="flat" />
          <StatCard loading={loading} label="Travellers to host" value={statTravellers} icon="users" delta={live ? null : "next 7 days"} deltaDir="flat" />
          <StatCard loading={loading} label="Capacity utilization" value={statCapacity} icon="compass" delta={live ? null : "+4pts"} deltaDir="up" hint="next 30 days" />
        </>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, alignItems: "start" }}>
        <div className="tk-chartcard">
          <div className="tk-row" style={{ justifyContent: "space-between", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
            <div><h3 className="tk-h5" style={{ margin: 0 }}>Bookings, {P.label.toLowerCase()}</h3><p className="tk-caption">{statBookings} new bookings · {statConfirmed} confirmed</p></div>
            <div className="tk-row" style={{ gap: 12, flexWrap: "wrap" }}>
              <Select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 150, minHeight: 36 }}
                options={[{ value: "12h", label: "Last 12 hours" }, { value: "24h", label: "Last 24 hours" }, { value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" }, { value: "90d", label: "Last 90 days" }, { value: "ytd", label: "Year to date" }, { value: "custom", label: "Custom range…" }]} />
              {customActive && (
                <div className="tk-row" style={{ gap: 6 }}>
                  <input type="date" aria-label="From date" value={range.from} max={range.to || undefined} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} style={dateInput} />
                  <span style={{ color: "var(--text-muted)" }}>–</span>
                  <input type="date" aria-label="To date" value={range.to} min={range.from || undefined} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} style={dateInput} />
                </div>
              )}
              <div className="tk-legend"><span><i style={{ background: "var(--chart-1)" }} />New bookings</span></div>
            </div>
          </div>
          {loading ? <span className="tk-skeleton" style={{ display: "block", height: 160, borderRadius: 8 }} />
            : <MiniChart type={chartType} height={180} ariaLabel={chartAria} data={chartData} />}
        </div>
        <div className="tk-chartcard">
          <h3 className="tk-h5" style={{ margin: "0 0 14px" }}>{donutTitle}</h3>
          {loading ? <span className="tk-skeleton" style={{ display: "block", height: 140, borderRadius: 8 }} />
            : <MiniChart type="donut" ariaLabel={donutAria} data={donutData} />}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, alignItems: "start" }}>
        <div>
          <div className="tk-row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <h3 className="tk-h5" style={{ margin: 0 }}>Needs your attention · {pending.length} pending</h3>
            <Button variant="link" size="sm" onClick={() => go("bookings")}>View all bookings</Button>
          </div>
          <div className="tk-tablewrap">
            <DataTable density="compact" loading={loading} onRowClick={(r) => go("bookings", r.ref)}
              columns={[
                { key: "ref", header: "Ref", strong: true },
                { key: "customer", header: "Customer" },
                { key: "tour", header: "Tour", render: r => <span className="tk-truncate" style={{ maxWidth: 180, display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>{r.tour}</span> },
                { key: "total", header: "Amount", align: "end", render: r => <Price amount={r.total} currency="USD" /> },
                { key: "status", header: "Status", render: r => <StatusBadge status={r.status} size="sm" /> },
              ]}
              rows={pending} getRowId={r => r.ref}
              empty={<EmptyState icon="check" title="Nothing pending" body="Every booking is confirmed or closed. Nice." />} />
          </div>
        </div>
        <div>
          <div className="tk-row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <h3 className="tk-h5" style={{ margin: 0 }}>Upcoming departures</h3>
            <Button variant="link" size="sm" onClick={() => go("departures")}>Manage</Button>
          </div>
          <div className="tk-card"><div className="tk-card__body" style={{ padding: 0 }}>
            {upcoming.map((d, i) => (
              <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: i ? "1px solid var(--border-subtle)" : "none" }}>
                <span style={{ flex: "none", width: 40, height: 40, borderRadius: "var(--radius-md)", background: "var(--bg-sunken)", display: "grid", placeItems: "center", color: "var(--text-muted)" }}><Icon name="calendar-days" size={18} /></span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.tour}</div>
                  <div className="tk-caption">{d.date} · {d.booked}/{d.capacity} booked</div>
                </div>
                {d.spotsLeft <= 3 && d.spotsLeft > 0 && <span className="tk-badge tk-badge--pending" style={{ flex: "none" }}>{d.spotsLeft} left</span>}
              </div>
            ))}
          </div></div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        {(role === "admin"
          ? [["Create tour","plus","tours"],["Add departure","calendar-days","departures"],["Export bookings","download","bookings"],["Invite staff","users","users"]]
          : [["Confirm pending","check","bookings"],["Add departure","calendar-days","departures"],["Export bookings","download","bookings"],["View customers","users","customers"]]
        ).map(([l,ic,to]) => (
          <button key={l} type="button" onClick={() => go(to)} className="tk-card tk-card--interactive" style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px", cursor: "pointer", textAlign: "start", border: "1px solid var(--border-subtle)" }}>
            <span style={{ width: 40, height: 40, borderRadius: "var(--radius-md)", background: "var(--brand-wash)", color: "var(--brand-gold-deep)", display: "grid", placeItems: "center" }}><Icon name={ic} size={19} /></span>
            <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text-strong)" }}>{l}</span>
            <Icon name="chevron-right" size={16} style={{ marginInlineStart: "auto", color: "var(--text-muted)" }} />
          </button>
        ))}
      </div>
    </div>
  );
}
Object.assign(window, { Dashboard });
