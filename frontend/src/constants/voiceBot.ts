export interface TipsPage {
  title: string;
  examples: string[];
}

export interface ModuleTips {
  [key: string]: TipsPage[];
}

export const MODULE_TIPS: ModuleTips = {
  pos: [
    {
      title: "POS Actions",
      examples: [
        "add 2 Coca Cola",
        "remove iPhone",
        "complete sale",
        "discount $10",
      ],
    },
    {
      title: "Navigation",
      examples: [
        "go to debts",
        "open profits",
        "show exchange",
        "take me to dashboard",
      ],
    },
    {
      title: "Quick Tips",
      examples: [
        "Use natural language",
        "Click examples to try",
        "Works from any page",
      ],
    },
  ],
  omt_whish: [
    {
      title: "Money Transfer",
      examples: [
        "send $50 to Amir 81077357",
        "receive $100 from John 81234567",
        "check balance",
      ],
    },
    {
      title: "Navigation",
      examples: [
        "go to pos",
        "open debts",
        "show profits",
        "take me to dashboard",
      ],
    },
    {
      title: "Quick Tips",
      examples: [
        "Works from any page",
        "Click examples to try",
        "Use natural language",
      ],
    },
  ],
  recharge: [
    {
      title: "Recharge",
      examples: [
        "recharge 81077357 $10",
        "recharge $20 for 81234567",
        "topup 81077357 $5",
      ],
    },
    {
      title: "Navigation",
      examples: [
        "go to pos",
        "open debts",
        "show profits",
        "take me to dashboard",
      ],
    },
    {
      title: "Quick Tips",
      examples: [
        "Works from any page",
        "Click examples to try",
        "Use natural language",
      ],
    },
  ],
  debts: [
    {
      title: "Debts",
      examples: [
        "add debt for Amir $50",
        "record payment from Amir $30",
        "show unpaid debts",
        "filter paid debts",
      ],
    },
    {
      title: "Navigation",
      examples: [
        "go to pos",
        "open profits",
        "show exchange",
        "take me to dashboard",
      ],
    },
    {
      title: "Quick Tips",
      examples: [
        "Works from any page",
        "Click examples to try",
        "Use natural language",
      ],
    },
  ],
  profits: [
    {
      title: "Profits",
      examples: [
        "profits from 01-01 to 31-01",
        "filter paid profits",
        "show unpaid profits",
      ],
    },
    {
      title: "Navigation",
      examples: [
        "go to pos",
        "open debts",
        "show expenses",
        "take me to dashboard",
      ],
    },
    {
      title: "Quick Tips",
      examples: [
        "Works from any page",
        "Click examples to try",
        "Use natural language",
      ],
    },
  ],
  expenses: [
    {
      title: "Expenses",
      examples: [
        "show rent expenses",
        "filter utilities expenses",
        "expenses from 01-01",
      ],
    },
    {
      title: "Navigation",
      examples: [
        "go to pos",
        "open profits",
        "show debts",
        "take me to dashboard",
      ],
    },
    {
      title: "Quick Tips",
      examples: [
        "Works from any page",
        "Click examples to try",
        "Use natural language",
      ],
    },
  ],
  exchange: [
    {
      title: "Exchange",
      examples: ["add exchange transaction", "view exchange history"],
    },
    {
      title: "Navigation",
      examples: [
        "go to pos",
        "open debts",
        "show profits",
        "take me to dashboard",
      ],
    },
    {
      title: "Quick Tips",
      examples: [
        "Works from any page",
        "Click examples to try",
        "Use natural language",
      ],
    },
  ],
  inventory: [
    {
      title: "Inventory",
      examples: ["add new product", "search for iPhone", "filter by category"],
    },
    {
      title: "Navigation",
      examples: [
        "go to pos",
        "open debts",
        "show profits",
        "take me to dashboard",
      ],
    },
    {
      title: "Quick Tips",
      examples: [
        "Works from any page",
        "Click examples to try",
        "Use natural language",
      ],
    },
  ],
  clients: [
    {
      title: "Clients",
      examples: ["add new client", "search for Amir", "filter clients"],
    },
    {
      title: "Navigation",
      examples: [
        "go to pos",
        "open debts",
        "show profits",
        "take me to dashboard",
      ],
    },
    {
      title: "Quick Tips",
      examples: [
        "Works from any page",
        "Click examples to try",
        "Use natural language",
      ],
    },
  ],
  settings: [
    {
      title: "Settings",
      examples: ["change exchange rate", "update shop info"],
    },
    {
      title: "Navigation",
      examples: [
        "go to pos",
        "open debts",
        "show profits",
        "take me to dashboard",
      ],
    },
    {
      title: "Quick Tips",
      examples: [
        "Works from any page",
        "Click examples to try",
        "Use natural language",
      ],
    },
  ],
};

export const DEFAULT_TIPS: TipsPage[] = [
  {
    title: "Navigation",
    examples: [
      "go to pos",
      "open debts",
      "show profits",
      "take me to dashboard",
    ],
  },
  {
    title: "Services (OMT/WHISH)",
    examples: [
      "send $50 to Amir 81077357",
      "receive $100 from John 81234567",
      "check balance",
    ],
  },
  {
    title: "Recharge",
    examples: ["recharge 81077357 $10", "recharge $20 for 81234567"],
  },
  {
    title: "POS",
    examples: [
      "add 2 Coca Cola",
      "remove iPhone",
      "complete sale",
      "discount $10",
    ],
  },
  {
    title: "Debts",
    examples: [
      "add debt for Amir $50",
      "record payment from Amir $30",
      "show unpaid debts",
    ],
  },
  {
    title: "Profits & Expenses",
    examples: [
      "profits from 01-01 to 31-01",
      "show rent expenses",
      "filter paid profits",
    ],
  },
  {
    title: "Quick Tips",
    examples: [
      "Works from any page!",
      "Click examples to try",
      "Use natural language",
    ],
  },
];

export const MODULE_SUGGESTIONS: Record<string, string[]> = {
  omt_whish: [
    "Send $5 to Amir 81077357",
    "Receive $10 from John 81234567",
    "Check balance",
  ],
  recharge: ["Recharge 81077357 $5", "Recharge $10 for 81234567"],
  pos: [
    "Add iPhone 2",
    "Add 2 Coca Cola",
    "Remove iPhone",
    "Complete sale",
    "Discount $10",
  ],
  debts: ["Add debt for Amir 81077357 $50", "Record payment from Amir $30"],
};

export interface VoiceBotConfig {
  enabled: boolean;
}

export const DEFAULT_VOICEBOT_CONFIG: VoiceBotConfig = {
  enabled: true,
};

export const STORAGE_KEYS = {
  ENABLED: "voicebot_enabled",
  CONFIG: "voicebot_config",
};
