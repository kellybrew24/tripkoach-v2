const NS = window.TripKoachDesignSystem_c9e4af;
const { Button, Icon, Alert, Accordion, FormField, Input, Select, Textarea, Checkbox, Badge, Chip, EmptyState } = NS;

const IMG = (slug) => "https://cdn.tripkoach.com/img/tours/" + slug + "/hero-480.jpg";

function PageHero({ overline, title, sub, children, dark = true, image }) {
  return (
    <section style={{ position: "relative", overflow: "hidden", background: dark ? "var(--n-900)" : "var(--brand-wash)", color: dark ? "var(--n-0)" : "var(--text-strong)", borderBottom: dark ? "none" : "1px solid var(--border-subtle)" }}>
      {image && <><img src={image} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.32 }} /><span style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(20,19,18,.4), rgba(20,19,18,.82))" }} /></>}
      <div className="tk-container" style={{ position: "relative", maxWidth: 1200, paddingBlock: "var(--space-12)" }}>
        <span className="tk-overline" style={{ color: dark ? "var(--gold-400)" : "var(--gold-700)" }}>{overline}</span>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1.0, fontSize: "clamp(38px,5vw,68px)", margin: "12px 0 0", maxWidth: "18ch", textWrap: "balance" }}>{title}</h1>
        {sub && <p style={{ fontSize: "clamp(17px,1.5vw,20px)", lineHeight: 1.55, marginTop: "var(--space-4)", maxWidth: "56ch", color: dark ? "rgba(255,255,255,.85)" : "var(--text-muted)" }}>{sub}</p>}
        {children && <div style={{ marginTop: "var(--space-6)", display: "flex", gap: 12, flexWrap: "wrap" }}>{children}</div>}
      </div>
    </section>
  );
}
const Wrap = ({ children, style }) => <section className="tk-container" style={{ maxWidth: 1200, paddingBlock: "var(--space-12)", ...style }}>{children}</section>;
const CTA = ({ go }) => (
  <div style={{ background: "var(--n-900)", color: "var(--n-0)" }}>
    <Wrap style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-5)" }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 800, letterSpacing: "-0.03em", fontSize: "clamp(30px,3.6vw,48px)", margin: 0 }}>Ready when you are.</h2>
      <p className="tk-body-lg" style={{ color: "rgba(255,255,255,.82)", maxWidth: "48ch" }}>Tell us where in Ghana you'd like to go, and we'll line up a tour, a guide, and the connectivity you need.</p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
        <Button size="lg" variant="accent" iconEnd="arrow-right" onClick={() => go("contact")}>Plan a trip</Button>
        <Button size="lg" variant="ghost" style={{ color: "var(--n-0)", borderColor: "rgba(255,255,255,.3)" }} onClick={() => go("browse")}>Browse tours</Button>
      </div>
    </Wrap>
  </div>
);

/* ── REGIONS ─────────────────────────────────────────── */
const REGION_NOTES = {
  "Greater Accra": { slug: "accra-city-tour", note: "The capital, its coast and its markets — Independence Square to Makola." },
  "Central": { slug: "coastal-history-trail", note: "Heritage castles at Cape Coast and Elmina, and the Kakum canopy walk." },
  "Eastern": { slug: "aburi-akosombo-and-boti-falls", note: "Aburi's botanical gardens, Lake Volta at Akosombo and Boti Falls." },
  "Western": { slug: "a-christmas-like-no-other", note: "Surf coast, old forts and the Ankos Festival at Christmas." },
  "Volta": { slug: "volta-mountains-and-monkeys", note: "Wli Falls, the Avatime hills and the monkeys of Tafi Atome." },
  "Northern": { slug: "northern-savannah-safari", note: "Mole National Park on foot and Larabanga's ancient mosque." },
  "Savannah": { slug: "northern-savannah-safari", note: "Wide-open plains and the gateway to the northern game country." },
  "Upper East": { slug: "upper-east-bolga-paga-and-sirigu", note: "Paga's sacred crocodiles, painted Sirigu and Bolga's basket market." },
};
function RegionsPage({ go }) {
  const regions = (window.TK_DATA.regions || []).map(name => {
    const tours = window.TK_REGION_TOURS ? window.TK_REGION_TOURS(name) : [];
    const meta = REGION_NOTES[name] || {};
    return { name, count: tours.length, slug: meta.slug || (tours[0] && tours[0].id) || "accra-city-tour", note: meta.note || "New tours in " + name + " are being added — check back soon." };
  });
  const n = regions.length;
  return (
    <div>
      <PageHero overline="Where to go" title={n + " regions of Ghana, more to come."}
        sub={"Ghana has sixteen administrative regions. TripKoach runs tours in " + n + " of them today — pick one to see who hosts there and which trips are running this season."} />
      <Wrap>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "var(--space-5)" }}>
          {regions.map(r => (
            <a key={r.name + r.slug} href="#browse" onClick={(e) => { e.preventDefault(); go("browse"); }}
              className="tk-card tk-card--interactive" style={{ display: "flex", overflow: "hidden", textDecoration: "none", color: "inherit" }}>
              <div className="tk-media" style={{ flex: "0 0 38%", aspectRatio: "1" }}><img src={IMG(r.slug)} alt="" loading="lazy" /></div>
              <div className="tk-card__body" style={{ justifyContent: "center", gap: "var(--space-2)" }}>
                <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <span className="tk-h4">{r.name}</span>
                  <span className="tk-badge tk-badge--neutral">{r.count} {r.count === 1 ? "tour" : "tours"}</span>
                </span>
                <p className="tk-body-sm" style={{ color: "var(--text-muted)", margin: 0 }}>{r.note}</p>
              </div>
            </a>
          ))}
        </div>
      </Wrap>
      <CTA go={go} />
    </div>
  );
}

/* ── eSIM ────────────────────────────────────────────── */
function EsimPage({ go }) {
  return (
    <div>
      <PageHero overline="Connectivity, sorted" title="Connected the second you land."
        sub="Every TripKoach booking includes a Ghana eSIM, set up before your flight touches down. No SIM swap, no roaming bill, no scavenger hunt at Kotoka.">
        <Button size="lg" variant="accent" onClick={() => go("contact")}>Plan a trip with eSIM</Button>
        <Button size="lg" variant="ghost" style={{ color: "var(--n-0)", borderColor: "rgba(255,255,255,.3)" }} iconStart="message-circle" onClick={() => window.open("https://wa.me/233200000000", "_blank")}>Message on WhatsApp</Button>
      </PageHero>
      <Wrap style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-10)", alignItems: "center" }}>
        <div>
          <span className="tk-overline" style={{ color: "var(--gold-700)" }}>Comes with your trip</span>
          <h2 className="tk-h1" style={{ marginTop: 8 }}>It's part of the package.</h2>
          <p className="tk-body-lg" style={{ color: "var(--text-muted)", marginTop: "var(--space-3)" }}>
            Pick a tour, confirm your booking, and we hand you a QR before you fly. Scan it the day before departure and your data is live the moment you clear customs. Works on iPhone XS or newer and most flagship Androids from the last five years.
          </p>
          <ul style={{ listStyle: "none", margin: "var(--space-5) 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {["Bundled with every confirmed TripKoach booking — one per traveler.", "Works on the local Ghana network. Keep your home SIM for calls.", "Connects on landing. No queue at the airport, no scratch cards."].map(x => (
              <li key={x} style={{ display: "flex", gap: 10, fontSize: 16 }}><Icon name="check" size={18} style={{ color: "var(--success-fg)", marginTop: 2 }} />{x}</li>
            ))}
          </ul>
        </div>
        <div style={{ background: "var(--n-900)", borderRadius: "var(--radius-2xl)", padding: "clamp(28px,4vw,48px)", color: "var(--n-0)", textAlign: "center", boxShadow: "var(--elev-3)" }}>
          <div style={{ width: 132, height: 132, margin: "0 auto", borderRadius: "var(--radius-lg)", background: "var(--n-0)", display: "grid", placeItems: "center" }}>
            <div style={{ width: 104, height: 104, background: "conic-gradient(from 0deg, var(--n-900) 0 25%, transparent 0 50%, var(--n-900) 0 75%, transparent 0)", backgroundSize: "26px 26px", borderRadius: 6 }} />
          </div>
          <p style={{ fontWeight: 800, fontSize: 20, marginTop: "var(--space-4)", letterSpacing: "-0.02em" }}>5GB free on arrival</p>
          <p style={{ color: "rgba(255,255,255,.7)", fontSize: 14, marginTop: 4 }}>Scan the day before you fly</p>
        </div>
      </Wrap>
      <Wrap style={{ paddingTop: 0 }}>
        <Alert tone="info" title="More coming soon">A standalone eSIM product — available without a tour booking, with regional plans and top-ups in-app — is on the roadmap for our next phase.</Alert>
      </Wrap>
      <CTA go={go} />
    </div>
  );
}

/* ── AIRPORT PICKUP ──────────────────────────────────── */
function PickupPage({ go }) {
  const steps = [
    ["Tell us your flight", "Share your arrival date, flight number, party size, and where you're staying in Accra."],
    ["We confirm within 24 hours", "You'll get a fixed quote and a named driver — no card on file, no surprise charges."],
    ["Driver meets you in arrivals", "Look for your name on a TripKoach placard at the Kotoka exit. We track your flight, so delays are on us."],
  ];
  const included = ["Meet and greet inside the arrivals hall, name placard in hand", "Direct private transfer to your Accra accommodation — no shared shuttle, no stops", "English-speaking driver who knows the city and its routes", "Bottled water on board and help with luggage", "24/7 trip support by phone or WhatsApp from booking to arrival"];
  return (
    <div>
      <PageHero overline="Arrival · Kotoka International" title="Land in Accra, already taken care of."
        image="https://cdn.tripkoach.com/img/services/airport-pickup.jpg"
        sub="Tell us your flight; a TripKoach driver meets you at Kotoka with a name placard and takes you straight to your Accra address. No queue, no surge fare, no language barrier.">
        <Button size="lg" variant="accent" iconEnd="arrow-right" onClick={() => document.getElementById("pickup-form").scrollIntoView({ behavior: "smooth" })}>Request a pickup</Button>
      </PageHero>
      <Wrap>
        <span className="tk-overline" style={{ color: "var(--gold-700)" }}>How it works</span>
        <h2 className="tk-h1" style={{ marginTop: 8, marginBottom: "var(--space-8)" }}>Three steps, door to door.</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-5)" }}>
          {steps.map(([t, d], i) => (
            <div key={t} className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-6)", gap: "var(--space-3)" }}>
              <span style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--brand-ink)", color: "var(--n-0)", display: "grid", placeItems: "center", fontWeight: 800, fontFamily: "var(--font-display)" }}>{i + 1}</span>
              <h3 className="tk-h5" style={{ margin: 0 }}>{t}</h3>
              <p className="tk-body-sm" style={{ color: "var(--text-muted)", margin: 0 }}>{d}</p>
            </div></div>
          ))}
        </div>
      </Wrap>
      <div style={{ background: "var(--brand-wash)", borderBlock: "1px solid var(--border-subtle)" }}>
        <Wrap style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-10)" }}>
          <div>
            <span className="tk-overline" style={{ color: "var(--gold-700)" }}>What's included</span>
            <h2 className="tk-h2" style={{ marginTop: 8 }}>Every pickup, every time.</h2>
            <p className="tk-body" style={{ color: "var(--text-muted)", marginTop: "var(--space-2)" }}>One fixed price, one named driver, one straight line to your accommodation. No add-ons, no upsells.</p>
            <ul style={{ listStyle: "none", margin: "var(--space-5) 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {included.map(x => <li key={x} style={{ display: "flex", gap: 10, fontSize: 15.5 }}><Icon name="check" size={17} style={{ color: "var(--success-fg)", marginTop: 2 }} />{x}</li>)}
            </ul>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-5)" }}>
              <h3 className="tk-h5" style={{ margin: 0 }}>Service area</h3>
              <p className="tk-body-sm" style={{ color: "var(--text-muted)", marginTop: 6 }}>Kotoka (KIA) to anywhere in Greater Accra — Cantonments, Airport Residential, East Legon, Osu, Labadi. Airport-to-region transfers to Cape Coast, Kumasi, Ho and Tamale on request.</p>
            </div></div>
            <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-5)" }}>
              <h3 className="tk-h5" style={{ margin: 0 }}>Pricing</h3>
              <p className="tk-body-sm" style={{ color: "var(--text-muted)", marginTop: 6 }}>No live tariff. Every pickup gets a fixed written quote within 24 hours based on party size, luggage, drop-off area and arrival window. No deposit, no card on file — settle with the driver in cash (USD, EUR or GHS) or ask for an invoice.</p>
            </div></div>
          </div>
        </Wrap>
      </div>
      <Wrap id="pickup-form">
        <div style={{ maxWidth: 620, margin: "0 auto" }}>
          <h2 className="tk-h2" style={{ textAlign: "center" }}>Send us your flight, get a quote in 24 hours.</h2>
          <div className="tk-card" style={{ marginTop: "var(--space-6)" }}><div className="tk-card__body" style={{ padding: "var(--space-6)", gap: "var(--space-4)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
              <FormField id="p-date" label="Arrival date" required><Input type="date" /></FormField>
              <FormField id="p-time" label="Arrival time" required><Input type="time" /></FormField>
              <FormField id="p-flight" label="Flight number" required><Input placeholder="KP 052" /></FormField>
              <FormField id="p-party" label="Party size" required><Input inputMode="numeric" placeholder="2" /></FormField>
            </div>
            <FormField id="p-drop" label="Drop-off area" required><Input placeholder="East Legon, Accra" /></FormField>
            <FormField id="p-req" label="Special requests" optional><Textarea rows={2} placeholder="Child seat, oversize luggage…" /></FormField>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
              <FormField id="p-name" label="Your name" optional><Input /></FormField>
              <FormField id="p-email" label="Email" required><Input type="email" placeholder="you@example.com" /></FormField>
            </div>
            <Checkbox id="p-agree" label="I agree to be contacted about this inquiry." />
            <Button block size="lg" onClick={() => window.tkToast("Inquiry sent — we'll reply within a day")}>Send inquiry</Button>
            <p className="tk-caption" style={{ textAlign: "center" }}>We'll only use your details to reply about this trip — no marketing, no third parties.</p>
          </div></div>
        </div>
      </Wrap>
      <Wrap style={{ paddingTop: 0 }}>
        <h2 className="tk-h3" style={{ marginBottom: "var(--space-4)" }}>Everything else, answered.</h2>
        <Accordion defaultOpen={["q1"]} items={[
          { id: "q1", title: "What happens if my flight is delayed?", content: <p>We track your flight from departure. If it's delayed, the driver waits — no extra fee for the first two hours past scheduled arrival. For longer delays or diversions, we reconfirm on WhatsApp.</p> },
          { id: "q2", title: "I'm landing late at night. Is anyone there?", content: <p>Yes. Kotoka has a steady stream of overnight arrivals and we run pickups around the clock. Your driver is at the arrivals exit before your flight touches down, whatever the hour.</p> },
          { id: "q3", title: "How big a party can you handle, and what about luggage?", content: <p>Standard pickups cover one to four passengers with normal luggage. For five or more, or surfboards, drum kits, oversize bags or filming gear, note it in special requests and we send the right vehicle.</p> },
          { id: "q4", title: "Can you provide a child seat?", content: <p>Yes — child and booster seats are available on request at no extra charge. Note the child's age and weight so we fit the right one.</p> },
          { id: "q5", title: "How do I pay?", content: <p>Cash to the driver on arrival, in USD, EUR or GHS at the day's rate. If you need an invoice or bank transfer in advance, mention it on the form and we'll send instructions with the quote.</p> },
        ]} />
      </Wrap>
      <CTA go={go} />
    </div>
  );
}

/* ── ABOUT ───────────────────────────────────────────── */
function AboutPage({ go }) {
  const promises = [
    ["users", "Locals first", "Tours led by certified, experienced local guides who know Ghana inside out and make every trip safe, informative and enjoyable."],
    ["sparkles", "Cultural immersion", "Go beyond sightseeing — cooking classes, traditional festivals, and hands-on tie-and-dye fabric workshops for a deeper connection."],
    ["shield-check", "Trusted partners", "Drivers, hotels and hosts we know personally. Vetted, comfortable, and held to a standard we can stand behind."],
    ["heart", "End-to-end care", "From visa questions to your last evening, a koach is on call. Nothing left to chance, nothing to figure out alone."],
  ];
  return (
    <div>
      <PageHero overline="Who we are" title="Ghana, guided by people who live it."
        image="https://cdn.tripkoach.com/img/hero/about-hero.jpg"
        sub="TripKoach designs travel in Ghana the way it should be — personal, well-organised, and rooted in the people who call this country home." />
      <Wrap>
        <span className="tk-overline" style={{ color: "var(--gold-700)" }}>What guides us</span>
        <h2 className="tk-h1" style={{ marginTop: 8, marginBottom: "var(--space-8)" }}>Four things we promise.</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "var(--space-5)" }}>
          {promises.map(([ic, t, d]) => (
            <div key={t} className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-6)", gap: "var(--space-3)", flexDirection: "row", alignItems: "flex-start" }}>
              <span style={{ flex: "none", width: 48, height: 48, borderRadius: "var(--radius-md)", background: "var(--brand-wash)", color: "var(--gold-700)", display: "grid", placeItems: "center" }}><Icon name={ic} size={24} /></span>
              <span><h3 className="tk-h5" style={{ margin: 0 }}>{t}</h3><p className="tk-body-sm" style={{ color: "var(--text-muted)", margin: "6px 0 0" }}>{d}</p></span>
            </div></div>
          ))}
        </div>
      </Wrap>
      <Wrap style={{ paddingTop: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-5)" }}>
        {[["https://cdn.tripkoach.com/img/about/storytellers.jpg", "Bonwire, Ashanti — a kente weaver at the loom."], ["https://cdn.tripkoach.com/img/about/market-life.jpg", "Makola Market, Accra — daily market life."]].map(([src, cap]) => (
          <figure key={src} style={{ margin: 0 }}>
            <div className="tk-media" style={{ borderRadius: "var(--radius-card)", aspectRatio: "3 / 2" }}><img src={src} alt={cap} loading="lazy" /></div>
            <figcaption className="tk-caption" style={{ marginTop: 8, fontStyle: "italic" }}>{cap}</figcaption>
          </figure>
        ))}
      </Wrap>
      <div style={{ background: "var(--brand-wash)", borderBlock: "1px solid var(--border-subtle)" }}>
        <Wrap style={{ maxWidth: 760 }}>
          <span className="tk-overline" style={{ color: "var(--gold-700)" }}>Our story</span>
          <h2 className="tk-h2" style={{ marginTop: 8, marginBottom: "var(--space-4)" }}>Built around the people who call Ghana home.</h2>
          {["TripKoach is a Ghana-based tour operator dedicated to delivering exceptional travel experiences for international visitors and Ghanaian travelers. Our mission is to showcase the beauty, history, culture and diversity of Ghana through personalised, expertly guided tours.",
            "Founded by passionate travel enthusiasts, TripKoach began with one goal: to help travelers experience Ghana beyond the typical tourist landmarks. We believe travel should educate, inspire, and build genuine connections.",
            "Our guides live and breathe the destinations they lead you through. We work closely with carefully selected local partners so every trip is comfortable, authentic and well organised — from the moment you begin planning to the memories you take home."].map((p, i) => (
            <p key={i} className="tk-body-lg" style={{ color: "var(--text-body)", marginBottom: "var(--space-4)" }}>{p}</p>
          ))}
          <div className="tk-card" style={{ marginTop: "var(--space-4)" }}><div className="tk-card__body" style={{ padding: "var(--space-5)", flexDirection: "row", alignItems: "center", gap: "var(--space-4)" }}>
            <Badge tone="neutral">Coming soon</Badge>
            <span><strong className="tk-h6">Leadership</strong><p className="tk-body-sm" style={{ color: "var(--text-muted)", margin: "2px 0 0" }}>Founder and leadership bios arrive ahead of the public launch.</p></span>
          </div></div>
        </Wrap>
      </div>
      <CTA go={go} />
    </div>
  );
}

/* ── CONTACT ─────────────────────────────────────────── */
function ContactPage({ go }) {
  return (
    <div>
      <PageHero dark={false} overline="Akwaaba, get in touch" title="We're real people in Accra."
        sub="No ticketing system, no offshore call centre. Message us on WhatsApp and a koach in Osu replies — usually within minutes." />
      <Wrap style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: "var(--space-10)", alignItems: "start" }}>
        <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-6)", gap: "var(--space-4)" }}>
          <h2 className="tk-h3" style={{ margin: 0 }}>Send us a note.</h2>
          <p className="tk-body-sm" style={{ color: "var(--text-muted)", margin: 0 }}>Tell us what you're hoping for and a koach picks it up.</p>
          <FormField id="c-subject" label="Subject"><Select options={[{ value: "general", label: "General" }, { value: "plan", label: "Plan a trip" }, { value: "tour", label: "Tour" }, { value: "shop", label: "Marketplace" }, { value: "club", label: "Tourism Club" }, { value: "press", label: "Press" }]} /></FormField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
            <FormField id="c-name" label="Your name" optional><Input placeholder="Ama Mensah" /></FormField>
            <FormField id="c-email" label="Email" required><Input type="email" placeholder="you@example.com" /></FormField>
          </div>
          <FormField id="c-phone" label="Phone" optional><Input type="tel" placeholder="+233 24 123 4567" /></FormField>
          <FormField id="c-msg" label="Tell us a bit more" optional><Textarea rows={4} placeholder="Dates, group size, what you're into…" /></FormField>
          <Checkbox id="c-agree" label="I agree to be contacted about this inquiry." />
          <Button block size="lg" onClick={() => window.tkToast("Inquiry sent — we'll reply within a day")}>Send inquiry</Button>
          <p className="tk-caption" style={{ textAlign: "center" }}>We'll only use your details to reply — no marketing, no third parties.</p>
        </div></div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {[
            ["message-circle", "WhatsApp a koach", "Fastest reply — usually under 5 minutes in office hours.", "+233 53 324 4042", "var(--success-fg)"],
            ["mail", "Email", "Receipts, longer questions, partnerships. We reply within one business day.", "services@tripkoach.com", "var(--gold-700)"],
            ["phone", "Call the Accra office", "Mon–Fri, 09:00–17:00 GMT. For complex or group bookings.", "+233 53 324 4042", "var(--info-fg)"],
          ].map(([ic, t, d, v, col]) => (
            <div key={t} className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-5)", flexDirection: "row", gap: "var(--space-4)", alignItems: "flex-start" }}>
              <span style={{ flex: "none", width: 44, height: 44, borderRadius: "var(--radius-md)", background: "var(--bg-subtle)", color: col, display: "grid", placeItems: "center" }}><Icon name={ic} size={20} /></span>
              <span><strong className="tk-h6">{t}</strong><p className="tk-body-sm" style={{ color: "var(--text-muted)", margin: "4px 0 6px" }}>{d}</p><span style={{ fontWeight: 700, color: "var(--text-strong)" }}>{v}</span></span>
            </div></div>
          ))}
          <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-5)" }}>
            <strong className="tk-h6">Accra office</strong>
            <p className="tk-body-sm" style={{ color: "var(--text-muted)", margin: "6px 0 0" }}>P.O. Box CT 11125 · Cantonments, Accra<br />Mon–Sat, 08:00–18:00 GMT</p>
          </div></div>
        </div>
      </Wrap>
    </div>
  );
}

/* ── MARKETPLACE (roadmap) ───────────────────────────── */
function MarketplacePage({ go }) {
  return (
    <div>
      <PageHero overline="Marketplace" title="Ghanaian craft, coming to the shop."
        sub="A curated marketplace of Ghanaian craft, cloth and provisions — kente, adinkra, shea and more, shipped or waiting for you on arrival. It launches in an upcoming phase." />
      <Wrap>
        <EmptyState icon="ticket" title="The shop isn't open yet"
          body="We're lining up makers across the regions. In the meantime, tell a koach what you're after and we'll point you to the right stall on your trip."
          action={<Button onClick={() => go("contact")}>Talk to a koach</Button>} />
      </Wrap>
    </div>
  );
}

/* ── TOURISM CLUB (schools) ──────────────────────────── */
function ClubPage({ go }) {
  return (
    <div>
      <PageHero overline="Tourism Club" title="Bringing Ghana into the classroom."
        sub="TripKoach Tourism Clubs help schools and youth groups explore Ghana's heritage, nature and regions through guided trips and in-class sessions built with local guides.">
        <Button size="lg" variant="accent" onClick={() => go("contact")}>Register your school</Button>
      </PageHero>
      <Wrap>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-5)" }}>
          {[["users", "Guided school trips", "Age-appropriate, safety-first itineraries to castles, parks and craft villages, led by certified local guides."],
            ["globe", "In-class sessions", "Koaches visit the classroom to prepare students before a trip and debrief the stories afterwards."],
            ["shield-check", "Safe and vetted", "Vetted transport and hosts, a fixed group price, and a koach on call for the whole programme."]].map(([ic, t, d]) => (
            <div key={t} className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-6)", gap: "var(--space-3)" }}>
              <span style={{ width: 48, height: 48, borderRadius: "var(--radius-md)", background: "var(--brand-wash)", color: "var(--gold-700)", display: "grid", placeItems: "center" }}><Icon name={ic} size={24} /></span>
              <h3 className="tk-h5" style={{ margin: 0 }}>{t}</h3>
              <p className="tk-body-sm" style={{ color: "var(--text-muted)", margin: 0 }}>{d}</p>
            </div></div>
          ))}
        </div>
        <Alert tone="info" title="Full programme details on request" style={{ marginTop: "var(--space-8)" }}>Tell us your school, year group and rough dates, and a koach will send the current programme and group pricing.</Alert>
      </Wrap>
      <CTA go={go} />
    </div>
  );
}
Object.assign(window, { RegionsPage, EsimPage, PickupPage, AboutPage, ContactPage, MarketplacePage, ClubPage });
