import type { ServiceCatalog } from "../mobileServices";

/**
 * Whish App catalog items (categories → subcategories → items).
 * Part of the Mobile Services starting catalog — imported by
 * `@/data/mobileServices`, which keeps the full catalog shape (see its doc
 * comment). Only seeds a NEW shop; existing shops keep their database items.
 *
 * Everything except the original alfa / mtc Prepaid cards was added from the
 * Whish app crawl of 2026-10-14 (docs/whish-prices/): `cost` is the LBP price
 * Whish charges the shop and `sell` starts equal to cost (owner rule
 * 2026-10-10). Migration v216 adds those same items to shops that already had
 * a catalog, from its own frozen copy
 * (packages/core/src/db/migrations/data/v216WhishAppCatalog.ts) — editing an
 * item here does not change what v216 did. *
 * LIRA-324: `cost_usd` / `sell_usd` are the USD prices from the 2026-10-14
 * USD crawl (sell starts equal to cost); items with `cost: "0"` are sold by
 * Whish in USD only, so LBP mode hides them. MTC / Alfa Prepaid cards stay
 * LBP-only. Migration v218 gives existing shops the same prices from its own
 * frozen copy (packages/core/src/db/migrations/data/v218WhishUsdPrices.ts).
 */
export const whishAppCatalog: ServiceCatalog = {
  alfa: {
    Prepaid: {
      // Credit-only card (no validity days), like the iPick 1.22. Added from
      // the 2026-10-14 Whish app crawl (cost = Whish price, sell = cost).
      "1.22": { cost: "141201", sell: "141201", credits: 1.22 },
      // Named by the CARD FACE VALUE (printed on the card), not the sell
      // price — owner decision 2026-07-03 (A1). Costs/sells unchanged.
      // `credits` and `validity_days` (owner-confirmed 2026-08-03/04) kept
      // identical to the iPick/Katsh alfa blocks — the same physical card.
      // `3.03` has no confirmed day count and stays credit-only.
      "3.03": { cost: "318978", sell: "355000", credits: 3.03 },
      "4.5": {
        cost: "462075",
        sell: "500000",
        validity_days: 10,
        credits: 4.5,
      },
      "7.58": {
        cost: "765007",
        sell: "800000",
        validity_days: 30,
        credits: 7.58,
      },
      "10": {
        cost: "1003274 ",
        sell: "1100000",
        validity_days: 30,
        credits: 10,
      },
      "15.15": {
        cost: "1511601",
        sell: "1600000",
        validity_days: 60,
        credits: 15.15,
      },
      "22.73": {
        cost: "2256769",
        sell: "2400000",
        validity_days: 90,
        credits: 22.73,
      },
      "77.28": {
        cost: "7620030",
        sell: "8000000",
        validity_days: 365,
        credits: 77.28,
      },
    },
    "Alfa Go": {
      "Alfa Go": {
        cost: "700000",
        sell: "700000",
        cost_usd: "7.82",
        sell_usd: "7.82",
      },
      "Alfa Go+": {
        cost: "1215000",
        sell: "1215000",
        cost_usd: "13.58",
        sell_usd: "13.58",
      },
      "Alfa Go Max": {
        cost: "1720000",
        sell: "1720000",
        cost_usd: "19.22",
        sell_usd: "19.22",
      },
    },
    "Mobile Internet": {
      "1GB": {
        cost: "355000",
        sell: "355000",
        cost_usd: "3.97",
        sell_usd: "3.97",
      },
      "7GB": {
        cost: "910000",
        sell: "910000",
        cost_usd: "10.17",
        sell_usd: "10.17",
      },
      "22GB": {
        cost: "1470000",
        sell: "1470000",
        cost_usd: "16.42",
        sell_usd: "16.42",
      },
      "44GB": {
        cost: "2125000",
        sell: "2125000",
        cost_usd: "23.74",
        sell_usd: "23.74",
      },
      "77GB": {
        cost: "3140000",
        sell: "3140000",
        cost_usd: "35.08",
        sell_usd: "35.08",
      },
      "111GB": {
        cost: "4055000",
        sell: "4055000",
        cost_usd: "45.31",
        sell_usd: "45.31",
      },
      "444GB": {
        cost: "13070000",
        sell: "13070000",
        cost_usd: "146.04",
        sell_usd: "146.04",
      },
    },
    "Mobile Internet (Postpaid)": {
      "1GB": {
        cost: "355000",
        sell: "355000",
        cost_usd: "3.97",
        sell_usd: "3.97",
      },
      "7GB": {
        cost: "910000",
        sell: "910000",
        cost_usd: "10.17",
        sell_usd: "10.17",
      },
      "25GB": {
        cost: "1470000",
        sell: "1470000",
        cost_usd: "16.42",
        sell_usd: "16.42",
      },
      "50GB": {
        cost: "2125000",
        sell: "2125000",
        cost_usd: "23.74",
        sell_usd: "23.74",
      },
      "85GB": {
        cost: "3140000",
        sell: "3140000",
        cost_usd: "35.08",
        sell_usd: "35.08",
      },
      "120GB": {
        cost: "4055000",
        sell: "4055000",
        cost_usd: "45.31",
        sell_usd: "45.31",
      },
      "475GB": {
        cost: "13070000",
        sell: "13070000",
        cost_usd: "146.04",
        sell_usd: "146.04",
      },
    },
    Boosters: {
      "50MB": {
        cost: "35000",
        sell: "35000",
        cost_usd: "0.4",
        sell_usd: "0.4",
      },
      "600MB": {
        cost: "100000",
        sell: "100000",
        cost_usd: "1.12",
        sell_usd: "1.12",
      },
      "unlinmited 2hrs": {
        cost: "170000",
        sell: "170000",
        cost_usd: "1.9",
        sell_usd: "1.9",
      },
      "20mins": {
        cost: "35000",
        sell: "35000",
        cost_usd: "0.4",
        sell_usd: "0.4",
      },
    },
    "Weekly data": {
      "500MB": {
        cost: "170000",
        sell: "170000",
        cost_usd: "1.9",
        sell_usd: "1.9",
      },
      "1.5GB": {
        cost: "235000",
        sell: "235000",
        cost_usd: "2.63",
        sell_usd: "2.63",
      },
      "5GB": {
        cost: "505000",
        sell: "505000",
        cost_usd: "5.65",
        sell_usd: "5.65",
      },
    },
    "Surf & Talk": {
      "4x4": {
        cost: "405000",
        sell: "405000",
        cost_usd: "4.53",
        sell_usd: "4.53",
      },
      "5x5": {
        cost: "170000",
        sell: "170000",
        cost_usd: "1.9",
        sell_usd: "1.9",
      },
    },
    "Mobile broadband": {
      "1GB": {
        cost: "355000",
        sell: "355000",
        cost_usd: "3.97",
        sell_usd: "3.97",
      },
      "7GB": {
        cost: "910000",
        sell: "910000",
        cost_usd: "10.17",
        sell_usd: "10.17",
      },
      "22GB": {
        cost: "1470000",
        sell: "1470000",
        cost_usd: "16.42",
        sell_usd: "16.42",
      },
      "44GB": {
        cost: "2125000",
        sell: "2125000",
        cost_usd: "23.74",
        sell_usd: "23.74",
      },
      "77GB": {
        cost: "3140000",
        sell: "3140000",
        cost_usd: "35.08",
        sell_usd: "35.08",
      },
      "111GB": {
        cost: "4055000",
        sell: "4055000",
        cost_usd: "45.31",
        sell_usd: "45.31",
      },
      "444GB": {
        cost: "13070000",
        sell: "13070000",
        cost_usd: "146.04",
        sell_usd: "146.04",
      },
    },
    Weekender: {
      "the weekender": {
        cost: "135000",
        sell: "135000",
        cost_usd: "1.51",
        sell_usd: "1.51",
      },
    },
  },
  mtc: {
    Prepaid: {
      // Named by the CARD FACE VALUE (what's printed on the card), not the
      // sell price — owner decision 2026-07-03 (A1). Costs/sells unchanged.
      "1": { cost: "119617", sell: "150000", credits: 1 },
      "1.67": { cost: "186071", sell: "235000", credits: 1.67 },
      "3.79": {
        cost: "398723",
        sell: "440000",
        validity_days: 10,
        credits: 3.79,
      },
      "4.5": {
        cost: "462518",
        sell: "500000",
        validity_days: 30,
        credits: 4.5,
      },
      "7.58": {
        cost: "765007",
        sell: "800000",
        validity_days: 30,
        credits: 7.58,
      },
      "10": {
        cost: "1003274 ",
        sell: "1100000",
        validity_days: 30,
        credits: 10,
      },
      "15.15": {
        cost: "1509829",
        sell: "1600000",
        validity_days: 60,
        credits: 15.15,
      },
      "22.73": {
        cost: "2255883",
        sell: "2400000",
        validity_days: 90,
        credits: 22.73,
      },
      "77.28": {
        cost: "7620030",
        sell: "8000000",
        validity_days: 365,
        credits: 77.28,
      },
      start: { cost: "464290", sell: "500000" },
      startSOS: { cost: "141768", sell: "2000000" },
      smart: { cost: "765547", sell: "800000" },
      super: { cost: "1360973", sell: "1450000" },
    },
    Validity: {
      "30 days": {
        cost: "250000",
        sell: "250000",
        cost_usd: "2.8",
        sell_usd: "2.8",
      },
      "60 days": {
        cost: "500000",
        sell: "500000",
        cost_usd: "5.6",
        sell_usd: "5.6",
      },
      "90 days": {
        cost: "750000",
        sell: "750000",
        cost_usd: "8.4",
        sell_usd: "8.4",
      },
      "180 days": {
        cost: "1500000",
        sell: "1500000",
        cost_usd: "16.8",
        sell_usd: "16.8",
      },
      "360 days": {
        cost: "3000000",
        sell: "3000000",
        cost_usd: "33.6",
        sell_usd: "33.6",
      },
    },
  },
  Telecom: {
    "DU UAE": {
      "DU PIN 25 AED": {
        cost: "682000",
        sell: "682000",
        cost_usd: "8",
        sell_usd: "8",
      },
      "DU PIN 55 AED": {
        cost: "1449000",
        sell: "1449000",
        cost_usd: "17",
        sell_usd: "17",
      },
      "DU PIN 110 AED": {
        cost: "2813000",
        sell: "2813000",
        cost_usd: "33",
        sell_usd: "33",
      },
      "DU PIN 210 AED": {
        cost: "5369000",
        sell: "5369000",
        cost_usd: "63",
        sell_usd: "63",
      },
      "DU PIN 525 AED": {
        cost: "13464000",
        sell: "13464000",
        cost_usd: "158",
        sell_usd: "158",
      },
    },
    "Etisalat UAE": {
      "ETISALAT PIN 30 AED": {
        cost: "767000",
        sell: "767000",
        cost_usd: "9",
        sell_usd: "9",
      },
      "ETISALAT PIN 55 AED": {
        cost: "1449000",
        sell: "1449000",
        cost_usd: "17",
        sell_usd: "17",
      },
      "ETISALAT PIN 110 AED": {
        cost: "2813000",
        sell: "2813000",
        cost_usd: "33",
        sell_usd: "33",
      },
      "ETISALAT PIN 210 AED": {
        cost: "5369000",
        sell: "5369000",
        cost_usd: "63",
        sell_usd: "63",
      },
      "ETISALAT PIN 525 AED": {
        cost: "13464000",
        sell: "13464000",
        cost_usd: "158",
        sell_usd: "158",
      },
    },
    "STC KSA": {
      "STC SAR 20": {
        cost: "590000",
        sell: "590000",
        cost_usd: "6.57",
        sell_usd: "6.57",
      },
      "STC SAR 30": {
        cost: "863000",
        sell: "863000",
        cost_usd: "9.61",
        sell_usd: "9.61",
      },
      "STC SAR 50": {
        cost: "1452000",
        sell: "1452000",
        cost_usd: "16.18",
        sell_usd: "16.18",
      },
      "STC SAR 100": {
        cost: "2813000",
        sell: "2813000",
        cost_usd: "31.36",
        sell_usd: "31.36",
      },
      "STC SAR 200": {
        cost: "5537000",
        sell: "5537000",
        cost_usd: "61.72",
        sell_usd: "61.72",
      },
      "STC SAR 300": {
        cost: "8260000",
        sell: "8260000",
        cost_usd: "92.08",
        sell_usd: "92.08",
      },
      "STC SAR 17.39": {
        cost: "519000",
        sell: "519000",
        cost_usd: "5.78",
        sell_usd: "5.78",
      },
    },
  },
  internet: {
    Terranet: {
      "TERR DSL 4MB 60GB": {
        cost: "519500",
        sell: "519500",
        cost_usd: "5.84",
        sell_usd: "5.84",
      },
      "TERR DSL OS 100GB / 4MB 100GB": {
        cost: "797000",
        sell: "797000",
        cost_usd: "8.96",
        sell_usd: "8.96",
      },
      "TERR DSL OS 160GB / 4MB UNLIMITED / SMART": {
        cost: "1296500",
        sell: "1296500",
        cost_usd: "14.57",
        sell_usd: "14.57",
      },
      "TERR DSL OS 200GB / 6MB UNLIMITED / HOME": {
        cost: "1518500",
        sell: "1518500",
        cost_usd: "17.07",
        sell_usd: "17.07",
      },
      "TERR DSL 8MB UNLIMITED / PLAY": {
        cost: "2129000",
        sell: "2129000",
        cost_usd: "23.93",
        sell_usd: "23.93",
      },
      "TERR DSL 50MB UNLIMITED": { cost: "2795000", sell: "2795000" },
      "TERR DSL OS 120GB": {
        cost: "963500",
        sell: "963500",
        cost_usd: "10.83",
        sell_usd: "10.83",
      },
      "TERR DSL OS 240GB": {
        cost: "1685000",
        sell: "1685000",
        cost_usd: "18.94",
        sell_usd: "18.94",
      },
      "TERR DSL OS 400GB": {
        cost: "2462000",
        sell: "2462000",
        cost_usd: "27.67",
        sell_usd: "27.67",
      },
      "TERR DSL OS 500GB": {
        cost: "2906000",
        sell: "2906000",
        cost_usd: "32.66",
        sell_usd: "32.66",
      },
      "TERR DSL OS 1000GB": {
        cost: "4016000",
        sell: "4016000",
        cost_usd: "45.13",
        sell_usd: "45.13",
      },
      "TERR DSL EXTRA VOLUME 5GB": {
        cost: "158750",
        sell: "158750",
        cost_usd: "1.79",
        sell_usd: "1.79",
      },
      "TERR ARMY DSL 4MB 60GB": {
        cost: "408500",
        sell: "408500",
        cost_usd: "4.59",
        sell_usd: "4.59",
      },
      "TERR ARMY DSL 4MB 100GB": {
        cost: "630500",
        sell: "630500",
        cost_usd: "7.09",
        sell_usd: "7.09",
      },
      "TERR ARMY DSL OS 120GB": {
        cost: "741500",
        sell: "741500",
        cost_usd: "8.34",
        sell_usd: "8.34",
      },
      "TERR ARMY DSL OS 160GB / 4MB UNLIMITED / SMART": {
        cost: "963500",
        sell: "963500",
        cost_usd: "10.83",
        sell_usd: "10.83",
      },
      "TERR ARMY DSL OS 200GB / 6MB UNLIMITED / HOME": {
        cost: "1185500",
        sell: "1185500",
        cost_usd: "13.33",
        sell_usd: "13.33",
      },
      "TERR ARMY DSL 8MB UNLIMITED / PLAY": {
        cost: "1574000",
        sell: "1574000",
        cost_usd: "17.69",
        sell_usd: "17.69",
      },
      "TERR ARMY DSL OS 240GB": {
        cost: "1296500",
        sell: "1296500",
        cost_usd: "14.57",
        sell_usd: "14.57",
      },
      "TERR ARMY DSL OS 400GB": {
        cost: "1740500",
        sell: "1740500",
        cost_usd: "19.56",
        sell_usd: "19.56",
      },
      "TERR ARMY DSL OS 500GB": {
        cost: "2184500",
        sell: "2184500",
        cost_usd: "24.55",
        sell_usd: "24.55",
      },
      "TERR ARMY DSL OS 1000GB": { cost: "2961500", sell: "2961500" },
      "TERR ARMY DSL 50 MB UNLIMITED": { cost: "2073500", sell: "2073500" },
      "TERR FIBER 50 MB UNLIMITED": {
        cost: "2628500",
        sell: "2628500",
        cost_usd: "29.54",
        sell_usd: "29.54",
      },
      "TERR FIBER 300GB": {
        cost: "2073500",
        sell: "2073500",
        cost_usd: "23.3",
        sell_usd: "23.3",
      },
      "TERR FIBER 400GB": {
        cost: "2462000",
        sell: "2462000",
        cost_usd: "27.67",
        sell_usd: "27.67",
      },
      "TERR FIBER 500GB": {
        cost: "2850500",
        sell: "2850500",
        cost_usd: "32.03",
        sell_usd: "32.03",
      },
      "TERR FIBER 850GB": {
        cost: "3572000",
        sell: "3572000",
        cost_usd: "40.14",
        sell_usd: "40.14",
      },
      "TERR FIBER 1000GB": {
        cost: "4016000",
        sell: "4016000",
        cost_usd: "45.13",
        sell_usd: "45.13",
      },
      "TERR FIBER 1500GB": {
        cost: "6014000",
        sell: "6014000",
        cost_usd: "67.58",
        sell_usd: "67.58",
      },
      "TERR FIBER 2000GB": {
        cost: "7013000",
        sell: "7013000",
        cost_usd: "78.8",
        sell_usd: "78.8",
      },
      "TERR FIBER 2500GB": {
        cost: "8567000",
        sell: "8567000",
        cost_usd: "96.26",
        sell_usd: "96.26",
      },
    },
    Connect: {
      "CONNECT DSL 4M / 85 GB": {
        cost: "526000",
        sell: "526000",
        cost_usd: "5.92",
        sell_usd: "5.92",
      },
      "Connect DSL 4MB - 85GB - FNT": {
        cost: "681000",
        sell: "681000",
        cost_usd: "7.66",
        sell_usd: "7.66",
      },
      "CONNECT DSL OPEN SPEED 160 GB": {
        cost: "1186000",
        sell: "1186000",
        cost_usd: "13.33",
        sell_usd: "13.33",
      },
      "CONNECT DSL OS 160GB + FNT": {
        cost: "1341000",
        sell: "1341000",
        cost_usd: "15.07",
        sell_usd: "15.07",
      },
      "CONNECT DSL OPEN SPEED 320 GB": {
        cost: "2196000",
        sell: "2196000",
        cost_usd: "24.68",
        sell_usd: "24.68",
      },
      "CONNECT DSL OS 320GB + FNT": {
        cost: "2351000",
        sell: "2351000",
        cost_usd: "26.42",
        sell_usd: "26.42",
      },
      "CONNECT DSL OPEN SPEED 500 GB": {
        cost: "2740000",
        sell: "2740000",
        cost_usd: "30.79",
        sell_usd: "30.79",
      },
      "CONNECT DSL OS 500GB + FNT": {
        cost: "2895000",
        sell: "2895000",
        cost_usd: "32.53",
        sell_usd: "32.53",
      },
      "CONNECT DSL 6M UNLIMITED": {
        cost: "1419000",
        sell: "1419000",
        cost_usd: "15.95",
        sell_usd: "15.95",
      },
      "CONNECT DSL 8M UNLIMITED": {
        cost: "1963000",
        sell: "1963000",
        cost_usd: "22.06",
        sell_usd: "22.06",
      },
      "CONNECT DSL FREEZE": {
        cost: "254000",
        sell: "254000",
        cost_usd: "2.86",
        sell_usd: "2.86",
      },
      "CONNECT FWA BASIC 10Mbps 100GB": {
        cost: "2411000",
        sell: "2411000",
        cost_usd: "26.87",
        sell_usd: "26.87",
      },
      "CONNECT FWA SILVER 10Mbps 145GB": {
        cost: "3226000",
        sell: "3226000",
        cost_usd: "35.96",
        sell_usd: "35.96",
      },
      "CONNECT FWA GOLD 10Mbps 300GB": {
        cost: "5018000",
        sell: "5018000",
        cost_usd: "55.94",
        sell_usd: "55.94",
      },
      "CONNECT FWA PLATINUM 10 Mbps 450GB": {
        cost: "7986000",
        sell: "7986000",
        cost_usd: "89.03",
        sell_usd: "89.03",
      },
      "CONNECT FWA SMART UNLIMITED 8GB": {
        cost: "3606000",
        sell: "3606000",
        cost_usd: "40.2",
        sell_usd: "40.2",
      },
      "CONNECT FWA SMART UNLIMITED 5GB": {
        cost: "2611000",
        sell: "2611000",
        cost_usd: "29.1",
        sell_usd: "29.1",
      },
      "CONNECT FWA FREEZE": {
        cost: "718000",
        sell: "718000",
        cost_usd: "8",
        sell_usd: "8",
      },
      "CONNECT FIBER 330 GB": {
        cost: "1963000",
        sell: "1963000",
        cost_usd: "22.06",
        sell_usd: "22.06",
      },
      "Connect Fiber 330GB + FNT": {
        cost: "2585000",
        sell: "2585000",
        cost_usd: "29.05",
        sell_usd: "29.05",
      },
      "CONNECT FIBER 550 GB": {
        cost: "2740000",
        sell: "2740000",
        cost_usd: "30.79",
        sell_usd: "30.79",
      },
      "Connect Fiber 550GB + FNT": {
        cost: "3362000",
        sell: "3362000",
        cost_usd: "37.78",
        sell_usd: "37.78",
      },
      "CONNECT FIBER 825 GB": {
        cost: "3128000",
        sell: "3128000",
        cost_usd: "35.15",
        sell_usd: "35.15",
      },
      "Connect Fiber 825GB + FNT": {
        cost: "3750000",
        sell: "3750000",
        cost_usd: "42.14",
        sell_usd: "42.14",
      },
      "CONNECT FIBER 1100 GB": {
        cost: "3905000",
        sell: "3905000",
        cost_usd: "43.88",
        sell_usd: "43.88",
      },
      "Connect Fiber 1100GB + FNT": {
        cost: "4527000",
        sell: "4527000",
        cost_usd: "50.87",
        sell_usd: "50.87",
      },
      "CONNECT FIBER FREEZE": {
        cost: "797000",
        sell: "797000",
        cost_usd: "8.96",
        sell_usd: "8.96",
      },
    },
    Mobi: {
      "MOBI DSL LITE 4 MBPS 80 GB": {
        cost: "486200",
        sell: "486200",
        cost_usd: "5.46",
        sell_usd: "5.46",
      },
      "MOBI DSL OS LITE 80 GB": {
        cost: "486200",
        sell: "486200",
        cost_usd: "5.46",
        sell_usd: "5.46",
      },
      "MOBI DSL LITE 4 MBPS 80 GB FNQ": {
        cost: "597200",
        sell: "597200",
        cost_usd: "6.71",
        sell_usd: "6.71",
      },
      "MOBI DSL OS LITE 80 GB FNQ": {
        cost: "597200",
        sell: "597200",
        cost_usd: "6.71",
        sell_usd: "6.71",
      },
      "MOBI DSL OS 100 GB FNQ": {
        cost: "719300",
        sell: "719300",
        cost_usd: "8.08",
        sell_usd: "8.08",
      },
      "MOBI DSL OS 115 GB FNQ": {
        cost: "819200",
        sell: "819200",
        cost_usd: "9.2",
        sell_usd: "9.2",
      },
      "MOBI DSL OS 175 GB FNQ": {
        cost: "1130000",
        sell: "1130000",
        cost_usd: "12.7",
        sell_usd: "12.7",
      },
      "MOBI DSL OS 220 GB FNQ": {
        cost: "1407500",
        sell: "1407500",
        cost_usd: "15.81",
        sell_usd: "15.81",
      },
      "MOBI DSL OS 330 GB FNQ": {
        cost: "1962500",
        sell: "1962500",
        cost_usd: "22.05",
        sell_usd: "22.05",
      },
      "MOBI DSL OS 440 GB FNQ": {
        cost: "2351000",
        sell: "2351000",
        cost_usd: "26.42",
        sell_usd: "26.42",
      },
      "MOBI DSL OS 550 GB FNQ": {
        cost: "2795000",
        sell: "2795000",
        cost_usd: "31.4",
        sell_usd: "31.4",
      },
      "MOBI DSL 4 MBPS UNLIMITED": {
        cost: "1241000",
        sell: "1241000",
        cost_usd: "13.94",
        sell_usd: "13.94",
      },
      "MOBI DSL 6 MBPS UNLIMITED": {
        cost: "1407500",
        sell: "1407500",
        cost_usd: "15.81",
        sell_usd: "15.81",
      },
      "MOBI DSL 8 MBPS UNLIMITED": {
        cost: "1962500",
        sell: "1962500",
        cost_usd: "22.05",
        sell_usd: "22.05",
      },
      "MOBI DSL OPEN PLAY UNLIMITED": {
        cost: "2073500",
        sell: "2073500",
        cost_usd: "23.3",
        sell_usd: "23.3",
      },
      "MOBI FIBER LITE 150 GB": {
        cost: "1352000",
        sell: "1352000",
        cost_usd: "15.19",
        sell_usd: "15.19",
      },
      "MOBI FIBER 300 GB": {
        cost: "1907000",
        sell: "1907000",
        cost_usd: "21.43",
        sell_usd: "21.43",
      },
      "MOBI FIBER 400 GB FNQ": {
        cost: "2351000",
        sell: "2351000",
        cost_usd: "26.42",
        sell_usd: "26.42",
      },
      "MOBI FIBER 500 GB FNQ": {
        cost: "2739500",
        sell: "2739500",
        cost_usd: "30.78",
        sell_usd: "30.78",
      },
      "MOBI FIBER 600 GB FNQ": {
        cost: "2961500",
        sell: "2961500",
        cost_usd: "33.28",
        sell_usd: "33.28",
      },
      "MOBI FIBER 800 GB FNQ": {
        cost: "3128000",
        sell: "3128000",
        cost_usd: "35.15",
        sell_usd: "35.15",
      },
      "MOBI FIBER 1000 GB FNQ": {
        cost: "3905000",
        sell: "3905000",
        cost_usd: "43.88",
        sell_usd: "43.88",
      },
      "MOBI FIBER 1500 GB FNQ": {
        cost: "5847500",
        sell: "5847500",
        cost_usd: "65.7",
        sell_usd: "65.7",
      },
      "MOBI FIBER 2000 GB FNQ": {
        cost: "7013000",
        sell: "7013000",
        cost_usd: "78.8",
        sell_usd: "78.8",
      },
      "MOBI FIBER 2500 GB FNQ": {
        cost: "8567000",
        sell: "8567000",
        cost_usd: "96.26",
        sell_usd: "96.26",
      },
      "MOBI FIBER UNLIMITED": {
        cost: "2517500",
        sell: "2517500",
        cost_usd: "28.29",
        sell_usd: "28.29",
      },
    },
    Wise: {
      "WISE 2890": {
        cost: "893000",
        sell: "893000",
        cost_usd: "10",
        sell_usd: "10",
      },
      "WISE 5780": {
        cost: "1680000",
        sell: "1680000",
        cost_usd: "18.8",
        sell_usd: "18.8",
      },
      "WISE 8000": {
        cost: "2258000",
        sell: "2258000",
        cost_usd: "25.3",
        sell_usd: "25.3",
      },
      "WISE 11100": {
        cost: "3045000",
        sell: "3045000",
        cost_usd: "34.1",
        sell_usd: "34.1",
      },
    },
  },
  Streaming: {
    "MBC Shahid": {
      "SHAHID VIP - 12M - LEBANON": {
        cost: "4485000",
        sell: "4485000",
        cost_usd: "50",
        sell_usd: "50",
      },
      "SHAHID VIP - 3M - LEBANON": {
        cost: "1211000",
        sell: "1211000",
        cost_usd: "13.5",
        sell_usd: "13.5",
      },
    },
    Anghami: {
      "ANGHAMI GOLD 12M": {
        cost: "7894000",
        sell: "7894000",
        cost_usd: "88",
        sell_usd: "88",
      },
      "ANGHAMI PLUS 1M": {
        cost: "449000",
        sell: "449000",
        cost_usd: "5",
        sell_usd: "5",
      },
      "ANGHAMI PLUS 3M": {
        cost: "1346000",
        sell: "1346000",
        cost_usd: "15",
        sell_usd: "15",
      },
      "ANGHAMI PLUS 6M": {
        cost: "2243000",
        sell: "2243000",
        cost_usd: "25",
        sell_usd: "25",
      },
      "ANGHAMI PLUS 12M": {
        cost: "4485000",
        sell: "4485000",
        cost_usd: "50",
        sell_usd: "50",
      },
      "ANGHAMI FAMILY 1M": {
        cost: "673000",
        sell: "673000",
        cost_usd: "7.5",
        sell_usd: "7.5",
      },
      "ANGHAMI FAMILY 12M": {
        cost: "6728000",
        sell: "6728000",
        cost_usd: "75",
        sell_usd: "75",
      },
      "ANGHAMI GOLD 1M": {
        cost: "718000",
        sell: "718000",
        cost_usd: "8",
        sell_usd: "8",
      },
    },
    "Netflix USA": {
      "NETFLIX $15": {
        cost: "1615000",
        sell: "1615000",
        cost_usd: "17",
        sell_usd: "17",
      },
      "NETFLIX $30": {
        cost: "3050000",
        sell: "3050000",
        cost_usd: "34",
        sell_usd: "34",
      },
      // USD only on Whish (LIRA-324): no LBP price, so LBP mode hides it.
      "NETFLIX 20$": { cost: "0", sell: "0", cost_usd: "22", sell_usd: "22" },
      "NETFLIX 25$": { cost: "0", sell: "0", cost_usd: "28", sell_usd: "28" },
      "NETFLIX 50$": { cost: "0", sell: "0", cost_usd: "56", sell_usd: "56" },
    },
    "Netflix UAE": {
      "NETFLIX 100 AED - UAE ONLY": {
        cost: "2602000",
        sell: "2602000",
        cost_usd: "29",
        sell_usd: "29",
      },
      "NETFLIX 500 AED - UAE ONLY": {
        cost: "12245000",
        sell: "12245000",
        cost_usd: "137",
        sell_usd: "137",
      },
    },
    "OSN+ Lebanon": {
      "OSN+ STANDARD 1M - LEBANON": {
        cost: "718000",
        sell: "718000",
        cost_usd: "8",
        sell_usd: "8",
      },
      "OSN+ STANDARD 3M - LEBANON": {
        cost: "2153000",
        sell: "2153000",
        cost_usd: "24",
        sell_usd: "24",
      },
      "OSN+ STANDARD 6M - LEBANON": {
        cost: "4306000",
        sell: "4306000",
        cost_usd: "48",
        sell_usd: "48",
      },
      "OSN+ STANDARD 12M - LEBANON": {
        cost: "7176000",
        sell: "7176000",
        cost_usd: "80",
        sell_usd: "80",
      },
      "OSN+ PREMIUM 1M - LEBANON": {
        cost: "897000",
        sell: "897000",
        cost_usd: "10",
        sell_usd: "10",
      },
      "OSN+ PREMIUM 3M - LEBANON": {
        cost: "2691000",
        sell: "2691000",
        cost_usd: "30",
        sell_usd: "30",
      },
      "OSN+ PREMIUM 6M - LEBANON": {
        cost: "5382000",
        sell: "5382000",
        cost_usd: "60",
        sell_usd: "60",
      },
      "OSN+ PREMIUM 12M - LEBANON": {
        cost: "8970000",
        sell: "8970000",
        cost_usd: "100",
        sell_usd: "100",
      },
    },
    Starzplay: {
      "STARZPLAY 6M": {
        cost: "3665000",
        sell: "3665000",
        cost_usd: "43",
        sell_usd: "43",
      },
      "STARZPLAY 12M": {
        cost: "7356000",
        sell: "7356000",
        cost_usd: "85",
        sell_usd: "85",
      },
      "STARZPLAY 3M": {
        cost: "1821000",
        sell: "1821000",
        cost_usd: "23",
        sell_usd: "23",
      },
    },
    Crunchyroll: {
      "Crunchyroll - 3 Months": { cost: "2602000", sell: "2602000" },
      "Crunchyroll - 12 Months": { cost: "8970000", sell: "8970000" },
      "Crunchyroll - 1 Month": { cost: "897000", sell: "897000" },
    },
    Twitch: {
      "TWITCH $50 (Not Redeemable Outside USA)": {
        cost: "4485000",
        sell: "4485000",
        cost_usd: "50",
        sell_usd: "50",
      },
      "TWITCH $100 (Not Redeemable Outside USA)": {
        cost: "8970000",
        sell: "8970000",
        cost_usd: "100",
        sell_usd: "100",
      },
      "TWITCH $25 (Not Redeemable Outside USA)": {
        cost: "2243000",
        sell: "2243000",
      },
    },
    Podu: {
      "PODU $5.14": {
        cost: "462000",
        sell: "462000",
        cost_usd: "5.14",
        sell_usd: "5.14",
      },
      "PODU $10.35": {
        cost: "929000",
        sell: "929000",
        cost_usd: "10.35",
        sell_usd: "10.35",
      },
      "PODU $1": { cost: "90000", sell: "90000" },
    },
    "Spacetoon Go": {
      "Spacetoon Go $45": { cost: "4037000", sell: "4037000" },
    },
    "MBC Shahid UAE": {
      // USD only on Whish (LIRA-324): no LBP price, so LBP mode hides it.
      "SHAHID VIP - 3M - UAE": {
        cost: "0",
        sell: "0",
        cost_usd: "35.13",
        sell_usd: "35.13",
      },
      "SHAHID VIP - 12M - UAE": {
        cost: "0",
        sell: "0",
        cost_usd: "122.5",
        sell_usd: "122.5",
      },
    },
    "Starzplay UAE": {
      // USD only on Whish (LIRA-324): no LBP price, so LBP mode hides it.
      "STARZPLAY 40 AED - 1M - UAE": {
        cost: "0",
        sell: "0",
        cost_usd: "10.9",
        sell_usd: "10.9",
      },
      "STARZPLAY 100 AED - 3M - UAE": {
        cost: "0",
        sell: "0",
        cost_usd: "27.25",
        sell_usd: "27.25",
      },
      "STARZPLAY 195 AED - 6M - UAE": {
        cost: "0",
        sell: "0",
        cost_usd: "53.13",
        sell_usd: "53.13",
      },
      "STARZPLAY 330 AED - 12M - UAE": {
        cost: "0",
        sell: "0",
        cost_usd: "89.92",
        sell_usd: "89.92",
      },
    },
  },
  Gaming: {
    "Ludo Club Coins": {
      "LUDO CLUB $1 - COINS": {
        cost: "90000",
        sell: "90000",
        cost_usd: "1",
        sell_usd: "1",
      },
      "LUDO CLUB $2 - COINS": {
        cost: "180000",
        sell: "180000",
        cost_usd: "2",
        sell_usd: "2",
      },
      "LUDO CLUB $10 - COINS": {
        cost: "897000",
        sell: "897000",
        cost_usd: "10",
        sell_usd: "10",
      },
      "LUDO CLUB $15 - COINS": {
        cost: "1346000",
        sell: "1346000",
        cost_usd: "15",
        sell_usd: "15",
      },
      "LUDO CLUB $30 - COINS": {
        cost: "2691000",
        sell: "2691000",
        cost_usd: "30",
        sell_usd: "30",
      },
      "LUDO CLUB $100 - COINS": {
        cost: "8970000",
        sell: "8970000",
        cost_usd: "100",
        sell_usd: "100",
      },
    },
    "Ludo Club Cash": {
      "LUDO CLUB $1 - CASH": {
        cost: "90000",
        sell: "90000",
        cost_usd: "1",
        sell_usd: "1",
      },
      "LUDO CLUB $2 - CASH": {
        cost: "180000",
        sell: "180000",
        cost_usd: "2",
        sell_usd: "2",
      },
      "LUDO CLUB $5 - CASH": {
        cost: "449000",
        sell: "449000",
        cost_usd: "5",
        sell_usd: "5",
      },
      "LUDO CLUB $20 - CASH": {
        cost: "1794000",
        sell: "1794000",
        cost_usd: "20",
        sell_usd: "20",
      },
      "LUDO CLUB $60 - CASH": {
        cost: "5382000",
        sell: "5382000",
        cost_usd: "60",
        sell_usd: "60",
      },
      "LUDO CLUB $100 - CASH": {
        cost: "8970000",
        sell: "8970000",
        cost_usd: "100",
        sell_usd: "100",
      },
    },
    Undawn: {
      "UNDAWN $3": {
        cost: "270000",
        sell: "270000",
        cost_usd: "3",
        sell_usd: "3",
      },
      "UNDAWN $5": {
        cost: "449000",
        sell: "449000",
        cost_usd: "5",
        sell_usd: "5",
      },
      "UNDAWN $10": {
        cost: "897000",
        sell: "897000",
        cost_usd: "10",
        sell_usd: "10",
      },
      "UNDAWN $1": {
        cost: "90000",
        sell: "90000",
        cost_usd: "1",
        sell_usd: "1",
      },
    },
    "Arena Breakout": {
      "ARENA BREAKOUT $5": {
        cost: "449000",
        sell: "449000",
        cost_usd: "5",
        sell_usd: "5",
      },
      "ARENA BREAKOUT $10": {
        cost: "897000",
        sell: "897000",
        cost_usd: "10",
        sell_usd: "10",
      },
      "ARENA BREAKOUT $25": {
        cost: "2243000",
        sell: "2243000",
        cost_usd: "25",
        sell_usd: "25",
      },
      "ARENA BREAKOUT $50": {
        cost: "4485000",
        sell: "4485000",
        cost_usd: "50",
        sell_usd: "50",
      },
      "ARENA BREAKOUT $100": {
        cost: "8970000",
        sell: "8970000",
        cost_usd: "100",
        sell_usd: "100",
      },
      "ARENA BREAKOUT $1": {
        cost: "90000",
        sell: "90000",
        cost_usd: "1",
        sell_usd: "1",
      },
    },
    "EA Play": {
      "EA PLAY $25 - USA (PC ONLY)": {
        cost: "2243000",
        sell: "2243000",
        cost_usd: "25",
        sell_usd: "25",
      },
      "EA PLAY $15 - USA (PC ONLY)": {
        cost: "1346000",
        sell: "1346000",
        cost_usd: "15",
        sell_usd: "15",
      },
    },
    "Genshin Impact": {
      "GENSHIN IMPACT $5": { cost: "449000", sell: "449000" },
      "GENSHIN IMPACT $15": { cost: "1346000", sell: "1346000" },
      "GENSHIN IMPACT $30": { cost: "2691000", sell: "2691000" },
      "GENSHIN IMPACT $50": { cost: "4485000", sell: "4485000" },
      "GENSHIN IMPACT $100": { cost: "8970000", sell: "8970000" },
      "GENSHIN IMPACT $5 - BOTWM": { cost: "449000", sell: "449000" },
      "GENSHIN IMPACT $1": { cost: "90000", sell: "90000" },
    },
    Nexon: {
      "NEXON $15 - EU": {
        cost: "1167000",
        sell: "1167000",
        cost_usd: "15",
        sell_usd: "15",
      },
      "NEXON $25": {
        cost: "2243000",
        sell: "2243000",
        cost_usd: "25",
        sell_usd: "25",
      },
      "NEXON $50": {
        cost: "4485000",
        sell: "4485000",
        cost_usd: "50",
        sell_usd: "50",
      },
      "NEXON $100": {
        cost: "8970000",
        sell: "8970000",
        cost_usd: "100",
        sell_usd: "100",
      },
      "NEXON $10": {
        cost: "897000",
        sell: "897000",
        cost_usd: "10",
        sell_usd: "10",
      },
    },
    "Legends of Runeterra": {
      "LEGENDS OF RUNETERRA $28": {
        cost: "2512000",
        sell: "2512000",
        cost_usd: "28",
        sell_usd: "28",
      },
      "LEGENDS OF RUNETERRA $14": {
        cost: "1256000",
        sell: "1256000",
        cost_usd: "14",
        sell_usd: "14",
      },
    },
    "Climbing Sand Dune": {
      "Climbing Sand Dune $19.79": {
        cost: "1776000",
        sell: "1776000",
        cost_usd: "19.79",
        sell_usd: "19.79",
      },
      "Climbing Sand Dune $37.79": {
        cost: "3390000",
        sell: "3390000",
        cost_usd: "37.79",
        sell_usd: "37.79",
      },
      "Climbing Sand Dune $89.99": {
        cost: "8073000",
        sell: "8073000",
        cost_usd: "89.99",
        sell_usd: "89.99",
      },
      "Climbing Sand Dune $8.99": {
        cost: "807000",
        sell: "807000",
        cost_usd: "8.99",
        sell_usd: "8.99",
      },
    },
    "Roblox USA": {
      "ROBLOX 10$ - USA": {
        cost: "897000",
        sell: "897000",
        cost_usd: "10",
        sell_usd: "10",
      },
      "ROBLOX 25$ - USA": {
        cost: "2243000",
        sell: "2243000",
        cost_usd: "25",
        sell_usd: "25",
      },
      // USD only on Whish (LIRA-324): no LBP price, so LBP mode hides it.
      "ROBLOX $50 - USA": {
        cost: "0",
        sell: "0",
        cost_usd: "50",
        sell_usd: "50",
      },
      "ROBLOX $100 - USA": {
        cost: "0",
        sell: "0",
        cost_usd: "100",
        sell_usd: "100",
      },
    },
    "Roblox UAE": {
      "ROBLOX 20 AED - UAE": {
        cost: "489000",
        sell: "489000",
        cost_usd: "5.45",
        sell_usd: "5.45",
      },
      "ROBLOX 100 AED - UAE": {
        cost: "2443000",
        sell: "2443000",
        cost_usd: "27.23",
        sell_usd: "27.23",
      },
      "ROBLOX 200 AED - UAE": {
        cost: "4886000",
        sell: "4886000",
        cost_usd: "54.46",
        sell_usd: "54.46",
      },
      "ROBLOX 500 AED - UAE": {
        cost: "12213000",
        sell: "12213000",
        cost_usd: "136.15",
        sell_usd: "136.15",
      },
    },
    "Roblox KSA": {
      "ROBLOX 20 SAR - KSA": {
        cost: "479000",
        sell: "479000",
        cost_usd: "5.34",
        sell_usd: "5.34",
      },
      "ROBLOX 100 SAR - KSA": {
        cost: "2392000",
        sell: "2392000",
        cost_usd: "26.66",
        sell_usd: "26.66",
      },
      "ROBLOX 200 SAR - KSA": {
        cost: "4783000",
        sell: "4783000",
        cost_usd: "53.32",
        sell_usd: "53.32",
      },
      "ROBLOX 500 SAR - KSA": {
        cost: "11958000",
        sell: "11958000",
        cost_usd: "133.3",
        sell_usd: "133.3",
      },
    },
    "PUBG Mobile": {
      "PUBG $1": { cost: "90000", sell: "90000", cost_usd: "1", sell_usd: "1" },
      "PUBG $5": {
        cost: "449000",
        sell: "449000",
        cost_usd: "5",
        sell_usd: "5",
      },
      "PUBG $10": {
        cost: "897000",
        sell: "897000",
        cost_usd: "10",
        sell_usd: "10",
      },
      "PUBG $25": {
        cost: "2243000",
        sell: "2243000",
        cost_usd: "25",
        sell_usd: "25",
      },
      "PUBG $50": {
        cost: "4485000",
        sell: "4485000",
        cost_usd: "50",
        sell_usd: "50",
      },
      "PUBG $100": {
        cost: "8970000",
        sell: "8970000",
        cost_usd: "100",
        sell_usd: "100",
      },
      "PUBG $200": {
        cost: "17940000",
        sell: "17940000",
        cost_usd: "200",
        sell_usd: "200",
      },
      "PUBG $300": {
        cost: "26910000",
        sell: "26910000",
        cost_usd: "300",
        sell_usd: "300",
      },
      "PUBG $400": {
        cost: "35880000",
        sell: "35880000",
        cost_usd: "400",
        sell_usd: "400",
      },
    },
    "PUBG New State": {
      "PUBG NEW STATE $2": { cost: "180000", sell: "180000" },
      "PUBG NEW STATE $6": { cost: "539000", sell: "539000" },
      "PUBG NEW STATE $13": { cost: "1167000", sell: "1167000" },
      "PUBG NEW STATE $32": { cost: "2871000", sell: "2871000" },
      "PUBG NEW STATE $51": {
        cost: "4575000",
        sell: "4575000",
        cost_usd: "51",
        sell_usd: "51",
      },
      "PUBG NEW STATE $101": { cost: "9060000", sell: "9060000" },
    },
    "Free Fire": {
      "FREE FIRE $2": {
        cost: "180000",
        sell: "180000",
        cost_usd: "2",
        sell_usd: "2",
      },
      "FREE FIRE $10": {
        cost: "897000",
        sell: "897000",
        cost_usd: "10",
        sell_usd: "10",
      },
      "FREE FIRE $1": {
        cost: "90000",
        sell: "90000",
        cost_usd: "1",
        sell_usd: "1",
      },
      "FREE FIRE $20": {
        cost: "1794000",
        sell: "1794000",
        cost_usd: "20",
        sell_usd: "20",
      },
      // USD only on Whish (LIRA-324): no LBP price, so LBP mode hides it.
      "FREE FIRE $5": { cost: "0", sell: "0", cost_usd: "5", sell_usd: "5" },
    },
    "Fashion Queen": {
      "FASHION QUEEN $3": { cost: "269000", sell: "269000" },
      "FASHION QUEEN $10": { cost: "897000", sell: "897000" },
      "FASHION QUEEN $20": { cost: "1794000", sell: "1794000" },
    },
    "Riot USA": {
      "RIOT ACCESS USA - $5": { cost: "449000", sell: "449000" },
      "RIOT ACCESS USA - $10": {
        cost: "897000",
        sell: "897000",
        cost_usd: "10",
        sell_usd: "10",
      },
      "RIOT ACCESS USA - $20": {
        cost: "1794000",
        sell: "1794000",
        cost_usd: "20",
        sell_usd: "20",
      },
      "RIOT ACCESS USA - $25": {
        cost: "2243000",
        sell: "2243000",
        cost_usd: "25",
        sell_usd: "25",
      },
      "RIOT ACCESS USA - $35": {
        cost: "3140000",
        sell: "3140000",
        cost_usd: "35",
        sell_usd: "35",
      },
      "RIOT ACCESS USA- $50": {
        cost: "4485000",
        sell: "4485000",
        cost_usd: "50",
        sell_usd: "50",
      },
      "RIOT ACCESS USA - $100": {
        cost: "8970000",
        sell: "8970000",
        cost_usd: "100",
        sell_usd: "100",
      },
    },
    Gamestop: {
      "GAMESTOP $10": {
        cost: "897000",
        sell: "897000",
        cost_usd: "10",
        sell_usd: "10",
      },
      "GAMESTOP $25": {
        cost: "2243000",
        sell: "2243000",
        cost_usd: "25",
        sell_usd: "25",
      },
      "GAMESTOP $50": {
        cost: "4485000",
        sell: "4485000",
        cost_usd: "50",
        sell_usd: "50",
      },
      "GAMESTOP $100": {
        cost: "8970000",
        sell: "8970000",
        cost_usd: "100",
        sell_usd: "100",
      },
      "GAMESTOP $5": {
        cost: "449000",
        sell: "449000",
        cost_usd: "5",
        sell_usd: "5",
      },
    },
    "Steam USA": {
      "STEAM $10": {
        cost: "1032000",
        sell: "1032000",
        cost_usd: "11.5",
        sell_usd: "11.5",
      },
      "STEAM $20": {
        cost: "2019500",
        sell: "2019500",
        cost_usd: "22.5",
        sell_usd: "22.5",
      },
      "STEAM $50": {
        cost: "4936500",
        sell: "4936500",
        cost_usd: "55",
        sell_usd: "55",
      },
      "STEAM $100": {
        cost: "9778000",
        sell: "9778000",
        cost_usd: "109",
        sell_usd: "109",
      },
    },
    "Steam UAE": {
      "STEAM AED 50": {
        cost: "1221000",
        sell: "1221000",
        cost_usd: "13.6",
        sell_usd: "13.6",
      },
      "STEAM AED 200": {
        cost: "4884000",
        sell: "4884000",
        cost_usd: "54.44",
        sell_usd: "54.44",
      },
      "STEAM AED 400": {
        cost: "9766000",
        sell: "9766000",
        cost_usd: "108.87",
        sell_usd: "108.87",
      },
    },
    "PlayStation LEB": {
      "PSN $10 - LEBANON": {
        cost: "897000",
        sell: "897000",
        cost_usd: "10",
        sell_usd: "10",
      },
      "PSN $20 - LEBANON": {
        cost: "1794000",
        sell: "1794000",
        cost_usd: "20",
        sell_usd: "20",
      },
      "PSN $50 - LEBANON": {
        cost: "4485000",
        sell: "4485000",
        cost_usd: "50",
        sell_usd: "50",
      },
      // USD only on Whish (LIRA-324): no LBP price, so LBP mode hides it.
      "PSN $40 - LEBANON": {
        cost: "0",
        sell: "0",
        cost_usd: "40",
        sell_usd: "40",
      },
      "PSN $100 - LEBANON": {
        cost: "0",
        sell: "0",
        cost_usd: "100",
        sell_usd: "100",
      },
    },
    "PlayStation USA": {
      "PSN $25 - USA": {
        cost: "2243000",
        sell: "2243000",
        cost_usd: "25",
        sell_usd: "25",
      },
      "PSN $50 - USA": {
        cost: "4485000",
        sell: "4485000",
        cost_usd: "50",
        sell_usd: "50",
      },
      "PSN $75 - USA": {
        cost: "6728000",
        sell: "6728000",
        cost_usd: "75",
        sell_usd: "75",
      },
      "PSN $100 - USA": {
        cost: "8970000",
        sell: "8970000",
        cost_usd: "100",
        sell_usd: "100",
      },
      // USD only on Whish (LIRA-324): no LBP price, so LBP mode hides it.
      "PSN $10 - USA": { cost: "0", sell: "0", cost_usd: "10", sell_usd: "10" },
    },
    "PlayStation UAE": {
      "PSN $10 - UAE": {
        cost: "897000",
        sell: "897000",
        cost_usd: "10",
        sell_usd: "10",
      },
      "PSN $20 - UAE": {
        cost: "1794000",
        sell: "1794000",
        cost_usd: "20",
        sell_usd: "20",
      },
      "PSN $50 - UAE": {
        cost: "4485000",
        sell: "4485000",
        cost_usd: "50",
        sell_usd: "50",
      },
      // USD only on Whish (LIRA-324): no LBP price, so LBP mode hides it.
      "PSN $40 - UAE": { cost: "0", sell: "0", cost_usd: "40", sell_usd: "40" },
      "PSN $60 - UAE": { cost: "0", sell: "0", cost_usd: "60", sell_usd: "60" },
      "PSN $70 - UAE": { cost: "0", sell: "0", cost_usd: "70", sell_usd: "70" },
      "PSN $100 - UAE": {
        cost: "0",
        sell: "0",
        cost_usd: "100",
        sell_usd: "100",
      },
    },
    "PlayStation KSA": {
      "PSN $10 - KSA": {
        cost: "897000",
        sell: "897000",
        cost_usd: "10",
        sell_usd: "10",
      },
      "PSN $20 - KSA": {
        cost: "1794000",
        sell: "1794000",
        cost_usd: "20",
        sell_usd: "20",
      },
      "PSN $40 - KSA": {
        cost: "3588000",
        sell: "3588000",
        cost_usd: "40",
        sell_usd: "40",
      },
      "PSN $50 - KSA": {
        cost: "4485000",
        sell: "4485000",
        cost_usd: "50",
        sell_usd: "50",
      },
      "PSN $60 - KSA": {
        cost: "5382000",
        sell: "5382000",
        cost_usd: "60",
        sell_usd: "60",
      },
      "PSN $100 - KSA": { cost: "8970000", sell: "8970000" },
    },
    Crossfire: {
      "CROSSFIRE $22": { cost: "1794000", sell: "1794000" },
      "CROSSFIRE $45": { cost: "3858000", sell: "3858000" },
      "CROSSFIRE $12": { cost: "897000", sell: "897000" },
    },
    "Xbox USA": {
      "XBOX $15 - USA": {
        cost: "1346000",
        sell: "1346000",
        cost_usd: "15",
        sell_usd: "15",
      },
      "XBOX $25 - USA": {
        cost: "2243000",
        sell: "2243000",
        cost_usd: "25",
        sell_usd: "25",
      },
      "XBOX $50 - USA": {
        cost: "4485000",
        sell: "4485000",
        cost_usd: "50",
        sell_usd: "50",
      },
      "XBOX $10 - 1M - USA": { cost: "897000", sell: "897000" },
      "XBOX $25 - 3M - USA": { cost: "2243000", sell: "2243000" },
      "XBOX $75 - 12M - USA": { cost: "6728000", sell: "6728000" },
      // USD only on Whish (LIRA-324): no LBP price, so LBP mode hides it.
      "XBOX 5$ - USA": { cost: "0", sell: "0", cost_usd: "5", sell_usd: "5" },
      "XBOX 10$ - USA": {
        cost: "0",
        sell: "0",
        cost_usd: "10",
        sell_usd: "10",
      },
      "XBOX 20$ - USA": {
        cost: "0",
        sell: "0",
        cost_usd: "20",
        sell_usd: "20",
      },
      "XBOX 100$ - USA": {
        cost: "0",
        sell: "0",
        cost_usd: "100",
        sell_usd: "100",
      },
    },
    "Xbox KSA": {
      "XBOX 50 SAR - KSA": {
        cost: "1211000",
        sell: "1211000",
        cost_usd: "13.5",
        sell_usd: "13.5",
      },
      "XBOX 100 SAR - KSA": {
        cost: "2422000",
        sell: "2422000",
        cost_usd: "27",
        sell_usd: "27",
      },
      "XBOX 200 SAR - KSA": {
        cost: "4844000",
        sell: "4844000",
        cost_usd: "54",
        sell_usd: "54",
      },
      "XBOX 300 SAR - KSA": {
        cost: "7266000",
        sell: "7266000",
        cost_usd: "81",
        sell_usd: "81",
      },
    },
    Runescape: {
      "RUNESCAPE $25": {
        cost: "2243000",
        sell: "2243000",
        cost_usd: "25",
        sell_usd: "25",
      },
      "RUNESCAPE $10": {
        cost: "1167000",
        sell: "1167000",
        cost_usd: "10",
        sell_usd: "10",
      },
    },
    Nintendo: {
      "NINTENDO ESHOP $20 -USA": {
        cost: "1884000",
        sell: "1884000",
        cost_usd: "20",
        sell_usd: "20",
      },
      "NINTENDO ESHOP $35 -USA": {
        cost: "3230000",
        sell: "3230000",
        cost_usd: "35",
        sell_usd: "35",
      },
      "NINTENDO ESHOP $50 -USA": {
        cost: "4755000",
        sell: "4755000",
        cost_usd: "50",
        sell_usd: "50",
      },
      "NINTENDO ESHOP $10 -USA": {
        cost: "1167000",
        sell: "1167000",
        cost_usd: "10",
        sell_usd: "10",
      },
    },
    "Razer Gold": {
      "RAZER $20": {
        cost: "1794000",
        sell: "1794000",
        cost_usd: "20",
        sell_usd: "20",
      },
      "RAZER $10": {
        cost: "897000",
        sell: "897000",
        cost_usd: "10",
        sell_usd: "10",
      },
      "RAZER $50": {
        cost: "4485000",
        sell: "4485000",
        cost_usd: "50",
        sell_usd: "50",
      },
      "RAZER $100": {
        cost: "8970000",
        sell: "8970000",
        cost_usd: "100",
        sell_usd: "100",
      },
      // USD only on Whish (LIRA-324): no LBP price, so LBP mode hides it.
      "RAZER $1": { cost: "0", sell: "0", cost_usd: "1", sell_usd: "1" },
      "RAZER $2": { cost: "0", sell: "0", cost_usd: "2", sell_usd: "2" },
      "RAZER $5": { cost: "0", sell: "0", cost_usd: "5", sell_usd: "5" },
      "RAZER $200": { cost: "0", sell: "0", cost_usd: "200", sell_usd: "200" },
    },
    Blizzard: {
      "BLIZZARD $50 USA": {
        cost: "4575000",
        sell: "4575000",
        cost_usd: "51",
        sell_usd: "51",
      },
      "BLIZZARD $20 USA": {
        cost: "1884000",
        sell: "1884000",
        cost_usd: "21",
        sell_usd: "21",
      },
    },
    "Battle of Kings": {
      "BATTLE OF KINGS $4.49": { cost: "403000", sell: "403000" },
      // USD only on Whish (LIRA-324): no LBP price, so LBP mode hides it.
      "BATTLE OF KINGS $89.99": {
        cost: "0",
        sell: "0",
        cost_usd: "89.99",
        sell_usd: "89.99",
      },
    },
    Apex: {
      "APEX $20 - USA (PC ONLY)": {
        cost: "1794000",
        sell: "1794000",
        cost_usd: "20",
        sell_usd: "20",
      },
    },
    Eve: {
      "EVE ONLINE PLEX 1": {
        cost: "2064000",
        sell: "2064000",
        cost_usd: "25",
        sell_usd: "25",
      },
      "EVE ONLINE PLEX 2": {
        cost: "3409000",
        sell: "3409000",
        cost_usd: "40",
        sell_usd: "40",
      },
    },
  },
  "Gift Cards": {
    Discord: {
      "DISCORD $10": {
        cost: "897000",
        sell: "897000",
        cost_usd: "10",
        sell_usd: "10",
      },
      "DISCORD $100": {
        cost: "8970000",
        sell: "8970000",
        cost_usd: "100",
        sell_usd: "100",
      },
      "DISCORD CLASSIC / BASIC $5": {
        cost: "449000",
        sell: "449000",
        cost_usd: "5",
        sell_usd: "5",
      },
    },
    Shein: {
      "SHEIN E-GIFT CARD $300": {
        cost: "28704000",
        sell: "28704000",
        cost_usd: "320",
        sell_usd: "320",
      },
      "SHEIN E-GIFT CARD $500": {
        cost: "47093000",
        sell: "47093000",
        cost_usd: "525",
        sell_usd: "525",
      },
      "SHEIN E-GIFT CARD $800": {
        cost: "73554000",
        sell: "73554000",
        cost_usd: "820",
        sell_usd: "820",
      },
      "SHEIN E-GIFT CARD $100": {
        cost: "9867000",
        sell: "9867000",
        cost_usd: "110",
        sell_usd: "110",
      },
    },
    "Nord VPN": {
      "NORD VPN $40": { cost: "3588000", sell: "3588000" },
      "NORD VPN $70": { cost: "6279000", sell: "6279000" },
      "NORD VPN $12": { cost: "1077000", sell: "1077000" },
    },
    "iTunes USA": {
      "iTUNES $2 - USA": { cost: "180000", sell: "180000" },
      "iTUNES $3 - USA": { cost: "270000", sell: "270000" },
      "iTUNES $4 - USA": { cost: "359000", sell: "359000" },
      "iTUNES $5 - USA": {
        cost: "449000",
        sell: "449000",
        cost_usd: "5",
        sell_usd: "5",
      },
      "iTUNES $10 - USA": {
        cost: "897000",
        sell: "897000",
        cost_usd: "10",
        sell_usd: "10",
      },
      "iTUNES $15 - USA": {
        cost: "1346000",
        sell: "1346000",
        cost_usd: "15",
        sell_usd: "15",
      },
      "iTUNES $20 - USA": {
        cost: "1794000",
        sell: "1794000",
        cost_usd: "20",
        sell_usd: "20",
      },
      "iTUNES $25 - USA": {
        cost: "2243000",
        sell: "2243000",
        cost_usd: "25",
        sell_usd: "25",
      },
      "iTUNES $30 - USA": { cost: "2691000", sell: "2691000" },
      "iTUNES $50 - USA": {
        cost: "4485000",
        sell: "4485000",
        cost_usd: "50",
        sell_usd: "50",
      },
      "iTUNES $100 - USA": {
        cost: "8970000",
        sell: "8970000",
        cost_usd: "100",
        sell_usd: "100",
      },
      "iTUNES $150 - USA": { cost: "13455000", sell: "13455000" },
      "iTUNES $200 - USA": { cost: "17940000", sell: "17940000" },
      "iTUNES $300 - USA": { cost: "26910000", sell: "26910000" },
      "iTUNES $400 - USA": {
        cost: "35880000",
        sell: "35880000",
        cost_usd: "400",
        sell_usd: "400",
      },
      "iTUNES $500 - USA": { cost: "44850000", sell: "44850000" },
    },
    "iTunes UAE": {
      "iTUNES AED 50 - UAE": {
        cost: "1221000",
        sell: "1221000",
        cost_usd: "13.61",
        sell_usd: "13.61",
      },
      "iTUNES AED 100 - UAE": {
        cost: "2442000",
        sell: "2442000",
        cost_usd: "27.22",
        sell_usd: "27.22",
      },
      "ITUNES AED 250 - UAE": {
        cost: "6105000",
        sell: "6105000",
        cost_usd: "68.05",
        sell_usd: "68.05",
      },
      "iTUNES AED 500 - UAE": {
        cost: "12209000",
        sell: "12209000",
        cost_usd: "136.1",
        sell_usd: "136.1",
      },
    },
    eBay: {
      "eBAY $100 (NOT REDEEMABLE OUTSIDE USA)": {
        cost: "9419000",
        sell: "9419000",
        cost_usd: "105",
        sell_usd: "105",
      },
      "eBAY $150 (NOT REDEEMABLE OUTSIDE USA)": {
        cost: "14622000",
        sell: "14622000",
      },
      "eBAY $200 (NOT REDEEMABLE OUTSIDE USA)": {
        cost: "18837000",
        sell: "18837000",
      },
      "eBAY $50 (NOT REDEEMABLE OUTSIDE USA)": {
        cost: "4755000",
        sell: "4755000",
        cost_usd: "53",
        sell_usd: "53",
      },
    },
    "Yalla Live": {
      "Yalla Live $100": {
        cost: "8970000",
        sell: "8970000",
        cost_usd: "100",
        sell_usd: "100",
      },
      // USD only on Whish (LIRA-324): no LBP price, so LBP mode hides it.
      "Yalla Live $25": {
        cost: "0",
        sell: "0",
        cost_usd: "25",
        sell_usd: "25",
      },
      "Yalla Live $50": {
        cost: "0",
        sell: "0",
        cost_usd: "50",
        sell_usd: "50",
      },
      "Yalla Live $300": {
        cost: "0",
        sell: "0",
        cost_usd: "300",
        sell_usd: "300",
      },
      "Yalla Live $500": {
        cost: "0",
        sell: "0",
        cost_usd: "500",
        sell_usd: "500",
      },
    },
    Norton: {
      "NORTON 360 PREMIUM 75GB - 12M": {
        cost: "3536000",
        sell: "3536000",
        cost_usd: "39.42",
        sell_usd: "39.42",
      },
      "NORTON 360 DELUXE 25GB - 12M": {
        cost: "1033000",
        sell: "1033000",
        cost_usd: "11.51",
        sell_usd: "11.51",
      },
    },
    "iTunes KSA": {
      "ITUNES SAR 50 - KSA": {
        cost: "1211000",
        sell: "1211000",
        cost_usd: "13.5",
        sell_usd: "13.5",
      },
      "ITUNES SAR 75 - KSA": {
        cost: "1817000",
        sell: "1817000",
        cost_usd: "20.25",
        sell_usd: "20.25",
      },
      "ITUNES SAR 100 - KSA": { cost: "2422000", sell: "2422000" },
      "ITUNES SAR 150 - KSA": {
        cost: "3633000",
        sell: "3633000",
        cost_usd: "40.5",
        sell_usd: "40.5",
      },
      "ITUNES SAR 200 - KSA": {
        cost: "4844000",
        sell: "4844000",
        cost_usd: "54",
        sell_usd: "54",
      },
      "ITUNES SAR 250 - KSA": {
        cost: "6055000",
        sell: "6055000",
        cost_usd: "67.5",
        sell_usd: "67.5",
      },
      "ITUNES SAR 300 - KSA": { cost: "8253000", sell: "8253000" },
      "ITUNES SAR 350 - KSA": { cost: "8477000", sell: "8477000" },
      "ITUNES SAR 500 - KSA": {
        cost: "12110000",
        sell: "12110000",
        cost_usd: "135",
        sell_usd: "135",
      },
    },
  },
  Transportation: {
    ACTC: {
      "ACTC 100": {
        cost: "100000",
        sell: "100000",
        cost_usd: "1.12",
        sell_usd: "1.12",
      },
      "ACTC 130": {
        cost: "130000",
        sell: "130000",
        cost_usd: "1.46",
        sell_usd: "1.46",
      },
      "ACTC 150": {
        cost: "150000",
        sell: "150000",
        cost_usd: "1.68",
        sell_usd: "1.68",
      },
      "ACTC 200": {
        cost: "200000",
        sell: "200000",
        cost_usd: "2.24",
        sell_usd: "2.24",
      },
      // USD only on Whish (LIRA-324): no LBP price, so LBP mode hides it.
      "ACTC 80": { cost: "0", sell: "0", cost_usd: "0.9", sell_usd: "0.9" },
    },
  },
};
