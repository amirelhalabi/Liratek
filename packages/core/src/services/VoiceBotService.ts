import { voiceBotLogger } from "../utils/logger.js";

export interface VoiceCommand {
  module: string;
  action: string;
  provider?: "OMT" | "WHISH";
  entities: {
    amount?: number;
    phone?: string;
    name?: string;
    product?: string;
    quantity?: number;
    serviceType?: "SEND" | "RECEIVE";
    senderName?: string;
    senderPhone?: string;
    receiverName?: string;
    receiverPhone?: string;
    // Navigation entities
    targetPage?: string;
    fromDate?: string;
    toDate?: string;
    status?: string;
    filter?: string;
  };
}

export interface VoiceCommandPattern {
  pattern: RegExp;
  action: string;
  entities: string[];
}

/**
 * Route mapping for navigation commands
 */
const ROUTE_MAPPING: Record<string, string> = {
  // Main modules
  pos: "/pos",
  "point of sale": "/pos",
  checkout: "/pos",
  products: "/products",
  inventory: "/products",
  clients: "/clients",
  customers: "/clients",
  debts: "/debts",
  "money owed": "/debts",
  exchange: "/exchange",
  "currency exchange": "/exchange",
  services: "/services",
  "omt whish": "/services",
  "money transfer": "/services",
  recharge: "/recharge",
  "mobile recharge": "/recharge",
  "phone credit": "/recharge",
  expenses: "/expenses",
  maintenance: "/maintenance",
  "custom services": "/custom-services",
  settings: "/settings",
  profits: "/profits",
  "profit overview": "/profits",
  "checkpoint timeline": "/checkpoint-timeline",
  closing: "/checkpoint-timeline",
  "shift closing": "/checkpoint-timeline",
  opening: "/opening",
  "shift opening": "/opening",
  // Shortcuts
  home: "/",
  dashboard: "/dashboard",
};

/**
 * Action keywords for each module
 */
const MODULE_ACTIONS: Record<string, string[]> = {
  pos: ["add", "remove", "complete", "checkout", "discount", "clear"],
  debts: ["add", "record", "payment", "view", "filter"],
  recharge: ["recharge", "topup", "top-up"],
  services: ["send", "receive", "check", "balance"],
  profits: ["filter", "view", "overview", "date", "from", "to"],
  expenses: ["add", "view", "filter", "category"],
  clients: ["add", "search", "filter", "view"],
  products: ["add", "search", "filter", "view", "stock"],
};

export class VoiceBotService {
  private patterns: Record<string, VoiceCommandPattern[]> = {
    omt_whish: [
      {
        pattern:
          /send\s+\$?(\d+(?:\.\d{2})?)\s+to\s+([a-zA-Z\s]+?)\s+(?:phone\s+)?(\d{7,8})/i,
        action: "send",
        entities: ["amount", "receiverName", "receiverPhone"],
      },
      {
        pattern:
          /receive\s+\$?(\d+(?:\.\d{2})?)\s+from\s+([a-zA-Z\s]+?)\s+(?:phone\s+)?(\d{7,8})/i,
        action: "receive",
        entities: ["amount", "senderName", "senderPhone"],
      },
      {
        pattern: /check\s+balance|how\s+much\s+money|what's\s+my\s+balance/i,
        action: "check_balance",
        entities: [],
      },
    ],
    recharge: [
      {
        pattern: /recharge\s+(?:phone\s+)?(\d{7,8})\s+\$?(\d+(?:\.\d{2})?)/i,
        action: "recharge",
        entities: ["phone", "amount"],
      },
      {
        pattern:
          /recharge\s+\$?(\d+(?:\.\d{2})?)\s+for\s+(?:phone\s+)?(\d{7,8})/i,
        action: "recharge",
        entities: ["amount", "phone"],
      },
    ],
    pos: [
      {
        pattern: /add\s+(?:([a-zA-Z0-9\s]+?)\s+)?(\d+)\s*([a-zA-Z0-9\s]+?)/i,
        action: "add_product",
        entities: ["quantity", "product"],
      },
      {
        pattern: /remove\s+([a-zA-Z0-9\s]+)/i,
        action: "remove_product",
        entities: ["product"],
      },
      {
        pattern: /complete\s+sale|checkout|pay\s+now|finish/i,
        action: "complete_sale",
        entities: [],
      },
      {
        pattern: /(?:apply\s+)?discount\s+\$?(\d+(?:\.\d{2})?)/i,
        action: "apply_discount",
        entities: ["amount"],
      },
    ],
    debts: [
      {
        pattern:
          /add\s+debt\s+for\s+([a-zA-Z\s]+?)\s+(?:phone\s+)?(\d{7,8})\s+\$?(\d+(?:\.\d{2})?)/i,
        action: "add_debt",
        entities: ["name", "phone", "amount"],
      },
      {
        pattern:
          /record\s+payment\s+from\s+([a-zA-Z\s]+?)\s+\$?(\d+(?:\.\d{2})?)/i,
        action: "record_payment",
        entities: ["name", "amount"],
      },
    ],
  };

  parseCommand(text: string, currentModule: string): VoiceCommand | null {
    try {
      const lowerText = text.toLowerCase().trim();

      // 1. Check for navigation commands first (works from any page)
      const navigationCommand = this.parseNavigationCommand(lowerText);
      if (navigationCommand) {
        voiceBotLogger.info(
          { command: navigationCommand },
          "Navigation command detected",
        );
        return navigationCommand;
      }

      // 2. Don't process module-specific commands if no valid module
      if (!currentModule) {
        voiceBotLogger.warn(
          { text, module: currentModule },
          "No active module for action command",
        );
        return null;
      }

      // 3. Check for module-specific action commands
      const actionCommand = this.parseActionCommand(text, currentModule);
      if (actionCommand) {
        voiceBotLogger.info(
          { command: actionCommand },
          "Action command detected",
        );
        return actionCommand;
      }

      // 4. Try pattern matching
      const patterns = this.patterns[currentModule] || [];
      for (const cmdPattern of patterns) {
        const match = text.match(cmdPattern.pattern);
        if (match) {
          const command: VoiceCommand = {
            module: currentModule,
            action: cmdPattern.action,
            entities: this.extractEntities(match, cmdPattern.entities),
          };

          // Add provider detection for omt_whish and recharge modules
          if (currentModule === "omt_whish" || currentModule === "recharge") {
            command.provider = this.detectProvider(text, currentModule);
          }

          return command;
        }
      }

      // 5. Try smart parsing
      voiceBotLogger.warn(
        { text, module: currentModule },
        "No matching pattern found, trying smart parse",
      );

      const smartCommand = this.smartParse(text, currentModule);
      if (smartCommand) {
        voiceBotLogger.info(
          { command: smartCommand },
          "Smart parse successful",
        );
        return smartCommand;
      }

      return null;
    } catch (error) {
      voiceBotLogger.error(
        { error, text, module: currentModule },
        "Failed to parse voice command",
      );
      return null;
    }
  }

  /**
   * Parse navigation commands (e.g., "go to profits", "open POS", "show expenses")
   */
  private parseNavigationCommand(text: string): VoiceCommand | null {
    const lowerText = text.toLowerCase();

    // Navigation keywords
    const navKeywords = [
      "go to",
      "open",
      "show",
      "navigate to",
      "go",
      "switch to",
      "change to",
      "i want to see",
      "i need to",
      "take me to",
    ];

    // Check if it's a navigation command
    const isNavigation = navKeywords.some((keyword) =>
      lowerText.includes(keyword),
    );

    if (!isNavigation) {
      return null;
    }

    // Find matching route
    for (const [keyword, route] of Object.entries(ROUTE_MAPPING)) {
      if (lowerText.includes(keyword)) {
        // Extract date filters if mentioned
        const fromDate = this.extractDate(lowerText, "from");
        const toDate = this.extractDate(lowerText, "to");

        // Extract status filter if mentioned
        let status: string | undefined;
        if (lowerText.includes("paid") && !lowerText.includes("unpaid")) {
          status = "paid";
        } else if (
          lowerText.includes("unpaid") ||
          lowerText.includes("pending")
        ) {
          status = "unpaid";
        }

        return {
          module: "navigation",
          action: "navigate",
          entities: {
            targetPage: route,
            fromDate,
            toDate,
            status,
          },
        };
      }
    }

    return null;
  }

  /**
   * Parse action commands within current module
   */
  private parseActionCommand(
    text: string,
    currentModule: string,
  ): VoiceCommand | null {
    const lowerText = text.toLowerCase();
    const actions = MODULE_ACTIONS[currentModule] || [];

    // Check if text contains action keywords for current module
    const hasAction = actions.some((action) => lowerText.includes(action));

    if (!hasAction) {
      return null;
    }

    // Module-specific action parsing
    switch (currentModule) {
      case "profits":
        return this.parseProfitsCommand(lowerText);
      case "expenses":
        return this.parseExpensesCommand(lowerText);
      case "debts":
        return this.parseDebtsCommand(lowerText);
      case "pos":
        return this.parsePOSCommand(lowerText);
      default:
        return null;
    }
  }

  /**
   * Parse profits module commands
   */
  private parseProfitsCommand(text: string): VoiceCommand | null {
    const command: VoiceCommand = {
      module: "profits",
      action: "filter",
      entities: {},
    };

    // Extract date range
    command.entities.fromDate = this.extractDate(text, "from");
    command.entities.toDate = this.extractDate(text, "to");

    // Extract status filter
    if (text.includes("paid")) {
      command.entities.status = "paid";
    } else if (text.includes("unpaid") || text.includes("pending")) {
      command.entities.status = "unpaid";
    }

    // Only return if we have filters
    if (
      command.entities.fromDate ||
      command.entities.toDate ||
      command.entities.status
    ) {
      return command;
    }

    return null;
  }

  /**
   * Parse expenses module commands
   */
  private parseExpensesCommand(text: string): VoiceCommand | null {
    const command: VoiceCommand = {
      module: "expenses",
      action: "filter",
      entities: {},
    };

    // Extract date range
    command.entities.fromDate = this.extractDate(text, "from");
    command.entities.toDate = this.extractDate(text, "to");

    // Extract category
    const categories = ["rent", "utilities", "salary", "supplies", "other"];
    for (const category of categories) {
      if (text.includes(category)) {
        command.entities.filter = category;
        break;
      }
    }

    if (
      command.entities.fromDate ||
      command.entities.toDate ||
      command.entities.filter
    ) {
      return command;
    }

    return null;
  }

  /**
   * Parse debts module commands
   */
  private parseDebtsCommand(text: string): VoiceCommand | null {
    // Check for filter commands
    if (
      text.includes("filter") ||
      text.includes("show") ||
      text.includes("view")
    ) {
      const command: VoiceCommand = {
        module: "debts",
        action: "filter",
        entities: {},
      };

      if (text.includes("paid")) {
        command.entities.status = "paid";
      } else if (text.includes("unpaid") || text.includes("pending")) {
        command.entities.status = "unpaid";
      }

      command.entities.fromDate = this.extractDate(text, "from");
      command.entities.toDate = this.extractDate(text, "to");

      if (
        command.entities.status ||
        command.entities.fromDate ||
        command.entities.toDate
      ) {
        return command;
      }
    }

    return null;
  }

  /**
   * Parse POS module commands
   */
  private parsePOSCommand(text: string): VoiceCommand | null {
    const command: VoiceCommand = {
      module: "pos",
      action: "action",
      entities: {},
    };

    if (
      text.includes("complete") ||
      text.includes("checkout") ||
      text.includes("finish")
    ) {
      command.action = "complete_sale";
      return command;
    }

    if (text.includes("clear") || text.includes("reset")) {
      command.action = "clear_cart";
      return command;
    }

    if (text.includes("discount")) {
      command.action = "apply_discount";
      const amountMatch = text.match(/\$?(\d+(?:\.\d{2})?)/);
      if (amountMatch) {
        command.entities.amount = parseFloat(amountMatch[1]);
      }
      return command;
    }

    return null;
  }

  /**
   * Extract date from text based on keyword
   */
  private extractDate(
    text: string,
    keyword: "from" | "to",
  ): string | undefined {
    const patterns = [
      new RegExp(`${keyword}\\s+(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})`, "i"),
      new RegExp(`${keyword}\\s+(\\w+\\s+\\d{1,2},?\\s+\\d{4})`, "i"),
      new RegExp(`${keyword}\\s+(\\d{4}-\\d{2}-\\d{2})`, "i"),
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return undefined;
  }

  /**
   * Detect provider (OMT vs WHISH) from text
   * Context-aware: differentiates between Money Transfer and Mobile Recharge
   */
  private detectProvider(text: string, module: string): "OMT" | "WHISH" {
    const lowerText = text.toLowerCase();

    // For RECHARGE module - look for "app" keywords
    if (module === "recharge") {
      // Check for WHISH first (more specific)
      if (lowerText.includes("whish app") || lowerText.includes("wish app")) {
        return "WHISH";
      }
      // Then check for OMT
      if (lowerText.includes("omt app") || lowerText.includes("omtapp")) {
        return "OMT";
      }
      // Default for recharge
      return "OMT";
    }

    // For OMT_WHISH module (money transfer)
    // Check for WHISH first (more specific)
    if (lowerText.includes("whish") || lowerText.includes("wish")) {
      return "WHISH";
    }
    // Then check for OMT
    if (lowerText.includes("omt") || lowerText.includes("money transfer")) {
      return "OMT";
    }

    // Default to OMT (most common for money transfer)
    return "OMT";
  }

  /**
   * Smart parsing - uses NLP-like extraction to understand natural language
   */
  private smartParse(text: string, currentModule: string): VoiceCommand | null {
    const lowerText = text.toLowerCase();

    // OMT/WHISH module - smart send/receive parsing with provider detection
    if (currentModule === "omt_whish") {
      // Detect provider (OMT vs WHISH) - context-aware
      const provider = this.detectProvider(text, currentModule);

      // Check if it's a send command
      const isSend =
        lowerText.includes("send") ||
        lowerText.includes("give") ||
        lowerText.includes("transfer") ||
        lowerText.includes("to amir") ||
        lowerText.includes("to ") ||
        lowerText.includes(" on ") ||
        lowerText.includes(" dollars ");

      if (isSend) {
        const entities = this.extractSendEntities(text);
        if (entities.amount) {
          return {
            module: "omt_whish",
            action: "send",
            provider,
            entities,
          };
        }
      }

      // Check if it's a receive command
      const isReceive =
        lowerText.includes("receive") ||
        lowerText.includes("get") ||
        lowerText.includes("from");

      if (isReceive) {
        const entities = this.extractReceiveEntities(text);
        if (entities.amount && entities.senderPhone) {
          return {
            module: "omt_whish",
            action: "receive",
            provider,
            entities,
          };
        }
      }
    }

    // RECHARGE module - smart recharge parsing with provider detection
    if (currentModule === "recharge") {
      const provider = this.detectProvider(text, currentModule);

      // Extract phone and amount
      const phoneMatch = text.match(/(\d{7,8})/);
      const amountMatch = text.match(/\$?(\d+(?:\.\d{2})?)/);

      if (phoneMatch && amountMatch) {
        return {
          module: "recharge",
          action: "recharge",
          provider,
          entities: {
            phone: phoneMatch[1],
            amount: parseFloat(amountMatch[1]),
          },
        };
      }
    }

    return null;
  }

  /**
   * Extract entities for SEND commands using smart extraction
   */
  private extractSendEntities(text: string) {
    const entities: VoiceCommand["entities"] = {};

    // Extract amount - look for numbers with/without currency indicators
    const amountPatterns = [
      /(\d+(?:\.\d{2})?)\s*dollars?/i, // "150 dollars"
      /\$?(\d+(?:\.\d{2})?)/, // "$150" or "150"
      /(\d{3,})/, // 3+ digit numbers
    ];

    for (const pattern of amountPatterns) {
      const match = text.match(pattern);
      if (match) {
        const amount = parseFloat(match[1]);
        // Reasonable amount range
        if (amount > 0 && amount < 100000) {
          entities.amount = amount;
          break;
        }
      }
    }

    // Extract phone number - look for 7-8 digit sequences
    const phoneMatch = text.match(/(\d{7,8})/);
    if (phoneMatch) {
      entities.receiverPhone = phoneMatch[1];
    }

    // Extract name - look for "to [name]" or "on [name]" or capitalized words
    const namePatterns = [
      /(?:to|for|on)\s+([a-zA-Z][a-zA-Z\s]+?)(?:\s+(?:phone|on)|\s+\d|$)/i,
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/, // Capitalized words
    ];

    for (const pattern of namePatterns) {
      const match = text.match(pattern);
      if (match && match[1].trim().length > 2) {
        const name = match[1].trim();
        // Avoid matching phone numbers or amounts as names
        if (!/^\d+$/.test(name)) {
          entities.receiverName = name;
          break;
        }
      }
    }

    return entities;
  }

  /**
   * Extract entities for RECEIVE commands
   */
  private extractReceiveEntities(text: string) {
    const entities: VoiceCommand["entities"] = {};

    // Extract amount
    const amountMatch = text.match(/\$?(\d+(?:\.\d{2})?)/);
    if (amountMatch) {
      entities.amount = parseFloat(amountMatch[1]);
    }

    // Extract phone
    const phoneMatch = text.match(/(\d{7,8})/);
    if (phoneMatch) {
      entities.senderPhone = phoneMatch[1];
    }

    // Extract name from "from [name]"
    const nameMatch = text.match(
      /from\s+([a-zA-Z\s]+?)(?:\s+(?:phone|on)|\s+\d|$)/i,
    );
    if (nameMatch && nameMatch[1].trim().length > 2) {
      entities.senderName = nameMatch[1].trim();
    }

    return entities;
  }

  private extractEntities(
    match: RegExpMatchArray,
    entityNames: string[],
  ): VoiceCommand["entities"] {
    const entities: VoiceCommand["entities"] = {};

    entityNames.forEach((name, index) => {
      const value = match[index + 1];
      if (value !== undefined) {
        if (name === "amount") {
          entities.amount = parseFloat(value);
        } else if (name === "quantity") {
          entities.quantity = parseInt(value, 10);
        } else if (name === "receiverName") {
          entities.receiverName = value.trim();
        } else if (name === "receiverPhone") {
          entities.receiverPhone = value.trim();
        } else if (name === "senderName") {
          entities.senderName = value.trim();
        } else if (name === "senderPhone") {
          entities.senderPhone = value.trim();
        } else if (name === "phone") {
          entities.phone = value.trim();
        } else if (name === "name") {
          entities.name = value.trim();
        } else if (name === "product") {
          entities.product = value.trim();
        }
      }
    });

    return entities;
  }

  validateCommand(command: VoiceCommand): {
    valid: boolean;
    missing?: string[];
  } {
    const required: Record<string, string[]> = {
      send: ["amount", "receiverPhone"],
      receive: ["amount", "senderPhone"],
      check_balance: [],
      recharge: ["phone", "amount"],
      add_product: ["product"],
      remove_product: ["product"],
      complete_sale: [],
      apply_discount: ["amount"],
      add_debt: ["name", "phone", "amount"],
      record_payment: ["name", "amount"],
      navigate: ["targetPage"],
      filter: [],
    };

    const requiredFields = required[command.action] || [];
    const missing = requiredFields.filter(
      (field) => !command.entities[field as keyof typeof command.entities],
    );

    return {
      valid: missing.length === 0,
      missing: missing.length > 0 ? missing : undefined,
    };
  }
}

// Singleton instance
let voiceBotServiceInstance: VoiceBotService | null = null;

export function getVoiceBotService(): VoiceBotService {
  if (!voiceBotServiceInstance) {
    voiceBotServiceInstance = new VoiceBotService();
  }
  return voiceBotServiceInstance;
}

export function resetVoiceBotService(): void {
  voiceBotServiceInstance = null;
}
