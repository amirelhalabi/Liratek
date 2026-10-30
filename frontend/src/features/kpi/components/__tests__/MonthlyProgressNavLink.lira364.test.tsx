/** @jest-environment jsdom */
/**
 * LIRA-364 — the sidebar's Monthly progress item shows only when the shop's
 * switch is on (the read answers `enabled`).
 *
 * Not proven failing-first: written after the component.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { KpiProgressResponse } from "@liratek/core";
import { MonthlyProgressNavLink } from "../MonthlyProgressNavLink";

const mockGetKpiSnapshots = jest.fn<Promise<KpiProgressResponse>, []>();
const mockApi = { getKpiSnapshots: mockGetKpiSnapshots };

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return { ...actual, useApi: () => mockApi };
});

function renderLink() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MonthlyProgressNavLink isCollapsed={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MonthlyProgressNavLink (LIRA-364)", () => {
  it("shows for a shop with the switch on", async () => {
    mockGetKpiSnapshots.mockResolvedValue({
      success: true,
      enabled: true,
      snapshots: [],
    });
    renderLink();
    expect(await screen.findByTestId("nav-monthly-progress")).toHaveAttribute(
      "href",
      "/monthly-progress",
    );
  });

  it("stays hidden while the switch is off", async () => {
    mockGetKpiSnapshots.mockResolvedValue({
      success: true,
      enabled: false,
      snapshots: [],
    });
    renderLink();
    await waitFor(() => expect(mockGetKpiSnapshots).toHaveBeenCalled());
    expect(screen.queryByTestId("nav-monthly-progress")).toBeNull();
  });

  it("stays hidden when the read fails", async () => {
    mockGetKpiSnapshots.mockResolvedValue({ success: false, error: "x" });
    renderLink();
    await waitFor(() => expect(mockGetKpiSnapshots).toHaveBeenCalled());
    expect(screen.queryByTestId("nav-monthly-progress")).toBeNull();
  });
});
