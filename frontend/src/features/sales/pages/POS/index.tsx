import { useState, useEffect, useCallback } from "react";
import logger from "@/utils/logger";
import { FileText, X, ShoppingCart } from "lucide-react";
import { PageHeader } from "@liratek/ui";
import ProductSearch from "./components/ProductSearch";
import Cart from "./components/Cart";
import CheckoutModal, {
  type PaymentData,
  type CheckoutDraftData,
} from "./components/CheckoutModal";
import ProductForm from "@/features/inventory/pages/Inventory/ProductForm";
import SaleDetailModal from "./components/SaleDetailModal";
import { appEvents, useApi } from "@liratek/ui";
import type { Product, CartItem, SaleRequest } from "@liratek/ui";
import { useExchangeRate } from "@/hooks/useExchangeRate";
import { useSession } from "@/features/sessions/context/SessionContext";
import { ConfirmModal } from "@/shared/components/ConfirmModal";
import { VoiceBotButton } from "@/components/VoiceBotButton";

export default function POS() {
  const api = useApi();
  const { activeSession, linkTransaction } = useSession();
  const { rate: defaultExchangeRate } = useExchangeRate("USD", "LBP");
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  // Sale detail modal state
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null);
  const [refreshSalesKey, setRefreshSalesKey] = useState(0);

  // Create-product-from-POS state
  const [showProductForm, setShowProductForm] = useState(false);
  const [productFormPrefill, setProductFormPrefill] = useState<{
    name?: string;
    barcode?: string;
  }>({});

  // Drafts State
  const [currentDraftId, setCurrentDraftId] = useState<number | undefined>(
    undefined,
  );
  const [isDraftsOpen, setIsDraftsOpen] = useState(false);
  // Confirmation states
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  type DraftItem = {
    product_id: number;
    quantity: number;
    price?: number;
    sold_price_usd?: number;
    name?: string;
    barcode?: string;
    imei?: string;
  };
  type Draft = {
    id: number;
    status: "draft";
    items?: DraftItem[];
    total_amount_usd?: number;
    client_id?: number | null;
    client_name?: string | null;
    client_phone?: string | null;
    created_at?: string;
    exchange_rate_snapshot?: number;
    change_given_usd?: number;
    change_given_lbp?: number;
    discount_usd?: number;
    paid_usd?: number;
    paid_lbp?: number;
  };
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [checkoutDraftData, setCheckoutDraftData] = useState<
    CheckoutDraftData | undefined
  >(undefined);

  const fetchDrafts = useCallback(async () => {
    const data = await api.getDrafts();
    setDrafts(data as unknown as Draft[]);
  }, [api]);

  // Fetch drafts on mount and whenever modal/checkout state changes
  useEffect(() => {
    const t = setTimeout(() => {
      fetchDrafts();
    }, 0);
    return () => clearTimeout(t);
  }, [isCheckoutOpen, isDraftsOpen, fetchDrafts]);

  const handleAddToCart = useCallback((product: Product) => {
    setCartItems((prev) => {
      const existing = prev.find((p) => p.id === product.id);
      if (existing) {
        return prev.map((p) =>
          p.id === product.id
            ? ({ ...p, quantity: (p.quantity || 0) + 1 } as any)
            : p,
        ) as any;
      }
      return [...prev, { ...product, quantity: 1 } as any] as any;
    });
  }, []);

  const handleUpdateQuantity = useCallback((id: number, delta: number) => {
    setCartItems((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          return { ...item, quantity: Math.max(1, item.quantity + delta) };
        }
        return item;
      }),
    );
  }, []);

  const handleRemoveItem = useCallback((id: number) => {
    setCartItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleUpdateIMEI = useCallback((id: number, imei: string) => {
    setCartItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, imei } : item)),
    );
  }, []);

  const handleClearCart = useCallback(() => {
    setCartItems([]);
    setCurrentDraftId(undefined); // Clear active draft
    setShowClearConfirm(false);
  }, []);

  // Open ProductForm from POS with pre-filled name or barcode
  const handleCreateProduct = useCallback(
    (prefill: { name?: string; barcode?: string }) => {
      setProductFormPrefill(prefill);
      setShowProductForm(true);
    },
    [],
  );

  // Called when ProductForm saves successfully — fetch the product, add to cart
  const handleProductCreated = async () => {
    setShowProductForm(false);
    // Find the newly created product by fetching all and taking the latest
    // (createProduct returns { success, id } but ProductForm doesn't expose the id)
    // Instead, re-search with the prefill name/barcode to find it
    try {
      const searchTerm =
        productFormPrefill.barcode || productFormPrefill.name || "";
      const all = (await api.getProducts(searchTerm)) as unknown as Product[];
      if (all.length > 0) {
        // Pick the first match (most likely the just-created product)
        handleAddToCart(all[0]);
      }
    } catch (err) {
      logger.error("Failed to fetch newly created product", err);
    }
    setProductFormPrefill({});
  };

  const handleSaveDraft = async (paymentData: PaymentData) => {
    try {
      const saleRequest: SaleRequest = {
        ...paymentData,
        ...(currentDraftId != null ? { id: currentDraftId } : {}), // Update existing draft if set
        status: "draft",
        items: cartItems.map((item) => ({
          product_id: item.id,
          quantity: item.quantity,
          price: item.retail_price,
          imei: item.imei || "",
        })),
      };

      const result = await api.processSale(saleRequest);

      if (result.success) {
        setIsCheckoutOpen(false);
        setCartItems([]);
        setCurrentDraftId(undefined);
        appEvents.emit(
          "notification:show",
          "Draft saved successfully!",
          "success",
        );
        appEvents.emit("checkout:closed");
        // Windows focus fix
        window.api?.display?.fixFocus();
      } else {
        appEvents.emit(
          "notification:show",
          "Failed to save draft: " + result.error,
          "error",
        );
      }
    } catch (error) {
      logger.error("Save draft error:", error);
      appEvents.emit(
        "notification:show",
        "An unexpected error occurred saving the draft.",
        "error",
      );
    }
  };

  const handleResumeDraft = (draft: Draft) => {
    // Transform draft items back to CartItems
    const items = (draft.items || []).map((item: DraftItem) => ({
      id: item.product_id,
      name: item.name || "",
      barcode: item.barcode || "",
      retail_price: item.sold_price_usd ?? item.price ?? 0,
      quantity: item.quantity,
      category: "",
      cost_price: 0,
      stock_quantity: 0,
      min_stock_level: 0,
      is_active: 1,
      imei: item.imei || "",
    }));

    setCartItems(items);
    setCurrentDraftId(draft.id);

    // Restore payment fields to CheckoutModal
    setCheckoutDraftData({
      selectedClient: (draft.client_id
        ? {
            id: draft.client_id,
            full_name: draft.client_name || "",
            phone_number: draft.client_phone || "",
            whatsapp_opt_in: 0,
          }
        : null) as any,
      clientSearchInput: draft.client_name || "",
      clientSearchSecondary: draft.client_phone || "",
      discount: draft.discount_usd || 0,
      paidUSD: draft.paid_usd || 0,
      paidLBP: draft.paid_lbp || 0,
      changeGivenUSD: draft.change_given_usd || 0,
      changeGivenLBP: draft.change_given_lbp || 0,
      exchangeRate: draft.exchange_rate_snapshot || defaultExchangeRate,
    });

    setIsDraftsOpen(false);
    setIsCheckoutOpen(true);
  };

  const handleCompleteSale = async (paymentData: PaymentData) => {
    try {
      const saleRequest: SaleRequest = {
        ...paymentData,
        ...(currentDraftId != null ? { id: currentDraftId } : {}), // Complete existing draft
        status: "completed",
        items: cartItems.map((item) => ({
          product_id: item.id,
          quantity: item.quantity,
          price: item.retail_price,
          imei: item.imei || "",
        })),
      };

      const result = await api.processSale(saleRequest);

      if (result.success) {
        // Link to active session if exists
        if (activeSession && result.id) {
          try {
            await linkTransaction({
              transactionType: "sale",
              transactionId: result.id,
              amountUsd: saleRequest.final_amount || 0,
              amountLbp: 0, // Sales are tracked in USD
            });
          } catch (err) {
            logger.error("Failed to link sale to session:", err);
            // Don't block the sale completion
          }
        }

        setIsCheckoutOpen(false);
        setCartItems([]);
        setCurrentDraftId(undefined);
        setRefreshSalesKey((k) => k + 1);
        appEvents.emit(
          "notification:show",
          "Sale completed successfully!",
          "success",
        );
        // Emit event to refresh dashboard immediately
        appEvents.emit("sale:completed", result);
        appEvents.emit("checkout:closed");
        // Windows focus fix
        window.api?.display?.fixFocus();
      } else {
        appEvents.emit(
          "notification:show",
          "Sale failed: " + result.error,
          "error",
        );
      }
    } catch (error) {
      logger.error("Checkout error:", error);
      appEvents.emit(
        "notification:show",
        "An unexpected error occurred processing the sale.",
        "error",
      );
    }
  };

  return (
    <div className="h-screen overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col gap-6 animate-in fade-in duration-500">
      <PageHeader icon={ShoppingCart} title="Point of Sale" />

      <div className="flex flex-1 min-h-0 gap-4 overflow-hidden relative">
        {/* Left: Product Selection */}
        <div className="flex-1 min-w-0 h-full">
          <ProductSearch
            onAddToCart={handleAddToCart}
            onCreateProduct={handleCreateProduct}
            onSaleClick={(id) => setSelectedSaleId(id)}
            refreshSalesKey={refreshSalesKey}
          />
        </div>

        {/* Right: Cart */}
        <div className="w-[44rem] flex-shrink-0 h-full">
          <Cart
            items={cartItems}
            onUpdateQuantity={handleUpdateQuantity}
            onRemoveItem={handleRemoveItem}
            onUpdateIMEI={handleUpdateIMEI}
            onClearCart={() => setShowClearConfirm(true)}
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
      </div>

      {isCheckoutOpen && (
        <CheckoutModal
          items={cartItems}
          totalAmount={cartItems.reduce(
            (acc, item) => acc + item.retail_price * item.quantity,
            0,
          )}
          onClose={async () => {
            // If we're editing a resumed draft, delete it on cancel
            if (currentDraftId) {
              try {
                await api.deleteDraft(currentDraftId);
              } catch (err) {
                logger.error("Failed to delete draft on cancel:", err);
              }
            }
            setIsCheckoutOpen(false);
            setCartItems([]);
            setCurrentDraftId(undefined);
            setCheckoutDraftData(undefined);
            appEvents.emit("checkout:closed");
            // Windows focus fix
            window.api?.display?.fixFocus();
          }}
          onComplete={handleCompleteSale}
          onSaveDraft={handleSaveDraft}
          {...(checkoutDraftData ? { draftData: checkoutDraftData } : {})}
          onRestoreDraftComplete={() => setCheckoutDraftData(undefined)}
        />
      )}

      {/* Create Product from POS */}
      {showProductForm && (
        <ProductForm
          onClose={() => {
            setShowProductForm(false);
            setProductFormPrefill({});
          }}
          onSave={handleProductCreated}
          prefillName={productFormPrefill.name}
          prefillBarcode={productFormPrefill.barcode}
        />
      )}

      {/* Drafts Modal */}
      {isDraftsOpen && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setIsDraftsOpen(false);
            }
          }}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            role="presentation"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <FileText className="text-violet-400" />
                Saved Drafts
              </h2>
              <button
                onClick={() => setIsDraftsOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {drafts.length === 0 ? (
                <div className="text-center text-slate-500 py-12">
                  No saved drafts found.
                </div>
              ) : (
                drafts.map((draft) => (
                  <div
                    key={draft.id}
                    className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex justify-between items-center hover:border-violet-500/50 transition-colors group"
                  >
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <span className="font-bold text-white text-lg">
                          ${(draft.total_amount_usd ?? 0).toFixed(2)}
                        </span>
                        {draft.client_name && (
                          <span className="text-sm px-2 py-0.5 bg-slate-700 rounded text-slate-300">
                            {draft.client_name}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500">
                        {draft.created_at
                          ? new Date(draft.created_at).toLocaleString()
                          : "Unknown"}{" "}
                        • {draft.items?.length || 0} Items
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
      {/* Sale Detail Modal */}
      {selectedSaleId !== null && (
        <SaleDetailModal
          saleId={selectedSaleId}
          onClose={() => setSelectedSaleId(null)}
          onRefunded={() => setRefreshSalesKey((k) => k + 1)}
        />
      )}

      {/* Confirmation Modals */}
      <ConfirmModal
        isOpen={showClearConfirm}
        title="Clear Cart"
        message="Are you sure you want to clear all items from the current cart? This action cannot be undone."
        confirmLabel="Clear Cart"
        onConfirm={handleClearCart}
        onCancel={() => setShowClearConfirm(false)}
        variant="danger"
      />

      {/* Voice Bot Button */}
      <VoiceBotButton position="bottom-right" />
    </div>
  );
}
