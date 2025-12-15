import { useState, useEffect } from 'react';
import { X, User, DollarSign } from 'lucide-react';
import { EXCHANGE_RATE } from '../../../config/constants';
import type { Client } from '../../../types';

interface CheckoutModalProps {
    totalAmount: number;
    onClose: () => void;
    onComplete: (paymentData: any) => Promise<void>;
    onSaveDraft: (paymentData: any) => Promise<void>;
}

export default function CheckoutModal({ totalAmount, onClose, onComplete, onSaveDraft }: CheckoutModalProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [clients, setClients] = useState<Client[]>([]);
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [clientSearch, setClientSearch] = useState('');

    // Payment State
    const [discount, setDiscount] = useState(0);
    const [paidUSD, setPaidUSD] = useState(0);
    const [paidLBP, setPaidLBP] = useState(0);
    const [exchangeRate] = useState(EXCHANGE_RATE);

    useEffect(() => {
        // Fetch clients for search
        const fetchClients = async () => {
            const data = await window.api.getClients('');
            setClients(data);
        };
        fetchClients();

        // Use timeout to simulate fetching settings for exchange rate, or valid future implementation
    }, []);

    // Filter clients for dropdown
    const filteredClients = clients.filter(c =>
        c.full_name.toLowerCase().includes(clientSearch.toLowerCase()) ||
        (c.phone_number || '').includes(clientSearch)
    );

    // State for the secondary input (Name or Phone depending on search)
    const [secondaryInput, setSecondaryInput] = useState('');

    // Heuristic: Is the search mainly digits?
    const isSearchPhone = /^\+?[\d\s\-]+$/.test(clientSearch) && clientSearch.length > 0;

    // Derived Label & Placeholder
    const secondaryLabel = isSearchPhone ? "Full Name" : "Phone Number";
    const secondaryPlaceholder = isSearchPhone ? "Enter Full Name..." : "Enter Phone Number...";

    // Change State
    const [changeGivenUSD, setChangeGivenUSD] = useState(0);
    const [changeGivenLBP, setChangeGivenLBP] = useState(0);

    // Validation for Debt
    const isNewClientInfoComplete = !!secondaryInput.trim();

    const finalAmount = Math.max(0, totalAmount - discount);
    const totalPaidInUSD = paidUSD + (paidLBP / exchangeRate);
    const remaining = finalAmount - totalPaidInUSD;
    const change = remaining < 0 ? Math.abs(remaining) : 0;

    const getPaymentData = () => {
        // Determine effective client details
        let finalClientId = (selectedClient?.id && selectedClient.id > 0) ? selectedClient.id : null;
        let finalClientName: string | undefined;
        let finalClientPhone: string | undefined;

        if (selectedClient?.id === 0) {
            finalClientName = selectedClient.full_name;
            finalClientPhone = selectedClient.phone_number;
        }
        else if (!selectedClient && clientSearch.trim()) {
            if (isSearchPhone) {
                finalClientPhone = clientSearch.trim();
                finalClientName = secondaryInput.trim() || `Client ${finalClientPhone}`;
            } else {
                finalClientName = clientSearch.trim();
                finalClientPhone = secondaryInput.trim();
            }
        }

        return {
            client_id: finalClientId,
            client_name: finalClientName,
            client_phone: finalClientPhone,
            total_amount: totalAmount,
            discount: discount,
            final_amount: finalAmount,
            payment_usd: paidUSD,
            payment_lbp: paidLBP,
            change_given_usd: changeGivenUSD,
            change_given_lbp: changeGivenLBP,
            exchange_rate: exchangeRate
        };
    };

    const handleComplete = async () => {
        // Validation: Debt requires a complete profile (either selected client with phone, or new client with both name and phone)
        if (remaining > 0.05) {
            // Check if selected client has a phone number
            if (selectedClient && selectedClient.id > 0) {
                if (!selectedClient.phone_number || selectedClient.phone_number.trim() === '') {
                    alert('Selected client does not have a phone number. Please add a phone number before proceeding with debt.');
                    return;
                }
            } 
            // Check if new client info is complete
            else if (!selectedClient) {
                const hasName = clientSearch.trim().length > 0;
                const hasPhone = secondaryInput.trim().length > 0;
                
                if (!hasName || !hasPhone) {
                    alert('To create a debt, please provide both client name and phone number.');
                    return;
                }
            }
        }

        setIsLoading(true);
        try {
            await onComplete(getPaymentData());
        } catch (error) {
            console.error(error);
            setIsLoading(false);
        }
    };

    const handleSaveDraft = async () => {
        setIsLoading(true);
        try {
            await onSaveDraft(getPaymentData());
        } catch (error) {
            console.error(error);
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-7xl shadow-2xl flex overflow-hidden h-[85vh]">

                {/* Left: Summary & Client */}
                <div className="w-1/2 bg-slate-800 p-8 border-r border-slate-700 flex flex-col">
                    <h2 className="text-2xl font-bold text-white mb-6">Checkout</h2>

                    {/* Client Selector */}
                    <div className="mb-8">
                        <label className="block text-sm font-medium text-slate-400 mb-2">Customer</label>

                        {/* Row 1: Inputs */}
                        <div className="flex gap-2 mb-4">
                            {/* Primary Input (Search) */}
                            <div className="relative flex-1">
                                <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl p-1 focus-within:ring-2 focus-within:ring-violet-600 transition-all">
                                    <div className="p-3 bg-slate-800 rounded-lg text-slate-400">
                                        <User size={20} />
                                    </div>
                                    <input
                                        type="text"
                                        value={clientSearch}
                                        onChange={(e) => {
                                            setClientSearch(e.target.value);
                                            // Reset selection if user types
                                            if (selectedClient && e.target.value !== selectedClient.full_name) {
                                                setSelectedClient(null);
                                            }
                                            setSecondaryInput(''); // Clear secondary input on primary search change
                                        }}
                                        className="bg-transparent border-none text-white w-full px-3 focus:outline-none"
                                        placeholder="Search Name or Phone..."
                                    />
                                    {selectedClient && (
                                        <button onClick={() => { setSelectedClient(null); setClientSearch(''); setSecondaryInput(''); }} className="p-2 text-slate-400 hover:text-white">
                                            <X size={16} />
                                        </button>
                                    )}
                                </div>

                                {/* Dropdown Results */}
                                {clientSearch && !selectedClient && filteredClients.length > 0 && (
                                    <div className="absolute top-full left-0 right-0 mt-2 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-20 max-h-48 overflow-y-auto">
                                        {filteredClients.map(client => (
                                            <button
                                                key={client.id}
                                                onClick={() => { setSelectedClient(client); setClientSearch(client.full_name); }}
                                                className="w-full text-left p-3 hover:bg-slate-700 text-slate-200 border-b border-slate-700/50 last:border-0"
                                            >
                                                <div className="font-medium">{client.full_name}</div>
                                                <div className="text-xs text-slate-500">{client.phone_number}</div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Secondary Input (Dynamic: Name or Phone) */}
                            <div className="w-1/2">
                                <div className={`flex items-center bg-slate-900 border border-slate-700 rounded-xl p-1 focus-within:ring-2 focus-within:ring-violet-600 transition-all h-full ${!clientSearch ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                    <input
                                        type="text"
                                        value={secondaryInput}
                                        onChange={(e) => setSecondaryInput(e.target.value)}
                                        className="bg-transparent border-none text-white w-full px-3 focus:outline-none py-3"
                                        placeholder={secondaryPlaceholder}
                                        disabled={!clientSearch || !!selectedClient}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Helper Text */}
                        {!selectedClient && clientSearch.length > 0 && filteredClients.length === 0 && (
                            <div className="text-xs text-slate-500 mb-4 ml-1">
                                Creating new client. <span className="text-violet-400">Add {secondaryLabel.toLowerCase()} to enable debt.</span>
                            </div>
                        )}

                        {/* Row 2: Order Summary Table (Full Width) */}
                        <div className="w-full bg-slate-900/50 rounded-xl p-4 border border-slate-700/50">
                            <div className="space-y-3">
                                <div className="flex justify-between text-slate-400">
                                    <span>Subtotal</span>
                                    <span>${totalAmount.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between items-center text-slate-400">
                                    <span>Discount</span>
                                    <div className="flex items-center gap-1 w-24">
                                        <span className="text-slate-600">$</span>
                                        <input
                                            type="number"
                                            value={discount}
                                            onChange={e => setDiscount(parseFloat(e.target.value) || 0)}
                                            className="w-full bg-slate-800 border-b border-slate-600 text-right focus:outline-none text-white p-1"
                                        />
                                    </div>
                                </div>
                                <div className="border-t border-slate-700 pt-3 flex justify-between items-center">
                                    <span className="text-lg font-bold text-white">Net Total</span>
                                    <span className="text-2xl font-bold text-violet-400">${finalAmount.toFixed(2)}</span>
                                </div>
                                <div className="text-right text-xs text-slate-500">
                                    ≈ {(finalAmount * exchangeRate).toLocaleString()} LBP
                                </div>
                            </div>
                        </div>

                    </div>
                </div>

                {/* Right: Payment */}
                <div className="w-1/2 p-8 flex flex-col">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="tex-lg font-semibold text-slate-300">Payment Details</h3>
                        <div className="text-xs bg-slate-800 px-3 py-1 rounded-full text-slate-400 font-mono">
                            1 USD = {exchangeRate.toLocaleString()} LBP
                        </div>
                    </div>

                    <div className="space-y-6 flex-1 overflow-y-auto">
                        <div className="flex gap-4">
                            <div className="w-1/4">
                                <label className="flex items-center gap-2 text-sm font-medium text-slate-400 mb-2">
                                    <DollarSign size={16} />
                                    Paid USD
                                </label>
                                <input
                                    type="number"
                                    value={paidUSD || ''}
                                    onChange={(e) => setPaidUSD(parseFloat(e.target.value) || 0)}
                                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-xl font-mono text-white focus:ring-2 focus:ring-emerald-500 transition-all font-bold"
                                    placeholder="0.00"
                                    autoFocus
                                />
                            </div>
                            <div className="w-3/4">
                                <label className="block text-sm font-medium text-slate-400 mb-2">Paid LBP</label>
                                <input
                                    type="number"
                                    value={paidLBP || ''}
                                    onChange={(e) => setPaidLBP(parseFloat(e.target.value) || 0)}
                                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-xl font-mono text-white focus:ring-2 focus:ring-emerald-500 transition-all font-bold"
                                    placeholder="0"
                                />
                            </div>
                        </div>

                        {/* Calculations */}
                        <div className="bg-slate-800/50 rounded-xl p-4 space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-400">Total Paid (Converted)</span>
                                <span className="text-white font-mono">${totalPaidInUSD.toFixed(2)}</span>
                            </div>

                            {remaining > 0.05 ? (
                                <div className="flex justify-between items-center pt-2 border-t border-slate-700">
                                    <span className="text-red-400 font-medium">Remaining (Debt)</span>
                                    <div className="text-right">
                                        <div className="text-red-400 font-bold text-xl">${remaining.toFixed(2)}</div>
                                        <div className="text-xs text-red-500/70">≈ {(remaining * exchangeRate).toLocaleString()} LBP</div>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="flex justify-between items-center pt-2 border-t border-slate-700">
                                        <span className="text-emerald-400 font-medium">Change Due</span>
                                        <div className="text-right">
                                            <div className="text-emerald-400 font-bold text-xl">${change.toFixed(2)}</div>
                                            <div className="text-xs text-emerald-500/70">≈ {(change * exchangeRate).toLocaleString()} LBP</div>
                                        </div>
                                    </div>

                                    {/* Change Given Inputs */}
                                    {change > 0 && (
                                        <div className="mt-4 pt-4 border-t border-slate-700/50 animate-in fade-in slide-in-from-top-2">
                                            <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">Change Given</label>
                                            <div className="flex gap-4 mb-2">
                                                <div className="flex-1">
                                                    <div className="relative">
                                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                                                        <input
                                                            type="number"
                                                            value={changeGivenUSD || ''}
                                                            onChange={(e) => setChangeGivenUSD(parseFloat(e.target.value) || 0)}
                                                            className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-8 pr-3 py-2 text-white focus:outline-none focus:border-violet-500"
                                                            placeholder="USD"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex-1">
                                                    <div className="relative">
                                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">LBP</span>
                                                        <input
                                                            type="number"
                                                            value={changeGivenLBP || ''}
                                                            onChange={(e) => setChangeGivenLBP(parseFloat(e.target.value) || 0)}
                                                            className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-3 pr-10 py-2 text-white focus:outline-none focus:border-violet-500"
                                                            placeholder="LBP"
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Smart Change Logic */}
                                            {(() => {
                                                const totalGiven = changeGivenUSD + (changeGivenLBP / exchangeRate);
                                                const diff = change - totalGiven;
                                                const absDiff = Math.abs(diff);

                                                // Smart Fix Handler
                                                const handleSmartFix = () => {
                                                    const floorUSD = Math.floor(change);
                                                    const fractionUSD = change - floorUSD;
                                                    const rawLBP = fractionUSD * exchangeRate;
                                                    // Round to nearest 5,000 LBP as requested
                                                    const roundedLBP = Math.round(rawLBP / 5000) * 5000;

                                                    setChangeGivenUSD(floorUSD);
                                                    setChangeGivenLBP(roundedLBP);
                                                };

                                                if (diff > 0.05) {
                                                    // Underpaying change (Remaining to give)
                                                    return (
                                                        <div className="text-center text-xs text-red-400 font-medium bg-red-500/10 py-2 rounded flex items-center justify-center gap-2">
                                                            <span>Remaining change to give: ${absDiff.toFixed(2)} ≈ {(absDiff * exchangeRate).toLocaleString()} LBP</span>
                                                            <button
                                                                onClick={handleSmartFix}
                                                                className="px-2 py-0.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded text-[10px] uppercase font-bold tracking-wider transition-colors"
                                                            >
                                                                Fix
                                                            </button>
                                                        </div>
                                                    );
                                                } else if (diff < -0.05) {
                                                    // Overpaying change (Caution)
                                                    return (
                                                        <div className="text-center text-xs text-amber-400 font-medium bg-amber-500/10 py-2 rounded flex items-center justify-center gap-2">
                                                            <span>⚠️ Caution: Returning excess change of ${absDiff.toFixed(2)}</span>
                                                            <button
                                                                onClick={handleSmartFix}
                                                                className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded text-[10px] uppercase font-bold tracking-wider transition-colors"
                                                            >
                                                                Fix
                                                            </button>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            })()}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                    <div className="mt-6 flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-6 py-4 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 transition-colors font-medium"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSaveDraft}
                            disabled={isLoading}
                            className="px-6 py-4 rounded-xl text-violet-300 hover:text-violet-100 hover:bg-violet-900/30 transition-colors font-medium border border-violet-500/30"
                        >
                            Save Draft
                        </button>
                        <button
                            onClick={handleComplete}
                            disabled={isLoading}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-lg shadow-lg shadow-emerald-900/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                        >
                            {isLoading ? 'Processing...' : 'Complete & Print'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
