import { ElectronApiAdapter } from "./ElectronApiAdapter";

/**
 * Singleton adapter instance used by ApiProvider at the app root.
 *
 * Implements the full @liratek/ui ApiAdapter interface by delegating
 * to backendApi.ts functions (which handle ipcOrHttp branching).
 */
export const backendApiAdapter = new ElectronApiAdapter();
