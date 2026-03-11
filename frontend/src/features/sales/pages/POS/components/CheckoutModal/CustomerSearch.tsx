import { User, X } from "lucide-react";
import type { Client } from "@liratek/ui";

interface CustomerSearchProps {
  clientSearch: string;
  secondaryInput: string;
  selectedClient: Client | null;
  filteredClients: Client[];
  isAutoFilledFromSession: boolean;
  secondaryPlaceholder: string;
  onClientSearchChange: (search: string) => void;
  onSecondaryInputChange: (input: string) => void;
  onClearCustomer: () => void;
  onSelectClient: (client: Client) => void;
}

export function CustomerSearch({
  clientSearch,
  secondaryInput,
  selectedClient,
  filteredClients,
  isAutoFilledFromSession,
  secondaryPlaceholder,
  onClientSearchChange,
  onSecondaryInputChange,
  onClearCustomer,
  onSelectClient,
}: CustomerSearchProps) {
  return (
    <div className="shrink-0">
      <label
        htmlFor="checkout-customer"
        className="block text-sm font-medium text-slate-400 mb-2 uppercase tracking-wider"
      >
        Customer
      </label>
      <div className="grid grid-cols-2 gap-2 mb-2">
        {/* Primary Input (Search) */}
        <div className="relative">
          <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl p-1 focus-within:ring-2 focus-within:ring-violet-600 transition-all h-[52px]">
            <div className="p-3 bg-slate-800 rounded-lg text-slate-400 shrink-0">
              <User size={20} />
            </div>
            <input
              ref={null} // Will be handled by parent hook
              type="text"
              value={clientSearch}
              onChange={(e) => onClientSearchChange(e.target.value)}
              className="bg-transparent border-none text-white w-full px-3 focus:outline-none"
              placeholder="Search Name or Phone..."
            />
            {selectedClient && (
              <button
                onClick={onClearCustomer}
                className="p-2 text-slate-400 hover:text-white shrink-0"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* Dropdown Results */}
          {clientSearch &&
            !selectedClient &&
            !isAutoFilledFromSession &&
            filteredClients.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-20 max-h-48 overflow-y-auto">
                {filteredClients.map((client) => (
                  <button
                    key={client.id}
                    onClick={() => onSelectClient(client)}
                    className="w-full text-left p-3 hover:bg-slate-700 text-slate-200 border-b border-slate-700/50 last:border-0"
                  >
                    <div className="font-medium">{client.full_name}</div>
                    <div className="text-xs text-slate-500">
                      {client.phone_number}
                    </div>
                  </button>
                ))}
              </div>
            )}
        </div>

        {/* Secondary Input */}
        <div>
          <div
            className={`flex items-center bg-slate-900 border border-slate-700 rounded-xl p-1 focus-within:ring-2 focus-within:ring-violet-600 transition-all h-[52px] ${
              !clientSearch ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            <input
              type="text"
              value={secondaryInput}
              onChange={(e) => onSecondaryInputChange(e.target.value)}
              className="bg-transparent border-none text-white w-full px-4 focus:outline-none"
              placeholder={secondaryPlaceholder}
              disabled={!clientSearch || !!selectedClient}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
