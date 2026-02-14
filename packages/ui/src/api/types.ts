// =============================================================================
// Core Types (from @liratek/core repositories)
// =============================================================================

export type ApiUser = {
  id: number;
  username: string;
  role: string;
};

export type ClientEntity = {
  id: number;
  full_name: string;
  phone_number: string;
  notes: string | null;
  whatsapp_opt_in: number;
  created_at: string;
};

export type DebtorSummary = {
  id: number;
  full_name: string;
  phone_number: string;
  total_debt: number;
  total_debt_usd: number;
  total_debt_lbp: number;
};

export type DebtLedgerEntity = {
  id: number;
  client_id: number;
  sale_id: number | null;
  transaction_type: string;
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
  created_at: string;
  created_by: number | null;
};

export type DashboardStats = {
  totalSalesUSD: number;
  totalSalesLBP: number;
  cashCollectedUSD: number;
  cashCollectedLBP: number;
  ordersCount: number;
  activeClients: number;
  lowStockCount: number;
};

export type ChartDataPoint = {
  date: string;
  usd?: number;
  lbp?: number;
  profit?: number;
};

export type RecentSale = {
  id: number;
  client_name: string | null;
  paid_usd: number;
  paid_lbp: number;
  created_at: string;
};

export type DrawerBalance = {
  usd: number;
  lbp: number;
};

export type DrawerBalances = {
  generalDrawer: DrawerBalance;
  omtDrawer: DrawerBalance;
};

export type StockStats = {
  totalProducts: number;
  totalValue: number;
  lowStockCount: number;
  outOfStockCount: number;
};

export type VirtualStock = {
  carrier: string;
  denomination: number;
  stock: number;
};

export type MonthlyPL = {
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  profitMargin: number;
};

// =============================================================================
// API Result Types
// =============================================================================

export type ApiResult = {
  success: boolean;
  error?: string;
};

export type ApiMeResult = ApiResult & {
  user?: ApiUser;
};

// =============================================================================
// API Adapter Interface
// =============================================================================

export type ApiAdapter = {
  // Auth
  login: (
    username: string,
    password: string,
    rememberMe?: boolean,
  ) => Promise<ApiMeResult & { sessionToken?: string }>;
  logout: () => Promise<void>;
  me: () => Promise<ApiMeResult>;

  // Clients
  getClients: (search?: string) => Promise<ClientEntity[]>;
  deleteClient: (id: number) => Promise<ApiResult>;

  // Debts
  getDebtors: () => Promise<DebtorSummary[]>;
  getClientDebtHistory: (clientId: number) => Promise<DebtLedgerEntity[]>;
  getClientDebtTotal: (clientId: number) => Promise<number>;
  addRepayment: (payload: {
    client_id: number;
    amount_usd: number;
    amount_lbp: number;
    paid_amount_usd: number;
    paid_amount_lbp: number;
    drawer_name: string;
    note?: string;
    user_id?: number;
  }) => Promise<ApiResult>;

  // Dashboard
  getDashboardStats: () => Promise<DashboardStats>;
  getProfitSalesChart: (type: "Sales" | "Profit") => Promise<ChartDataPoint[]>;
  getTodaysSales: () => Promise<RecentSale[]>;
  getDrawerBalances: () => Promise<DrawerBalances>;
  getInventoryStockStats: () => Promise<StockStats>;
  getRechargeStock: () => Promise<VirtualStock[]>;
  getMonthlyPL: (month: string) => Promise<MonthlyPL>;
};
