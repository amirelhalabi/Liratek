import { MaintenanceRepository, } from "../repositories/MaintenanceRepository.js";
import { toErrorString } from "../utils/errors.js";
export class MaintenanceService {
    repo;
    constructor() {
        this.repo = new MaintenanceRepository();
    }
    /**
     * Save (create or update) a maintenance job
     */
    saveJob(params) {
        try {
            return this.repo.withTransaction(() => {
                // Handle client auto-creation if name provided but no ID
                let clientId = params.client_id ?? null;
                if (!clientId && params.client_name) {
                    try {
                        clientId = this.repo.findOrCreateClient(params.client_name, params.client_phone);
                    }
                    catch (e) {
                        console.error("Auto-create client failed", e);
                    }
                }
                const jobData = {
                    client_id: clientId,
                    client_name: params.client_name ?? null,
                    device_name: params.device_name,
                    issue_description: params.issue_description ?? null,
                    cost_usd: params.cost_usd ?? 0,
                    price_usd: params.price_usd ?? 0,
                    discount_usd: params.discount_usd ?? 0,
                    final_amount_usd: params.final_amount_usd ?? 0,
                    paid_usd: params.paid_usd ?? 0,
                    paid_lbp: params.paid_lbp ?? 0,
                    exchange_rate: params.exchange_rate ?? 0,
                    status: params.status ?? "In Progress",
                    note: params.note ?? null,
                };
                if (params.id) {
                    // Update existing
                    this.repo.updateJob(params.id, jobData);
                    // Log status change for completion
                    if (params.status === "Delivered_Paid" ||
                        params.status === "Delivered") {
                        this.repo.logActivity(1, "Maintenance Job Completed", {
                            drawer: "General_Drawer_B",
                            device: params.device_name,
                            amount_usd: params.final_amount_usd,
                            status: params.status,
                        });
                        console.log(`[MAINTENANCE] Job ${params.id} completed: ${params.device_name} - $${params.final_amount_usd} [Drawer B]`);
                    }
                    return { success: true, id: params.id };
                }
                else {
                    // Create new
                    const newId = this.repo.createJob(jobData);
                    this.repo.logActivity(1, "Maintenance Job Created", {
                        drawer: "General_Drawer_B",
                        device: params.device_name,
                        price_usd: params.price_usd,
                    });
                    console.log(`[MAINTENANCE] New job: ${params.device_name} - $${params.price_usd} [Drawer B]`);
                    return { success: true, id: newId };
                }
            });
        }
        catch (error) {
            console.error("MaintenanceService.saveJob error:", error);
            return { success: false, error: toErrorString(error) };
        }
    }
    /**
     * Get all jobs, optionally filtered by status
     */
    getJobs(statusFilter) {
        try {
            return this.repo.getJobs(statusFilter);
        }
        catch (error) {
            console.error("MaintenanceService.getJobs error:", error);
            return [];
        }
    }
    /**
     * Delete a job by ID
     */
    deleteJob(id) {
        try {
            this.repo.deleteJob(id);
            return { success: true };
        }
        catch (error) {
            return { success: false, error: toErrorString(error) };
        }
    }
}
// Singleton instance
let maintenanceServiceInstance = null;
export function getMaintenanceService() {
    if (!maintenanceServiceInstance) {
        maintenanceServiceInstance = new MaintenanceService();
    }
    return maintenanceServiceInstance;
}
export function resetMaintenanceService() {
    maintenanceServiceInstance = null;
}
