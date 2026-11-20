// economy.js
// Real-world reference economy (Türkiye, 2026) and the conversion into the game's coin economy.
// The game balance runs in coins; 1 coin is calibrated so that SEED.salary (blue-collar daily cost) equals the real
// employer cost of the 2026 minimum wage per day. Every cost derived from real data (rent, SGK, salaries, fuel, cars)
// is converted with the same rate, so the ₺ figures shown to Turkish players are consistent with real numbers.
// Values flagged `est: true` are estimates (no single official source) and are admin-editable.

const TR2026 = {
  asOf: '2026-11',
  minWage: { gross: 33030, net: 28075.5 },                     // 1 Ocak 2026
  sgk: { employer: 0.2175, unemploymentEmployer: 0.02, employee: 0.14, unemploymentEmployee: 0.01 },
  collars: {
    blue: { gross: 33030 },                                     // mavi yaka = asgari ücret
    grey: { gross: 50000, est: true },                          // gri yaka (teknik / kalifiye)
    white: { gross: 67410, est: true }                          // beyaz yaka (ortalama brüt ücret haberi)
  },
  fuel: { gasoline: 80.45, diesel: 100.5, asOf: '2026-10-28', where: 'İstanbul (Avrupa)' },
  car: { consumptionL100: 7, buyPrice: 1250000, upkeepMonthly: 7500, rentDaily: 1800, est: true },
  // Araç galerisi: binek / ticari, sıfır / ikinci el (fiyatlar tahmini). Ticari araç daha çok mal taşır (satış +%4) ama daha çok yakar.
  models: {
    sedan_new:  { cond: 'new',  body: 'sedan', buyPrice: 1250000, upkeepMonthly: 7500,  consumptionL100: 7,    boost: 0,    resaleBase: 0.80 },
    sedan_used: { cond: 'used', body: 'sedan', buyPrice: 780000,  upkeepMonthly: 9500,  consumptionL100: 7.8,  boost: 0,    resaleBase: 0.65, ageYears: 3, km: 62000 },
    van_new:    { cond: 'new',  body: 'van',   buyPrice: 1650000, upkeepMonthly: 9500,  consumptionL100: 9.5,  boost: 0.04, resaleBase: 0.80 },
    van_used:   { cond: 'used', body: 'van',   buyPrice: 1000000, upkeepMonthly: 11500, consumptionL100: 10.5, boost: 0.04, resaleBase: 0.65, ageYears: 4, km: 110000 }
  },
  parkingDaily: 150,          // otopark günlük ücreti (₺, est); kapı önü park ücretsizdir ama hasar riski vardır
  rentDays: [1, 3, 7, 14, 30],
  damage: { chancePerDay: 0.004, share: 0.03 }, // kapı önünde park eden aracın günlük hasar olasılığı ve araç değerine oranı
  // Vergiler: gelir vergisi tarifesi (₺, yıllık net kâr dilimleri). 2026 dilimleri 190.000 / 400.000 / 1.500.000 / 5.300.000 ₺ olarak alındı;
  // resmi Tebliğ ile doğrulanmalı (est). Damga vergisi: kira sözleşmesi binde 9,48, ücret bordrosu binde 7,59.
  tax: {
    income: [[190000, 0.15], [400000, 0.20], [1500000, 0.27], [5300000, 0.35], [Infinity, 0.40]], est: true,
    stampContract: 0.00948, stampPayroll: 0.00759,
    accountantMonthly: { basic: 2500, pro: 6000 }, noAccountantPenalty: 0.15, proSaving: 0.07, est2: true // muhasebe ücretleri ve ceza/tasarruf oranları tahmini
  },
  // Şehirler arası seyahat (tahmini): otobüs bileti ₺/km, ortalama hızlar, kuş uçuşu yerine yol katsayısı
  intercity: { busPerKm: 2.2, busKmh: 75, carKmh: 95, roadFactor: 1.25, stopHours: 0.5, est: true },
  courierPerKm: 18,                                             // kurye / taksi ile teslimat (est)
  busFare: 40,                                                  // toplu taşıma tek biniş (est)
  priceToRentMonths: 220,                                       // satış fiyatı ≈ 220 aylık kira (~%5,5 brüt getiri, est)
  cities: {
    istanbul: { name: 'İstanbul', rentM2: 850 },                // müstakil işyeri kira ₺/m²/ay (Haz 2026)
    ankara: { name: 'Ankara', rentM2: 380 },                    // dükkan kira ₺/m²/ay
    izmir: { name: 'İzmir', rentM2: 455 },                      // dükkan kira ₺/m²/ay
    bursa: { name: 'Bursa', rentM2: 320, est: true },
    antalya: { name: 'Antalya', rentM2: 400, est: true }
  },
  // Türkiye haritasındaki şehirler: durum 'open' (oynanabilir) | 'premium' | 'soon' (pek yakında). Konumlar yaklaşık (boylam, enlem).
  cityMap: [
    { key: 'istanbul', name: 'İstanbul', lon: 28.98, lat: 41.01, status: 'open' },
    { key: 'ankara', name: 'Ankara', lon: 32.85, lat: 39.93, status: 'open' },
    { key: 'izmir', name: 'İzmir', lon: 27.14, lat: 38.42, status: 'open' },
    { key: 'bursa', name: 'Bursa', lon: 29.06, lat: 40.19, status: 'open' },
    { key: 'antalya', name: 'Antalya', lon: 30.71, lat: 36.89, status: 'open' },
    { key: 'adana', name: 'Adana', lon: 35.32, lat: 37.0, status: 'premium' },
    { key: 'konya', name: 'Konya', lon: 32.48, lat: 37.87, status: 'premium' },
    { key: 'gaziantep', name: 'Gaziantep', lon: 37.38, lat: 37.07, status: 'premium' },
    { key: 'kayseri', name: 'Kayseri', lon: 35.49, lat: 38.72, status: 'premium' },
    { key: 'samsun', name: 'Samsun', lon: 36.33, lat: 41.29, status: 'soon' },
    { key: 'trabzon', name: 'Trabzon', lon: 39.72, lat: 41.0, status: 'soon' },
    { key: 'erzurum', name: 'Erzurum', lon: 41.27, lat: 39.9, status: 'soon' },
    { key: 'diyarbakir', name: 'Diyarbakır', lon: 40.22, lat: 37.91, status: 'soon' },
    { key: 'van', name: 'Van', lon: 43.38, lat: 38.5, status: 'soon' },
    { key: 'mugla', name: 'Muğla', lon: 28.37, lat: 37.21, status: 'soon' },
    { key: 'eskisehir', name: 'Eskişehir', lon: 30.52, lat: 39.77, status: 'soon' }
  ],
  sources: [
    { label: 'Asgari ücret 2026 (QNB Yatırım)', url: 'https://www.qnbinvest.com.tr/investodak/qnbarastirma/2026-asgari-ucret-aciklandi-net-28075-tl' },
    { label: 'Asgari ücret işveren maliyeti (PwC)', url: 'https://www.pwc.com.tr/tr/medya/kose-yazilari/celal-ozcan/2026-yili-asgari-ucreti-ve-sektorlere-gore-isveren-maliyeti.html' },
    { label: 'SGK prim oranları 2026 (Alomaliye)', url: 'https://www.alomaliye.com/2025/12/21/2025-2026-isveren-tesvik-ve-sgk-prim-oranlari-karsilastirma-tablosu/' },
    { label: 'Gelir vergisi tarifesi 2026 (GİB) — doğrulayın', url: 'https://www.gib.gov.tr' },
    { label: 'Damga vergisi oranları (Damga Vergisi Kanunu, 488 s.K.)', url: 'https://www.mevzuat.gov.tr' },
    { label: 'Kiralık dükkan m² (Emlakjet / Endeksa)', url: 'https://www.emlakjet.com/emlak-piyasasi/kiralik-dukkan' },
    { label: 'Kiralık müstakil işyeri m² (Emlakjet)', url: 'https://www.emlakjet.com/emlak-piyasasi/kiralik-ofis-mustakil' },
    { label: 'Akaryakıt fiyatları 28 Ekim 2026', url: 'https://www.24saatgazetesi.com/akaryakit-fiyatlari-28-ekim-2026-akaryakita-zam-gelecek' },
    { label: 'Mavi / beyaz yaka maaş aralıkları (eleman.net)', url: 'https://www.eleman.net/is-rehberi/maaslar-ve-ucretler/en-populer-sayisal-ve-mavi-yaka-meslekler-maaslari-h21024' }
  ]
};

const employerCost = gross => gross * (1 + TR2026.sgk.employer + TR2026.sgk.unemploymentEmployer);
const netOf = gross => gross * (1 - TR2026.sgk.employee - TR2026.sgk.unemploymentEmployee); // income tax ignored (asgari ücret istisnası)

// Productivity factor per collar: daily sales "units" an NPC employee produces (white collar sells higher value work)
const COLLAR_FACTOR = { blue: 4, grey: 6.5, white: 10 };
// Delivery distance per sale by sector (km), drives fuel / courier cost
const DELIVERY_KM = { 'sector.food': 2, 'sector.retail': 3, 'sector.service': 5, 'sector.health': 2, 'sector.education': 0,
  'sector.creative': 1, 'sector.tech': 0, 'sector.auto': 8, 'sector.transport': 0 };

function build(blueSalaryCoins) {
  const rate = employerCost(TR2026.minWage.gross) / 30 / blueSalaryCoins; // ₺ per coin
  const c = tl => tl / rate;                                              // ₺ -> coins (float)
  const collars = Object.fromEntries(Object.entries(TR2026.collars).map(([k, v]) => [k, {
    gross: v.gross, net: Math.round(netOf(v.gross)), employerCost: Math.round(employerCost(v.gross)), est: !!v.est,
    salary: Math.round(c(employerCost(v.gross) / 30)), factor: COLLAR_FACTOR[k]
  }]));
  const car = TR2026.car;
  return {
    rate, data: TR2026, collars,
    vehicle: {
      fuelPerKm: c((car.consumptionL100 / 100) * TR2026.fuel.gasoline),  // own / rented car
      courierPerKm: c(TR2026.courierPerKm),                              // no company car
      rentPerDay: Math.round(c(car.rentDaily)), buyPrice: Math.round(c(car.buyPrice)), upkeepPerDay: Math.round(c(car.upkeepMonthly / 30) * 10) / 10,
      resale: 0.6,
      models: Object.fromEntries(Object.entries(TR2026.car.models || TR2026.models).map(([k, m]) => [k, {
        cond: m.cond, body: m.body, price: Math.round(c(m.buyPrice)), upkeepPerDay: Math.round(c(m.upkeepMonthly / 30) * 10) / 10,
        fuelPerKm: c((m.consumptionL100 / 100) * TR2026.fuel.gasoline), boost: m.boost, resaleBase: m.resaleBase, ageYears: m.ageYears || 0, km: m.km || 0 }])),
      parkingPerDay: Math.round(c(TR2026.parkingDaily) * 10) / 10, rentDays: TR2026.rentDays, damage: TR2026.damage
    },
    tax: {
      brackets: TR2026.tax.income.map(([limit, rate]) => ({ limit: limit === Infinity ? null : limit, rate })), est: true,
      stampContract: TR2026.tax.stampContract, stampPayroll: TR2026.tax.stampPayroll,
      accountant: {
        none: { feeDaily: 0, mult: 1 + TR2026.tax.noAccountantPenalty },
        basic: { feeDaily: c(TR2026.tax.accountantMonthly.basic / 30), mult: 1 },
        pro: { feeDaily: c(TR2026.tax.accountantMonthly.pro / 30), mult: 1 - TR2026.tax.proSaving }
      }
    },
    busFare: Math.max(1, Math.round(c(TR2026.busFare))), busTopups: [10, 20, 50],
    deliveryKm: DELIVERY_KM, cityMap: TR2026.cityMap,
    intercity: { busPerKm: c(TR2026.intercity.busPerKm), busKmh: TR2026.intercity.busKmh, carKmh: TR2026.intercity.carKmh, roadFactor: TR2026.intercity.roadFactor, stopHours: TR2026.intercity.stopHours, est: true },
    cities: Object.fromEntries(Object.entries(TR2026.cities).map(([k, v]) => [k, { ...v }])),
    lotRent: (cityKey, size) => Math.max(1, Math.ceil(c((size * (TR2026.cities[cityKey] || TR2026.cities.istanbul).rentM2) / 30))),
    lotPrice: (cityKey, size) => Math.ceil(c(size * (TR2026.cities[cityKey] || TR2026.cities.istanbul).rentM2 * TR2026.priceToRentMonths))
  };
}

module.exports = { build, TR2026 };
