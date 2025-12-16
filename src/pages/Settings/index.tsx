import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, X, Lock, Users as UsersIcon } from 'lucide-react';
import UsersManager from './UsersManager';
import Diagnostics from './Diagnostics';
import CurrencyManager from './CurrencyManager';
import RatesManager from './RatesManager';

export default function Settings() {
    const [shopName, setShopName] = useState('');
    const [receiptHeaderText, setReceiptHeaderText] = useState('');
    const [exchangeRate, setExchangeRate] = useState('');
    const [drawerLimitGeneral, setDrawerLimitGeneral] = useState('');
    const [drawerLimitOMT, setDrawerLimitOMT] = useState('');
    const [whatsAppApiKey, setWhatsAppApiKey] = useState(''); // Placeholder for future feature
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        setIsLoading(true);
        try {
            const settings = await window.api.settings.getAll(); // Changed to use new API
            const settingsMap = new Map(settings.map((s: { key_name: string; value: string; }) => [s.key_name, s.value]));

            setShopName((settingsMap.get('shop_name') as string) || '');
            setReceiptHeaderText((settingsMap.get('receipt_header_text') as string) || '');
            setExchangeRate((settingsMap.get('exchange_rate_usd_lbp') as string) || '');
            setDrawerLimitGeneral((settingsMap.get('drawer_limit_general') as string) || '');
            setDrawerLimitOMT((settingsMap.get('drawer_limit_omt') as string) || '');
            setWhatsAppApiKey((settingsMap.get('whatsapp_api_key') as string) || '');
        } catch (error) {
            console.error('Failed to load settings:', error);
            alert('Failed to load settings.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveSettings = async () => {
        setIsSaving(true);
        try {
            // Changed to use new API
            await Promise.all([
                window.api.settings.update('shop_name', shopName),
                window.api.settings.update('receipt_header_text', receiptHeaderText),
                window.api.settings.update('exchange_rate_usd_lbp', exchangeRate),
                window.api.settings.update('drawer_limit_general', drawerLimitGeneral),
                window.api.settings.update('drawer_limit_omt', drawerLimitOMT),
                window.api.settings.update('whatsapp_api_key', whatsAppApiKey),
            ]);
            alert('Settings saved successfully!');
        } catch (error) {
            console.error('Failed to save settings:', error);
            alert('Failed to save settings.');
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[500px] text-slate-400">
                Loading Settings...
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <SettingsIcon className="text-violet-500" />
                Application Settings
            </h1>

            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                <h2 className="text-xl font-semibold text-white mb-4">General Settings</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label htmlFor="shopName" className="block text-sm font-medium text-slate-400 mb-2">Shop Name</label>
                        <input
                            type="text"
                            id="shopName"
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                            value={shopName}
                            onChange={(e) => setShopName(e.target.value)}
                        />
                    </div>
                    <div>
                        <label htmlFor="receiptHeaderText" className="block text-sm font-medium text-slate-400 mb-2">Receipt Header Text</label>
                        <input
                            type="text"
                            id="receiptHeaderText"
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                            value={receiptHeaderText}
                            onChange={(e) => setReceiptHeaderText(e.target.value)}
                        />
                    </div>
                    <div>
                        <label htmlFor="exchangeRate" className="block text-sm font-medium text-slate-400 mb-2">USD to LBP Exchange Rate (1 USD = ? LBP)</label>
                        <input
                            type="number"
                            id="exchangeRate"
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                            value={exchangeRate}
                            onChange={(e) => setExchangeRate(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                <h2 className="text-xl font-semibold text-white mb-4">Drawer Limits</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label htmlFor="drawerLimitGeneral" className="block text-sm font-medium text-slate-400 mb-2">General Drawer Limit (USD)</label>
                        <input
                            type="number"
                            id="drawerLimitGeneral"
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                            value={drawerLimitGeneral}
                            onChange={(e) => setDrawerLimitGeneral(e.target.value)}
                        />
                    </div>
                    <div>
                        <label htmlFor="drawerLimitOMT" className="block text-sm font-medium text-slate-400 mb-2">OMT Drawer Limit (USD)</label>
                        <input
                            type="number"
                            id="drawerLimitOMT"
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                            value={drawerLimitOMT}
                            onChange={(e) => setDrawerLimitOMT(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                <h2 className="text-xl font-semibold text-white mb-4">Exchange Currencies</h2>
                <CurrencyManager />
            </div>

            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                <h2 className="text-xl font-semibold text-white mb-4">Exchange Rates</h2>
                <RatesManager />
            </div>

            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                <h2 className="text-xl font-semibold text-white mb-4">Diagnostics</h2>
                <Diagnostics />
            </div>

            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2"><UsersIcon size={18} /> Users</h2>
                <UsersManager />
            </div>

            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg opacity-50 cursor-not-allowed">
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                    <Lock size={20} className="text-amber-500" />
                    Admin & Integrations (Admin Only - Future)
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label htmlFor="whatsAppApiKey" className="block text-sm font-medium text-slate-500 mb-2">WhatsApp API Key (Placeholder)</label>
                        <input
                            type="text"
                            id="whatsAppApiKey"
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-500"
                            value={whatsAppApiKey}
                            onChange={(e) => setWhatsAppApiKey(e.target.value)}
                            disabled
                        />
                    </div>
                </div>
            </div>

            <div className="flex justify-end gap-3">
                <button
                    onClick={loadSettings}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                >
                    <X size={20} />
                    Cancel
                </button>
                <button
                    onClick={handleSaveSettings}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-6 py-3 rounded-lg font-bold bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-900/20 active:scale-[0.98] transition-all"
                >
                    <Save size={20} />
                    {isSaving ? 'Saving...' : 'Save Settings'}
                </button>
            </div>
        </div>
    );
}
