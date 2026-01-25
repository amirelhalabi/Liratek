import { BaseRepository } from "./BaseRepository.js";
export interface MaintenanceJob {
    id?: number;
    client_id?: number | null;
    client_name?: string | null;
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
    created_at?: string;
    updated_at?: string;
}
interface MaintenanceRow {
    id: number;
    client_id: number | null;
    client_name: string | null;
    device_name: string;
    issue_description: string | null;
    cost_usd: number;
    price_usd: number;
    discount_usd: number;
    final_amount_usd: number;
    paid_usd: number;
    paid_lbp: number;
    exchange_rate: number;
    status: string;
    note: string | null;
    created_at: string;
    updated_at: string;
}
export declare class MaintenanceRepository extends BaseRepository<MaintenanceRow> {
    constructor();
    /**
     * Create a new maintenance job
     */
    createJob(job: MaintenanceJob): number;
    /**
     * Update an existing maintenance job
     */
    updateJob(id: number, job: MaintenanceJob): void;
    /**
     * Get jobs by status filter
     */
    getJobs(statusFilter?: string): MaintenanceRow[];
    /**
     * Delete a job by ID
     */
    deleteJob(id: number): void;
    /**
     * Log activity for a maintenance job
     */
    logActivity(userId: number, action: string, details: Record<string, unknown>): void;
    /**
     * Find or create a client by name
     */
    findOrCreateClient(name: string, phone?: string | null): number;
    /**
     * Execute a function within a transaction
     */
    withTransaction<T>(fn: () => T): T;
}
export {};
