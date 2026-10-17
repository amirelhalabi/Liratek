/**
 * LIRA-331 T024: the shared UI components (namespace `ui`) render Arabic when
 * the language is ar, and the same English as before when it is en.
 */
import { render, screen } from "@testing-library/react";
import { AlertTriangle } from "lucide-react";
import { i18n, loadLanguage } from "@/i18n/setup";
import { ConfirmModal } from "../ConfirmModal";
import { DataTable } from "../DataTable";
import PageAlerts from "../PageAlerts";
import TopUpModal from "../TopUpModal";

afterEach(() => i18n.changeLanguage("en"));

const alerts = [
  {
    id: "a",
    icon: AlertTriangle,
    title: "t",
    detail: "d",
    actionLabel: "Review",
    onAction: () => {},
  },
];

function renderAll() {
  render(
    <>
      <ConfirmModal
        isOpen
        title="x"
        message="y"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
      <DataTable<{ id: number }>
        columns={["A"]}
        data={[]}
        renderRow={(r) => <tr key={r.id} />}
      />
      <PageAlerts alerts={alerts} />
      <TopUpModal
        isOpen
        onClose={() => {}}
        onConfirm={() => {}}
        provider="MTC"
        allDrawers={[]}
        destinationDrawer="MTC"
        defaultSourceDrawer="General"
      />
    </>,
  );
}

it("shows the same English text", () => {
  renderAll();
  expect(screen.getByTestId("confirm-modal-confirm-btn")).toHaveTextContent(
    "Confirm",
  );
  expect(screen.getByTestId("data-table-empty")).toHaveTextContent("No data");
  expect(screen.getByTestId("page-alerts-trigger")).toHaveTextContent(
    "1 needs attention",
  );
  expect(screen.getByText("Top Up MTC Drawer")).toBeInTheDocument();
});

it("shows Arabic when the language is ar", async () => {
  await loadLanguage("ar");
  await i18n.changeLanguage("ar");
  renderAll();
  expect(screen.getByTestId("confirm-modal-confirm-btn")).not.toHaveTextContent(
    "Confirm",
  );
  expect(screen.getByTestId("data-table-empty")).toHaveTextContent("لا بيانات");
  expect(screen.getByTestId("page-alerts-trigger")).toHaveTextContent(
    "أمر واحد يحتاج انتباهك",
  );
  expect(screen.getByText("تعبئة صندوق MTC")).toBeInTheDocument();
});
