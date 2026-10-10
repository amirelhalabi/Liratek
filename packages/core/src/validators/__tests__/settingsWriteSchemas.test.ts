/**
 * LIRA-297 (scope item 3) — the currency, payment-method, supplier-create and
 * drawer top-up contracts shared by the IPC handlers and the REST routes.
 *
 * Two kinds of guard:
 *  - KEY guards: every key the repositories read survives a parse (Zod strips
 *    unknown keys silently, rule 23). The expected key lists are the schemas'
 *    own `.shape` keys checked against the repository data interfaces at
 *    compile time (`satisfies Required<…>`), so a field added to a repository
 *    interface but not to the schema fails here (rule 24).
 *  - BEHAVIOUR guards: the refusals both transports now share.
 */
import type { CreateCurrencyData } from "../../repositories/CurrencyRepository.js";
import type { UpdateCurrencyData } from "../../repositories/CurrencyRepository.js";
import type {
  CreatePaymentMethodData,
  UpdatePaymentMethodData,
} from "../../repositories/PaymentMethodRepository.js";
import type { CreateSupplierData } from "../../repositories/SupplierRepository.js";
import type {
  CreateDrawerTopUpData,
  CreateDrawerTopUpFromDrawerData,
} from "../../repositories/DrawerTopUpRepository.js";
import {
  createCurrencySchema,
  updateCurrencySchema,
  type CreateCurrencyPayload,
  type UpdateCurrencyPayload,
} from "../currency.js";
import {
  createPaymentMethodSchema,
  updatePaymentMethodSchema,
  type CreatePaymentMethodPayload,
  type UpdatePaymentMethodPayload,
} from "../paymentMethod.js";
import {
  supplierCreateSchema,
  type SupplierCreatePayload,
} from "../supplier.js";
import {
  drawerTopUpCreateSchema,
  drawerTopUpFromDrawerSchema,
  type DrawerTopUpCreatePayload,
  type DrawerTopUpFromDrawerPayload,
} from "../drawerTopUp.js";

// A fully-populated fixture per contract. `satisfies Required<RepoData>` makes
// the compiler prove the fixture names EVERY key the repository reads; the
// `satisfies …Payload` proves each is also a schema key.
const currencyCreate = {
  code: "EUR",
  name: "Euro",
  symbol: "€",
  decimal_places: 2,
} satisfies Required<CreateCurrencyData> & CreateCurrencyPayload;

const currencyUpdate = {
  code: "EUR",
  name: "Euro",
  symbol: "€",
  decimal_places: 2,
  is_active: 0,
} satisfies Required<UpdateCurrencyData> & UpdateCurrencyPayload;

const paymentMethodCreate = {
  code: "CARD",
  label: "Card",
  drawer_name: "General",
  affects_drawer: 0,
  sort_order: 3,
} satisfies Required<CreatePaymentMethodData> & CreatePaymentMethodPayload;

const paymentMethodUpdate = {
  label: "Card",
  drawer_name: "General",
  affects_drawer: 1,
  is_active: 0,
  sort_order: 3,
} satisfies Required<UpdatePaymentMethodData> & UpdatePaymentMethodPayload;

const supplierCreate = {
  name: "Acme",
  contact_name: "Sam",
  phone: "70123456",
  note: "n",
  module_key: "recharge",
  provider: "MTC",
} satisfies Required<CreateSupplierData> & SupplierCreatePayload;

const topUpCreate = {
  amount_usd: 10,
  amount_lbp: 0,
  notes: "float",
  transaction_time: "2026-10-01T08:00:00.000Z",
  extra_currencies: [
    {
      currency_code: "EUR",
      amount: 50,
      acquisition_usd_per_unit: 1.08,
      market_usd_per_unit_hint: 1.07,
    },
  ],
} satisfies Required<CreateDrawerTopUpData> & DrawerTopUpCreatePayload;

const topUpFromDrawer = {
  amount_usd: 5,
  amount_lbp: 450000,
  source_drawer: "MTC",
  notes: "n",
  transaction_time: "2026-10-01T08:00:00.000Z",
} satisfies Required<CreateDrawerTopUpFromDrawerData> &
  DrawerTopUpFromDrawerPayload;

describe("LIRA-297 settings write schemas — no key a repository reads is stripped", () => {
  it.each([
    ["createCurrencySchema", createCurrencySchema, currencyCreate],
    ["updateCurrencySchema", updateCurrencySchema, currencyUpdate],
    [
      "createPaymentMethodSchema",
      createPaymentMethodSchema,
      paymentMethodCreate,
    ],
    [
      "updatePaymentMethodSchema",
      updatePaymentMethodSchema,
      paymentMethodUpdate,
    ],
    ["supplierCreateSchema", supplierCreateSchema, supplierCreate],
    ["drawerTopUpCreateSchema", drawerTopUpCreateSchema, topUpCreate],
    [
      "drawerTopUpFromDrawerSchema",
      drawerTopUpFromDrawerSchema,
      topUpFromDrawer,
    ],
  ] as const)(
    "%s round-trips a fully-populated payload unchanged",
    (_n, schema, fixture) => {
      expect(schema.parse(fixture)).toEqual(fixture);
    },
  );

  it("strips keys no repository reads (e.g. a client-sent id / is_system)", () => {
    expect(
      supplierCreateSchema.parse({ ...supplierCreate, is_system: 1 }),
    ).toEqual(supplierCreate);
    expect(updateCurrencySchema.parse({ ...currencyUpdate, id: 5 })).toEqual(
      currencyUpdate,
    );
  });
});

describe("LIRA-297 settings write schemas — shared refusals", () => {
  it("supplier create requires a name and string optional fields", () => {
    expect(supplierCreateSchema.safeParse({}).success).toBe(false);
    expect(
      supplierCreateSchema.safeParse({ name: "Acme", contact_name: 42 })
        .success,
    ).toBe(false);
    expect(supplierCreateSchema.safeParse({ name: "Acme" }).success).toBe(true);
  });

  it("currency create requires code + name; update accepts a lone is_active 0/1 only", () => {
    expect(createCurrencySchema.safeParse({ name: "Euro" }).success).toBe(
      false,
    );
    expect(
      createCurrencySchema.safeParse({ code: "EUR", name: "Euro" }).success,
    ).toBe(true);
    expect(updateCurrencySchema.safeParse({ is_active: 1 }).success).toBe(true);
    expect(updateCurrencySchema.safeParse({ is_active: 2 }).success).toBe(
      false,
    );
    expect(updateCurrencySchema.safeParse({ is_active: "1" }).success).toBe(
      false,
    );
  });

  it("payment method create requires code, label and drawer_name", () => {
    const { drawer_name: _omit, ...noDrawer } = paymentMethodCreate;
    expect(createPaymentMethodSchema.safeParse(noDrawer).success).toBe(false);
    expect(
      createPaymentMethodSchema.safeParse({ ...paymentMethodCreate, label: "" })
        .success,
    ).toBe(false);
  });

  it("drawer top-up: amounts default to 0, a negative amount is refused, at least one amount must be positive", () => {
    expect(drawerTopUpCreateSchema.parse({ amount_lbp: 100000 })).toEqual({
      amount_usd: 0,
      amount_lbp: 100000,
    });
    expect(
      drawerTopUpCreateSchema.safeParse({ amount_usd: -50, amount_lbp: 100000 })
        .success,
    ).toBe(false);
    expect(drawerTopUpCreateSchema.safeParse({}).success).toBe(false);
    // An extra currency alone is enough.
    expect(
      drawerTopUpCreateSchema.safeParse({
        extra_currencies: [{ currency_code: "EUR", amount: 5 }],
      }).success,
    ).toBe(true);
  });

  it("drawer top-up refuses the same extra currency twice (case-insensitive)", () => {
    expect(
      drawerTopUpCreateSchema.safeParse({
        extra_currencies: [
          { currency_code: "EUR", amount: 5 },
          { currency_code: "eur", amount: 6 },
        ],
      }).success,
    ).toBe(false);
  });

  it("from-drawer top-up requires a source drawer and refuses negative / all-zero amounts", () => {
    expect(
      drawerTopUpFromDrawerSchema.safeParse({ amount_usd: 5 }).success,
    ).toBe(false);
    expect(
      drawerTopUpFromDrawerSchema.safeParse({
        amount_usd: -5,
        amount_lbp: 450000,
        source_drawer: "MTC",
      }).success,
    ).toBe(false);
    expect(
      drawerTopUpFromDrawerSchema.safeParse({ source_drawer: "MTC" }).success,
    ).toBe(false);
  });
});
