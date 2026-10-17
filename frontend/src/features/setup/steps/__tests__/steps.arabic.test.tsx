/** @jest-environment jsdom */
/**
 * LIRA-331: the wizard steps render their labels from the `setup` catalog, so
 * they show Arabic when the language is ar. Data typed by the operator (the
 * shop name) and brand names stay as they are.
 */
import { render, screen } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import Step1Account from "../Step1Account";
import StepBaseSystem from "../StepBaseSystem";
import StepComplete from "../StepComplete";
import StepDetect from "../StepDetect";

const mockPayload = {
  shop_name: "Abou Ali Phones",
  admin_username: "admin",
  admin_password: "",
  base_system: "OMT",
  enabled_modules: ["pos", "inventory"],
  enabled_payment_methods: ["CASH"],
  session_management_enabled: true,
  customer_sessions_enabled: false,
  active_currencies: ["USD", "LBP"],
  extra_users: [],
  whatsapp_phone: "",
  whatsapp_api_key: "",
  drawer_amounts: [{ drawer_name: "General", currency_code: "USD", amount: 5 }],
  carrier_lines: [{ carrier: "mtc", phone_number: "03123456" }],
};
const mockSetup = {
  payload: mockPayload,
  updatePayload: jest.fn(),
  setStep: jest.fn(),
  resetWizard: jest.fn(),
};
jest.mock("../../context/SetupContext", () => ({
  useSetup: () => mockSetup,
}));

const mockAuth = {
  login: jest.fn(),
  clearSetupRequired: jest.fn(),
  clearFreshSignIn: jest.fn(),
};
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

const mockApi = { completeSetup: jest.fn(), createCheckpoint: jest.fn() };
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

describe("setup steps in Arabic", () => {
  beforeEach(async () => {
    await loadLanguage("ar");
    await i18n.changeLanguage("ar");
  });
  afterEach(() => i18n.changeLanguage("en"));

  it("StepDetect", async () => {
    render(<StepDetect />);
    expect(screen.getByText("أهلاً بك في LiraTek")).toBeInTheDocument();
    expect(await screen.findByText("إعداد محل جديد")).toBeInTheDocument();
  });

  it("Step1Account", () => {
    render(<Step1Account />);
    expect(
      screen.getByText("أعدّ محلك وأنشئ حساب المدير."),
    ).toBeInTheDocument();
    expect(screen.getByText("التالي ←")).toBeInTheDocument();
  });

  it("StepBaseSystem keeps brand names in Latin", () => {
    render(<StepBaseSystem />);
    expect(screen.getByText("اختر نظامك الأساسي")).toBeInTheDocument();
    expect(screen.getByText(/أملك نظام OMT\./)).toBeInTheDocument();
    expect(screen.getByText(/Whish يحتاج إلى شريك\./)).toBeInTheDocument();
  });

  it("StepComplete shows the summary labels in Arabic and the shop name as typed", () => {
    render(<StepComplete />);
    expect(screen.getByText("كل شيء جاهز!")).toBeInTheDocument();
    expect(screen.getByText("Abou Ali Phones")).toBeInTheDocument();
    expect(screen.getByText("1 مُدخلة")).toBeInTheDocument();
    expect(screen.getByText("MTC فقط")).toBeInTheDocument();
    expect(screen.getByText("مفعّل")).toBeInTheDocument();
    expect(screen.getByText("معطّل")).toBeInTheDocument();
  });
});
