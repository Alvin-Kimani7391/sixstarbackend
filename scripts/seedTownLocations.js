/**
 * seedTownLocations.js
 * -------------------------------------------------------------------------
 * One-time (safe to re-run) seed for the TownLocation collection.
 * Run with:  node scripts/seedTownLocations.js
 * Requires MONGO_URI in your environment, same as the rest of the app.
 *
 * Upserts by { county, town } so running this more than once never creates
 * duplicates — it only fills in rows that don't exist yet. It will NOT
 * overwrite a town you've already edited in the admin panel (e.g. a
 * nairobiManualFee you already set), it only creates missing rows.
 *
 * Three groups are seeded:
 *   1. NAIROBI_TOWNS       — the towns your old hardcoded DELIVERY_DATA.Nairobi
 *                            list had, migrated in with their old fee as a
 *                            starting nairobiManualFee (editable in admin).
 *   2. PICKUP_STATION_TOWNS — the full list you supplied, one row per town,
 *                            classified into its real county, hasPickupStation
 *                            true, transport fee left to the normal dynamic
 *                            weight-tier system (unaffected).
 *   3. OTHER_LEGACY_TOWNS  — towns from your old DELIVERY_DATA that are NOT
 *                            covered by the pickup-station list above, kept
 *                            so nothing that worked before stops working.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const TownLocation = require('../models/TownLocation');

const NAIROBI_TOWNS = [
  { town: 'CBD', nairobiManualFee: 0, deliveryDays: 1 },
  { town: 'Westlands', nairobiManualFee: 50, deliveryDays: 1 },
  { town: 'Karen', nairobiManualFee: 50, deliveryDays: 1 },
  { town: 'Kasarani', nairobiManualFee: 80, deliveryDays: 1 },
  { town: 'Embakasi', nairobiManualFee: 80, deliveryDays: 1 },
  { town: 'Rongai', nairobiManualFee: 100, deliveryDays: 1 },
].map((t) => ({
  county: 'Nairobi',
  town: t.town,
  isNairobi: true,
  nairobiManualFee: t.nairobiManualFee,
  deliveryDays: t.deliveryDays,
  hasPickupStation: false,
  pickupStationAddress: '',
}));

// Rough delivery-day defaults per county tier — purely for the checkout
// preview text, admin can edit any individual town afterwards.
const COUNTY_DAYS = {
  Kiambu: 2, Kajiado: 2, Machakos: 2, Muranga: 2, Kirinyaga: 2, Kitui: 2, Makueni: 2,
  Meru: 2, Embu: 2, 'Tharaka Nithi': 2, Isiolo: 2, Laikipia: 2, Nyeri: 2,
  Mombasa: 3, Kilifi: 3, Kwale: 3, 'Taita Taveta': 3,
};
const daysFor = (county) => COUNTY_DAYS[county] || 3;

// -------------------------------------------------------------------------
// Every town from the supplied pickup-station list, classified by county.
// -------------------------------------------------------------------------
const PICKUP_RAW = [
  ['Meru', 'Timau', 'Timau, Meru, ON Corridor Facing Timau Stadium Road Direct Near Stage And Githui Poshomill'],
  ['Laikipia', 'Nanyuki Town', 'Nanyuki town, Main stage stalls, opposite Meiso sacco booking office, room MN/046'],
  ['Embu', 'Runyenjes Town', 'Runyenjes town, near county Sacco, opposite catholic bookshop'],
  ['Embu', 'Embu Town', 'Embu town, 2NK stage, opposite 2NK Sacco booking booth'],
  ['Kajiado', 'Kitengela Town', 'Kitengela town, Namelok Building, Ground floor, room no.3, behind Rubis petrol station and Pizza inn adjacent to Sarafina hotel'],
  ['Mombasa', 'Mombasa - Buxton (Mwembe Tayari)', 'Cate Cyber Buxton Area, Narok Road, near Kenya Methodist University and opposite Buxton Auto Care Service Centre, close to Buxton Point Gate B'],
  ['Mombasa', 'Mombasa Town', 'Mombasa CBD, Kwashibu Road off Moi Ave, old Budget Supermarket (currently JCC church), opposite One Two Motor Hub, next to Natasha Cafe, before Bivamax City Traders shop'],
  ['Kwale', 'Ukunda', 'Ukunda, Kona Beach Building, next to Ochieng chemist, opposite Imarika Sacco'],
  ['Muranga', 'Muranga Town', 'Muranga town, Kephus Building, opposite Tickers Lounge, corner shop'],
  ['Muranga', 'Maragua Town', 'Maragua town, Evabamar House, opposite Sparkle Carwash, near ACK Rurago church'],
  ['Muranga', 'Kenol Town', 'Kenol town, Kilele Mall, 1st floor shop no 10, above Aga Khan Hospital - Kenol Medical Centre'],
  ['Tharaka Nithi', 'Chogoria Town', "Chogoria town, opposite Chogoria Hospital Doctor's Plaza gate, next to Alternative Restaurant"],
  ['Nyeri', 'Nyeri Town', 'Nyeri town, Kimathi street, Whispers Park containers, opposite Transchem Pharmaceuticals Ltd Nyeri'],
  ['Nyeri', 'Karatina Town (RD Patel Bldg)', 'Karatina-Nyeri highway, RD Patel Building, ground floor shop 1, opposite Total Petrol Station Karatina'],
  ['Nyeri', 'Karatina Town (Mwaka House)', 'Mwaka House, ground floor room A5, opposite Karatina University Stage'],
  ['Nyeri', 'Chaka Town', 'Chaka town, behind Chaka Railway Station, next to Ditshimologo General Stores'],
  ['Meru', 'Maua Town', 'Maua town, Maua-Athiru road, next to old NHIF offices, opposite St Josephs Maua MCK Church'],
  ['Meru', 'Nchiru', 'Nchiru market, near Meru University of Science and Technology, along Market road, next to Mulung\u2019e Medical Clinic, opposite Nchiru Market entrance'],
  ['Meru', 'Meru Town', 'Migambo Shopping Complex, ground floor shop no 1, opposite Kwa Mama Tembe Gen Shop, next to Victory Beauty Shop, near Maathai Supermarket'],
  ['Meru', 'Nkubu Town', 'Nkubu town, Catholic Church stalls, next to Unique Shuttle booking office, opposite Nkubu main stage'],
  ['Meru', 'Makutano (Meru)', 'Meru Makutano, Mtwaruchio House, 1st floor shop 16, between KCB Bank and Mediwell Hospital'],
  ['Kiambu', 'Makongeni (Thika)', 'Makongeni, Thika, near Delta Petrol Station, opposite Auto Express Garissa Road, next to Heshima Boda Boda shade'],
  ['Kiambu', 'Thika Town', 'Grace House, ground floor shop no.6, Kwame Nkuruma Street, along Safaricom, opp Johana Center'],
  ['Kiambu', 'Ikinu Town', 'Ikinu Town, opposite Rubis Petrol Station, next to Brilliant Bookshop'],
  ['Kirinyaga', 'Kagio Town', 'Kagio market, along Kutus-Sagana road, next to Emmaus Agro Hardware'],
  ['Kirinyaga', 'Mwea Town', 'Embu-Nairobi highway, next to Bata Mwea shop, opposite Old Eastmatt Supermarket'],
  ['Isiolo', 'Isiolo Town', 'Isiolo town, Main stage, opposite Inana Sacco booking office'],
  ['Kiambu', 'Githunguri Town (Diplomat House)', 'Diplomat House, ground floor shop no.4, next to Githunguri bus stop'],
  ['Kiambu', 'Githunguri Town (Mumia Complex)', 'Mumia Complex ground floor, behind GDC Sacco HQ'],
  ['Kiambu', 'Kiambu Town (Co-op Bank)', 'Along Kiambu-Nairobi Road, opposite Cooperative Bank, stall no.D18'],
  ['Kiambu', 'Limuru Town', 'Limuru-Kwa Mbira road, Jaskat Centre 2nd floor shop no.210, next to Kimucho Complex'],
  ['Kiambu', 'Kiambu Town (Kiach Bldg)', 'Kiach Building shop no.2, along Kiambu-Ndumberi Road, between St.Bridget and Radiant Hospital sign board'],
  ['Kiambu', 'Kikuyu Town', 'Post Office Road, May House 1st floor M4, next to Holiday Driving School, opposite Kirigu-Ini House'],
  ['Nakuru', 'Naivasha Town', 'Kenya Women Finance Trust (KWFT) building, 2nd shop, adjacent to Telkom shop'],
  ['Nakuru', 'Gilgil Town', 'Main street, Makutano Building, behind Safaricom customer care, opposite Posta, next to Deputy County Commissioner office'],
  ['Kajiado', 'Namanga Town', 'Bunus Cyber - Transborder building, near Maili Tisa matatu stage'],
  ['Kajiado', 'Isinya Town', 'Omom Enkai Electricals, along Galaxy Road, next to Jubilee building'],
  ['Kajiado', 'Ngong Town', 'Shijays Opulent Enterprises, Zambia Stage, next to Suswa Plaza'],
  ['Kajiado', 'Kajiado Town', 'Containers opposite Sidian Bank, shop no 2, next to Family Bank Kajiado branch'],
  ['Kilifi', 'Kilifi Town', 'Behind Absa Bank, opposite NCBA Bank'],
  ['Kilifi', 'Watamu Town', 'Dzalamkadze, before Watamu Total Petrol Service, Watamu, Kilifi County'],
  ['Kilifi', 'Malindi Town', 'Divine Victory shop, near Santorini Lounge, Sala Gate, opposite Abel Medical Clinic, along Tsavo Road'],
  ['Taita Taveta', 'Voi Town', 'Arusha Sounds, Voi Stage, next to Coast Bus office'],
  ['Makueni', 'Kibwezi Town', 'Kibwezi town, busy street next to Choices Butchery'],
  ['Makueni', 'Emali Town', 'Emali town, Maasai Inn Building, behind Emali Supermarket'],
  ['Kilifi', 'Mtwapa Town', 'Mtwapa Shopping Complex, ground floor shop F3, Mombasa-Malindi Road (between Imarika Sacco and Total petrol station)'],
  ['Kitui', 'Kitui Town', 'Mbusyani road, opposite Maendeleo ya Wanawake, shop no 1'],
  ['Machakos', 'Machakos Town', 'Cooperative Union Building, opposite Co-operative Bank, entrance before Bata shop, 1st floor shop no 14'],
  ['Machakos', 'Mlolongo Town', 'Recci Electronics shop and phone repair, behind Quickmart Supermarket, 100m along the street adjacent to the supermarket'],
  ['Machakos', 'Kyumvi', 'Next to Kyumbi Police Station on your right, Miracle Plaza, shop no 2'],
  ['Makueni', 'Makueni (Wote)', 'Wote, near Cooperative Bank, behind Cocacola depot, shop no 5'],
  ['Kilifi', 'Mariakani Town', 'Royal Plaza shop no 1C, along Mombasa-Nairobi highway'],
  ['Kilifi', 'Mazeras Town', 'Opposite Mazeras Main Stage, opposite Ozone Petrol Station'],
  ['Taita Taveta', 'Maungu Town', 'Mombasa Stage, Mkombozi Building, beside Miliana Chemist'],
  ['Kwale', 'Taru Town', 'Mombasa-Nairobi Rd, Stariit Plaza, ground floor, next to Safaricom Customer Care'],
  ['Nyeri', 'Naromoru Town', 'Naromoru town, opposite Total Petrol Station, near Popular Supermarket'],
  ['Tharaka Nithi', 'Chuka Town', 'Chuka town, inside Chuka Main Stage, stall no 8'],
  ['Kirinyaga', 'Kutus Town', 'Opposite St Triza Girls Kutus main gate, next to Badilisha Plaza, 1st floor room 1'],
  ['Nakuru', 'Nakuru Town', 'Kenyatta Avenue, Kimotho House Shopping Mall, ground floor shop no G28, next to Shoppers Paradise'],
  ['Uasin Gishu', 'Eldoret Town', 'Ronald Ngala Street, Safina Plaza, ground floor, room G15, next to Mt Kenya University'],
  ['Trans Nzoia', 'Kitale Town', 'Sungura Street, Club 100 Building, 1st floor, Stall 033'],
  ['Nandi', 'Kapsabet Town', 'Sogom Hotel Building, basement shop no 2, next to Anika Tractor Spares Ltd'],
  ['Kakamega', 'Kakamega Town', 'Dharau-Safaricom street, Emisioma House (DTB Bank Building), 2nd floor, right wing, room no 34'],
  ['Trans Nzoia', 'Kiminini Town', 'Menya Ciaku Mini Supermarket, next to Home Depot filling station, opposite Main Market'],
  ['Bungoma', 'Webuye (Dina Junction)', 'Dina Junction, Kamp David Complex, next to North Rift Shuttle booking office'],
  ['Bungoma', 'Bungoma Town', 'Off Moi Avenue, Afrique Centre Building, behind Huduma Center, opposite Telkom House'],
  ['Siaya', 'Siaya Town (Maria House)', 'Maria House, opposite Siaya Main Stage, 2nd floor shop no 9'],
  ['Siaya', 'Bondo Town', 'Oginga Odinga grounds, adjacent to West End Hotel, opposite HP shop'],
  ['Siaya', 'Siaya Town (Centoz)', 'Centoz Investment Siaya, Door No A6, opposite Ena Coach booking office'],
  ['Vihiga', 'Mbale Town', 'Along Mbihi road, next to Praise Centre Church'],
  ['Kisumu', 'Kisumu Town', 'Jomo Kenyatta highway, directly opposite United Mall (Carrefour Supermarket)'],
  ['Kericho', 'Kericho Town', 'Elim Business Centre, opposite Kericho Main Prison, stall no E04'],
  ['Kisumu', 'Awasi Town', 'Kisumu-Nairobi highway, next to Awasi Police Station'],
  ['Kisumu', 'Ahero', 'Kisumu-Nairobi highway, near virtual weighbridge, opposite AFTA petrol station'],
  ['Homa Bay', 'Homa Bay Town', 'Along Kendu Bay-Rongo road, opposite Modern Market, next to Rio City Hair Centre'],
  ['Kericho', 'Londiani Town', 'Mama Josiah Tailoring Shop, next to Safaricom shop'],
  ['Migori', 'Migori Town', 'Suna Driving School Building, ground floor, next to Lifecare Hospital, opposite Migori Primary School'],
  ['Kisii', 'Kisii Town', 'Silver Building, ground floor, next to Catholic Church CBD, along Church Road, third shop from SM Fries'],
  ['Nyamira', 'Nyamira Town', 'Along Nyamira-Kisumu road, Nyabite market, opposite George Mirambo Guest House'],
  ['Bomet', 'Bomet Town', 'Bomet-Narok road, inside Ola Petrol Station, next to Ola Cafe'],
  ['Narok', 'Narok Town', 'Corner house, next to Maish Boutique, shop no C13'],
  ['Laikipia', 'Nyahururu Town', 'MIMA Center, ground floor, room no 9, next to Breeze Hotel, opposite Sidian Bank'],
  ['Kirinyaga', 'Kerugoya Town', 'ACK containers, opposite Focus Hospital, stall no 9'],
  ['Mombasa', 'Changamwe Town', 'Opposite Changamwe Police Post, near St Mary Catholic Church'],
  ['Busia', 'Busia Town', 'Consolata Doctors Plaza, ground floor, Bata Downtown Depot, next to Mayenje Chemist'],
  ['Kajiado', 'Kiserian', 'Next to Style Up Driving School, Xtreme Media shop'],
  ['Kajiado', 'Ongata Rongai', 'Maasai Lodge stage, near county gas, Xtreme Media shop'],
  ['Mombasa', 'Bamburi Town', 'Baraka Book Shop, next to Baraka Estate main gate, opposite Safqa Plaza, on Bamburi Mtambo road'],
  ['Nakuru', 'Molo', 'Kamugunda Building, ground floor, opposite KWFT'],
  ['Mombasa', 'Nyali', 'Kenol Nyali, next to City Mall'],
  ['Makueni', 'Makindu Town', 'Next to Dante Club, beside Heritage Motorbikes'],
  ['Siaya', 'Siaya Town Center', 'Siaya Town Center'],
];

const PICKUP_STATION_TOWNS = PICKUP_RAW.map(([county, town, address]) => ({
  county,
  town,
  isNairobi: false,
  nairobiManualFee: 0,
  deliveryDays: daysFor(county),
  hasPickupStation: true,
  pickupStationAddress: address,
}));

// Old DELIVERY_DATA towns that aren't covered by the pickup-station list
// above — kept so no previously-working town silently disappears.
const OTHER_LEGACY_TOWNS = [
  ['Kajiado', 'Loitoktok', 3],
  ['Bungoma', 'Kimilili', 3],
  ['Bungoma', 'Chwele', 4],
  ['Kisii', 'Keroka', 3],
  ['Kisii', 'Ogembo', 4],
  ['Siaya', 'Ugunja', 4],
].map(([county, town, deliveryDays]) => ({
  county,
  town,
  isNairobi: false,
  nairobiManualFee: 0,
  deliveryDays,
  hasPickupStation: false,
  pickupStationAddress: '',
}));

const ALL_TOWNS = [...NAIROBI_TOWNS, ...PICKUP_STATION_TOWNS, ...OTHER_LEGACY_TOWNS];

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected. Seeding ${ALL_TOWNS.length} towns (upsert — existing rows are left untouched)...`);

  let created = 0;
  let skipped = 0;

  for (const t of ALL_TOWNS) {
    const res = await TownLocation.updateOne(
      { county: t.county, town: t.town },
      { $setOnInsert: t },
      { upsert: true }
    );
    if (res.upsertedCount && res.upsertedCount > 0) created++;
    else skipped++;
  }

  console.log(`Done. Created ${created} new town(s), skipped ${skipped} already-existing town(s).`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});