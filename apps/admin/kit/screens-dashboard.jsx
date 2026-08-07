const NS = window.TripKoachDesignSystem_c9e4af;
const { StatCard, MiniChart, DataTable, StatusBadge, Button, Icon, Price, AuditTimeline, EmptyState, Select } = NS;

const PERIODS = {
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

function Dashboard({ go, state, role = "admin" }) {
  const A = window.TK_ADMIN;
  const [period, setPeriod] = React.useState("7d");
  const P = PERIODS[period];
  const loading = state.dashView === "loading";
  const empty = state.dashView === "empty";
  const pending = A.bookings.filter(b => b.status === "pending");
  const upcoming = A.departures.filter(d => d.status === "scheduled").slice(0, 5);

  if (empty) {
    return <EmptyState icon="compass" title="No activity yet"
      body="Once tours are published and bookings start coming in, this dashboard fills with today's numbers."
      action={<Button onClick={() => go("tours")}>Set up your first tour</Button>} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {role === "admin" ? <>
          <StatCard loading={loading} label={"Bookings " + P.short} value={P.bookings} icon="ticket" delta={P.bDelta} deltaDir="up" hint={"vs previous " + P.label.toLowerCase().replace("last ", "")} />
          <StatCard loading={loading} label="Expected revenue" value={P.revenue} icon="wallet" delta="+8%" deltaDir="up" hint={P.short} />
          <StatCard loading={loading} label="Capacity utilization" value="71%" icon="users" delta="+4pts" deltaDir="up" hint="next 30 days" />
          <StatCard loading={loading} label="Pending confirmation" value="5" icon="clock" delta="2 over 24h" deltaDir="down" hint="act soon" />
        </> : <>
          <StatCard loading={loading} label="Pending confirmation" value="5" icon="clock" delta="2 over 24h" deltaDir="down" hint="act soon" />
          <StatCard loading={loading} label={"Departures " + P.short} value="6" icon="calendar-days" delta="2 today" deltaDir="flat" />
          <StatCard loading={loading} label="Travellers to host" value="34" icon="users" delta="next 7 days" deltaDir="flat" />
          <StatCard loading={loading} label="Capacity utilization" value="71%" icon="compass" delta="+4pts" deltaDir="up" hint="next 30 days" />
        </>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, alignItems: "start" }}>
        <div className="tk-chartcard">
          <div className="tk-row" style={{ justifyContent: "space-between", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
            <div><h3 className="tk-h5" style={{ margin: 0 }}>Bookings, {P.label.toLowerCase()}</h3><p className="tk-caption">{P.bookings} new bookings · {P.confirmed} confirmed</p></div>
            <div className="tk-row" style={{ gap: 12 }}>
              <Select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 150, minHeight: 36 }}
                options={[{ value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" }, { value: "90d", label: "Last 90 days" }, { value: "ytd", label: "Year to date" }]} />
              <div className="tk-legend"><span><i style={{ background: "var(--chart-1)" }} />New bookings</span></div>
            </div>
          </div>
          {loading ? <span className="tk-skeleton" style={{ display: "block", height: 160, borderRadius: 8 }} />
            : <MiniChart type="line" height={180} ariaLabel={P.trend} data={P.series} />}
        </div>
        <div className="tk-chartcard">
          <h3 className="tk-h5" style={{ margin: "0 0 14px" }}>{role === "admin" ? "Revenue by region" : "Bookings by status"}</h3>
          {loading ? <span className="tk-skeleton" style={{ display: "block", height: 140, borderRadius: 8 }} />
            : role === "admin"
              ? <MiniChart type="donut" ariaLabel="Revenue $9,600 Central, $7,200 Greater Accra, $4,180 Eastern, $3,200 other"
                  data={[{label:"Central",value:9600},{label:"Greater Accra",value:7200},{label:"Eastern",value:4180},{label:"Other",value:3200}]} />
              : <MiniChart type="donut" ariaLabel="82 confirmed, 41 pending, 12 cancelled"
                  data={[{label:"Confirmed",value:82},{label:"Pending",value:41},{label:"Cancelled",value:12}]} />}
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
