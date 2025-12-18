import { useState, useEffect } from "react";
import { generateClosingReport } from "../../utils/closingReportGenerator";
import { X } from "lucide-react";
import { appEvents } from "../../../../shared/utils/appEvents";

export default function Closing({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState(1);
  const [drawerType, setDrawerType] = useState<"General" | "OMT">("General");
  const [physicalCount, setPhysicalCount] = useState({
    usd: 0,
    lbp: 0,
    eur: 0,
  });
  // Placeholder for system expected values
  const drawerTypes: Array<"General" | "OMT" | "MTC" | "Alfa"> = [
    "General",
    "OMT",
    "MTC",
    "Alfa",
  ];
  const [currencies, setCurrencies] = useState<
    Array<{ code: string; name: string }>
  >([]);
  const [physicalText, setPhysicalText] = useState<
    Record<string, Record<string, string>>
  >({});
  const setDrawerCurrencyText = (
    drawer: string,
    code: string,
    value: string,
  ) => {
    setPhysicalText((prev) => ({
      ...prev,
      [drawer]: { ...prev[drawer], [code]: value },
    }));
  };

  const [systemExpected, setSystemExpected] = useState({
    usd: 0,
    lbp: 0,
    eur: 0,
  });

  useEffect(() => {
    if (!isOpen) {
      // Reset state when modal is closed
      setStep(1);
      setDrawerType("General");
      setPhysicalCount({ usd: 0, lbp: 0, eur: 0 });
      setSystemExpected({ usd: 0, lbp: 0, eur: 0 });
      return;
    }

    // Load currencies
    const loadCurrencies = async () => {
      try {
        const list = await window.api.currencies.list();
        const active = list
          .filter((c: any) => c.is_active === 1)
          .map((c: any) => ({ code: c.code, name: c.name }));
        setCurrencies(active);
        const init: Record<string, Record<string, string>> = {};
        for (const d of drawerTypes) {
          init[d] = {};
          for (const c of active) init[d][c.code] = "";
        }
        setPhysicalText(init);
      } catch {}
    };

    // Enforce blind count: only fetch expected after entering counts (step >= 3)
    const fetchSystemExpectedBalances = async () => {
      try {
        const balances = await window.api.closing.getSystemExpectedBalances();
        if (drawerType === "General") {
          setSystemExpected(balances.generalDrawer);
        } else {
          setSystemExpected(balances.omtDrawer);
        }
      } catch (error) {
        console.error("Failed to fetch system expected balances:", error);
        // Optionally handle error in UI
      }
    };

    if (step >= 3) {
      fetchSystemExpectedBalances();
    }
    loadCurrencies();
  }, [drawerType, isOpen, step]); // Refetch when drawerType changes and after step 3

  const nextStep = () => setStep((prev) => prev + 1);
  const prevStep = () => setStep((prev) => prev - 1);

  const [varianceNotes, setVarianceNotes] = useState("");

  const handleConfirmClosing = async () => {
    const closing_date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    // Aggregated model now; amounts per drawer/currency are sent below

    try {
      const amountsArray = [] as Array<{
        drawer_name: string;
        currency_code: string;
        physical_amount: number;
      }>;
      for (const d of drawerTypes) {
        for (const c of currencies) {
          const raw = physicalText[d]?.[c.code] ?? "";
          const parsed = raw === "" ? 0 : parseFloat(raw);
          amountsArray.push({
            drawer_name: d,
            currency_code: c.code,
            physical_amount: isNaN(parsed) ? 0 : parsed,
          });
        }
      }
      const result = await window.api.closing.createDailyClosing({
        closing_date,
        amounts: amountsArray,
        variance_notes: varianceNotes,
        report_path: lastReportPath || undefined,
        user_id: (window as any).currentUserId,
      });
      if (result.success) {
        // Try backup after successful save
        try {
          const backup = await window.api.report.backupDatabase();
          console.log("Backup result:", backup);
        } catch (_e) {}
        appEvents.emit("closing:confirmed");
        alert("Closing confirmed and saved successfully!");
        onClose(); // Close modal on success
      } else {
        alert("Failed to save closing: " + result.error);
      }
    } catch (error) {
      console.error("Error confirming closing:", error);
      alert("An unexpected error occurred during closing.");
    }
  };

  const [lastReportPath, setLastReportPath] = useState<string | null>(null);

  const handleGeneratePDFReport = async () => {
    const closing_date = new Date().toISOString().split("T")[0];
    const drawer_name = `${drawerType}_Drawer_${drawerType === "General" ? "B" : "A"}`;
    try {
      const dailyStats = await window.api.closing.getDailyStatsSnapshot();
      const reportData = {
        closing_date,
        drawer_name,
        physical_usd: physicalCount.usd,
        physical_lbp: physicalCount.lbp,
        physical_eur: physicalCount.eur,
        system_expected_usd: systemExpected.usd,
        system_expected_lbp: systemExpected.lbp,
        variance_usd: physicalCount.usd - systemExpected.usd,
        variance_lbp: physicalCount.lbp - systemExpected.lbp,
        variance_eur: physicalCount.eur - systemExpected.eur,
      };
      const reportText = generateClosingReport(reportData, dailyStats);
      const html = `<html><body><pre style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap;">${reportText.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre></body></html>`;
      const result = await window.api.report.generatePDF(
        html,
        `closing_${closing_date}_${drawer_name}.pdf`,
      );
      if (result.success) {
        setLastReportPath(result.path || null);
        alert(`PDF saved to: ${result.path}`);
      } else {
        alert("Failed to generate PDF: " + result.error);
      }
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Failed to generate PDF.");
    }
  };

  const handleGenerateReport = async () => {
    const closing_date = new Date().toISOString().split("T")[0];
    const drawer_name = `${drawerType}_Drawer_${drawerType === "General" ? "B" : "A"}`;

    try {
      const dailyStats = await window.api.closing.getDailyStatsSnapshot();

      const reportData = {
        closing_date,
        drawer_name,
        physical_usd: physicalCount.usd,
        physical_lbp: physicalCount.lbp,
        physical_eur: physicalCount.eur,
        system_expected_usd: systemExpected.usd,
        system_expected_lbp: systemExpected.lbp,
        variance_usd: physicalCount.usd - systemExpected.usd,
        variance_lbp: physicalCount.lbp - systemExpected.lbp,
        variance_eur: physicalCount.eur - systemExpected.eur,
      };

      const report = generateClosingReport(reportData, dailyStats);
      alert("Generated Report:\n" + report);
    } catch (error) {
      console.error("Error generating report:", error);
      alert("Failed to generate report.");
    }
  };

  if (!isOpen) return null; // Don't render anything if not open

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-in fade-in duration-300">
      <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-slate-700">
          <h1 className="text-xl font-bold text-white">
            End-of-Day Closing Shift Wizard
          </h1>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={24} />
          </button>
        </div>
        <div className="p-6 flex-1">
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-xl text-violet-400">Step 1: Select Drawer</h2>
              <p className="text-slate-300">
                Which drawer are you closing today?
              </p>
              <div className="flex gap-4">
                <button
                  onClick={() => setDrawerType("General")}
                  className={`px-6 py-3 rounded-lg font-semibold ${drawerType === "General" ? "bg-violet-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-violet-500 hover:text-white"}`}
                >
                  General Drawer
                </button>
                <button
                  onClick={() => setDrawerType("OMT")}
                  className={`px-6 py-3 rounded-lg font-semibold ${drawerType === "OMT" ? "bg-violet-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-violet-500 hover:text-white"}`}
                >
                  OMT Drawer
                </button>
              </div>
              <button
                onClick={nextStep}
                className="mt-6 px-6 py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-500"
              >
                Next
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-xl text-violet-400">
                Step 2: Enter Physical Count ({drawerType} Drawer)
              </h2>
              <p className="text-slate-300">
                Enter the physical cash count for each currency.
              </p>
              <div className="space-y-4">
                {drawerTypes.map((d) => (
                  <div
                    key={d}
                    className="border border-slate-700 rounded-lg p-3"
                  >
                    <div className="font-semibold text-white mb-2">
                      {d} Drawer
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {currencies.map((c) => (
                        <div key={c.code}>
                          <label className="block text-sm text-slate-400 mb-1">
                            {c.code}
                          </label>
                          <input
                            type="number"
                            value={physicalText[d]?.[c.code] ?? ""}
                            onChange={(e) =>
                              setDrawerCurrencyText(d, c.code, e.target.value)
                            }
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-4 mt-6">
                <button
                  onClick={prevStep}
                  className="px-6 py-3 bg-slate-700 text-slate-300 rounded-lg font-bold hover:bg-slate-600"
                >
                  Back
                </button>
                <button
                  onClick={nextStep}
                  className="px-6 py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-500"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-xl text-violet-400">
                Step 3: Variance Overview
              </h2>
              <p className="text-slate-300">
                Compare physical count with system's expected values.
              </p>
              <div className="space-y-4 text-slate-200">
                <div>
                  <div className="border border-slate-700 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-900 text-slate-400">
                        <tr>
                          <th className="p-2">Currency</th>
                          <th className="p-2">Physical Total</th>
                          <th className="p-2">Expected</th>
                          <th className="p-2">Variance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currencies.map((c) => {
                          const total = drawerTypes.reduce(
                            (sum, d) =>
                              sum +
                              (parseFloat(physicalText[d]?.[c.code] || "0") ||
                                0),
                            0,
                          );
                          const expected =
                            c.code === "USD"
                              ? systemExpected.usd
                              : c.code === "LBP"
                                ? systemExpected.lbp
                                : 0;
                          const variance = total - expected;
                          return (
                            <tr
                              key={c.code}
                              className="border-t border-slate-800"
                            >
                              <td className="p-2">{c.code}</td>
                              <td className="p-2">
                                {c.code === "LBP"
                                  ? total.toLocaleString()
                                  : total.toFixed(2)}
                              </td>
                              <td className="p-2">
                                {c.code === "LBP"
                                  ? expected.toLocaleString()
                                  : expected.toFixed(2)}
                              </td>
                              <td
                                className={`p-2 ${variance !== 0 ? "text-red-400" : "text-emerald-400"}`}
                              >
                                {c.code === "LBP"
                                  ? variance.toLocaleString()
                                  : variance.toFixed(2)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <p className="font-semibold">Physical Count</p>
                  <p>${physicalCount.usd.toFixed(2)}</p>
                  <p>{physicalCount.lbp.toLocaleString()} LBP</p>
                  <p>€{physicalCount.eur.toFixed(2)}</p>
                </div>
                <div>
                  <p className="font-semibold">System Expected</p>
                  <p>${systemExpected.usd.toFixed(2)}</p>
                  <p>{systemExpected.lbp.toLocaleString()} LBP</p>
                  <p>€{systemExpected.eur.toFixed(2)}</p>
                </div>
                <div>
                  <p className="font-semibold">Variance</p>
                  <p
                    className={`${physicalCount.usd - systemExpected.usd !== 0 ? "text-red-400" : "text-emerald-400"}`}
                  >
                    ${(physicalCount.usd - systemExpected.usd).toFixed(2)}
                  </p>
                  <p
                    className={`${physicalCount.lbp - systemExpected.lbp !== 0 ? "text-red-400" : "text-emerald-400"}`}
                  >
                    {(physicalCount.lbp - systemExpected.lbp).toLocaleString()}{" "}
                    LBP
                  </p>
                  <p
                    className={`${physicalCount.eur - systemExpected.eur !== 0 ? "text-red-400" : "text-emerald-400"}`}
                  >
                    €{(physicalCount.eur - systemExpected.eur).toFixed(2)}
                  </p>
                </div>
              </div>
              <div className="flex gap-4 mt-6">
                <button
                  onClick={prevStep}
                  className="px-6 py-3 bg-slate-700 text-slate-300 rounded-lg font-bold hover:bg-slate-600"
                >
                  Back
                </button>
                <button
                  onClick={nextStep}
                  className="px-6 py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-500"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h2 className="text-xl text-violet-400">
                Step 4: Review & Confirm
              </h2>
              <p className="text-slate-300">
                Please review the closing details before confirming.
              </p>
              <div className="text-slate-200 space-y-4">
                <p>
                  <span className="font-semibold">Drawer Selected:</span>{" "}
                  {drawerType} Drawer
                </p>
                <p>
                  <span className="font-semibold">Physical USD:</span> $
                  {physicalCount.usd.toFixed(2)}
                </p>
                <p>
                  <span className="font-semibold">Physical LBP:</span>{" "}
                  {physicalCount.lbp.toLocaleString()} LBP
                </p>
                <p>
                  <span className="font-semibold">Physical EUR:</span> €
                  {physicalCount.eur.toFixed(2)}
                </p>
                <p>
                  <span className="font-semibold">Variance USD:</span> $
                  {(physicalCount.usd - systemExpected.usd).toFixed(2)}
                </p>
                <p>
                  <span className="font-semibold">Variance LBP:</span>{" "}
                  {(physicalCount.lbp - systemExpected.lbp).toLocaleString()}{" "}
                  LBP
                </p>
                <p>
                  <span className="font-semibold">Variance EUR:</span> €
                  {(physicalCount.eur - systemExpected.eur).toFixed(2)}
                </p>
              </div>
              <div className="flex gap-4 mt-6">
                <button
                  onClick={prevStep}
                  className="px-6 py-3 bg-slate-700 text-slate-300 rounded-lg font-bold hover:bg-slate-600"
                >
                  Back
                </button>
                <div className="flex-1">
                  <label className="block text-sm text-slate-400 mb-1">
                    Variance Notes
                  </label>
                  <textarea
                    value={varianceNotes}
                    onChange={(e) => setVarianceNotes(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white min-h-24"
                  />
                </div>
                <button
                  onClick={handleGenerateReport}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-500"
                >
                  Preview Report
                </button>
                <button
                  onClick={handleGeneratePDFReport}
                  className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-500"
                >
                  Save PDF
                </button>
                <button
                  onClick={handleConfirmClosing}
                  className="px-6 py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-500"
                >
                  Confirm Closing
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
