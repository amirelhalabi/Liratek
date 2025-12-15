import { useState, useEffect } from 'react';
import { FileText, X } from 'lucide-react';
import ProductSearch from './components/ProductSearch';
import Cart from './components/Cart';
import CheckoutModal from './components/CheckoutModal';
import type { Product, CartItem, SaleRequest } from '../../types';

export default function POS() {
    const [cartItems, setCartItems] = useState<CartItem[]>([]);
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

    // Drafts State
    const [currentDraftId, setCurrentDraftId] = useState<number | undefined>(undefined);
    const [isDraftsOpen, setIsDraftsOpen] = useState(false);
    const [drafts, setDrafts] = useState<any[]>([]);

    const fetchDrafts = async () => {
        const data = await window.api.getDrafts();
        setDrafts(data);
    };

    // Fetch drafts on mount and whenever modal/checkout state changes
    useEffect(() => {
        fetchDrafts();
    }, [isCheckoutOpen, isDraftsOpen]);

    const handleAddToCart = (product: Product) => {
        setCartItems(prev => {
            const existing = prev.find(p => p.id === product.id);
            if (existing) {
                return prev.map(p => p.id === product.id ? { ...p, quantity: p.quantity + 1 } : p);
            }
            return [...prev, { ...product, quantity: 1 }];
        });
    };

    const handleUpdateQuantity = (id: number, delta: number) => {
        setCartItems(prev => prev.map(item => {
            if (item.id === id) {
                return { ...item, quantity: Math.max(1, item.quantity + delta) };
            }
            return item;
        }));
    };

    const handleRemoveItem = (id: number) => {
        setCartItems(prev => prev.filter(item => item.id !== id));
    };

    const handleClearCart = () => {
        if (confirm('Clear current cart?')) {
            setCartItems([]);
            setCurrentDraftId(undefined); // Clear active draft
        }
    };

    const handleSaveDraft = async (paymentData: any) => {
        try {
            const saleRequest: SaleRequest = {
                ...paymentData,
                id: currentDraftId, // Update existing draft if set
                status: 'draft',
                items: cartItems.map(item => ({
                    product_id: item.id,
                    quantity: item.quantity,
                    price: item.retail_price
                }))
            };

            const result = await (window.api as any).processSale(saleRequest);

            if (result.success) {
                setIsCheckoutOpen(false);
                setCartItems([]);
                setCurrentDraftId(undefined);
                alert('Draft saved successfully!');
            } else {
                alert('Failed to save draft: ' + result.error);
            }
        } catch (error) {
            console.error('Save draft error:', error);
            alert('An unexpected error occurred saving the draft.');
        }
    };

    const handleResumeDraft = (draft: any) => {
        // Transform draft items back to CartItems
        const items = draft.items.map((item: any) => ({
            id: item.product_id,
            name: item.name,
            barcode: item.barcode,
            retail_price: item.sold_price_usd,
            quantity: item.quantity
        }));

        setCartItems(items);
        setCurrentDraftId(draft.id);
        setIsDraftsOpen(false);
        setIsCheckoutOpen(true);
    };

    const handleCompleteSale = async (paymentData: any) => {
        try {
            const saleRequest: SaleRequest = {
                ...paymentData,
                id: currentDraftId, // Complete existing draft
                status: 'completed',
                items: cartItems.map(item => ({
                    product_id: item.id,
                    quantity: item.quantity,
                    price: item.retail_price
                }))
            };

            const result = await (window.api as any).processSale(saleRequest);

            if (result.success) {
                setIsCheckoutOpen(false);
                setCartItems([]);
                setCurrentDraftId(undefined);
                // In future: navigate to receipt or show success toast
                alert('Sale completed successfully!');
            } else {
                alert('Sale failed: ' + result.error);
            }
        } catch (error) {
            console.error('Checkout error:', error);
            alert('An unexpected error occurred processing the sale.');
        }
    };

    // ... inside return ...
    return (
        <div className="flex h-[calc(100vh-theme(spacing.16))] gap-4 -m-4 p-4 overflow-hidden relative">

            {/* Left: Product Selection */}
            <div className="flex-1 min-w-0">
                <ProductSearch onAddToCart={handleAddToCart} />
            </div>

            {/* Right: Cart */}
            <div className="w-96 flex-shrink-0">
                <Cart
                    items={cartItems}
                    onUpdateQuantity={handleUpdateQuantity}
                    onRemoveItem={handleRemoveItem}
                    onClearCart={handleClearCart}
                    onCheckout={() => setIsCheckoutOpen(true)}
                    onOpenDrafts={() => setIsDraftsOpen(true)}
                    draftCount={drafts.length}
                />
                {currentDraftId && (
                    <div className="mt-2 text-center">
                        <span className="text-xs font-mono bg-violet-500/20 text-violet-300 px-2 py-1 rounded">
                            Editing Draft #{currentDraftId}
                        </span>
                    </div>
                )}
            </div>

            {isCheckoutOpen && (
                <CheckoutModal
                    totalAmount={cartItems.reduce((acc, item) => acc + (item.retail_price * item.quantity), 0)}
                    onClose={() => setIsCheckoutOpen(false)}
                    onComplete={handleCompleteSale}
                    onSaveDraft={handleSaveDraft}
                />
            )}

            {/* Drafts Modal */}
            {isDraftsOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
                        <div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                <FileText className="text-violet-400" />
                                Saved Drafts
                            </h2>
                            <button onClick={() => setIsDraftsOpen(false)} className="text-slate-400 hover:text-white">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-4">
                            {drafts.length === 0 ? (
                                <div className="text-center text-slate-500 py-12">
                                    No saved drafts found.
                                </div>
                            ) : (
                                drafts.map(draft => (
                                    <div key={draft.id} className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex justify-between items-center hover:border-violet-500/50 transition-colors group">
                                        <div>
                                            <div className="flex items-center gap-3 mb-1">
                                                <span className="font-bold text-white text-lg">
                                                    ${draft.total_amount_usd.toFixed(2)}
                                                </span>
                                                {draft.client_name && (
                                                    <span className="text-sm px-2 py-0.5 bg-slate-700 rounded text-slate-300">
                                                        {draft.client_name}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-xs text-slate-500">
                                                {new Date(draft.created_at).toLocaleString()} • {draft.items?.length || 0} Items
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleResumeDraft(draft)}
                                                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg font-medium shadow-lg shadow-violet-900/20"
                                            >
                                                Resume
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
