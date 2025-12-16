import React, { useState, useEffect } from 'react';

export default function Closing() {
    const [step, setStep] = useState(1);
    const [drawerType, setDrawerType] = useState<'General' | 'OMT'>('General');
    const [physicalCount, setPhysicalCount] = useState({
        usd: 0,
        lbp: 0,
        eur: 0,
    });
    // Placeholder for system expected values
    const [systemExpected, setSystemExpected] = useState({
        usd: 0,
        lbp: 0,
        eur: 0,
    });
    const [allSystemExpectedBalances, setAllSystemExpectedBalances] = useState<any | null>(null);

    useEffect(() => {
        const fetchSystemExpectedBalances = async () => {
            try {
                const balances = await window.api.closing.getSystemExpectedBalances();
                setAllSystemExpectedBalances(balances);
                if (drawerType === 'General') {
                    setSystemExpected(balances.generalDrawer);
                } else {
                    setSystemExpected(balances.omtDrawer);
                }
            } catch (error) {
                console.error('Failed to fetch system expected balances:', error);
            }
        };

        fetchSystemExpectedBalances();
    }, [drawerType]); // Refetch when drawerType changes

    const nextStep = () => setStep(prev => prev + 1);
    const prevStep = () => setStep(prev => prev - 1);

    // Placeholder for actual closing logic
    const handleConfirmClosing = async () => {
        const closing_date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const drawer_name = `${drawerType}_Drawer_${drawerType === 'General' ? 'B' : 'A'}`; // Format as General_Drawer_B or OMT_Drawer_A

        // For now, assume opening balance is 0 as it's not tracked yet.
        // In a future enhancement, this would be fetched from the previous closing record.
        const opening_balance_usd = 0;
        const opening_balance_lbp = 0;

        const dataToSend = {
            closing_date,
            drawer_name,
            opening_balance_usd,
            opening_balance_lbp,
            physical_usd: physicalCount.usd,
            physical_lbp: physicalCount.lbp,
            physical_eur: physicalCount.eur,
            system_expected_usd: systemExpected.usd,
            system_expected_lbp: systemExpected.lbp,
            variance_usd: physicalCount.usd - systemExpected.usd,
            notes: `Daily closing for ${drawerType} Drawer on ${closing_date}`, // Add a default note
        };

        try {
            const result = await window.api.closing.createDailyClosing(dataToSend);
            if (result.success) {
                alert('Closing confirmed and saved successfully!');
                setStep(1); // Reset wizard
                setPhysicalCount({ usd: 0, lbp: 0, eur: 0 }); // Clear physical counts
            } else {
                alert('Failed to save closing: ' + result.error);
            }
        } catch (error) {
            console.error('Error confirming closing:', error);
            alert('An unexpected error occurred during closing.');
        }
    };

    return (
        <div className="flex flex-col items-center justify-center p-6 bg-slate-900 rounded-xl border border-slate-700 shadow-lg min-h-[500px]">
            <h1 className="text-2xl font-bold text-white mb-6">End-of-Day Closing Shift Wizard</h1>

            {step === 1 && (
                <div className="space-y-4">
                    <h2 className="text-xl text-violet-400">Step 1: Select Drawer</h2>
                    <p className="text-slate-300">Which drawer are you closing today?</p>
                    <div className="flex gap-4">
                        <button
                            onClick={() => setDrawerType('General')}
                            className={`px-6 py-3 rounded-lg font-semibold ${drawerType === 'General' ? 'bg-violet-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-violet-500 hover:text-white'}`}
                        >
                            General Drawer
                        </button>
                        <button
                            onClick={() => setDrawerType('OMT')}
                            className={`px-6 py-3 rounded-lg font-semibold ${drawerType === 'OMT' ? 'bg-violet-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-violet-500 hover:text-white'}`}
                        >
                            OMT Drawer
                        </button>
                    </div>
                    <button onClick={nextStep} className="mt-6 px-6 py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-500">
                        Next
                    </button>
                </div>
            )}

            {step === 2 && (
                <div className="space-y-4">
                    <h2 className="text-xl text-violet-400">Step 2: Enter Physical Count ({drawerType} Drawer)</h2>
                    <p className="text-slate-300">Enter the physical cash count for each currency.</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2">USD</label>
                            <input
                                type="number"
                                value={physicalCount.usd}
                                onChange={(e) => setPhysicalCount({ ...physicalCount, usd: parseFloat(e.target.value) || 0 })}
                                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-white"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2">LBP</label>
                            <input
                                type="number"
                                value={physicalCount.lbp}
                                onChange={(e) => setPhysicalCount({ ...physicalCount, lbp: parseFloat(e.target.value) || 0 })}
                                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-white"
                            />
                        </div>
                        {/* EUR input only if Exchange is active (future implementation check) */}
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2">EUR</label>
                            <input
                                type="number"
                                value={physicalCount.eur}
                                onChange={(e) => setPhysicalCount({ ...physicalCount, eur: parseFloat(e.target.value) || 0 })}
                                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-white"
                            />
                        </div>
                    </div>
                    <div className="flex gap-4 mt-6">
                        <button onClick={prevStep} className="px-6 py-3 bg-slate-700 text-slate-300 rounded-lg font-bold hover:bg-slate-600">
                            Back
                        </button>
                        <button onClick={nextStep} className="px-6 py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-500">
                            Next
                        </button>
                    </div>
                </div>
            )}

            {step === 3 && (
                <div className="space-y-4">
                    <h2 className="text-xl text-violet-400">Step 3: Variance Overview</h2>
                    <p className="text-slate-300">Compare physical count with system's expected values.</p>
                    <div className="grid grid-cols-2 gap-4 text-slate-200">
                        <div>
                            <p className="font-semibold">Currency</p>
                            <p>USD:</p>
                            <p>LBP:</p>
                            <p>EUR:</p>
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
                            <p className={`${(physicalCount.usd - systemExpected.usd) !== 0 ? 'text-red-400' : 'text-emerald-400'}`}>${(physicalCount.usd - systemExpected.usd).toFixed(2)}</p>
                            <p className={`${(physicalCount.lbp - systemExpected.lbp) !== 0 ? 'text-red-400' : 'text-emerald-400'}`}>{(physicalCount.lbp - systemExpected.lbp).toLocaleString()} LBP</p>
                            <p className={`${(physicalCount.eur - systemExpected.eur) !== 0 ? 'text-red-400' : 'text-emerald-400'}`}>€{(physicalCount.eur - systemExpected.eur).toFixed(2)}</p>
                        </div>
                    </div>
                    <div className="flex gap-4 mt-6">
                        <button onClick={prevStep} className="px-6 py-3 bg-slate-700 text-slate-300 rounded-lg font-bold hover:bg-slate-600">
                            Back
                        </button>
                        <button onClick={nextStep} className="px-6 py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-500">
                            Next
                        </button>
                    </div>
                </div>
            )}

            {step === 4 && (
                <div className="space-y-4">
                    <h2 className="text-xl text-violet-400">Step 4: Review & Confirm</h2>
                    <p className="text-slate-300">Please review the closing details before confirming.</p>
                    <div className="text-slate-200 space-y-2">
                        <p><span className="font-semibold">Drawer Selected:</span> {drawerType} Drawer</p>
                        <p><span className="font-semibold">Physical USD:</span> ${physicalCount.usd.toFixed(2)}</p>
                        <p><span className="font-semibold">Physical LBP:</span> {physicalCount.lbp.toLocaleString()} LBP</p>
                        <p><span className="font-semibold">Physical EUR:</span> €{physicalCount.eur.toFixed(2)}</p>
                        <p><span className="font-semibold">Variance USD:</span> ${(physicalCount.usd - systemExpected.usd).toFixed(2)}</p>
                        <p><span className="font-semibold">Variance LBP:</span> {(physicalCount.lbp - systemExpected.lbp).toLocaleString()} LBP</p>
                        <p><span className="font-semibold">Variance EUR:</span> €{(physicalCount.eur - systemExpected.eur).toFixed(2)}</p>
                    </div>
                    <div className="flex gap-4 mt-6">
                        <button onClick={prevStep} className="px-6 py-3 bg-slate-700 text-slate-300 rounded-lg font-bold hover:bg-slate-600">
                            Back
                        </button>
                        <button onClick={handleConfirmClosing} className="px-6 py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-500">
                            Confirm Closing
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}


