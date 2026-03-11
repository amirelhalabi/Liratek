import { VoiceBotService } from "@liratek/core";

describe("VoiceBotService - Navigation Commands", () => {
  let service: VoiceBotService;

  beforeEach(() => {
    service = new VoiceBotService();
  });

  describe("Basic Navigation", () => {
    it("should navigate to profits", () => {
      const result = service.parseCommand("go to profits", "dashboard");
      expect(result).not.toBeNull();
      expect(result?.module).toBe("navigation");
      expect(result?.action).toBe("navigate");
      expect(result?.entities.targetPage).toBe("/profits");
    });

    it("should navigate to POS", () => {
      const result = service.parseCommand("open POS", "dashboard");
      expect(result?.module).toBe("navigation");
      expect(result?.entities.targetPage).toBe("/pos");
    });

    it("should navigate to expenses", () => {
      const result = service.parseCommand("show expenses", "dashboard");
      expect(result?.module).toBe("navigation");
      expect(result?.entities.targetPage).toBe("/expenses");
    });
  });

  describe("Navigation with Date Filters", () => {
    it("should navigate to profits with date range", () => {
      const result = service.parseCommand(
        "go to profits from 01/01/2024 to 31/01/2024",
        "dashboard",
      );
      expect(result?.module).toBe("navigation");
      expect(result?.entities.targetPage).toBe("/profits");
      expect(result?.entities.fromDate).toBe("01/01/2024");
      expect(result?.entities.toDate).toBe("31/01/2024");
    });
  });

  describe("Navigation with Status Filters", () => {
    it("should navigate to debts with unpaid filter", () => {
      const result = service.parseCommand(
        "navigate to debts unpaid",
        "dashboard",
      );
      expect(result?.module).toBe("navigation");
      expect(result?.entities.targetPage).toBe("/debts");
      expect(result?.entities.status).toBe("unpaid");
    });
  });
});

describe("VoiceBotService - Money Transfer Commands", () => {
  let service: VoiceBotService;

  beforeEach(() => {
    service = new VoiceBotService();
  });

  describe("OMT Send Commands", () => {
    it("should parse OMT send command", () => {
      const result = service.parseCommand(
        "send 150 to Amir 81077357",
        "omt_whish",
      );
      expect(result?.module).toBe("omt_whish");
      expect(result?.action).toBe("send");
      expect(result?.provider).toBe("OMT");
      expect(result?.entities.amount).toBe(150);
      expect(result?.entities.receiverPhone).toBe("81077357");
    });

    it("should parse explicit OMT send", () => {
      const result = service.parseCommand(
        "omt send 150 to Amir 81077357",
        "omt_whish",
      );
      expect(result?.provider).toBe("OMT");
    });

    it("should parse natural language send", () => {
      const result = service.parseCommand(
        "150 dollars to Amir on 81077357",
        "omt_whish",
      );
      expect(result?.action).toBe("send");
      expect(result?.entities.amount).toBe(150);
    });
  });

  describe("WHISH Send Commands", () => {
    it("should parse WHISH send command", () => {
      const result = service.parseCommand(
        "whish send 200 to John 81234567",
        "omt_whish",
      );
      expect(result?.provider).toBe("WHISH");
      expect(result?.entities.amount).toBe(200);
    });
  });

  describe("Receive Commands", () => {
    it("should parse OMT receive command", () => {
      const result = service.parseCommand(
        "receive 100 from Mary 81765432",
        "omt_whish",
      );
      expect(result?.action).toBe("receive");
      expect(result?.provider).toBe("OMT");
      expect(result?.entities.amount).toBe(100);
      expect(result?.entities.senderPhone).toBe("81765432");
    });

    it("should parse WHISH receive command", () => {
      const result = service.parseCommand(
        "whish receive 75 from Amir 81077357",
        "omt_whish",
      );
      expect(result?.provider).toBe("WHISH");
      expect(result?.action).toBe("receive");
    });
  });
});

describe("VoiceBotService - Mobile Recharge Commands", () => {
  let service: VoiceBotService;

  beforeEach(() => {
    service = new VoiceBotService();
  });

  describe("OMT App Recharge", () => {
    it("should parse OMT app recharge", () => {
      const result = service.parseCommand(
        "omt app recharge 81077357 10",
        "recharge",
      );
      expect(result?.module).toBe("recharge");
      expect(result?.action).toBe("recharge");
      expect(result?.provider).toBe("OMT");
      expect(result?.entities.phone).toBe("81077357");
      expect(result?.entities.amount).toBe(10);
    });
  });

  describe("WHISH App Recharge", () => {
    it("should parse WHISH app recharge", () => {
      const result = service.parseCommand(
        "whish app recharge 81234567 20",
        "recharge",
      );
      expect(result?.provider).toBe("WHISH");
      expect(result?.entities.phone).toBe("81234567");
      expect(result?.entities.amount).toBe(20);
    });
  });

  describe("Generic Recharge", () => {
    it("should parse recharge without explicit provider", () => {
      const result = service.parseCommand(
        "recharge 81077357 5 dollars",
        "recharge",
      );
      expect(result?.provider).toBe("OMT");
      expect(result?.entities.phone).toBe("81077357");
      expect(result?.entities.amount).toBe(5);
    });
  });
});

describe("VoiceBotService - Provider Detection", () => {
  let service: VoiceBotService;

  beforeEach(() => {
    service = new VoiceBotService();
  });

  it("should default to OMT for money transfer", () => {
    const result = service.parseCommand(
      "send 100 to Amir 81077357",
      "omt_whish",
    );
    expect(result?.provider).toBe("OMT");
  });

  it("should detect WHISH when explicitly mentioned", () => {
    const result = service.parseCommand("whish send 100 to Amir", "omt_whish");
    expect(result?.provider).toBe("WHISH");
  });

  it("should detect WHISH app for recharge", () => {
    const result = service.parseCommand(
      "whish app recharge 81077357 10",
      "recharge",
    );
    expect(result?.provider).toBe("WHISH");
  });
});

describe("VoiceBotService - Command Validation", () => {
  let service: VoiceBotService;

  beforeEach(() => {
    service = new VoiceBotService();
  });

  it("should validate send command with all required fields", () => {
    const command: any = {
      module: "omt_whish",
      action: "send",
      entities: {
        amount: 100,
        receiverPhone: "81077357",
      },
    };
    const validation = service.validateCommand(command);
    expect(validation.valid).toBe(true);
  });

  it("should invalidate send command missing amount", () => {
    const command: any = {
      module: "omt_whish",
      action: "send",
      entities: {
        receiverPhone: "81077357",
      },
    };
    const validation = service.validateCommand(command);
    expect(validation.valid).toBe(false);
    expect(validation.missing).toContain("amount");
  });

  it("should validate recharge command", () => {
    const command: any = {
      module: "recharge",
      action: "recharge",
      entities: {
        phone: "81077357",
        amount: 10,
      },
    };
    const validation = service.validateCommand(command);
    expect(validation.valid).toBe(true);
  });
});
