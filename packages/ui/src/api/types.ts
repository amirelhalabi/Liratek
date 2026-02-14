export type ApiUser = {
  id: number;
  username: string;
  role: string;
};

export type ApiResult = {
  success: boolean;
  error?: string;
};

export type ApiMeResult = ApiResult & {
  user?: ApiUser;
};

export type ApiAdapter = {
  login: (
    username: string,
    password: string,
    rememberMe?: boolean,
  ) => Promise<ApiMeResult & { sessionToken?: string }>;
  logout: () => Promise<void>;
  me: () => Promise<ApiMeResult>;

  getClients: (search?: string) => Promise<unknown[]>;
  deleteClient: (id: number) => Promise<ApiResult>;

  getDebtors: () => Promise<unknown[]>;
  getClientDebtHistory: (clientId: number) => Promise<unknown[]>;
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

  getDashboardStats: () => Promise<unknown>;
  getProfitSalesChart: (type: "Sales" | "Profit") => Promise<unknown[]>;
  getTodaysSales: () => Promise<unknown[]>;
  getDrawerBalances: () => Promise<unknown>;
  getInventoryStockStats: () => Promise<unknown>;
  getRechargeStock: () => Promise<unknown>;
  getMonthlyPL: (month: string) => Promise<unknown>;
};
