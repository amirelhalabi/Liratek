import {
  ActivityService,
  AuthService,
  ClientService,
  ClosingService,
  CurrencyService,
  DebtService,
  ExchangeService,
  ExpenseService,
  FinancialService,
  InventoryService,
  MaintenanceService,
  RateService,
  RechargeService,
  SalesService,
  SettingsService,
  SupplierService,
} from "@liratek/core";

// Re-export all core services/types
export * from "@liratek/core";

// Web-backend convenience singletons (legacy API expects getXService())
let _activity: ActivityService | null = null;
let _auth: AuthService | null = null;
let _client: ClientService | null = null;
let _closing: ClosingService | null = null;
let _currency: CurrencyService | null = null;
let _debt: DebtService | null = null;
let _exchange: ExchangeService | null = null;
let _expense: ExpenseService | null = null;
let _financial: FinancialService | null = null;
let _inventory: InventoryService | null = null;
let _maintenance: MaintenanceService | null = null;
let _rate: RateService | null = null;
let _recharge: RechargeService | null = null;
let _sales: SalesService | null = null;
let _settings: SettingsService | null = null;
let _supplier: SupplierService | null = null;

export function getActivityService(): ActivityService {
  return (_activity ??= new ActivityService());
}
export function getAuthService(): AuthService {
  return (_auth ??= new AuthService());
}
export function getClientService(): ClientService {
  return (_client ??= new ClientService());
}
export function getClosingService(): ClosingService {
  return (_closing ??= new ClosingService());
}
export function getCurrencyService(): CurrencyService {
  return (_currency ??= new CurrencyService());
}
export function getDebtService(): DebtService {
  return (_debt ??= new DebtService());
}
export function getExchangeService(): ExchangeService {
  return (_exchange ??= new ExchangeService());
}
export function getExpenseService(): ExpenseService {
  return (_expense ??= new ExpenseService());
}
export function getFinancialService(): FinancialService {
  return (_financial ??= new FinancialService());
}
export function getInventoryService(): InventoryService {
  return (_inventory ??= new InventoryService());
}
export function getMaintenanceService(): MaintenanceService {
  return (_maintenance ??= new MaintenanceService());
}
export function getRateService(): RateService {
  return (_rate ??= new RateService());
}
export function getRechargeService(): RechargeService {
  return (_recharge ??= new RechargeService());
}
export function getSalesService(): SalesService {
  return (_sales ??= new SalesService());
}
export function getSettingsService(): SettingsService {
  return (_settings ??= new SettingsService());
}
export function getSupplierService(): SupplierService {
  return (_supplier ??= new SupplierService());
}
