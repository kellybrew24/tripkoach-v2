// Admin console demo data. Bookings/customers/payments/promos/staff are
// synthetic but consistent with the real TK_DATA catalogue (USD, real tour titles).
(function () {
  var T = (window.TK_DATA && window.TK_DATA.tours) || [];
  var byId = {}; T.forEach(function (t) { byId[t.id] = t; });
  function tour(id) { return byId[id] || { title: id, region: "-", price: 0 }; }

  var customers = [
    { id:"c1", name:"Ama Mensah", email:"ama@example.com", phone:"+233 24 555 0142", country:"Ghana", joined:"12 Feb 2026", bookings:3, initials:"AM", emergencyName:"Kofi Mensah", emergencyPhone:"+233 24 555 0199", diet:"No shellfish" },
    { id:"c2", name:"Marcus Bell", email:"marcus@example.co.uk", phone:"+44 7700 900142", country:"United Kingdom", joined:"3 Mar 2026", bookings:1, initials:"MB", emergencyName:"Lia Bell", emergencyPhone:"+44 7700 900143", diet:"Vegetarian" },
    { id:"c3", name:"Kojo Asante", email:"kojo.asante@example.com", phone:"+1 416 555 0199", country:"Canada", joined:"20 Mar 2026", bookings:2, initials:"KA", emergencyName:"Abena Asante", emergencyPhone:"+1 416 555 0200", diet:"-" },
    { id:"c4", name:"Lena Fischer", email:"lena.f@example.de", phone:"+49 151 5550 142", country:"Germany", joined:"1 Apr 2026", bookings:1, initials:"LF", emergencyName:"Jonas Fischer", emergencyPhone:"+49 151 5550 143", diet:"Gluten-free" },
    { id:"c5", name:"Nana Yaa Owusu", email:"nanayaa@example.com", phone:"+233 20 555 0177", country:"Ghana", joined:"9 Apr 2026", bookings:1, initials:"NO", emergencyName:"Kwabena Owusu", emergencyPhone:"+233 20 555 0178", diet:"-" },
    { id:"c6", name:"David Okonkwo", email:"d.okonkwo@example.ng", phone:"+234 803 555 0142", country:"Nigeria", joined:"22 Apr 2026", bookings:2, initials:"DO", emergencyName:"Chidi Okonkwo", emergencyPhone:"+234 803 555 0143", diet:"Halal" },
  ];

  var B = [];
  var seed = [
    ["TK-4821","c1","accra-city-tour","d2","Sat 22 Aug 2026",4,"pending","unpaid","22 Aug 2026"],
    ["TK-4390","c3","aburi-akosombo-and-boti-falls","d1","Fri 17 Jul 2026",2,"confirmed","paid","2 Jul 2026"],
    ["TK-4102","c1","volta-mountains-and-monkeys","d1","Thu 4 Jun 2026",2,"cancelled","refunded","20 May 2026"],
    ["TK-4785","c2","discover-ghana-in-10-days","d1","Mon 7 Sep 2026",2,"confirmed","paid","18 Aug 2026"],
    ["TK-4756","c4","coastal-history-trail","d1","Sat 5 Sep 2026",3,"pending","unpaid","15 Aug 2026"],
    ["TK-4712","c5","a-christmas-like-no-other","d1","Fri 25 Dec 2026",2,"pending","unpaid","10 Aug 2026"],
    ["TK-4690","c6","northern-savannah-safari","d1","Mon 14 Sep 2026",4,"confirmed","paid","6 Aug 2026"],
    ["TK-4655","c3","accra-city-tour","d1","Sat 15 Aug 2026",1,"confirmed","paid","1 Aug 2026"],
    ["TK-4610","c6","upper-east-bolga-paga-and-sirigu","d1","Mon 21 Sep 2026",2,"failed","failed","28 Jul 2026"],
    ["TK-4588","c2","volta-mountains-and-monkeys","d1","Thu 10 Sep 2026",2,"pending","unpaid","25 Jul 2026"],
    ["TK-4540","c4","luxury-wellness-tour","d1","Wed 2 Sep 2026",2,"confirmed","paid","20 Jul 2026"],
    ["TK-4501","c5","coastal-festival-trio","d1","Sat 4 Jul 2026",2,"completed","paid","2 Jun 2026"],
  ];
  seed.forEach(function (s) {
    var t = tour(s[2]);
    B.push({ ref:s[0], customerId:s[1], customer:(customers.find(function(c){return c.id===s[1];})||{}).name,
      tourId:s[2], tour:t.title, region:t.region, departureId:s[3], date:s[4], travellers:s[5],
      unit:t.price, total:t.price*s[5], currency:"USD", status:s[6], payment:s[7], created:s[8] });
  });

  var payments = B.filter(function(b){return b.payment!=="unpaid";}).map(function(b,i){
    return { id:"PAY-"+(9100+i), ref:b.ref, customer:b.customer, amount:b.total, currency:"USD",
      method: b.payment==="refunded" ? "Paystack · card" : (i%2? "Mobile money":"Paystack · card"),
      status: b.payment, date:b.created };
  });
  payments.push({ id:"PAY-9088", ref:"TK-4610", customer:"David Okonkwo", amount:1700, currency:"USD", method:"Paystack · card", status:"failed", date:"28 Jul 2026" });

  var promos = [
    { code:"HARMATTAN10", type:"percent", value:10, currency:"USD", used:24, limit:100, from:"1 Nov 2026", to:"31 Jan 2027", tours:"All tours", active:true },
    { code:"DIASPORA25", type:"fixed", value:25, currency:"USD", used:8, limit:50, from:"1 Jul 2026", to:"1 Sep 2026", tours:"Cultural Discovery", active:true },
    { code:"EARLYBIRD", type:"percent", value:15, currency:"USD", used:50, limit:50, from:"1 Jan 2026", to:"1 Apr 2026", tours:"All tours", active:false },
    { code:"KAKUM5", type:"percent", value:5, currency:"USD", used:0, limit:200, from:"1 Sep 2026", to:"31 Dec 2026", tours:"Coastal History Trail", active:true },
  ];

  var staff = [
    { id:"u1", name:"Kwame Boateng", email:"kwame@tripkoach.com", role:"admin", status:"active", initials:"KB", last:"2 min ago", mfaEnabled:true },
    { id:"u2", name:"Ama Owusu", email:"ama.o@tripkoach.com", role:"operator", status:"active", initials:"AO", last:"1 hr ago", mfaEnabled:true },
    { id:"u3", name:"Kofi Adjei", email:"kofi@tripkoach.com", role:"operator", status:"active", initials:"KA", last:"Today, 08:12", mfaEnabled:false, locked:true, lockedUntil:"2026-08-12T23:59:00Z" },
    { id:"u4", name:"Efua Sarpong", email:"efua@tripkoach.com", role:"viewer", status:"invited", initials:"ES", last:"-" },
    { id:"u5", name:"Yaw Darko", email:"yaw@tripkoach.com", role:"operator", status:"disabled", initials:"YD", last:"14 Mar 2026", mfaEnabled:true },
  ];

  // Departures across the catalogue with capacity/inventory
  var departures = [];
  T.forEach(function (t) {
    (t.departures || []).forEach(function (d) {
      var cap = (d.spotsLeft||0) + Math.floor(Math.random()*0); // keep deterministic-ish
      var capacity = d.spotsLeft <= 0 ? 12 : d.spotsLeft + 6;
      var booked = capacity - d.spotsLeft;
      departures.push({ id:t.id+"-"+d.id, tourId:t.id, tour:t.title, region:t.region, date:d.date, time:d.time,
        price:d.price, currency:"USD", capacity:capacity, booked:booked, spotsLeft:d.spotsLeft,
        status: d.spotsLeft<=0 ? "sold-out" : "scheduled" });
    });
  });

  // Field guides who lead departures
  var guides = [
    { id:"kwame", name:"Kwame Boateng", initials:"KB", email:"kwame.g@tripkoach.com", phone:"+233 24 555 0110", base:"Accra", regions:["Greater Accra","Eastern"], languages:["English","Twi","Ga"], status:"active", rating:4.9, trips:212, bio:"Ten years leading city and heritage tours across the capital." },
    { id:"ama", name:"Ama Serwaa", initials:"AS", email:"ama.g@tripkoach.com", phone:"+233 20 555 0134", base:"Cape Coast", regions:["Central","Western"], languages:["English","Fante"], status:"active", rating:4.8, trips:168, bio:"Coastal heritage specialist: castles, festivals and the fishing towns." },
    { id:"kojo", name:"Kojo Antwi", initials:"KA", email:"kojo.g@tripkoach.com", phone:"+233 27 555 0188", base:"Kumasi", regions:["Ashanti","Northern","Savannah"], languages:["English","Twi"], status:"active", rating:4.9, trips:143, bio:"Ashanti culture and northern safari guide." },
    { id:"efua", name:"Efua Owusu", initials:"EO", email:"efua.g@tripkoach.com", phone:"+233 24 555 0166", base:"Ho", regions:["Volta"], languages:["English","Ewe"], status:"active", rating:4.7, trips:74, bio:"Volta waterfalls, mountains and the monkey sanctuary." },
    { id:"nii", name:"Nii Armah", initials:"NA", email:"nii.g@tripkoach.com", phone:"+233 26 555 0121", base:"Accra", regions:["Greater Accra"], languages:["English","Ga"], status:"leave", rating:4.6, trips:52, bio:"Jamestown and street-food walks. On leave until September." },
  ];

  // Blog / CMS (TRI-917): prototype fixture for the authoring screen. In live
  // mode tk-boot.js replaces this with the real catalogue from GET /api/admin/blog.
  var blog = [
    { id:"kakum-canopy-walk-cape-coast-day-trip", slug:"kakum-canopy-walk-cape-coast-day-trip", tag:"Destinations", status:"published", published:true, readTime:6, date:"5 Aug 2026", updated:"5 Aug 2026", title:"Above the trees at Kakum: Ghana's canopy walk and how to do it right", excerpt:"Forty metres up, on seven swaying bridges strung between the tallest trees in the forest, you walk right through the top of Ghana's rainforest.", hero:"https://cdn.tripkoach.com/img/posts/kakum-canopy-walk-cape-coast-day-trip-hero.jpg", author:"TripKoach", bodyText:"## What Kakum actually is\n\nKakum National Park protects about 375 square kilometres of Upper Guinean rainforest, one of the last big stretches of this forest type left in West Africa." },
    { id:"first-24-hours-accra", slug:"first-24-hours-accra", tag:"First-time in Ghana", status:"published", published:true, readTime:3, date:"18 May 2026", updated:"18 May 2026", title:"Your first 24 hours in Accra: the koach's arrival kit", excerpt:"SIM, cedis, ride apps, the food that fixes jet lag, and the small moves that set up the rest of your trip.", hero:"https://cdn.tripkoach.com/img/posts/first-24-hours-accra-hero.jpg", author:"TripKoach", bodyText:"Akwaaba. Here is what to do before you even unpack." },
    { id:"green-season-ghana", slug:"green-season-ghana", tag:"Seasons & Weather", status:"draft", published:false, readTime:3, date:"", updated:"11 May 2026", title:"Akwaaba to the green season", excerpt:"Yes, it rains. It is also when Boti Falls runs full and the crowds thin out.", hero:"https://cdn.tripkoach.com/img/posts/green-season-ghana-hero.jpg", author:"TripKoach", bodyText:"Here is what the green season actually looks like, and how TripKoach keeps you covered." },
  ];

  // TRI-1139: custom-date requests inbox (TRI-1136 A+B1). Prototype fixture; in
  // live mode tk-boot.js replaces this with GET /api/admin/requests (interest
  // enquiries whose intent is 'request', i.e. a traveller asked for a date that
  // isn't on the schedule). Status flows New → Contacted → Scheduled → Booked → Closed.
  var reqTours = T.slice(0, 3);
  function reqTour(i) { return reqTours[i] || tour("accra-city-tour"); }
  // status values match the live BE enum (lowercase): new|contacted|scheduled|booked|closed.
  var requests = [
    { id:"rq1", tourId:reqTour(0).id, tour:reqTour(0).title, requestedDate:"2026-10-18", partySize:4, customerName:"Ama Mensah", email:"ama@example.com", phone:"+233 24 555 0142", receivedAt:"2026-08-13", status:"new", note:"Anniversary trip, hoping for a private group.", indicativeTotalMinor:(reqTour(0).price||0)*4*100, currency:"USD" },
    { id:"rq2", tourId:reqTour(1).id, tour:reqTour(1).title, requestedDate:"2026-11-02", partySize:2, customerName:"Marcus Bell", email:"marcus@example.co.uk", phone:"+44 7700 900142", receivedAt:"2026-08-12", status:"contacted", note:"Flexible ±3 days.", indicativeTotalMinor:(reqTour(1).price||0)*2*100, currency:"USD" },
    { id:"rq3", tourId:reqTour(2).id, tour:reqTour(2).title, requestedDate:"2026-09-27", partySize:6, customerName:"Kojo Asante", email:"kojo.asante@example.com", phone:"+1 416 555 0199", receivedAt:"2026-08-11", status:"scheduled", note:"", indicativeTotalMinor:(reqTour(2).price||0)*6*100, currency:"USD" },
    { id:"rq4", tourId:reqTour(0).id, tour:reqTour(0).title, requestedDate:"2026-12-20", partySize:3, customerName:"Lena Fischer", email:"lena.f@example.de", phone:"+49 151 5550 142", receivedAt:"2026-08-09", status:"booked", note:"Christmas week.", indicativeTotalMinor:(reqTour(0).price||0)*3*100, currency:"USD" },
    { id:"rq5", tourId:reqTour(1).id, tour:reqTour(1).title, requestedDate:"2026-08-30", partySize:2, customerName:"David Okonkwo", email:"d.okonkwo@example.ng", phone:"+234 803 555 0142", receivedAt:"2026-08-08", status:"closed", note:"Dates no longer work.", indicativeTotalMinor:(reqTour(1).price||0)*2*100, currency:"USD" },
  ];

  window.TK_ADMIN = { customers:customers, bookings:B, payments:payments, promos:promos, staff:staff, guides:guides, departures:departures, tours:T, blog:blog, requests:requests };
})();
