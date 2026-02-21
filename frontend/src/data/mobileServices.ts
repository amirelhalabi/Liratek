/**
 * Mobile Services catalog data.
 *
 * Sourced from the original mobileServices.json with per-provider item lists.
 * Each provider maps to categories, and each category to either:
 *   - An empty array  → no pre-defined items (free-form entry)
 *   - An object       → keyed by label, value = code/price string
 */

export type ServiceItems = Record<string, string> | string[];
export type ServiceSubcategory = ServiceItems | Record<string, ServiceItems>;
export type ServiceCategory = Record<string, ServiceSubcategory>;
export type ServiceCatalog = Record<string, ServiceCategory>;

const mobileServices: Record<string, ServiceCatalog | Record<string, never>> = {
  "i-Pick": {
    alfa: {
      Go: [],
      "Mobile Internet": [],
      Prepaid: [],
      "Weekly data": [],
      Boosters: [],
      "Surf & Talk": [],
      Weekender: [],
      "Mobile broadband": [],
    },
    mtc: {
      Credits: [],
      Validity: [],
      Prepaid: [],
    },
    internet: {
      Terranet: [],
      Mobi: [],
      Wise: [],
      Idm: [],
      Cyberia: [],
      Sodetel: [],
    },
    gaming: {
      pubg: [],
      "pubg direct": [],
      "free fire direct": [],
      "jawaker direct": [],
      "yalla ludo": [],
      "fortnite usa": [],
      "playstation leb": [],
      "playstation usa": [],
      "playstation uae": [],
      roblox: [],
      steam: [],
      "honor of kings": [],
    },
  },
  Katsh: {
    "mobile topups": {
      alfa: {
        voucher: {
          "3.6": "318978",
          "5.24": "462075",
          "8.65": "765007",
          "11.32": "10003274",
          "17.06": "1511601",
          "25.47": "2256769",
          "86": "7620030",
        },
      },
      mtc: {
        voucher: {
          "1.35": "119617",
          "2.10": "186071",
          "4.45": "398723",
          "5.24": "462518",
          "8.65": "765007",
          "11.32": "10003274",
          "17.06": "1509829",
          "25.47": "2255883",
          "86": "7620030",
          start: "464290",
          startSOS: "141768",
          smart: "765547",
          super: "1360973",
        },
      },
    },
    "Gaming cards": {
      "pubg voucher": {
        "60UC": "82340",
        "300UC +25 free": "411700",
        "600UC +60 free": "823400",
        "1500UC +300 free": "2058500",
        "3000UC +850 free": "4117000",
        "6000UC +2100 free": "8234000",
        "12000UC +4200 free": "16468000",
        "18000UC +6300 free": "24702000",
        "24000UC +8400 free": "32936000",
      },
      "freefire voucher": {
        "100 diamonds": "89500",
        "210 diamonds": "179000",
        "530 diamonds": "447500",
        "1080 diamonds": "895000",
        "2200 diamonds": "1790000",
      },
      roblox: {
        "10$": "895000",
        "15$": "1342500",
        "20$": "1790000",
        "25$": "2237500",
        "50$": "4475000",
        "75$": "6712500",
        "100$": "8950000",
        "150$": "13425000",
      },
    },
    "DSL cards": {
      idm: {
        "ADSL Pause Card": "169376",
        "Parental Control": "226437",
        "ADSL 4Mbps/80GB": "558059",
        "ADSL OpenSpeed/110GB": "861092",
        "ADSL OpenSpeed/170GB": "1307065",
        "ADSL iPlan Light": "1438572",
        "ADSL 6Mbps/Unlimited": "1507183",
        "ADSL OpenSpeed/220GB": "1621534",
        "ADSL iPlan Popular": "1838803",
        "ADSL OpenSpeed/150GB DualPlay": "1868992",
        "ADSL 8Mbps/Unlimited DualPlay": "2074368",
        "ADSL OpenSpeed/300GB DualPlay": "2078943",
        "ADSL 8Mbps/Unlimited": "2136119",
        "ADSL OpenSpeed/150GB DualPlay Value": "2177057",
        "ADSL iPlan Medium": "2239036",
        "ADSL 8Mbps/Unlimited DualPlay Value": "2382433",
        "ADSL OpenSpeed/400GB": "2479118",
        "ADSL iPlan Platinum": "2679292",
        "ADSL OpenSpeed/500GB": "2907939",
        "ADSL OpenSpeed/750GB": "3309286",
        "ADSL OpenSpeed/1000GB": "4080164",
      },
    },
  },
  "Whish App": {},
  "Validity vouchers": {
    alfa: {
      voucher: {
        "1 day": "318978",
        "3 days": "462075",
        "7 days": "765007",
        "15 days": "10003274",
        "30 days": "1511601",
        "60 days": "2256769",
        "90 days": "7620030",
      },
    },
    mtc: {
      voucher: {
        "1 day": "119617",
        "3 days": "186071",
        "7 days": "398723",
        "15 days": "462518",
        "30 days": "765007",
        "60 days": "10003274",
        "90 days": "1509829",
      },
    },
  },
};

export default mobileServices;
