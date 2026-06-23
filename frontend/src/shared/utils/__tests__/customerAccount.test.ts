import { canChargeToCustomerAccount, hasNewClientInfo } from "@liratek/ui";

describe("canChargeToCustomerAccount", () => {
  it("is true when both name and phone are present", () => {
    expect(
      canChargeToCustomerAccount({ name: "Amir Halabi", phone: "03123456" }),
    ).toBe(true);
  });

  it("is false with a name but no phone (the session-checkout bug)", () => {
    expect(canChargeToCustomerAccount({ name: "Amir Halabi" })).toBe(false);
    expect(canChargeToCustomerAccount({ name: "Amir Halabi", phone: "" })).toBe(
      false,
    );
    expect(
      canChargeToCustomerAccount({ name: "Amir Halabi", phone: "   " }),
    ).toBe(false);
  });

  it("is false with a phone but no name", () => {
    expect(canChargeToCustomerAccount({ phone: "03123456" })).toBe(false);
    expect(canChargeToCustomerAccount({ name: "  ", phone: "03123456" })).toBe(
      false,
    );
  });

  it("is false when nothing is provided", () => {
    expect(canChargeToCustomerAccount({})).toBe(false);
    expect(canChargeToCustomerAccount({ name: null, phone: undefined })).toBe(
      false,
    );
  });

  it("ignores clientId — a client id alone is not enough", () => {
    expect(canChargeToCustomerAccount({ clientId: 42 })).toBe(false);
    expect(
      canChargeToCustomerAccount({ clientId: 42, name: "Amir", phone: "03" }),
    ).toBe(true);
  });
});

describe("hasNewClientInfo", () => {
  it("is true for a brand-new client with name + phone and no clientId", () => {
    expect(hasNewClientInfo({ name: "Amir Halabi", phone: "03123456" })).toBe(
      true,
    );
    expect(
      hasNewClientInfo({ clientId: null, name: "Amir", phone: "03" }),
    ).toBe(true);
  });

  it("is false once an existing client is selected", () => {
    expect(
      hasNewClientInfo({ clientId: 7, name: "Amir", phone: "03123456" }),
    ).toBe(false);
  });

  it("is false when name or phone is missing", () => {
    expect(hasNewClientInfo({ name: "Amir" })).toBe(false);
    expect(hasNewClientInfo({ phone: "03123456" })).toBe(false);
    expect(hasNewClientInfo({})).toBe(false);
  });
});
