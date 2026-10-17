/** @jest-environment jsdom */
/**
 * LIRA-331 T069: the offline banner and standby screen render in Arabic, and
 * the numbers they carry are unchanged. The useApi mock returns ONE stable
 * object (rule 25).
 */
import { render, screen } from "@testing-library/react";
import type { OfflineStatusView } from "@liratek/core";
import { i18n, loadLanguage } from "@/i18n/setup";

const api = {
  backToWeb: jest.fn(async () => ({ success: true })),
  sendOfflineNow: jest.fn(async () => ({ success: true })),
  openWebApp: jest.fn(async () => ({ success: true })),
  goOffline: jest.fn(async () => ({ success: true })),
  installOfflineUpdate: jest.fn(async () => ({ success: true })),
};
jest.mock("@liratek/ui", () => ({ useApi: () => api }));

import { OfflineBanner } from "../OfflineBanner";
import { StandbyScreen } from "../StandbyScreen";

const STATUS: OfflineStatusView = {
  mode: "offline",
  paired: true,
  deviceNo: 3,
  shopName: "Corner Tech",
  serverReachable: true,
  unreachableSeconds: 0,
  pendingCount: 4,
};

beforeAll(async () => {
  await loadLanguage("ar");
});
afterEach(() => i18n.changeLanguage("en"));

describe("offline screens in Arabic", () => {
  it("banner: Arabic text with the same count", async () => {
    await i18n.changeLanguage("ar");
    render(<OfflineBanner status={STATUS} onChanged={jest.fn()} />);
    expect(screen.getByText(/عاد الإنترنت/)).toBeTruthy();
    expect(screen.getByText(/4 عملية بانتظار الإرسال/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "العودة إلى تطبيق الويب" }),
    ).toBeTruthy();
  });

  it("standby: Arabic labels, shop name shown as stored", async () => {
    await i18n.changeLanguage("ar");
    render(
      <StandbyScreen
        status={{ ...STATUS, mode: "standby", copyAgeSeconds: 180 }}
        onChanged={jest.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Corner Tech" })).toBeTruthy();
    expect(screen.getByText(/هذا الكمبيوتر رقم 3/)).toBeTruthy();
    expect(screen.getByText("عمرها 3 د")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "افتح تطبيق الويب" }),
    ).toBeTruthy();
  });
});
