/** @jest-environment jsdom */
/**
 * PageAlerts — the compact popover pill that replaced Dashboard's stacked
 * full-width amber banners (see packages/ui/src/components/ui/PageAlerts.tsx
 * for the "why a popover" rationale). This component is presentation-only
 * (DIP) — it renders whatever `PageAlertItem[]` it's handed and calls the
 * item's own `onAction`, with no knowledge of drawers/checkpoints/carriers.
 *
 * Covers: (a) zero alerts renders nothing, (b) the singular/plural count
 * label on the trigger, (c) clicking a row closes the popover and invokes
 * that row's own `onAction` — following Select.modalStacking.test.tsx's
 * pattern of driving the real headlessui control (fireEvent + findByRole/
 * findByTestId), never reading props.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { AlertTriangle, Wallet } from "lucide-react";
import { PageAlerts } from "@liratek/ui";
import type { PageAlertItem } from "@liratek/ui";

describe("PageAlerts", () => {
  it("renders nothing when there are no alerts", () => {
    const { container } = render(<PageAlerts alerts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the singular count label for exactly one alert", () => {
    const alerts: PageAlertItem[] = [
      {
        id: "one",
        icon: Wallet,
        title: "Starting drawer amounts not set",
        detail: "Set the opening cash for each active drawer.",
        actionLabel: "Set now",
        onAction: jest.fn(),
      },
    ];
    render(<PageAlerts alerts={alerts} />);
    expect(screen.getByText("1 needs attention")).toBeInTheDocument();
  });

  it("shows the plural count label for more than one alert", () => {
    const alerts: PageAlertItem[] = [
      {
        id: "one",
        icon: Wallet,
        title: "Starting drawer amounts not set",
        detail: "Set the opening cash for each active drawer.",
        actionLabel: "Set now",
        onAction: jest.fn(),
      },
      {
        id: "two",
        icon: AlertTriangle,
        title: "Carrier line needs attention",
        detail: "Alfa expires in 3 days.",
        actionLabel: "Review",
        onAction: jest.fn(),
      },
    ];
    render(<PageAlerts alerts={alerts} />);
    expect(screen.getByText("2 need attention")).toBeInTheDocument();
  });

  it("clicking a row closes the popover and calls only that alert's onAction", async () => {
    const onActionOne = jest.fn();
    const onActionTwo = jest.fn();
    const alerts: PageAlertItem[] = [
      {
        id: "one",
        icon: Wallet,
        title: "Starting drawer amounts not set",
        detail: "Set the opening cash for each active drawer.",
        actionLabel: "Set now",
        onAction: onActionOne,
      },
      {
        id: "two",
        icon: AlertTriangle,
        title: "Carrier line needs attention",
        detail: "Alfa expires in 3 days.",
        actionLabel: "Review",
        onAction: onActionTwo,
      },
    ];
    render(<PageAlerts alerts={alerts} />);

    // Open the real headlessui popover via its trigger button.
    fireEvent.click(screen.getByTestId("page-alerts-trigger"));
    const row = await screen.findByTestId("page-alerts-row-two");

    fireEvent.click(row);

    expect(onActionTwo).toHaveBeenCalledTimes(1);
    expect(onActionOne).not.toHaveBeenCalled();

    // The panel closes on row click — its rows are no longer queryable.
    expect(screen.queryByTestId("page-alerts-row-two")).not.toBeInTheDocument();
  });
});
