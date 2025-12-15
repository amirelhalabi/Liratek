import { Trash2, Plus, Minus, CreditCard, History } from 'lucide-react';
import type { CartItem } from '../../../types';

interface CartProps {
    items: CartItem[];
    onUpdateQuantity: (id: number, delta: number) => void;
    onRemoveItem: (id: number) => void;
    onClearCart: () => void;
    onCheckout: () => void;
    onOpenDrafts: () => void;
    draftCount: number;
}

export default function Cart({ items, onUpdateQuantity, onRemoveItem, onClearCart, onCheckout, onOpenDrafts, draftCount }: CartProps) {
    const totalAmount = items.reduce((sum, item) => sum + (item.retail_price * item.quantity), 0);

    return (
        <div className="flex flex-col h-full bg-slate-800 border-l border-slate-700 w-96 shadow-2xl z-20">
            {/* Header */}
            <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className="w-2 h-6 bg-violet-600 rounded-full"></span>
                    Current Sale
                </h2>

                <div className="flex items-center gap-3">
                    <button
                        onClick={onOpenDrafts}
                        className="relative p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors group"
                        title="View Saved Drafts"
                    >
                        <History size={18} />
                        {draftCount > 0 && (
                            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-[10px] font-bold text-white">
                                {draftCount}
                            </span>
                        )}
                    </button>
                    {items.length > 0 && (
                        <button
                            onClick={onClearCart}
                            className="text-xs text-red-400 hover:text-red-300 transition-colors bg-red-500/10 px-2 py-1 rounded hover:bg-red-500/20"
                        >
                            Clear
                        </button>
                    )}
                </div>
            </div>

            {/* Items List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                {items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-4">
                        <div className="w-16 h-16 rounded-full bg-slate-700/50 flex items-center justify-center">
                            <CreditCard className="opacity-50" size={32} />
                        </div>
                        <p>Cart is empty</p>
                        <p className="text-xs text-slate-600 text-center max-w-[200px]">
                            Scan a barcode or select products to begin a sale.
                        </p>
                    </div>
                ) : (
                    items.map((item) => (
                        <div key={item.id} className="bg-slate-700/30 rounded-xl p-3 border border-slate-700/50 flex gap-3 group hover:bg-slate-700/50 transition-all">
                            <div className="flex-1">
                                <h4 className="font-medium text-slate-200 text-sm line-clamp-1">{item.name}</h4>
                                <div className="text-xs text-slate-500 mt-1">${item.retail_price.toFixed(2)} / unit</div>
                            </div>

                            <div className="flex flex-col items-end gap-2">
                                <div className="font-bold text-violet-400">${(item.retail_price * item.quantity).toFixed(2)}</div>

                                <div className="flex items-center gap-2 bg-slate-800 rounded-lg p-1 border border-slate-700">
                                    <button
                                        onClick={() => onUpdateQuantity(item.id, -1)}
                                        className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white disabled:opacity-30"
                                        disabled={item.quantity <= 1}
                                    >
                                        <Minus size={12} />
                                    </button>
                                    <span className="text-xs font-mono w-4 text-center text-white">{item.quantity}</span>
                                    <button
                                        onClick={() => onUpdateQuantity(item.id, 1)}
                                        className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white"
                                    >
                                        <Plus size={12} />
                                    </button>
                                </div>
                            </div>

                            <button
                                onClick={() => onRemoveItem(item.id)}
                                className="self-center p-2 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all -mr-2"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))
                )}
            </div>

            {/* Footer Summary */}
            <div className="p-4 bg-slate-900 border-t border-slate-700 space-y-4">
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between text-slate-400">
                        <span>Items</span>
                        <span>{items.reduce((acc, i) => acc + i.quantity, 0)}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                        <span>Subtotal</span>
                        <span>${totalAmount.toFixed(2)}</span>
                    </div>
                    {/* Discount logic can be added later */}
                </div>

                <div className="pt-4 border-t border-slate-700">
                    <div className="flex justify-between items-end mb-4">
                        <span className="text-slate-400 mb-1">Total Due</span>
                        <span className="text-3xl font-bold text-emerald-400">${totalAmount.toFixed(2)}</span>
                    </div>

                    <button
                        onClick={onCheckout}
                        disabled={items.length === 0}
                        className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-violet-900/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                    >
                        <CreditCard size={20} />
                        Proceed to Checkout
                    </button>
                </div>
            </div>
        </div>
    );
}
