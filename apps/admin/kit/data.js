// Real catalogue pulled from tripkoach.com (Aug 2026). Prices are "from" per-person rates in USD,
// as quoted on the live site, which takes booking inquiries rather than fixed-date checkout.
// Images hotlink cdn.tripkoach.com. Departures below are illustrative for prototyping the booking flow.
window.TK_IMG = function (slug, name) {
  return "https://cdn.tripkoach.com/img/tours/" + slug + "/" + (name || "hero-480") + ".jpg";
};
window.TK_DATA = {
  tours: [
    { id:"accra-city-tour", title:"Accra City Tour", region:"Greater Accra", duration:"3 to 4 hrs · Half day",
      category:"City Tour", price:65, currency:"USD", rating:4.8, reviews:215, spotsLeft:11, tag:"Most booked",
      image:TK_IMG("accra-city-tour"),
      blurb:"Feel the pulse of the capital: history, culture, flavor. Iconic sites, vibrant markets, and street food in just a few hours.",
      highlights:["Black Star Gate at Independence Square","Kwame Nkrumah Memorial Park","Jamestown harbor and lighthouse","Makola Market with a guided street-food tasting"],
      included:["Private transportation","Bottled water + 1 non-alcoholic drink","Professional guided tour","Local street-food experience","Hotel pickup within Accra"],
      excluded:["Travel to Accra","Tips and personal expenses"],
      pricing:[["Solo traveler","$100 USD"],["2 to 5 travelers (per person)","$75 USD"],["Group of 6+ (per person)","$65 USD"]],
      itinerary:[["09:00","Hotel pickup within Accra"],["09:30","Black Star Gate & Independence Square"],["10:30","Kwame Nkrumah Memorial Park"],["11:30","Jamestown harbor and lighthouse"],["12:15","Makola Market + street-food tasting"],["13:00","Drop-off at your hotel"]],
      packages:[
        { id:"route1", name:"Route 1: Classic Capital Loop", tag:"Heritage & Food · half day", blurb:"The iconic first-timer's loop: landmarks, Jamestown and a guided street-food tasting.", duration:"Half day · 3 to 4 hrs", tiers:[{minPax:1,price:100},{minPax:2,price:75},{minPax:6,price:65}],
          stops:["Hotel pickup in Accra","Black Star Gate at Independence Square","Kwame Nkrumah Memorial Park and mausoleum","Jamestown lighthouse and harbor walk","Makola Market: guided orientation","Guided street-food tasting: kelewele, koose, sugar bread","Hotel drop-off"],
          includes:["Private transportation","Bottled water + 1 non-alcoholic drink","Professional guided tour","Makola street-food tasting","Hotel pickup within Accra"] },
        { id:"route2", name:"Route 2: Culture & Arts Focus", tag:"Art, History & Osu · half day", blurb:"For art and culture lovers: the National Museum, Du Bois Centre and Osu's galleries.", duration:"Half day · 3 to 4 hrs", tiers:[{minPax:1,price:100},{minPax:2,price:75},{minPax:6,price:65}],
          stops:["Hotel pickup in Accra","National Museum of Ghana: kente, gold weights, pre-colonial history","W.E.B. Du Bois Centre: Pan-African history","Artists Alliance Gallery, Osu: contemporary art and crafts","Labadi Beach promenade","Oxford Street, Osu: street food and people-watching","Optional extension: +233 Jazz Bar (live Afrobeats and highlife)"],
          includes:["Private transportation","Bottled water + 1 non-alcoholic drink","Professional guided tour","National Museum & Du Bois Centre entry","Hotel pickup within Accra"] },
        { id:"route3", name:"Route 3: Heritage Deep Dive", tag:"Forts, History & Sea · half day", blurb:"A deeper heritage day: forts, the Chorkor smokehouse and Accra's old town.", duration:"Half day · 3 to 4 hrs", tiers:[{minPax:1,price:100},{minPax:2,price:75},{minPax:6,price:65}],
          stops:["Hotel pickup in Accra","W.E.B. Du Bois Centre: Pan-African context briefing","Kwame Nkrumah Memorial Park: extended guided session","Usher Fort (Ussher Town): 17th-century Dutch fort in Jamestown","Chorkor smokehouse: open-air fish smoking along the seafront","Accra old-town walk: colonial architecture and the Ga community quarter","Street-food close: chichinga, fried yam, fresh sugar-cane juice","Hotel drop-off"],
          includes:["Private transportation","Bottled water + 1 non-alcoholic drink","Professional guided tour","Usher Fort entry","Hotel pickup within Accra"] } ],
      defaultPackage:"route1",
      departures:[
        { id:"d1", date:"Sat 15 Aug 2026", time:"09:00 · Hotel pickup, Accra", price:75, spotsLeft:9 },
        { id:"d2", date:"Sat 22 Aug 2026", time:"09:00 · Hotel pickup, Accra", price:75, spotsLeft:3 },
        { id:"d3", date:"Sat 29 Aug 2026", time:"09:00 · Hotel pickup, Accra", price:75, spotsLeft:0 },
        { id:"d4", date:"Sat 5 Sep 2026", time:"09:00 · Hotel pickup, Accra", price:75, spotsLeft:12 } ] },
    { id:"discover-ghana-in-10-days", title:"Discover Ghana in 10 days", region:"Greater Accra", duration:"10 days",
      category:"Cultural Discovery", price:2175, currency:"USD", rating:4.9, reviews:86, spotsLeft:6, tag:"Best seller",
      image:TK_IMG("discover-ghana-in-10-days"),
      blurb:"Ten days across the breadth of Ghana: Accra's arts and nightlife, Cape Coast and Elmina's heritage castles, a Safari Valley game drive, Aburi's botanical gardens, and Boti Falls' twin cataracts. Built for first-time visitors who want depth without forced marches.",
      highlights:["Cape Coast & Elmina heritage castles","Kakum National Park canopy walkway","Safari Valley Resort game drive","Aburi Botanical Gardens and Boti Falls"],
      included:["All ground transport in private 4WD","9 nights mid-range accommodation","Daily breakfast, 4 lunches, 3 dinners","Licensed TripKoach guide","All entrance fees per itinerary","Safari Valley Resort game drive"],
      excluded:["International flights","Ghana entry visa (visa-on-arrival available)","Travel insurance (mandatory)","Tips and personal expenses"],
      pricing:[["Solo traveler","$2,900 USD"],["2 adults","$2,610 USD"],["Couple (sharing 1 room)","$2,465 USD"],["Family of 3 to 5 (per person)","$2,320 USD"],["Group of 6+ (per person)","$2,175 USD"]],
      itinerary:[["Day 1","Arrive Accra: airport pickup, welcome dinner, trip briefing"],["Day 2","Accra city day + nightlife: Black Star Gate, Nkrumah Park, Jamestown, Makola"],["Day 3","Accra arts & culture: Du Bois Centre, National Museum, live jazz"],["Day 4","Drive to Cape Coast via Assin Manso Ancestral Slave River"],["Day 5","Cape Coast Castle, Elmina Castle, Kakum canopy walkway"],["Day 6","Safari Valley Resort game drive, bonfire dinner"],["Day 7","Tetteh Quarshie Cocoa Farm + Aburi Botanical Gardens"],["Day 8","Boti Falls + shea-butter waterfall massage"],["Day 9","Return Accra: shopping and nightlife showcase"],["Day 10","Farewell breakfast, airport drop-off"]],
      departures:[
        { id:"d1", date:"Mon 7 Sep 2026", time:"Airport pickup, KIA Accra", price:2175, spotsLeft:6 },
        { id:"d2", date:"Mon 5 Oct 2026", time:"Airport pickup, KIA Accra", price:2175, spotsLeft:8 },
        { id:"d3", date:"Mon 2 Nov 2026", time:"Airport pickup, KIA Accra", price:2320, spotsLeft:4 } ] },
    { id:"a-christmas-like-no-other", title:"A Christmas Like No Other: The Ankos Festival", region:"Western", duration:"5 days",
      category:"Cultural Discovery", price:2175, currency:"USD", rating:4.9, reviews:31, spotsLeft:8,
      image:TK_IMG("a-christmas-like-no-other"),
      blurb:"The Ankos Festival experience on Ghana's western coast: masquerades, brass bands and a Christmas week like nowhere else." },
    { id:"coastal-festival-trio", title:"Coastal festival trio (Aboakyer · Bakatue · Fetu Afahye)", region:"Central", duration:"8 days",
      category:"Cultural Discovery", price:1400, currency:"USD", rating:4.9, reviews:18, spotsLeft:5,
      image:TK_IMG("coastal-festival-trio"),
      blurb:"Three of the coast's great festivals in one journey: deer hunt at Winneba, canoe regatta at Elmina, Fetu Afahye in Cape Coast." },
    { id:"coastal-history-trail", title:"Coastal History Trail (Cape Coast & Elmina)", region:"Central", duration:"4 days",
      category:"Cultural Discovery", price:563, currency:"USD", spotsLeft:10,
      image:TK_IMG("coastal-history-trail"),
      blurb:"The heritage castles of Cape Coast and Elmina, Assin Manso's Ancestral Slave River, and the Kakum canopy walkway." },
    { id:"edina-bakatue-festival-2026", title:"Edina Bakatue Festival Tour", region:"Central", duration:"8 days",
      category:"Cultural Discovery", price:2175, currency:"USD", spotsLeft:4, tag:"Jul 2026",
      image:TK_IMG("edina-bakatue-festival-2026"),
      blurb:"Royal processions, canoe regattas, and coastal celebrations across Ghana's most iconic landmarks. 6 to 13 July 2026." },
    { id:"northern-savannah-safari", title:"Northern and Savannah region tour", region:"Northern", duration:"5 days",
      category:"Adventure", price:980, currency:"USD", spotsLeft:7,
      image:TK_IMG("northern-savannah-safari"),
      blurb:"Mole National Park on foot and by 4WD, Larabanga's ancient mosque, and the wide Savannah landscapes of the north." },
    { id:"upper-east-bolga-paga-and-sirigu", title:"Upper East: Paga, Sirigu & Bolga Market", region:"Upper East", duration:"5 days",
      category:"Cultural Discovery", price:850, currency:"USD", spotsLeft:9,
      image:TK_IMG("upper-east-bolga-paga-and-sirigu"),
      blurb:"Paga's sacred crocodile ponds, the painted houses of Sirigu, and the basket weavers of Bolgatanga market." },
    { id:"volta-mountains-and-monkeys", title:"Volta Mountains & Monkeys", region:"Volta", duration:"4 days",
      category:"Adventure", price:540, currency:"USD", spotsLeft:6,
      image:TK_IMG("volta-mountains-and-monkeys"),
      blurb:"Wli Falls, the Avatime hills, and the mona monkeys of the Tafi Atome sanctuary." },
    { id:"aburi-akosombo-and-boti-falls", title:"Aburi gardens, Akosombo & Boti Falls", region:"Eastern", duration:"3 days",
      category:"Adventure", price:440, currency:"USD", rating:4.8, reviews:14, spotsLeft:12,
      image:TK_IMG("aburi-akosombo-and-boti-falls"),
      blurb:"The 1879 plantings at Aburi, a cruise on Lake Volta at Akosombo, and the twin cataracts of Boti Falls." },
    { id:"luxury-wellness-tour", title:"Luxury Wellness Tour", region:"Eastern", duration:"4 days",
      category:"Luxury", price:850, currency:"USD", spotsLeft:4,
      image:TK_IMG("luxury-wellness-tour"),
      blurb:"Slow days in the Eastern hills: spa, shea-butter waterfall massage, and quiet luxury lodges." }
  ],
  bookings: [
    { ref:"TK-4821", tour:"Accra City Tour", date:"Sat 22 Aug 2026", travellers:"4 travellers", total:300, currency:"USD", status:"pending", image:TK_IMG("accra-city-tour") },
    { ref:"TK-4390", tour:"Aburi gardens, Akosombo & Boti Falls", date:"Fri 17 Jul 2026", travellers:"2 travellers", total:880, currency:"USD", status:"confirmed", image:TK_IMG("aburi-akosombo-and-boti-falls") },
    { ref:"TK-4102", tour:"Volta Mountains & Monkeys", date:"Thu 4 Jun 2026", travellers:"2 travellers", total:1080, currency:"USD", status:"cancelled", image:TK_IMG("volta-mountains-and-monkeys") }
  ],
  regions: ["Greater Accra","Central","Eastern","Western","Volta","Savannah","Northern","Upper East"]
};

/* Group pricing: per-person rate falls as the party grows. Real tiers for the two
   tours the live site publishes; a consistent group-discount default for the rest.
   tour.price stays the "from" (largest-group, cheapest) rate shown on cards. */
(function () {
  var REAL = {
    "accra-city-tour": [[1,100],[2,75],[6,65]],
    "discover-ghana-in-10-days": [[1,2900],[2,2610],[3,2320],[6,2175]]
  };
  (window.TK_DATA.tours || []).forEach(function (t) {
    if (REAL[t.id]) {
      t.tiers = REAL[t.id].map(function (x) { return { minPax: x[0], price: x[1] }; });
    } else {
      var b = t.price, r = function (n) { return Math.round(n / 5) * 5; };
      t.tiers = [{ minPax: 1, price: r(b * 1.4) }, { minPax: 2, price: r(b * 1.15) }, { minPax: 6, price: b }];
    }
  });
  window.TK_PRICE = {
    /** Per-person price for a given party size, honouring the tour's tiers. */
    perPerson: function (t, pax) {
      var tiers = (t && t.tiers) || [{ minPax: 1, price: t ? t.price : 0 }];
      var p = tiers[0].price;
      for (var i = 0; i < tiers.length; i++) if (pax >= tiers[i].minPax) p = tiers[i].price;
      return p;
    },
    total: function (t, pax) { return window.TK_PRICE.perPerson(t, pax) * pax; },
    /** The next cheaper tier a customer would unlock, or null. */
    nextTier: function (t, pax) {
      var tiers = (t && t.tiers) || [];
      for (var i = 0; i < tiers.length; i++) if (tiers[i].minPax > pax) return tiers[i];
      return null;
    },
    /** "1", "2 to 5", "6+" band label for a tier at index i. */
    band: function (tiers, i) {
      var lo = tiers[i].minPax, hi = i < tiers.length - 1 ? tiers[i + 1].minPax - 1 : null;
      return hi == null ? lo + "+" : (lo === hi ? "" + lo : lo + " to " + hi);
    }
  };

  // ── Reviews (shared by public tour pages + admin moderation) ──
  var TT = window.TK_DATA.tours;
  var tById = {}; TT.forEach(function (t) { tById[t.id] = t; });
  function tt(i) { return TT[i] || TT[0]; }
  window.TK_REVIEWS = [
    { id:"r1", tourId:tt(0).id, tour:tt(0).title, author:"Ama Mensah", initials:"AM", rating:5, date:"18 Aug 2026", verified:true, status:"approved",
      title:"Our koach made the city come alive", text:"Kwame knew every street and every story. Jamestown and the market were the highlight. We never felt rushed and lunch was incredible. Booking and pickup were smooth.", reply:"Thank you Ama! Kwame says hello, come back for the coast next time." },
    { id:"r2", tourId:tt(0).id, tour:tt(0).title, author:"Marcus Bell", initials:"MB", rating:4, date:"11 Aug 2026", verified:true, status:"approved",
      title:"Great value, well organised", text:"Good pace and a friendly guide. Only wish we had a little more time at the Du Bois centre, otherwise excellent." },
    { id:"r3", tourId:tt(0).id, tour:tt(0).title, author:"Efua O.", initials:"EO", rating:5, date:"2 Aug 2026", verified:true, status:"approved",
      title:"Felt safe and looked after the whole day", text:"As a solo traveller this was perfect. Clear communication, air-conditioned koach, and real local insight." },
    { id:"r4", tourId:tt(0).id, tour:tt(0).title, author:"Kojo Danso", initials:"KD", rating:5, date:"22 Aug 2026", verified:true, status:"pending",
      title:"Best day of our trip", text:"Everything was seamless. The Route 2 arts focus was exactly what we wanted and the jazz bar extension was a lovely surprise." },
    { id:"r5", tourId:tt(1).id, tour:tt(1).title, author:"Sarah W.", initials:"SW", rating:4, date:"20 Aug 2026", verified:true, status:"pending",
      title:"Beautiful and moving", text:"The castle tour was powerful. Long drive but worth it. Guide was knowledgeable and kind." },
    { id:"r6", tourId:tt(0).id, tour:tt(0).title, author:"anon", initials:"?", rating:1, date:"19 Aug 2026", verified:false, status:"pending",
      title:"", text:"Book direct on my site instead, cheaper deals www.example-spam.test cheap tours call now!!!" },
    { id:"r7", tourId:tt(2).id, tour:tt(2).title, author:"Daniel K.", initials:"DK", rating:5, date:"9 Aug 2026", verified:true, status:"approved",
      title:"Unforgettable", text:"Wli Falls took our breath away and the monkeys were so friendly. Great guide, great trip." },
    { id:"r8", tourId:tt(0).id, tour:tt(0).title, author:"Grace A.", initials:"GA", rating:2, date:"5 Aug 2026", verified:true, status:"rejected",
      title:"Mixed", text:"Loved the guide but our pickup was 40 minutes late which cut into the day.", reply:"" },
  ];
  window.TK_REVIEWS_FOR = function (tourId) { return window.TK_REVIEWS.filter(function (r) { return r.tourId === tourId && r.status === "approved"; }); };
  window.TK_REVIEW_STATS = function (tourId) {
    var a = window.TK_REVIEWS_FOR(tourId); if (!a.length) return { count:0, avg:0 };
    var s = a.reduce(function (n, r) { return n + r.rating; }, 0);
    return { count:a.length, avg:Math.round((s / a.length) * 10) / 10 };
  };

  // ── Regions (single source; admin can extend, public derives) ──
  window.TK_REGION_COUNT = function () { return (window.TK_DATA.regions || []).length; };
  window.TK_REGION_TOURS = function (name) { return TT.filter(function (t) { return t.region === name; }); };
  window.TK_ADD_REGION = function (name) {
    var r = window.TK_DATA.regions || (window.TK_DATA.regions = []);
    if (name && r.indexOf(name) === -1) { r.push(name); return true; }
    return false;
  };

  // ── Review invitations (sent when a departure is ended) ──
  var FIRST = ["Ama", "Kojo", "Efua", "Yaw", "Akua", "Kofi", "Abena", "Kwesi", "Adjoa", "Nii", "Esi", "Fiifi"];
  var LAST = ["Mensah", "Boateng", "Owusu", "Danso", "Asante", "Appiah", "Osei", "Addo", "Bediako", "Quaye"];
  window.TK_PARTICIPANTS = function (seed, n) {
    var out = []; var s = 0; for (var i = 0; i < String(seed).length; i++) s += String(seed).charCodeAt(i);
    for (var j = 0; j < n; j++) { var f = FIRST[(s + j * 7) % FIRST.length], l = LAST[(s + j * 3) % LAST.length]; out.push({ name: f + " " + l, email: f.toLowerCase() + "@example.com", initials: f[0] + l[0] }); }
    return out;
  };
  // Demo invite the public "review from your trip" link resolves to
  window.TK_INVITE = { token: "rv_ac_8821", name: "Ama Mensah", tourId: tt(0).id, tour: tt(0).title, date: "Sat 22 Aug 2026", ref: "TK-4821" };

  // Currency conversion for the header toggle. USD is the currency of record;
  // GHS rate is an assumption pending a live FX feed.
  window.TK_FX = { USD: 1, GHS: 15.6 };
  window.tkCvt = function (usd, cur) { return cur === "GHS" ? Math.round((usd || 0) * window.TK_FX.GHS) : (usd || 0); };
  window.tkMoney = function (usd, cur) { return (cur === "GHS" ? "GH₵" : "$") + window.tkCvt(usd, cur).toLocaleString(); };
  window.tkDeps = function (deps, cur) { return (deps || []).map(function (d) { return Object.assign({}, d, { price: window.tkCvt(d.price, cur) }); }); };
})();
