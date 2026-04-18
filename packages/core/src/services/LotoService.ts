/**
 * Loto Service
 *
 * Business logic for the Loto module.
 * Uses 5 specialized repositories instead of the monolithic LotoRepository.
 */

import {
  LotoTicketRepository,
  getLotoTicketRepository,
} from "../repositories/LotoTicketRepository.js";
import type {
  LotoTicket,
  LotoTicketCreate,
  LotoTicketUpdate,
} from "../repositories/LotoTicketRepository.js";
import {
  LotoSettingsRepository,
  getLotoSettingsRepository,
} from "../repositories/LotoSettingsRepository.js";
import type { LotoSetting } from "../repositories/LotoSettingsRepository.js";
import {
  LotoMonthlyFeeRepository,
  getLotoMonthlyFeeRepository,
} from "../repositories/LotoMonthlyFeeRepository.js";
import type { LotoMonthlyFee } from "../repositories/LotoMonthlyFeeRepository.js";
import {
  LotoCheckpointRepository,
  getLotoCheckpointRepository,
} from "../repositories/LotoCheckpointRepository.js";
import type {
  LotoCheckpoint,
  LotoCheckpointUpdate,
  LotoSettlement,
} from "../repositories/LotoCheckpointRepository.js";
import {
  LotoCashPrizeRepository,
  getLotoCashPrizeRepository,
} from "../repositories/LotoCashPrizeRepository.js";
import type {
  LotoCashPrize,
  LotoCashPrizeCreate,
} from "../repositories/LotoCashPrizeRepository.js";
import type { LotoReportData } from "../repositories/LotoRepository.js";

// Backward compat: also accept the facade
import type { LotoRepository } from "../repositories/LotoRepository.js";
import { getLotoRepository } from "../repositories/LotoRepository.js";

import { lotoLogger } from "../utils/logger.js";

export interface SellTicketData {
  ticket_number?: string;
  sale_amount: number;
  commission_rate?: number;
  is_winner?: boolean;
  prize_amount?: number;
  sale_date?: string;
  payment_method?: string;
  currency?: string;
  note?: string;
  userId: number;
}

export interface SettlementData {
  totalSales: number;
  totalFees: number;
  totalCommission: number;
  totalPrizes: number;
  totalCashPrizes: number;
  /** Amount shop pays to supplier (sales + fees) */
  shopPaysSupplier: number;
  /** Amount supplier pays to shop (commission + prizes + cash prizes) */
  supplierPaysShop: number;
  /** Net amount (positive = shop owes supplier, negative = supplier owes shop) */
  netSettlement: number;
}

export class LotoService {
  private ticketRepo: LotoTicketRepository;
  private settingsRepo: LotoSettingsRepository;
  private monthlyFeeRepo: LotoMonthlyFeeRepository;
  private checkpointRepo: LotoCheckpointRepository;
  private cashPrizeRepo: LotoCashPrizeRepository;

  /**
   * @deprecated backward-compat accessor — use specialized repos instead
   */
  get repo(): LotoRepository {
    return getLotoRepository();
  }

  constructor(
    ticketRepo: LotoTicketRepository,
    settingsRepo: LotoSettingsRepository,
    monthlyFeeRepo: LotoMonthlyFeeRepository,
    checkpointRepo: LotoCheckpointRepository,
    cashPrizeRepo: LotoCashPrizeRepository,
  ) {
    this.ticketRepo = ticketRepo;
    this.settingsRepo = settingsRepo;
    this.monthlyFeeRepo = monthlyFeeRepo;
    this.checkpointRepo = checkpointRepo;
    this.cashPrizeRepo = cashPrizeRepo;
  }

  // ===========================================================================
  // Ticket Operations
  // ===========================================================================

  /**
   * Sell a loto ticket
   * Commission is auto-calculated if not provided
   */
  sellTicket(data: SellTicketData): LotoTicket {
    try {
      // Calculate commission if not provided
      const commission_rate = data.commission_rate ?? this.getCommissionRate();
      const commission_amount = data.sale_amount * commission_rate;

      const ticketData: LotoTicketCreate = {
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
        userId: data.userId,
      };

      const ticket = this.ticketRepo.createTicket(ticketData);
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
  markWinner(id: number, prizeAmount: number): LotoTicket {
    try {
      const ticket = this.ticketRepo.updateTicket(id, {
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
  payPrize(id: number): LotoTicket {
    try {
      const paidDate = new Date().toISOString();
      const ticket = this.ticketRepo.updateTicket(id, {
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
  getTicket(id: number): LotoTicket | null {
    try {
      return this.ticketRepo.getTicketById(id);
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.getTicket failed",
      );
      throw error;
    }
  }

  /**
   * Update a ticket
   */
  updateTicket(id: number, data: LotoTicketUpdate): LotoTicket | null {
    try {
      const ticket = this.ticketRepo.updateTicket(id, data);
      if (ticket) {
        lotoLogger.info(`Loto ticket ${id} updated`);
      }
      return ticket;
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.updateTicket failed",
      );
      throw error;
    }
  }

  /**
   * Get tickets by date range
   */
  getTicketsByDateRange(from: string, to: string): LotoTicket[] {
    try {
      return this.ticketRepo.getTicketsByDateRange(from, to);
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
   * - We collected totalSales from customers
   * - We keep totalCommission as our profit (4.45%)
   * - We owe LOTO: (totalSales - totalCommission) + totalFees
   * - LOTO owes us: totalPrizes + totalCashPrizes (prizes we paid out)
   * - Net = (prizes) - (sales - commission + fees)
   *   - Positive: LOTO owes us (they pay us)
   *   - Negative: We owe LOTO (we pay them)
   */
  calculateSettlement(from: string, to: string): SettlementData {
    try {
      const totalSales = this.ticketRepo.getTotalSales(from, to);
      const totalFees = this.monthlyFeeRepo.getTotalFees(from, to);
      const totalCommission = this.ticketRepo.getTotalCommission(from, to);
      const totalPrizes = this.ticketRepo.getTotalPrizes(from, to);
      const totalCashPrizes = this.cashPrizeRepo.getTotalCashPrizes(from, to);

      // We owe LOTO: sales minus our commission, plus any fees
      const shopPaysSupplier = totalSales - totalCommission + totalFees;

      // LOTO owes us: prizes we paid out to customers
      const supplierPaysShop = totalPrizes + totalCashPrizes;

      // Net settlement (positive = LOTO owes us, negative = we owe LOTO)
      const netSettlement = supplierPaysShop - shopPaysSupplier;

      return {
        totalSales,
        totalFees,
        totalCommission,
        totalPrizes,
        totalCashPrizes,
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
  recordMonthlyFee(data: {
    fee_amount: number;
    fee_month: string;
    fee_year: number;
    recorded_date?: string;
    note?: string;
  }): LotoMonthlyFee {
    try {
      const feeData = {
        fee_amount: data.fee_amount,
        fee_month: data.fee_month,
        fee_year: data.fee_year,
        recorded_date: data.recorded_date || new Date().toISOString(),
        is_paid: 0,
        note: data.note,
      };

      const fee = this.monthlyFeeRepo.createMonthlyFee(feeData);
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
  getMonthlyFees(year: number): LotoMonthlyFee[] {
    try {
      return this.monthlyFeeRepo.getMonthlyFeesByYear(year);
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
  markFeePaid(id: number, userId: number): LotoMonthlyFee {
    try {
      const paidDate = new Date().toISOString();
      const fee = this.monthlyFeeRepo.markFeePaid(id, paidDate, userId);

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
  getCommissionRate(): number {
    try {
      const settings = this.settingsRepo.getSettings();
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
  getMonthlyFeeAmount(): number {
    try {
      const settings = this.settingsRepo.getSettings();
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
  isAutoRecordEnabled(): boolean {
    try {
      const settings = this.settingsRepo.getSettings();
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
  updateSetting(key: string, value: string): LotoSetting | null {
    try {
      const setting = this.settingsRepo.updateSetting(key, value);
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
  getSettings(): Map<string, string> {
    try {
      return this.settingsRepo.getSettings();
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
   * This is a composite query spanning ticket + monthly fee repos
   */
  getReportData(from: string, to: string): LotoReportData {
    try {
      return {
        total_tickets: this.ticketRepo.getTicketCount(from, to),
        total_sales: this.ticketRepo.getTotalSales(from, to),
        total_commission: this.ticketRepo.getTotalCommission(from, to),
        total_prizes: this.ticketRepo.getTotalPrizes(from, to),
        total_cash_prizes: this.cashPrizeRepo.getTotalCashPrizes(from, to),
        outstanding_prizes: this.ticketRepo.getOutstandingPrizes(),
        total_fees: this.monthlyFeeRepo.getTotalFees(from, to),
      };
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
  checkAndRecordMonthlyFee(): { recorded: boolean; fee?: LotoMonthlyFee } {
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

  // ===========================================================================
  // Checkpoints
  // ===========================================================================

  /**
   * Create a new checkpoint with aggregated data for the specified period
   */
  createCheckpoint(data: {
    checkpoint_date: string;
    period_start: string;
    period_end: string;
    note?: string;
  }): LotoCheckpoint {
    try {
      // Calculate the aggregated data for this period
      const reportData = this.getReportData(data.period_start, data.period_end);

      // Find unassigned cash prizes in this date range
      const unassignedPrizes = this.cashPrizeRepo.getUnassignedByDateRange(
        data.period_start,
        data.period_end,
      );
      const totalCashPrizes = unassignedPrizes.reduce(
        (sum, p) => sum + p.prize_amount,
        0,
      );

      const checkpointData = {
        checkpoint_date: data.checkpoint_date,
        period_start: data.period_start,
        period_end: data.period_end,
        total_sales: reportData.total_sales,
        total_commission: reportData.total_commission,
        total_tickets: reportData.total_tickets,
        total_prizes: reportData.total_prizes,
        total_cash_prizes: totalCashPrizes,
        total_cash_prizes_count: unassignedPrizes.length,
        note: data.note,
      };

      const checkpoint = this.checkpointRepo.createCheckpoint(checkpointData);

      // Assign cash prizes to this checkpoint
      for (const prize of unassignedPrizes) {
        this.cashPrizeRepo.assignToCheckpoint(prize.id, checkpoint.id);
      }

      lotoLogger.info(
        `Loto checkpoint created: ${checkpoint.id}, Period: ${data.period_start} to ${data.period_end}, Sales: ${checkpoint.total_sales}, Commission: ${checkpoint.total_commission}, CashPrizes: ${totalCashPrizes} (${unassignedPrizes.length})`,
      );

      return checkpoint;
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.createCheckpoint failed",
      );
      throw error;
    }
  }

  /**
   * Get a checkpoint by ID
   */
  getCheckpoint(id: number): LotoCheckpoint | null {
    try {
      return this.checkpointRepo.getCheckpointById(id);
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.getCheckpoint failed",
      );
      throw error;
    }
  }

  /**
   * Get a checkpoint by date
   */
  getCheckpointByDate(date: string): LotoCheckpoint | null {
    try {
      return this.checkpointRepo.getCheckpointByDate(date);
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.getCheckpointByDate failed",
      );
      throw error;
    }
  }

  /**
   * Get checkpoints by date range
   */
  getCheckpointsByDateRange(from: string, to: string): LotoCheckpoint[] {
    try {
      return this.checkpointRepo.getCheckpointsByDateRange(from, to);
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.getCheckpointsByDateRange failed",
      );
      throw error;
    }
  }

  /**
   * Get all unsettled checkpoints
   */
  getUnsettledCheckpoints(): LotoCheckpoint[] {
    try {
      return this.checkpointRepo.getUnsettledCheckpoints();
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.getUnsettledCheckpoints failed",
      );
      throw error;
    }
  }

  /**
   * Update a checkpoint
   */
  updateCheckpoint(
    id: number,
    data: Partial<LotoCheckpointUpdate>,
  ): LotoCheckpoint | null {
    try {
      const checkpoint = this.checkpointRepo.updateCheckpoint(id, data);
      if (checkpoint) {
        lotoLogger.info(`Loto checkpoint ${id} updated`);
      }
      return checkpoint;
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.updateCheckpoint failed",
      );
      throw error;
    }
  }

  /**
   * Mark a checkpoint as settled
   */
  markCheckpointAsSettled(
    id: number,
    settledAt?: string,
    settlementId?: number,
  ): LotoCheckpoint | null {
    try {
      const checkpoint = this.checkpointRepo.markCheckpointAsSettled(
        id,
        settledAt,
        settlementId,
      );
      if (checkpoint) {
        lotoLogger.info(`Loto checkpoint ${id} marked as settled`);
      }
      return checkpoint;
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.markCheckpointAsSettled failed",
      );
      throw error;
    }
  }

  /**
   * Settle a checkpoint with full accounting (creates supplier_ledger entry, updates drawers)
   */
  settleCheckpoint(
    id: number,
    totalSales: number,
    totalCommission: number,
    totalPrizes: number,
    totalCashPrizes: number,
    settledAt: string | undefined,
    userId: number,
    payments?: Array<{ method: string; currency_code: string; amount: number }>,
  ): LotoCheckpoint {
    try {
      const checkpoint = this.checkpointRepo.settleCheckpoint(
        id,
        totalSales,
        totalCommission,
        totalPrizes,
        totalCashPrizes,
        settledAt,
        userId,
        payments,
      );
      lotoLogger.info(
        `Loto checkpoint ${id} settled: sales=${totalSales}, commission=${totalCommission}, cash_prizes=${totalCashPrizes}`,
      );
      return checkpoint;
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.settleCheckpoint failed",
      );
      throw error;
    }
  }

  /**
   * Get total sales from all unsettled checkpoints (what we owe to Loto guy)
   */
  getTotalSalesFromUnsettledCheckpoints(): number {
    try {
      return this.checkpointRepo.getTotalSalesFromUnsettledCheckpoints();
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.getTotalSalesFromUnsettledCheckpoints failed",
      );
      throw error;
    }
  }

  /**
   * Get total commission from all unsettled checkpoints (our profit)
   */
  getTotalCommissionFromUnsettledCheckpoints(): number {
    try {
      return this.checkpointRepo.getTotalCommissionFromUnsettledCheckpoints();
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.getTotalCommissionFromUnsettledCheckpoints failed",
      );
      throw error;
    }
  }

  /**
   * Get the last checkpoint created
   */
  getLastCheckpoint(): LotoCheckpoint | null {
    try {
      return this.checkpointRepo.getLastCheckpoint();
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.getLastCheckpoint failed",
      );
      throw error;
    }
  }

  /**
   * Delete an unsettled checkpoint. Settled checkpoints cannot be deleted.
   */
  deleteCheckpoint(id: number): boolean {
    try {
      // Unlink any cash prizes assigned to this checkpoint before deleting
      const unlinkedCount = this.cashPrizeRepo.unlinkFromCheckpoint(id);

      const deleted = this.checkpointRepo.deleteCheckpoint(id);
      if (deleted) {
        lotoLogger.info(
          `Loto checkpoint #${id} deleted (${unlinkedCount} cash prizes unlinked)`,
        );
      } else {
        lotoLogger.warn(
          `Failed to delete checkpoint #${id} — not found or already settled`,
        );
      }
      return deleted;
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.deleteCheckpoint failed",
      );
      throw error;
    }
  }

  /**
   * Create a checkpoint for the given date range based on the last checkpoint
   * If no previous checkpoint exists, use all tickets from the beginning
   */
  createScheduledCheckpoint(checkpointDate?: string): LotoCheckpoint {
    try {
      const date = checkpointDate || new Date().toISOString().split("T")[0];

      // Find the last checkpoint to determine the start date
      const lastCheckpoint = this.getLastCheckpoint();
      let startDate = "1970-01-01";
      if (lastCheckpoint) {
        // Start from the day AFTER the last checkpoint's period_end
        // to avoid double-counting tickets on the boundary day
        const nextDay = new Date(lastCheckpoint.period_end);
        nextDay.setDate(nextDay.getDate() + 1);
        startDate = nextDay.toISOString().split("T")[0];
      }

      // Create a checkpoint for the period since the last checkpoint
      return this.createCheckpoint({
        checkpoint_date: date,
        period_start: startDate,
        period_end: date,
        note: `Scheduled checkpoint for ${date}`,
      });
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.createScheduledCheckpoint failed",
      );
      throw error;
    }
  }

  // ===========================================================================
  // Cash Prizes
  // ===========================================================================

  /**
   * Record a cash prize payout to a customer
   */
  recordCashPrize(data: {
    ticket_number: string;
    prize_amount: number;
    prize_date?: string;
    userId: number;
  }): LotoCashPrize {
    try {
      if (!data.prize_amount || data.prize_amount <= 0) {
        throw new Error("Prize amount must be greater than zero");
      }

      const prizeData: LotoCashPrizeCreate = {
        ticket_number: data.ticket_number?.trim() || undefined,
        prize_amount: data.prize_amount,
        prize_date: data.prize_date || new Date().toISOString().split("T")[0],
        userId: data.userId,
      };

      const prize = this.cashPrizeRepo.createCashPrize(prizeData);
      lotoLogger.info(
        `Cash prize recorded: ${prize.id}, Amount: ${prize.prize_amount}, Ticket: ${prize.ticket_number}`,
      );

      return prize;
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.recordCashPrize failed",
      );
      throw error;
    }
  }

  /**
   * Get cash prizes by date range
   */
  getCashPrizes(from: string, to: string): LotoCashPrize[] {
    try {
      return this.cashPrizeRepo.getCashPrizesByDateRange(from, to);
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.getCashPrizes failed",
      );
      throw error;
    }
  }

  /**
   * Get all unreimbursed cash prizes
   */
  getUnreimbursedCashPrizes(): LotoCashPrize[] {
    try {
      return this.cashPrizeRepo.getUnreimbursedCashPrizes();
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.getUnreimbursedCashPrizes failed",
      );
      throw error;
    }
  }

  /**
   * Mark a cash prize as reimbursed (during settlement)
   */
  markCashPrizeReimbursed(
    id: number,
    reimbursedDate?: string,
    settlementId?: number,
  ): LotoCashPrize | null {
    try {
      const prize = this.cashPrizeRepo.markCashPrizeReimbursed(
        id,
        reimbursedDate,
        settlementId,
      );
      if (prize) {
        lotoLogger.info(`Cash prize ${id} marked as reimbursed`);
      }
      return prize;
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.markCashPrizeReimbursed failed",
      );
      throw error;
    }
  }

  /**
   * Get total unreimbursed cash prizes amount
   */
  getTotalUnreimbursedCashPrizes(): number {
    try {
      return this.cashPrizeRepo.getTotalUnreimbursedCashPrizes();
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.getTotalUnreimbursedCashPrizes failed",
      );
      throw error;
    }
  }

  /**
   * Get settlement history
   */
  getSettlementHistory(limit?: number): LotoSettlement[] {
    try {
      return this.checkpointRepo.getSettlementHistory(limit);
    } catch (error) {
      lotoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "LotoService.getSettlementHistory failed",
      );
      throw error;
    }
  }
}

export default LotoService;

// =============================================================================
// Singleton Instance
// =============================================================================

let lotoServiceInstance: LotoService | null = null;

export function getLotoService(): LotoService {
  if (!lotoServiceInstance) {
    lotoServiceInstance = new LotoService(
      getLotoTicketRepository(),
      getLotoSettingsRepository(),
      getLotoMonthlyFeeRepository(),
      getLotoCheckpointRepository(),
      getLotoCashPrizeRepository(),
    );
  }
  return lotoServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetLotoService(): void {
  lotoServiceInstance = null;
}
