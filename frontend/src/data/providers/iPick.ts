import type { ServiceCatalog } from "../mobileServices";

/**
 * iPick catalog items (categories → subcategories → items).
 * Part of the Mobile Services starting catalog — imported by
 * `@/data/mobileServices`, which keeps the full catalog shape (see its doc
 * comment). Only seeds a NEW shop; existing shops keep their database items.
 */
export const iPickCatalog: ServiceCatalog = {
  alfa: {
    Prepaid: {
      // `credits` = the card's face value (owner-confirmed 2026-08-03):
      // an Alfa prepaid card labelled "3.03" carries $3.03 of credit.
      // `validity_days` owner-confirmed 2026-08-04 from the Katsh alfa shelf
      // and applied to all three providers — the same physical Alfa card is
      // resold through iPick/Katsh/WHISH_APP, so the face value identifies
      // the validity (the rule migration v135 already used for mtc).
      // NOTE these differ from the mtc card of the same face value: alfa 4.5
      // is 10 days where mtc 4.5 is 30. Only 15.15 matches mtc at 60.
      // `1.22` and `3.03` are deliberately left WITHOUT validity_days: the
      // owner could not confirm a day count for them (2026-08-04), so they
      // are treated as credit-only — the alfa equivalent of mtc's `1`/`1.67`
      // — and are excluded from Only-Days by `isOnlyDaysCandidate`. Giving
      // them a days_cost would wrongly flip `isTelecomSplitComplete`.
      // `days_cost_lbp` is derived at seed time from `credits` and the
      // configured credit rate R (TELECOM_DAYS_COST_PLAN.md §4.3).
      "1.22": { cost: "140000", sell: "140000", credits: 1.22 },
      "3.03": { cost: "322000", sell: "355000", credits: 3.03 },
      "4.5": {
        cost: "466000",
        sell: "500000",
        validity_days: 10,
        credits: 4.5,
      },
      "7.58": {
        cost: "770000",
        sell: "800000",
        validity_days: 30,
        credits: 7.58,
      },
      "10": {
        cost: "1000000",
        sell: "1100000",
        validity_days: 30,
        credits: 10,
      },
      "15.15": {
        cost: "1515000",
        sell: "1600000",
        validity_days: 60,
        credits: 15.15,
      },
      "22.73": {
        cost: "2273000",
        sell: "2400000",
        validity_days: 90,
        credits: 22.73,
      },
      "77.28": {
        cost: "7728000",
        sell: "8000000",
        validity_days: 365,
        credits: 77.28,
      },
    },
    "Mobile Internet": {
      "1GB": { cost: "340000", sell: "340000" },
      "3GB": { cost: "900000", sell: "900000" },
      "7GB": { cost: "1500000", sell: "1500000" },
      "22GB": { cost: "3000000", sell: "3000000" },
      "44GB": { cost: "5000000", sell: "5000000" },
      "77GB": { cost: "7000000", sell: "7000000" },
      "111GB": { cost: "10000000", sell: "10000000" },
      "444GB": { cost: "30000000", sell: "30000000" },
    },
    "Alfa Go": {
      "Alfa Go": { cost: "697000", sell: "697000" },
      "Alfa Go+": { cost: "1212000", sell: "1212000" },
      "Alfa Go Max": { cost: "1717000", sell: "1717000" },
    },
    "Weekly data": {
      "500MB": { cost: "50000", sell: "50000" },
      "1.5GB": { cost: "100000", sell: "100000" },
      "5GB": { cost: "200000", sell: "200000" },
    },
    Boosters: {
      "600MB": { cost: "50000", sell: "50000" },
      "20mins": { cost: "50000", sell: "50000" },
      "50MB": { cost: "50000", sell: "50000" },
      "unlinmited 2hrs": { cost: "50000", sell: "50000" },
    },
    "Surf & Talk": {
      "4x4": { cost: "50000", sell: "50000" },
      "5x5": { cost: "50000", sell: "50000" },
    },
    Weekender: {
      "the weekender": { cost: "136000", sell: "136000" },
    },
    "Mobile broadband": {
      "1GB": { cost: "340000", sell: "340000" },
      "3GB": { cost: "900000", sell: "900000" },
      "7GB": { cost: "1500000", sell: "1500000" },
      "10GB": { cost: "2000000", sell: "2000000" },
      "22GB": { cost: "3000000", sell: "3000000" },
      "44GB": { cost: "5000000", sell: "5000000" },
      "77GB": { cost: "7000000", sell: "7000000" },
      "111GB": { cost: "10000000", sell: "10000000" },
      "444GB": { cost: "30000000", sell: "30000000" },
    },
  },
  mtc: {
    Credits: {
      // NOT renamed under A1 (reviewed 2026-07-19, LIRA-072 follow-up):
      // cost/sell scale linearly with the dollar figure (cost = 93,333.33
      // LBP/$, sell = 50,000 LBP/$), unlike Prepaid's fixed odd-numbered
      // card denominations (3.03/4.5/7.58/…). No card-face-value precedent
      // exists for this category anywhere else in the catalog — looks like
      // a direct credit top-up rather than a physical card. Leave as-is
      // pending owner confirmation.
      "3$": { cost: "280000", sell: "150000" },
      "6$": { cost: "560000", sell: "300000" },
      "9$": { cost: "840000", sell: "450000" },
      "12$": { cost: "1120000", sell: "600000" },
      "15$": { cost: "1400000", sell: "750000" },
    },
    Validity: {
      // NOT renamed under A1 (reviewed 2026-07-19, LIRA-072 follow-up):
      // day-count validity extensions, not physical cards — cost scales
      // linearly with days (65,000 LBP per 10-day unit). Matches the
      // untouched top-level "Validity vouchers" category from the same
      // 2026-07-03 (A1) commit, which also kept its day-count labels.
      // Leave as-is pending owner confirmation.
      "10 days": { cost: "65000", sell: "100000" },
      "30 days": { cost: "195000", sell: "250000" },
      "60 days": { cost: "390000", sell: "450000" },
      "90 days": { cost: "585000", sell: "650000" },
      "180 days": { cost: "1170000", sell: "1300000" },
      "360 days": { cost: "2340000", sell: "2500000" },
    },
    Prepaid: {
      // Named by the CARD FACE VALUE (what's printed on the card), with
      // the day-count/"credit only" descriptor prefix dropped — owner
      // decision 2026-07-03 (A1), applied to iPick mtc 2026-07-19
      // (LIRA-072 follow-up). The dollar figure already embedded in each
      // old label matched the face values owner-confirmed for Katsh/
      // WHISH_APP mtc Prepaid (migration v117) — only the descriptor
      // prefix is new information here, not the number. Costs/sells
      // unchanged.
      "1": { cost: "120000", sell: "150000", credits: 1 },
      "1.67": { cost: "186000", sell: "220000", credits: 1.67 },
      "3.79": {
        cost: "379000",
        sell: "430000",
        validity_days: 10,
        credits: 3.79,
      },
      "4.5": {
        cost: "450000",
        sell: "520000",
        validity_days: 30,
        credits: 4.5,
      },
      "7.58": {
        cost: "758000",
        sell: "850000",
        validity_days: 30,
        credits: 7.58,
      },
      "10": {
        cost: "1000000",
        sell: "1100000",
        validity_days: 30,
        credits: 10,
      },
      "15.15": {
        cost: "1526000",
        sell: "1650000",
        validity_days: 60,
        credits: 15.15,
      },
      "22.73": {
        cost: "2273000",
        sell: "2450000",
        validity_days: 90,
        credits: 22.73,
      },
      "77.28": {
        cost: "7728000",
        sell: "8200000",
        validity_days: 365,
        credits: 77.28,
      },
      start: { cost: "450000", sell: "520000" },
    },
  },
  internet: {
    Terranet: {
      "8MB UNL": { cost: "1967000", sell: "2194000" },
      "4MB 100GB": { cost: "591000", sell: "835000" },
      "4MB 50GB": { cost: "765000", sell: "555000" },
      "ARMY DSL 4MB 100GB": { cost: "591000", sell: "591000" },
      "ARMY DSL 4MB 50GB": { cost: "765000", sell: "765000" },
      "ARMY DSL 50MB UNL": { cost: "2070000", sell: "2070000" },
      "ARMY DSL 8MB UNL/PLAY": { cost: "1967000", sell: "1967000" },
      "ARMY DSL OS 1000GB": { cost: "2070000", sell: "2070000" },
      "ARMY DSL OS 120GB": { cost: "591000", sell: "591000" },
      "ARMY DSL OS 160GB/4MB UNL": { cost: "765000", sell: "765000" },
      "ARMY DSL OS 200GB/6MB UNL": { cost: "2070000", sell: "2070000" },
      "ARMY DSL OS 240GB": { cost: "591000", sell: "591000" },
      "ARMY DSL OS 400GB": { cost: "765000", sell: "765000" },
      "ARMY DSL OS 500GB": { cost: "2070000", sell: "2070000" },
      "DSL 50MB UNL": { cost: "591000", sell: "2870000" },
      "DSL EXTRA VOLUME 5GB": { cost: "765000", sell: "207000" },
      "FIBER 300MB 1000GB": { cost: "2070000", sell: "4005000" },
      "FIBER 300MB 1500GB": { cost: "591000", sell: "5968000" },
      "FIBER 300MB 2000GB": { cost: "765000", sell: "7193000" },
      "FIBER 300MB 2500GB": { cost: "2070000", sell: "8637000" },
      "FIBER 300MB 300GB": { cost: "591000", sell: "2063000" },
      "FIBER 300MB 400GB": { cost: "765000", sell: "2461000" },
      "FIBER 300MB 500GB": { cost: "2070000", sell: "2850000" },
      "FIBER 300MB 850GB": { cost: "591000", sell: "3667000" },
      "FIBER 50MB UNL": { cost: "765000", sell: "2600000" },
      "OPEN SPEED 1000GB": { cost: "2070000", sell: "4005000" },
      "OPEN SPEED 120GB": { cost: "591000", sell: "995000" },
      "OPEN SPEED 240GB": { cost: "765000", sell: "1785000" },
      "OPEN SPEED 400GB": { cost: "2070000", sell: "2461000" },
      "OPEN SPEED 500GB": { cost: "591000", sell: "2996000" },
      "OS 160GB/4MB UNL/SMART": { cost: "765000", sell: "1361000" },
      "OS 200GB/6MB UNL/HOME": { cost: "2070000", sell: "1563000" },
    },
    Mobi: {
      "1month freeze": { cost: "0", sell: "205000" },
      "4MB UNL": { cost: "0", sell: "1315000" },
      "6MB UNL": { cost: "0", sell: "1537000" },
      "8MB UNL": { cost: "0", sell: "2037000" },
      "4MB 80GB": { cost: "0", sell: "538000" },
      "4MB 80GB FNQ": { cost: "0", sell: "760000" },
      "4MB 120GB FNQ": { cost: "0", sell: "1204000" },
      "4MB 200GB": { cost: "0", sell: "1426000" },
      "4MB 200GB FNQ": { cost: "0", sell: "1648000" },
      "OS 80GB": { cost: "0", sell: "538000" },
      "OS 80GB FNQ": { cost: "0", sell: "760000" },
      "OS 100GB": { cost: "0", sell: "760000" },
      "OS 100GB FNQ": { cost: "0", sell: "982000" },
      "OS 160GB": { cost: "0", sell: "1204000" },
      "OS 160GB FNQ": { cost: "0", sell: "1426000" },
      "OS 200GB": { cost: "0", sell: "1482000" },
      "OS 200GB FNQ": { cost: "0", sell: "1704000" },
      "OS 300GB": { cost: "0", sell: "2037000" },
      "OS 300GB FNQ": { cost: "0", sell: "2259000" },
      "OS 500GB": { cost: "0", sell: "2814000" },
      "OS 500GB FNQQ": { cost: "0", sell: "3036000" },
    },
    Wise: {
      "2890": { cost: "0", sell: "0" },
      "5780": { cost: "0", sell: "0" },
      "8000": { cost: "0", sell: "0" },
      "11100": { cost: "0", sell: "0" },
    },
    Idm: {
      "ADSL Pause Card": { cost: "169000", sell: "240000" },
      "Parental Control": { cost: "226437", sell: "296437" },
      "Army unlimited 6mb": { cost: "1124000", sell: "1199877" },
      "Army openspeed 50gb": { cost: "362000", sell: "433660" },
      "Army openspeed 110gb": { cost: "589000", sell: "662306" },
      "Army openspeed 300gb": { cost: "1613000", sell: "1691476" },

      //todo: to be done
    },
    Cyberia: {},
    Sodetel: {},
  },
  Gaming: {
    "Pubg direct": {
      "60": { cost: "82340", sell: "100000" },
      "325 UC": { cost: "454000", sell: "454000" },
      "660 UC": { cost: "908000", sell: "908000" },
      "1800 UC": { cost: "2272000", sell: "2272000" },
      "3850 UC": { cost: "4545000", sell: "4545000" },
      "8100 UC": { cost: "9090000", sell: "9090000" },
      "16200 UC": { cost: "18180000", sell: "18180000" },
      "24300 UC": { cost: "27270000", sell: "27270000" },
      "32400 UC": { cost: "36360000", sell: "36360000" },
    },
    "Free Fire direct": {
      "100 +10 diamonds": { cost: "97000", sell: "100000" },
      "210 +21 diamonds": { cost: "193000", sell: "220000" },
      "530 +30 diamonds": { cost: "482000", sell: "500000" },
      "1080 +108 diamonds": { cost: "963000", sell: "963000" },
      "2200 +220 diamonds": { cost: "1926000", sell: "1926000" },
      "Weekly membership": { cost: "270000", sell: "270000" },
      "Monthly membership": { cost: "1080000", sell: "1080000" },
      "Booyah access": { cost: "360000", sell: "360000" },
    },
    "Jawaker direct": {
      "15000 tokens": { cost: "1764000", sell: "1764000" },
      "23000 tokens": { cost: "2646000", sell: "2646000" },
      "40000 tokens": { cost: "4410000", sell: "4410000" },
      "520000 tokens": { cost: "5733000", sell: "5733000" },
      "805000 tokens": { cost: "8820000", sell: "8820000" },
    },
    "Yalla Ludo": {},
    "Fortnite USA": {},
    "PlayStation LEB": {
      "10$ PSN": { cost: "846000", sell: "895000" },
      "20$ PSN": { cost: "1692000", sell: "1800000" },
      "50$ PSN": { cost: "4230000", sell: "4450000" },
      "100$ PSN": { cost: "8460000", sell: "8950000" },
    },
    "PlayStation USA": {
      "100$ PSN": { cost: "8900000", sell: "9000000" },
    },
    "PlayStation UAE": {
      "10$ PSN": { cost: "912000", sell: "912000" },
      "20$ PSN": { cost: "1824000", sell: "1824000" },
      "50$ PSN": { cost: "4558000", sell: "4558000" },
      "100$ PSN": { cost: "9116000", sell: "9116000" },
    },
    Roblox: {
      "10$": { cost: "936000", sell: "950000" },
      "25$": { cost: "2340000", sell: "2350000" },
      "50$": { cost: "4680000", sell: "4680000" },
    },
    Steam: {
      "5$": { cost: "518000", sell: "518000" },
      "10$": { cost: "1042000", sell: "1042000" },
      "20$": { cost: "2061000", sell: "2061000" },
      "30$": { cost: "2977000", sell: "2977000" },
      "50$": { cost: "4961000", sell: "4961000" },
      "150$": { cost: "14992000", sell: "14992000" },
      "200$": { cost: "19557000", sell: "19557000" },
    },
    "Honor of Kings": {
      "16 tokens": { cost: "18000", sell: "18000" },
      "80 tokens": { cost: "90000", sell: "90000" },
      "240 tokens": { cost: "270000", sell: "270000" },
      "400 tokens": { cost: "450000", sell: "450000" },
      "560 tokens": { cost: "630000", sell: "630000" },
      "830 tokens": { cost: "900000", sell: "900000" },
      "1245 tokens": { cost: "1350000", sell: "1350000" },
      "2508 tokens": { cost: "2700000", sell: "2700000" },
      "4180 tokens": { cost: "4500000", sell: "4500000" },
      "8360 tokens": { cost: "9000000", sell: "9000000" },
    },
    "Razer Gold": {
      "1$": { cost: "90000", sell: "90000" },
      "2$": { cost: "180000", sell: "180000" },
      "5$": { cost: "450000", sell: "450000" },
      "10$": { cost: "900000", sell: "900000" },
      "20$": { cost: "1800000", sell: "1800000" },
      "25$": { cost: "2250000", sell: "2250000" },
      "50$": { cost: "4500000", sell: "4500000" },
      "100$": { cost: "9000000", sell: "9000000" },
      "200$": { cost: "18000000", sell: "18000000" },
      "300$": { cost: "27000000", sell: "27000000" },
      "400$": { cost: "36000000", sell: "36000000" },
    },
    Nintendo: {
      "5$": { cost: "450000", sell: "450000" },
      "10$": { cost: "900000", sell: "900000" },
      "20$": { cost: "1800000", sell: "1800000" },
      "35$": { cost: "3150000", sell: "3150000" },
      "50$": { cost: "4500000", sell: "4500000" },
    },
    Xbox: {
      "NBA 2K24 75000VC": { cost: "1800000", sell: "1800000" },
      "NBA 2K24 200000VC": { cost: "4500000", sell: "4500000" },
      "NBA 2K24 450000VC": { cost: "9000000", sell: "9000000" },
      "6-MONTHS PASS": { cost: "5400000", sell: "5400000" },
      "CORE 1-MONTH PASS": { cost: "900000", sell: "900000" },
      "CORE 3-MONTHS PASS": { cost: "2250000", sell: "2250000" },
      "CORE 6-MONTHS PASS": { cost: "3600000", sell: "3600000" },
      "CORE 12-MONTHS PASS": { cost: "6750000", sell: "6750000" },
      "ULTIMATE 1 MONTH": { cost: "2700000", sell: "2700000" },
      "ULTIMATE 3 MONTH": { cost: "8100000", sell: "8100000" },
      "5$": { cost: "450000", sell: "450000" },
      "10$": { cost: "900000", sell: "900000" },
      "15$": { cost: "1350000", sell: "1350000" },
      "20$": { cost: "1800000", sell: "1800000" },
      "25$": { cost: "2250000", sell: "2250000" },
      "50$": { cost: "4500000", sell: "4500000" },
      "100$": { cost: "9000000", sell: "9000000" },
    },
    Valorant: {
      "5$": { cost: "450000", sell: "450000" },
      "10$": { cost: "900000", sell: "900000" },
      "20$": { cost: "1800000", sell: "1800000" },
      "25$": { cost: "2250000", sell: "2250000" },
      "35$": { cost: "3150000", sell: "3150000" },
      "50$": { cost: "4500000", sell: "4500000" },
      "100$": { cost: "9000000", sell: "9000000" },
    },
    Minecraft: {
      "java & bedrock": { cost: "2426000", sell: "2426000" },
      "1720 coins": { cost: "900000", sell: "900000" },
      "3500 coins": { cost: "1800000", sell: "1800000" },
    },
    Blizzard: {
      "20$": { cost: "1888000", sell: "1900000" },
      "50$": { cost: "4717000", sell: "4717000" },
    },
  },
};
