/**
 * LIRA-297 item 3 — the shared write contracts for customer sessions
 * (start / update / cart add / link transaction), the daily-closing edit and
 * the voucher-image save. Each schema now sits in front of BOTH transports,
 * and Zod strips unknown keys silently (rule 23), so the load-bearing check is
 * that every key a handler forwards survives a parse. Fixtures are typed by
 * the schemas' own input types and compared against `.shape` (rule 24), so a
 * key added to a schema without a fixture fails here.
 *
 * Not proven failing-first (rule 17): these schemas are new — there was no
 * earlier version for the tests to fail against.
 */
import {
  startSessionSchema,
  startSessionIpcSchema,
  updateSessionSchema,
  sessionCartAddSchema,
  linkSessionTransactionSchema,
  type StartSessionIpcInput,
  type UpdateSessionInput,
  type SessionCartAddInput,
  type LinkSessionTransactionInput,
} from "../session.js";
import {
  updateDailyClosingIpcSchema,
  type UpdateDailyClosingIpcInput,
} from "../closing.js";
import {
  setVoucherImageSchema,
  type SetVoucherImageInput,
} from "../voucherImage.js";
import { completeSetupSchema, type CompleteSetupInput } from "../setup.js";

function keysOf(o: object): string[] {
  return Object.keys(o).sort();
}

// Full fixtures: one value for every key in each schema.
const START: Required<StartSessionIpcInput> = {
  customer_name: "Walk-in",
  customer_phone: "70123456",
  customer_notes: "VIP",
  started_by: "cashier1",
};
const UPDATE: Required<UpdateSessionInput> = {
  customer_name: "Ali",
  customer_phone: "71000000",
  customer_notes: "",
};
const CART: Required<SessionCartAddInput> = {
  item_id: "uuid-1",
  module: "recharge",
  label: "Alfa $10",
  amount: 10,
  currency: "USD",
  form_data: "{}",
  ipc_channel: "recharge:process",
};
const LINK: Required<LinkSessionTransactionInput> = {
  sessionId: 7,
  transactionType: "exchange",
  transactionId: 99,
  amountUsd: 100,
  amountLbp: 0,
  profitUsd: 1.5,
  profitLbp: 2500,
};
const CLOSING: Required<UpdateDailyClosingIpcInput> = {
  id: 3,
  physical_usd: 10,
  physical_lbp: 900_000,
  physical_eur: 5,
  system_expected_usd: 11,
  system_expected_lbp: 910_000,
  variance_usd: -1,
  notes: "recount",
  report_path: "/r.pdf",
};
const IMAGE: SetVoucherImageInput = {
  provider: "alfa",
  category: "cards",
  itemKey: "alfa-10",
  imageData: "data:image/png;base64,AAAA",
};

describe.each([
  ["startSessionIpcSchema", startSessionIpcSchema, START],
  ["updateSessionSchema", updateSessionSchema, UPDATE],
  ["sessionCartAddSchema", sessionCartAddSchema, CART],
  ["linkSessionTransactionSchema", linkSessionTransactionSchema, LINK],
  ["updateDailyClosingIpcSchema", updateDailyClosingIpcSchema, CLOSING],
  ["setVoucherImageSchema", setVoucherImageSchema, IMAGE],
] as const)("%s", (_name, schema, fixture) => {
  it("the fixture covers every key in the schema", () => {
    expect(keysOf(fixture)).toEqual(keysOf(schema.shape));
  });

  it("every key survives a parse unchanged (nothing stripped)", () => {
    const parsed = schema.safeParse(fixture);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(fixture);
  });
});

describe("session schemas", () => {
  it("the REST start schema is the IPC one minus started_by", () => {
    expect(keysOf(startSessionSchema.shape)).toEqual(
      keysOf(startSessionIpcSchema.shape).filter((k) => k !== "started_by"),
    );
  });

  it("actor ids are not part of the start / cart contracts (stripped)", () => {
    const start = startSessionIpcSchema.parse({ ...START, user_id: 999 });
    expect(start).not.toHaveProperty("user_id");
    const cart = sessionCartAddSchema.parse({ ...CART, user_id: 999 });
    expect(cart).not.toHaveProperty("user_id");
  });

  it("link: profit is optional and gets NO default (rule 22)", () => {
    const { profitUsd: _u, profitLbp: _l, ...noProfit } = LINK;
    const parsed = linkSessionTransactionSchema.parse(noProfit);
    expect(parsed).not.toHaveProperty("profitUsd");
    expect(parsed).not.toHaveProperty("profitLbp");
  });

  it("link: sessionId is optional (active-session fallback)", () => {
    const { sessionId: _s, ...noSession } = LINK;
    expect(linkSessionTransactionSchema.safeParse(noSession).success).toBe(
      true,
    );
  });

  it.each(["amountUsd", "amountLbp", "transactionType", "transactionId"])(
    "link: %s is required",
    (key) => {
      const rest: Record<string, unknown> = { ...LINK };
      delete rest[key];
      expect(linkSessionTransactionSchema.safeParse(rest).success).toBe(false);
    },
  );

  it("link: a negative profit is accepted (a below-cost sale is real)", () => {
    expect(
      linkSessionTransactionSchema.safeParse({ ...LINK, profitLbp: -500 })
        .success,
    ).toBe(true);
  });

  it("link: NaN is refused", () => {
    expect(
      linkSessionTransactionSchema.safeParse({ ...LINK, amountUsd: NaN })
        .success,
    ).toBe(false);
  });
});

describe("updateDailyClosingIpcSchema", () => {
  it("does not carry user_id — the editor comes from the signed-in user", () => {
    const parsed = updateDailyClosingIpcSchema.parse({
      id: 3,
      report_path: "/r.pdf",
      user_id: 999,
    });
    expect(parsed).toEqual({ id: 3, report_path: "/r.pdf" });
  });

  it("requires a positive integer id", () => {
    expect(
      updateDailyClosingIpcSchema.safeParse({ report_path: "/r.pdf" }).success,
    ).toBe(false);
  });
});

describe("setVoucherImageSchema", () => {
  it.each(Object.keys(IMAGE))("refuses an empty %s", (key) => {
    expect(
      setVoucherImageSchema.safeParse({ ...IMAGE, [key]: "" }).success,
    ).toBe(false);
  });
});

describe("completeSetupSchema (type contract)", () => {
  it("accepts the wizard's full state, including UI-only keys", () => {
    const payload: CompleteSetupInput & Record<string, unknown> = {
      shop_name: "Shop",
      admin_username: "owner",
      admin_password: "Passw0rd!",
      base_system: "OMT",
      enabled_modules: ["pos"],
      enabled_payment_methods: ["CASH"],
      session_management_enabled: true,
      customer_sessions_enabled: true,
      active_currencies: ["USD", "LBP"],
      extra_users: [],
      whatsapp_phone: "",
      whatsapp_api_key: "",
      drawer_amounts: [],
      carrier_lines: [
        { carrier: "alfa", phone_number: "03111111", label: null, credits: 5 },
      ],
      modules_defaults_applied: true,
      database_path: null,
    };
    expect(completeSetupSchema.safeParse(payload).success).toBe(true);
  });
});
