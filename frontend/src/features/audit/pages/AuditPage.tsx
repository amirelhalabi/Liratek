import { useState } from "react";
import { Shield, ArrowLeftRight } from "lucide-react";
import { PageHeader } from "@liratek/ui";
import AuditLogViewer from "./AuditLogViewer";
import TransactionsViewer from "./TransactionsViewer";

type TabKey = "audit" | "transactions";

export default function AuditPage() {
  const [active, setActive] = useState<TabKey>("audit");

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500">
      <PageHeader icon={Shield} title="Audit & Transactions" />

      <div className="flex-1 min-h-0 bg-slate-800 rounded-xl border border-slate-700 shadow-lg flex flex-col overflow-hidden">
        <div className="flex gap-2 p-2 border-b border-slate-700 shrink-0">
          <button
            onClick={() => setActive("audit")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              active === "audit"
                ? "bg-violet-600 text-white"
                : "text-slate-300 hover:bg-slate-700"
            }`}
          >
            <Shield size={14} />
            Audit Log
          </button>
          <button
            onClick={() => setActive("transactions")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              active === "transactions"
                ? "bg-violet-600 text-white"
                : "text-slate-300 hover:bg-slate-700"
            }`}
          >
            <ArrowLeftRight size={14} />
            Transactions
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-4">
          {active === "audit" && <AuditLogViewer />}
          {active === "transactions" && <TransactionsViewer />}
        </div>
      </div>
    </div>
  );
}
