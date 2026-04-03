import { useState, useEffect, useCallback, useRef } from "react";
import logger from "@/utils/logger";
import { FileText, X, ShoppingCart, Trash2 } from "lucide-react";
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
  // Store checkout modal state for edit flow
  const [pendingCheckoutData, setPendingCheckoutData] =
    useState<CheckoutDraftData | null>(null);

  // Minimized orders state
  type MinimizedOrder = {
    id: string;
    cartItems: CartItem[];
    checkoutData: CheckoutDraftData;
    draftId?: number | undefined;
    createdAt: string;
  };
  const [minimizedOrders, setMinimizedOrders] = useState<MinimizedOrder[]>(
    () => {
      try {
        const stored = localStorage.getItem("pos_minimized_orders");
        if (stored) {
          return JSON.parse(stored);
        }
      } catch (error) {
        logger.error("Failed to load minimized orders:", error);
      }
      return [];
    },
  );
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialMountRef = useRef(true);

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
    setCurrentDraftId(undefined);
    setShowClearConfirm(false);
  }, []);

  // Minimize current order
  const handleMinimizeOrder = useCallback(
    (checkoutData: CheckoutDraftData) => {
      if (cartItems.length === 0) return;

      const orderId = `order-${Date.now()}`;

      const minimizedOrder: MinimizedOrder = {
        id: orderId,
        cartItems: [...cartItems],
        checkoutData: checkoutData,
        draftId: currentDraftId,
        createdAt: new Date().toISOString(),
      };

      setMinimizedOrders((prev) => [...prev, minimizedOrder]);
      setIsCheckoutOpen(false);
      setCartItems([]);
      setCurrentDraftId(undefined);
      setPendingCheckoutData(null);
    },
    [cartItems, currentDraftId],
  );

  // Restore minimized order
  const handleRestoreOrder = useCallback(
    (orderId: string) => {
      const order = minimizedOrders.find((o) => o.id === orderId);
      if (!order) return;

      setCartItems(order.cartItems);
      setPendingCheckoutData(order.checkoutData);
      setCurrentDraftId(order.draftId);
      setIsCheckoutOpen(true);

      // Remove from minimized orders
      setMinimizedOrders((prev) => prev.filter((o) => o.id !== orderId));
    },
    [minimizedOrders],
  );

  // Cancel order (from checkout modal)
  const handleCancelOrder = useCallback(async () => {
    if (currentDraftId) {
      try {
        await api.deleteDraft(currentDraftId);
        await fetchDrafts();
      } catch (error) {
        logger.error("Failed to delete draft on cancel:", error);
      }
    }
    setIsCheckoutOpen(false);
    setCartItems([]);
    setCurrentDraftId(undefined);
    setPendingCheckoutData(null);
  }, [currentDraftId, api, fetchDrafts]);

  // Cancel minimized order
  const handleCancelMinimizedOrder = useCallback(
    async (orderId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const order = minimizedOrders.find((o) => o.id === orderId);
      if (!order) return;

      if (order.draftId) {
        try {
          await api.deleteDraft(order.draftId);
          await fetchDrafts();
        } catch (error) {
          logger.error("Failed to delete draft on cancel:", error);
        }
      }

      setMinimizedOrders((prev) => prev.filter((o) => o.id !== orderId));
    },
    [minimizedOrders, api, fetchDrafts],
  );

  // Delete draft from history modal
  const handleDeleteDraft = useCallback(
    async (draftId: number) => {
      try {
        await api.deleteDraft(draftId);
        await fetchDrafts();
        appEvents.emit("notification:show", "Draft deleted", "success");
      } catch (error) {
        logger.error("Failed to delete draft:", error);
        appEvents.emit("notification:show", "Failed to delete draft", "error");
      }
    },
    [api, fetchDrafts],
  );

  // Persist minimized orders to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        "pos_minimized_orders",
        JSON.stringify(minimizedOrders),
      );
    } catch (error) {
      logger.error("Failed to save minimized orders:", error);
    }
  }, [minimizedOrders]);

  // Auto-save draft when cart changes (for resumed drafts)
  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }

    if (!currentDraftId || cartItems.length === 0) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        const totalAmount = cartItems.reduce(
          (sum, item) => sum + item.retail_price * item.quantity,
          0,
        );
        const discount = pendingCheckoutData?.discount || 0;
        const saleRequest: SaleRequest = {
          status: "draft",
          id: currentDraftId,
          items: cartItems.map((item) => ({
            product_id: item.id,
            quantity: item.quantity,
            price: item.retail_price,
            imei: item.imei || "",
          })),
          total_amount: totalAmount,
          discount,
          final_amount: totalAmount - discount,
          payment_usd: pendingCheckoutData?.paidUSD || 0,
          payment_lbp: pendingCheckoutData?.paidLBP || 0,
          client_id: pendingCheckoutData?.selectedClient?.id || null,
          exchange_rate:
            pendingCheckoutData?.exchangeRate || defaultExchangeRate,
        };

        await api.processSale(saleRequest);
      } catch (error) {
        logger.error("Auto-save draft failed:", error);
      }
    }, 1000);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [
    cartItems,
    currentDraftId,
    pendingCheckoutData,
    api,
    defaultExchangeRate,
  ]);

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

  const handleSaveDraft = async (
    paymentData: PaymentData,
    options?: { clearCart?: boolean; closeModal?: boolean },
  ) => {
    const { clearCart = true, closeModal = true } = options || {};
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
        if (closeModal) {
          setIsCheckoutOpen(false);
        }
        if (clearCart) {
          setCartItems([]);
          setCurrentDraftId(undefined);
        }
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

    // Store payment fields for when checkout is opened
    setPendingCheckoutData({
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
    // Don't open checkout modal - let user edit cart first
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

        // Delete draft after successful completion
        if (currentDraftId) {
          try {
            await api.deleteDraft(currentDraftId);
          } catch (err) {
            logger.error("Failed to delete draft after completion:", err);
          }
        }

        setIsCheckoutOpen(false);
        setCartItems([]);
        setCurrentDraftId(undefined);
        setPendingCheckoutData(null);
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
    <div
      className={`h-full overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col gap-6 animate-in fade-in duration-500 ${minimizedOrders.length > 0 ? "pb-32" : ""}`}
    >
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
          onMinimize={handleMinimizeOrder}
          onCancel={handleCancelOrder}
          onEdit={(checkoutData) => {
            setPendingCheckoutData(checkoutData);
            setIsCheckoutOpen(false);
          }}
          onComplete={handleCompleteSale}
          onSaveDraft={handleSaveDraft}
          isDraft={currentDraftId !== undefined}
          {...(pendingCheckoutData ? { draftData: pendingCheckoutData } : {})}
          onRestoreDraftComplete={() => {
            setPendingCheckoutData(null);
          }}
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
                        onClick={() => handleDeleteDraft(draft.id)}
                        className="px-3 py-2 bg-red-600/20 hover:bg-red-600/40 text-red-400 hover:text-red-300 rounded-lg font-medium transition-colors"
                        title="Delete Draft"
                      >
                        <Trash2 size={18} />
                      </button>
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

      {/* Minimized Orders Bar */}
      {minimizedOrders.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-md border-t border-slate-700 shadow-2xl z-40">
          <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto">
            {/* Minimized orders - most recent on the right */}
            {minimizedOrders.map((order, index) => {
              const totalAmount = order.cartItems.reduce(
                (sum, item) => sum + item.retail_price * item.quantity,
                0,
              );
              const itemCount = order.cartItems.reduce(
                (sum, item) => sum + item.quantity,
                0,
              );
              const customerName =
                order.checkoutData.clientSearchInput || "Walk-in Customer";

              return (
                <button
                  key={order.id}
                  onClick={() => handleRestoreOrder(order.id)}
                  className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 hover:border-violet-500 rounded-lg transition-all shrink-0 group min-w-[200px]"
                >
                  <ShoppingCart size={16} className="text-violet-400" />
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-xs font-medium text-white truncate">
                      {customerName}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {itemCount} items • ${totalAmount.toFixed(2)}
                    </div>
                  </div>
                  {index === minimizedOrders.length - 1 && (
                    <div className="w-2 h-2 bg-violet-500 rounded-full animate-pulse" />
                  )}
                  <button
                    onClick={(e) => handleCancelMinimizedOrder(order.id, e)}
                    className="ml-1 p-1 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition-colors"
                    title="Cancel Order"
                  >
                    <Trash2 size={14} />
                  </button>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
