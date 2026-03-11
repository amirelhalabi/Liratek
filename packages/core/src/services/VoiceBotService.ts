import { voiceBotLogger } from "../utils/logger.js";

export interface VoiceCommand {
  module: string;
  action: string;
  entities: {
    amount?: number;
    phone?: string;
    name?: string;
    product?: string;
    quantity?: number;
    serviceType?: "SEND" | "RECEIVE";
    // New fields for sender/receiver separation
    senderName?: string;
    senderPhone?: string;
    receiverName?: string;
    receiverPhone?: string;
  };
}

export interface VoiceCommandPattern {
  pattern: RegExp;
  action: string;
  entities: string[];
}

export class VoiceBotService {
  // Pattern matching per module
  private patterns: Record<string, VoiceCommandPattern[]> = {
    omt_whish: [
      // Send money: "send $5 to Amir Elhalabi 81077357"
      {
        pattern:
          /send\s+\$?(\d+(?:\.\d{2})?)\s+to\s+([a-zA-Z\s]+?)\s+(?:phone\s+)?(\d{7,8})/i,
        action: "send",
        entities: ["amount", "receiverName", "receiverPhone"],
      },
      // Receive money: "receive $10 from John 81077357"
      {
        pattern:
          /receive\s+\$?(\d+(?:\.\d{2})?)\s+from\s+([a-zA-Z\s]+?)\s+(?:phone\s+)?(\d{7,8})/i,
        action: "receive",
        entities: ["amount", "senderName", "senderPhone"],
      },
      // Check balance
      {
        pattern: /check\s+balance|how\s+much\s+money|what's\s+my\s+balance/i,
        action: "check_balance",
        entities: [],
      },
    ],
    recharge: [
      // Recharge: "recharge 81077357 $5"
      {
        pattern: /recharge\s+(?:phone\s+)?(\d{7,8})\s+\$?(\d+(?:\.\d{2})?)/i,
        action: "recharge",
        entities: ["phone", "amount"],
      },
      // Recharge alternative: "recharge $5 for 81077357"
      {
        pattern:
          /recharge\s+\$?(\d+(?:\.\d{2})?)\s+for\s+(?:phone\s+)?(\d{7,8})/i,
        action: "recharge",
        entities: ["amount", "phone"],
      },
    ],
    pos: [
      // Add product: "add iPhone 2" or "add 2 iPhone"
      {
        pattern: /add\s+(?:([a-zA-Z0-9\s]+?)\s+)?(\d+)\s*([a-zA-Z0-9\s]+?)/i,
        action: "add_product",
        entities: ["quantity", "product"],
      },
      // Remove product: "remove iPhone"
      {
        pattern: /remove\s+([a-zA-Z0-9\s]+)/i,
        action: "remove_product",
        entities: ["product"],
      },
      // Complete sale
      {
        pattern: /complete\s+sale|checkout|pay\s+now|finish/i,
        action: "complete_sale",
        entities: [],
      },
      // Apply discount: "discount $10" or "apply discount 10"
      {
        pattern: /(?:apply\s+)?discount\s+\$?(\d+(?:\.\d{2})?)/i,
        action: "apply_discount",
        entities: ["amount"],
      },
    ],
    debts: [
      // Add debt: "add debt for Amir 81077357 $50"
      {
        pattern:
          /add\s+debt\s+for\s+([a-zA-Z\s]+?)\s+(?:phone\s+)?(\d{7,8})\s+\$?(\d+(?:\.\d{2})?)/i,
        action: "add_debt",
        entities: ["name", "phone", "amount"],
      },
      // Record payment: "record payment from Amir $50"
      {
        pattern:
          /record\s+payment\s+from\s+([a-zA-Z\s]+?)\s+\$?(\d+(?:\.\d{2})?)/i,
        action: "record_payment",
        entities: ["name", "amount"],
      },
    ],
  };

  /**
   * Parse voice command text into structured command
   */
  parseCommand(text: string, currentModule: string): VoiceCommand | null {
    try {
      const patterns = this.patterns[currentModule] || [];

      for (const cmdPattern of patterns) {
        const match = text.match(cmdPattern.pattern);
        if (match) {
          return {
            module: currentModule,
            action: cmdPattern.action,
            entities: this.extractEntities(match, cmdPattern.entities),
          };
        }
      }

      voiceBotLogger.warn(
        { text, module: currentModule },
        "No matching pattern found",
      );
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
   * Extract entities from regex match
   */
  private extractEntities(
    match: RegExpMatchArray,
    entityNames: string[],
  ): VoiceCommand["entities"] {
    const entities: VoiceCommand["entities"] = {};

    entityNames.forEach((name, index) => {
      const value = match[index + 1];
      if (value) {
        if (name === "amount") {
          entities.amount = parseFloat(value);
        } else if (name === "quantity") {
          entities.quantity = parseInt(value, 10);
        } else if (name === "receiverPhone") {
          entities.receiverPhone = value.trim();
        } else if (name === "receiverName") {
          entities.receiverName = value.trim();
        } else if (name === "senderPhone") {
          entities.senderPhone = value.trim();
        } else if (name === "senderName") {
          entities.senderName = value.trim();
        } else if (name === "phone") {
          entities.phone = value.trim();
        } else if (name === "name") {
          entities.name = value.trim();
        } else if (name === "product") {
          entities.product = value.trim();
        }
      }
    });

    // Set service type based on action
    if (match[0]) {
      if (/send/i.test(match[0])) {
        entities.serviceType = "SEND";
      } else if (/receive/i.test(match[0])) {
        entities.serviceType = "RECEIVE";
      }
    }

    return entities;
  }

  /**
   * Validate command has required entities
   */
  validateCommand(command: VoiceCommand): {
    valid: boolean;
    missing?: string[];
  } {
    const required: Record<string, Record<string, string[]>> = {
      omt_whish: {
        send: ["amount", "receiverPhone"],
        receive: ["amount", "senderPhone"],
        check_balance: [],
      },
      recharge: {
        recharge: ["phone", "amount"],
      },
      pos: {
        add_product: ["product"],
        remove_product: ["product"],
        complete_sale: [],
        apply_discount: ["amount"],
      },
      debts: {
        add_debt: ["name", "amount"],
        record_payment: ["name", "amount"],
      },
    };

    const moduleRequired = required[command.module]?.[command.action] || [];
    const missing: string[] = [];

    for (const field of moduleRequired) {
      if (!command.entities[field as keyof typeof command.entities]) {
        missing.push(field);
      }
    }

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
