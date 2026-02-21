import {
  MaintenanceRepository,
  MaintenanceJob,
  MaintenancePaymentLine,
} from "../repositories/MaintenanceRepository.js";
import { toErrorString } from "../utils/errors.js";
import { maintenanceLogger } from "../utils/logger.js";

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
  paid_by?: string;
  note?: string | null;
  /** Split-method payment lines (from CheckoutModal) */
  payments?: MaintenancePaymentLine[];
  change_given_usd?: number;
  change_given_lbp?: number;
}

export class MaintenanceService {
  private repo: MaintenanceRepository;

  constructor(repo?: MaintenanceRepository) {
    this.repo = repo ?? new MaintenanceRepository();
  }

  /**
   * Save (create or update) a maintenance job
   */
  saveJob(params: SaveJobParams): {
    success: boolean;
    id?: number;
    error?: string;
  } {
    try {
      return this.repo.withTransaction(() => {
        // Handle client auto-creation if name provided but no ID
        let clientId = params.client_id ?? null;
        if (!clientId && params.client_name) {
          try {
            clientId = this.repo.findOrCreateClient(
              params.client_name,
              params.client_phone,
            );
          } catch (e) {
            maintenanceLogger.error(
              { error: e, clientName: params.client_name },
              "Auto-create client failed",
            );
          }
        }

        const jobData: MaintenanceJob = {
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
          paid_by: params.paid_by ?? "CASH",
          note: params.note ?? null,
        };

        // Determine primary payment method from payment lines
        if (params.payments?.length) {
          // Use the first non-DEBT method as primary paid_by
          const primaryMethod = params.payments.find(
            (p) => p.method !== "DEBT",
          );
          if (primaryMethod) {
            jobData.paid_by = primaryMethod.method;
          }
        }

        const isPaidStatus =
          params.status === "Delivered_Paid" || params.status === "Delivered";

        if (params.id) {
          // Update existing
          this.repo.updateJob(params.id, jobData);

          // Process payments only on first transition to paid status
          if (isPaidStatus && params.payments?.length) {
            if (!this.repo.hasPayments(params.id)) {
              this.repo.processPayments(params.id, params.payments, {
                finalAmount: params.final_amount_usd ?? 0,
                exchangeRate: params.exchange_rate ?? 1,
                clientId: clientId,
                changeUsd: params.change_given_usd,
                changeLbp: params.change_given_lbp,
                note: params.note,
              });
            }
          }

          // Log status change for completion
          if (isPaidStatus) {
            maintenanceLogger.info(
              {
                jobId: params.id,
                device: params.device_name,
                amountUSD: params.final_amount_usd,
                status: params.status,
              },
              `Job ${params.id} completed: ${params.device_name} - $${params.final_amount_usd}`,
            );
          }
          return { success: true, id: params.id };
        } else {
          // Create new
          const newId = this.repo.createJob(jobData);

          // If creating with payment data (checkout from new job form)
          if (isPaidStatus && params.payments?.length) {
            this.repo.processPayments(newId, params.payments, {
              finalAmount: params.final_amount_usd ?? 0,
              exchangeRate: params.exchange_rate ?? 1,
              clientId: clientId,
              changeUsd: params.change_given_usd,
              changeLbp: params.change_given_lbp,
              note: params.note,
            });
          }

          maintenanceLogger.info(
            {
              jobId: newId,
              device: params.device_name,
              priceUSD: params.price_usd,
            },
            `New job: ${params.device_name} - $${params.price_usd}`,
          );
          return { success: true, id: newId };
        }
      });
    } catch (error) {
      maintenanceLogger.error(
        { error, params },
        "MaintenanceService.saveJob error",
      );
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Get all jobs, optionally filtered by status
   */
  getJobs(statusFilter?: string): unknown[] {
    try {
      return this.repo.getJobs(statusFilter);
    } catch (error) {
      maintenanceLogger.error(
        { error, statusFilter },
        "MaintenanceService.getJobs error",
      );
      return [];
    }
  }

  /**
   * Delete a job by ID
   */
  deleteJob(id: number): { success: boolean; error?: string } {
    try {
      this.repo.deleteJob(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: toErrorString(error) };
    }
  }
}

// Singleton instance
let maintenanceServiceInstance: MaintenanceService | null = null;

export function getMaintenanceService(): MaintenanceService {
  if (!maintenanceServiceInstance) {
    maintenanceServiceInstance = new MaintenanceService();
  }
  return maintenanceServiceInstance;
}

export function resetMaintenanceService(): void {
  maintenanceServiceInstance = null;
}
