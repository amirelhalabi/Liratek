export interface SaveJobParams {
    id?: number;
    client_id?: number | null;
    client_name?: string | null;
    client_phone?: string | null;
    device_name: string;
    issue_description?: string | null;
    cost_usd?: number;
    price_usd?: number;
    discount_usd?: number;
    final_amount_usd?: number;
    paid_usd?: number;
    paid_lbp?: number;
    exchange_rate?: number;
    status?: string;
    note?: string | null;
}
export declare class MaintenanceService {
    private repo;
    constructor();
    /**
     * Save (create or update) a maintenance job
     */
    saveJob(params: SaveJobParams): {
        success: boolean;
        id?: number;
        error?: string;
    };
    /**
     * Get all jobs, optionally filtered by status
     */
    getJobs(statusFilter?: string): unknown[];
    /**
     * Delete a job by ID
     */
    deleteJob(id: number): {
        success: boolean;
        error?: string;
    };
}
export declare function getMaintenanceService(): MaintenanceService;
export declare function resetMaintenanceService(): void;
