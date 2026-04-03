/**
 * Loto Service
 *
 * Business logic for the Loto module.
 */
import { getLotoRepository } from "../repositories/LotoRepository.js";
import { lotoLogger } from "../utils/logger.js";
export class LotoService {
  repo;
  constructor(repo) {
    this.repo = repo;
  }
  // ===========================================================================
  // Ticket Operations
  // ===========================================================================
  /**
   * Sell a loto ticket
   * Commission is auto-calculated if not provided
   */
  sellTicket(data) {
    try {
      // Calculate commission if not provided
      const commission_rate = data.commission_rate ?? this.getCommissionRate();
      const commission_amount = data.sale_amount * commission_rate;
      const ticketData = {
        ticket_number: data.ticket_number,
        sale_amount: data.sale_amount,
        commission_rate,
        commission_amount,
        is_winner: data.is_winner ? 1 : 0,
        prize_amount: data.prize_amount || 0,
        sale_date: data.sale_date || new Date().toISOString().split("T")[0],
        payment_method: data.payment_method,
        currency: data.currency || "LBP",
        note: data.note,
      };
      const ticket = this.repo.createTicket(ticketData);
      lotoLogger.info(
        `Loto ticket sold: ${ticket.id}, Amount: ${ticket.sale_amount}, Commission: ${ticket.commission_amount}`,
      );
      return ticket;
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.sellTicket failed",
      );
      throw error;
    }
  }
  /**
   * Mark a ticket as winner and set prize amount
   */
  markWinner(id, prizeAmount) {
    try {
      const ticket = this.repo.updateTicket(id, {
        is_winner: 1,
        prize_amount: prizeAmount,
      });
      if (!ticket) {
        throw new Error(`Ticket ${id} not found`);
      }
      lotoLogger.info(
        `Loto ticket ${id} marked as winner, Prize: ${prizeAmount}`,
      );
      return ticket;
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.markWinner failed",
      );
      throw error;
    }
  }
  /**
   * Record prize payment date
   */
  payPrize(id) {
    try {
      const paidDate = new Date().toISOString();
      const ticket = this.repo.updateTicket(id, {
        prize_paid_date: paidDate,
      });
      if (!ticket) {
        throw new Error(`Ticket ${id} not found`);
      }
      lotoLogger.info(`Loto prize paid for ticket ${id} on ${paidDate}`);
      return ticket;
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.payPrize failed",
      );
      throw error;
    }
  }
  /**
   * Get ticket by ID
   */
  getTicket(id) {
    try {
      return this.repo.getTicketById(id);
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.getTicket failed",
      );
      throw error;
    }
  }
  /**
   * Get tickets by date range
   */
  getTicketsByDateRange(from, to) {
    try {
      return this.repo.getTicketsByDateRange(from, to);
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.getTicketsByDateRange failed",
      );
      throw error;
    }
  }
  // ===========================================================================
  // Settlement Calculation
  // ===========================================================================
  /**
   * Calculate settlement between shop and supplier
   *
   * Business logic:
   * - Shop pays supplier: all collected sales + monthly fees
   * - Supplier pays shop: commission + prizes paid to customers
   * - Net = (commission + prizes) - (sales + fees)
   *   - Positive: shop owes supplier
   *   - Negative: supplier owes shop
   */
  calculateSettlement(from, to) {
    try {
      const totalSales = this.repo.getTotalSales(from, to);
      const totalFees = this.repo.getTotalFees(from, to);
      const totalCommission = this.repo.getTotalCommission(from, to);
      const totalPrizes = this.repo.getTotalPrizes(from, to);
      const shopPaysSupplier = totalSales + totalFees;
      const supplierPaysShop = totalCommission + totalPrizes;
      const netSettlement = supplierPaysShop - shopPaysSupplier;
      return {
        totalSales,
        totalFees,
        totalCommission,
        totalPrizes,
        shopPaysSupplier,
        supplierPaysShop,
        netSettlement,
      };
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.calculateSettlement failed",
      );
      throw error;
    }
  }
  // ===========================================================================
  // Monthly Fees
  // ===========================================================================
  /**
   * Record monthly fee
   */
  recordMonthlyFee(data) {
    try {
      const feeData = {
        fee_amount: data.fee_amount,
        fee_month: data.fee_month,
        fee_year: data.fee_year,
        recorded_date: data.recorded_date || new Date().toISOString(),
        is_paid: 0,
        note: data.note,
      };
      const fee = this.repo.createMonthlyFee(feeData);
      lotoLogger.info(
        `Loto monthly fee recorded: ${fee.id}, Amount: ${fee.fee_amount}`,
      );
      return fee;
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.recordMonthlyFee failed",
      );
      throw error;
    }
  }
  /**
   * Get monthly fees for a year
   */
  getMonthlyFees(year) {
    try {
      return this.repo.getMonthlyFeesByYear(year);
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.getMonthlyFees failed",
      );
      throw error;
    }
  }
  /**
   * Mark monthly fee as paid
   */
  markFeePaid(id) {
    try {
      const paidDate = new Date().toISOString();
      const fee = this.repo.markFeePaid(id, paidDate);
      if (!fee) {
        throw new Error(`Fee ${id} not found`);
      }
      lotoLogger.info(`Loto fee ${id} marked as paid on ${paidDate}`);
      return fee;
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.markFeePaid failed",
      );
      throw error;
    }
  }
  // ===========================================================================
  // Settings
  // ===========================================================================
  /**
   * Get commission rate from settings
   */
  getCommissionRate() {
    try {
      const settings = this.repo.getSettings();
      const rate = settings.get("commission_rate");
      return rate ? parseFloat(rate) : 0.0445;
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.getCommissionRate failed",
      );
      return 0.0445;
    }
  }
  /**
   * Get monthly fee amount from settings
   */
  getMonthlyFeeAmount() {
    try {
      const settings = this.repo.getSettings();
      const amount = settings.get("monthly_fee_amount");
      return amount ? parseFloat(amount) : 1400000;
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.getMonthlyFeeAmount failed",
      );
      return 1400000;
    }
  }
  /**
   * Check if auto-record is enabled
   */
  isAutoRecordEnabled() {
    try {
      const settings = this.repo.getSettings();
      const enabled = settings.get("auto_record_monthly_fee");
      return enabled !== "0";
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.isAutoRecordEnabled failed",
      );
      return true;
    }
  }
  /**
   * Update setting
   */
  updateSetting(key, value) {
    try {
      const setting = this.repo.updateSetting(key, value);
      lotoLogger.info(`Loto setting updated: ${key} = ${value}`);
      return setting;
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.updateSetting failed",
      );
      throw error;
    }
  }
  /**
   * Get all settings
   */
  getSettings() {
    try {
      return this.repo.getSettings();
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.getSettings failed",
      );
      return new Map();
    }
  }
  // ===========================================================================
  // Reports
  // ===========================================================================
  /**
   * Get report data for date range
   */
  getReportData(from, to) {
    try {
      return this.repo.getReportData(from, to);
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.getReportData failed",
      );
      throw error;
    }
  }
  /**
   * Check and record monthly fee if it's the first Monday of the month
   * Call this on app startup
   */
  checkAndRecordMonthlyFee() {
    try {
      if (!this.isAutoRecordEnabled()) {
        return { recorded: false };
      }
      const today = new Date();
      const isMonday = today.getDay() === 1;
      const isFirstWeek = today.getDate() <= 7;
      if (!isMonday || !isFirstWeek) {
        return { recorded: false };
      }
      // Check if already recorded for this month
      const existingFees = this.getMonthlyFees(today.getFullYear());
      const currentMonth = (today.getMonth() + 1).toString().padStart(2, "0");
      const alreadyRecorded = existingFees.some(
        (f) => f.fee_month === currentMonth,
      );
      if (alreadyRecorded) {
        return { recorded: false };
      }
      // Record the fee
      const feeAmount = this.getMonthlyFeeAmount();
      const fee = this.recordMonthlyFee({
        fee_amount: feeAmount,
        fee_month: currentMonth,
        fee_year: today.getFullYear(),
        note: "Auto-recorded on first Monday",
      });
      return { recorded: true, fee };
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.checkAndRecordMonthlyFee failed",
      );
      return { recorded: false };
    }
  }
}
export default LotoService;
// =============================================================================
// Singleton Instance
// =============================================================================
let lotoServiceInstance = null;
export function getLotoService() {
  if (!lotoServiceInstance) {
    const repo = getLotoRepository();
    lotoServiceInstance = new LotoService(repo);
  }
  return lotoServiceInstance;
}
/** Reset the singleton (for testing) */
export function resetLotoService() {
  lotoServiceInstance = null;
}
