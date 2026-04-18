/**
 * Loto Repository (Backward-Compatible Facade)
 *
 * Delegates to the 5 specialized repositories:
 * - LotoTicketRepository (loto_tickets)
 * - LotoSettingsRepository (loto_settings)
 * - LotoMonthlyFeeRepository (loto_monthly_fees)
 * - LotoCheckpointRepository (loto_checkpoints + loto_settlements)
 * - LotoCashPrizeRepository (loto_cash_prizes)
 *
 * This facade preserves backward compatibility for existing consumers.
 * New code should import from the specialized repositories directly.
 */

import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";

// Re-export all types from specialized repos
export type {
  LotoTicket,
  LotoTicketCreate,
  LotoTicketUpdate,
} from "./LotoTicketRepository.js";
export type { LotoSetting } from "./LotoSettingsRepository.js";
export type {
  LotoMonthlyFee,
  LotoMonthlyFeeCreate,
} from "./LotoMonthlyFeeRepository.js";
export type {
  LotoCheckpoint,
  LotoCheckpointCreate,
  LotoCheckpointUpdate,
  LotoSettlement,
} from "./LotoCheckpointRepository.js";
export type {
  LotoCashPrize,
  LotoCashPrizeCreate,
} from "./LotoCashPrizeRepository.js";

import {
  LotoTicketRepository,
  getLotoTicketRepository,
} from "./LotoTicketRepository.js";
import type {
  LotoTicket,
  LotoTicketCreate,
  LotoTicketUpdate,
} from "./LotoTicketRepository.js";
import {
  LotoSettingsRepository,
  getLotoSettingsRepository,
} from "./LotoSettingsRepository.js";
import type { LotoSetting } from "./LotoSettingsRepository.js";
import {
  LotoMonthlyFeeRepository,
  getLotoMonthlyFeeRepository,
} from "./LotoMonthlyFeeRepository.js";
import type {
  LotoMonthlyFee,
  LotoMonthlyFeeCreate,
} from "./LotoMonthlyFeeRepository.js";
import {
  LotoCheckpointRepository,
  getLotoCheckpointRepository,
} from "./LotoCheckpointRepository.js";
import type {
  LotoCheckpoint,
  LotoCheckpointCreate,
  LotoCheckpointUpdate,
  LotoSettlement,
} from "./LotoCheckpointRepository.js";
import {
  LotoCashPrizeRepository,
  getLotoCashPrizeRepository,
} from "./LotoCashPrizeRepository.js";
import type {
  LotoCashPrize,
  LotoCashPrizeCreate,
} from "./LotoCashPrizeRepository.js";

export interface LotoReportData {
  total_tickets: number;
  total_sales: number;
  total_commission: number;
  total_prizes: number;
  total_cash_prizes: number;
  outstanding_prizes: number;
  total_fees: number;
}

/**
 * @deprecated Use the specialized repositories directly:
 * - LotoTicketRepository
 * - LotoSettingsRepository
 * - LotoMonthlyFeeRepository
 * - LotoCheckpointRepository
 * - LotoCashPrizeRepository
 */
export class LotoRepository {
  private tickets: LotoTicketRepository;
  private settings: LotoSettingsRepository;
  private monthlyFees: LotoMonthlyFeeRepository;
  private checkpoints: LotoCheckpointRepository;
  private cashPrizes: LotoCashPrizeRepository;

  constructor(db: Database.Database) {
    this.tickets = new LotoTicketRepository(db);
    this.settings = new LotoSettingsRepository(db);
    this.monthlyFees = new LotoMonthlyFeeRepository(db);
    this.checkpoints = new LotoCheckpointRepository(db);
    this.cashPrizes = new LotoCashPrizeRepository(db);
  }

  // Tickets
  createTicket(data: LotoTicketCreate): LotoTicket {
    return this.tickets.createTicket(data);
  }
  getTicketById(id: number): LotoTicket | null {
    return this.tickets.getTicketById(id);
  }
  getTicketsByDateRange(from: string, to: string): LotoTicket[] {
    return this.tickets.getTicketsByDateRange(from, to);
  }
  updateTicket(id: number, data: LotoTicketUpdate): LotoTicket | null {
    return this.tickets.updateTicket(id, data);
  }
  getTotalSales(from: string, to: string): number {
    return this.tickets.getTotalSales(from, to);
  }
  getTotalCommission(from: string, to: string): number {
    return this.tickets.getTotalCommission(from, to);
  }
  getTotalPrizes(from: string, to: string): number {
    return this.tickets.getTotalPrizes(from, to);
  }
  getOutstandingPrizes(): number {
    return this.tickets.getOutstandingPrizes();
  }
  getTicketCount(from: string, to: string): number {
    return this.tickets.getTicketCount(from, to);
  }

  // Monthly Fees
  createMonthlyFee(data: LotoMonthlyFeeCreate): LotoMonthlyFee {
    return this.monthlyFees.createMonthlyFee(data);
  }
  getMonthlyFeeById(id: number): LotoMonthlyFee | null {
    return this.monthlyFees.getMonthlyFeeById(id);
  }
  getMonthlyFeesByYear(year: number): LotoMonthlyFee[] {
    return this.monthlyFees.getMonthlyFeesByYear(year);
  }
  markFeePaid(
    id: number,
    paidDate: string,
    userId: number,
  ): LotoMonthlyFee | null {
    return this.monthlyFees.markFeePaid(id, paidDate, userId);
  }
  getTotalFees(from: string, to: string): number {
    return this.monthlyFees.getTotalFees(from, to);
  }

  // Settings
  getSettings(): Map<string, string> {
    return this.settings.getSettings();
  }
  updateSetting(key: string, value: string): LotoSetting | null {
    return this.settings.updateSetting(key, value);
  }

  // Report Data (composite - spans tickets + monthly fees)
  getReportData(from: string, to: string): LotoReportData {
    return {
      total_tickets: this.tickets.getTicketCount(from, to),
      total_sales: this.tickets.getTotalSales(from, to),
      total_commission: this.tickets.getTotalCommission(from, to),
      total_prizes: this.tickets.getTotalPrizes(from, to),
      total_cash_prizes: this.cashPrizes.getTotalCashPrizes(from, to),
      outstanding_prizes: this.tickets.getOutstandingPrizes(),
      total_fees: this.monthlyFees.getTotalFees(from, to),
    };
  }

  // Checkpoints
  createCheckpoint(data: LotoCheckpointCreate): LotoCheckpoint {
    return this.checkpoints.createCheckpoint(data);
  }
  getCheckpointById(id: number): LotoCheckpoint | null {
    return this.checkpoints.getCheckpointById(id);
  }
  getCheckpointByDate(date: string): LotoCheckpoint | null {
    return this.checkpoints.getCheckpointByDate(date);
  }
  getCheckpointsByDateRange(from: string, to: string): LotoCheckpoint[] {
    return this.checkpoints.getCheckpointsByDateRange(from, to);
  }
  getUnsettledCheckpoints(): LotoCheckpoint[] {
    return this.checkpoints.getUnsettledCheckpoints();
  }
  updateCheckpoint(
    id: number,
    data: LotoCheckpointUpdate,
  ): LotoCheckpoint | null {
    return this.checkpoints.updateCheckpoint(id, data);
  }
  markCheckpointAsSettled(
    id: number,
    settledAt?: string,
    settlementId?: number,
  ): LotoCheckpoint | null {
    return this.checkpoints.markCheckpointAsSettled(
      id,
      settledAt,
      settlementId,
    );
  }
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
    return this.checkpoints.settleCheckpoint(
      id,
      totalSales,
      totalCommission,
      totalPrizes,
      totalCashPrizes,
      settledAt,
      userId,
      payments,
    );
  }
  getTotalSalesFromUnsettledCheckpoints(): number {
    return this.checkpoints.getTotalSalesFromUnsettledCheckpoints();
  }
  getTotalCommissionFromUnsettledCheckpoints(): number {
    return this.checkpoints.getTotalCommissionFromUnsettledCheckpoints();
  }
  getLastCheckpoint(): LotoCheckpoint | null {
    return this.checkpoints.getLastCheckpoint();
  }
  getSettlementHistory(limit?: number): LotoSettlement[] {
    return this.checkpoints.getSettlementHistory(limit);
  }

  // Cash Prizes
  createCashPrize(data: LotoCashPrizeCreate): LotoCashPrize {
    return this.cashPrizes.createCashPrize(data);
  }
  getCashPrizeById(id: number): LotoCashPrize | null {
    return this.cashPrizes.getCashPrizeById(id);
  }
  getCashPrizesByDateRange(from: string, to: string): LotoCashPrize[] {
    return this.cashPrizes.getCashPrizesByDateRange(from, to);
  }
  getUnreimbursedCashPrizes(): LotoCashPrize[] {
    return this.cashPrizes.getUnreimbursedCashPrizes();
  }
  markCashPrizeReimbursed(
    id: number,
    reimbursedDate?: string,
    settlementId?: number,
  ): LotoCashPrize | null {
    return this.cashPrizes.markCashPrizeReimbursed(
      id,
      reimbursedDate,
      settlementId,
    );
  }
  getTotalCashPrizes(from: string, to: string): number {
    return this.cashPrizes.getTotalCashPrizes(from, to);
  }
  getTotalUnreimbursedCashPrizes(): number {
    return this.cashPrizes.getTotalUnreimbursedCashPrizes();
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let lotoRepositoryInstance: LotoRepository | null = null;

export function getLotoRepository(): LotoRepository {
  if (!lotoRepositoryInstance) {
    lotoRepositoryInstance = new LotoRepository(getDatabase());
  }
  return lotoRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetLotoRepository(): void {
  lotoRepositoryInstance = null;
}

export default LotoRepository;
