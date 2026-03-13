import { google } from "googleapis";
import { logger } from "../utils/logger.js";
import path from "path";
import fs from "fs";

export interface ClientData {
  shop_name: string;
  plan: "essentials" | "professional";
  status: "active" | "expired" | "grace_period" | "paused";
  api_key: string;
  huggingface_api_key?: string;
  contact_email?: string;
  contact_phone?: string;
  created_at: string;
  expires_at?: string;
  last_login_at?: string;
  last_synced_at?: string;
  grace_period_ends?: string;
  billing_cycle?: "monthly" | "yearly" | "lifetime";
  notes?: string;
}

class GoogleSheetsService {
  private sheets: any;
  private spreadsheetId: string;
  private initialized: boolean = false;

  constructor() {
    const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
    this.spreadsheetId = process.env.GOOGLE_SHEET_ID!;

    if (!keyPath || !this.spreadsheetId) {
      throw new Error(
        "Missing Google Sheets configuration. Check GOOGLE_SERVICE_ACCOUNT_KEY_PATH and GOOGLE_SHEET_ID in .env",
      );
    }

    const fullPath = path.resolve(process.cwd(), keyPath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Service account key file not found at: ${fullPath}`);
    }

    const key = JSON.parse(fs.readFileSync(fullPath, "utf8"));

    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    this.sheets = google.sheets({ version: "v4", auth });
  }

  /**
   * Initialize connection and verify access
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) {
      return true;
    }

    try {
      // Test connection by reading sheet metadata
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });

      logger.info(
        { spreadsheetTitle: response.data.properties.title },
        "Connected to Google Sheets",
      );

      this.initialized = true;
      return true;
    } catch (error: any) {
      logger.error(
        { error: error.message },
        "Failed to connect to Google Sheets",
      );
      throw new Error(`Google Sheets connection failed: ${error.message}`);
    }
  }

  /**
   * Get all clients from the sheet
   */
  async getAllClients(): Promise<ClientData[]> {
    await this.initialize();

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: "Sheet1!A2:N", // Skip header row, read all columns
      });

      const rows = response.data.values || [];

      return rows.map((row: string[]) => this.rowToClientData(row));
    } catch (error: any) {
      logger.error(
        { error: error.message },
        "Failed to read clients from sheet",
      );
      throw new Error(`Failed to read clients: ${error.message}`);
    }
  }

  /**
   * Get a single client by shop name
   */
  async getClientByShopName(shopName: string): Promise<ClientData | null> {
    const clients = await this.getAllClients();
    return clients.find((c) => c.shop_name === shopName) || null;
  }

  /**
   * Get a single client by API key
   */
  async getClientByApiKey(apiKey: string): Promise<ClientData | null> {
    const clients = await this.getAllClients();
    return clients.find((c) => c.api_key === apiKey) || null;
  }

  /**
   * Update client last login timestamp
   */
  async updateLastLogin(shopName: string): Promise<void> {
    const clients = await this.getAllClients();
    const clientIndex = clients.findIndex((c) => c.shop_name === shopName);

    if (clientIndex === -1) {
      throw new Error(`Client not found: ${shopName}`);
    }

    const now = new Date().toISOString();
    const rowNumber = clientIndex + 2; // +2 because row 1 is header and array is 0-indexed

    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `Sheet1!J${rowNumber}`,
        valueInputOption: "RAW",
        requestBody: {
          values: [[now]],
        },
      });

      logger.info({ shopName, lastLogin: now }, "Updated last login timestamp");
    } catch (error: any) {
      logger.error(
        { error: error.message, shopName },
        "Failed to update last login",
      );
      throw new Error(`Failed to update last login: ${error.message}`);
    }
  }

  /**
   * Update client plan
   */
  async updateClientPlan(
    shopName: string,
    newPlan: "essentials" | "professional",
  ): Promise<void> {
    const clients = await this.getAllClients();
    const clientIndex = clients.findIndex((c) => c.shop_name === shopName);

    if (clientIndex === -1) {
      throw new Error(`Client not found: ${shopName}`);
    }

    const rowNumber = clientIndex + 2;

    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `Sheet1!B${rowNumber}`,
        valueInputOption: "RAW",
        requestBody: {
          values: [[newPlan]],
        },
      });

      logger.info({ shopName, newPlan }, "Updated client plan");
    } catch (error: any) {
      logger.error(
        { error: error.message, shopName },
        "Failed to update client plan",
      );
      throw new Error(`Failed to update plan: ${error.message}`);
    }
  }

  /**
   * Update client status
   */
  async updateClientStatus(
    shopName: string,
    newStatus: "active" | "expired" | "grace_period" | "paused",
  ): Promise<void> {
    const clients = await this.getAllClients();
    const clientIndex = clients.findIndex((c) => c.shop_name === shopName);

    if (clientIndex === -1) {
      throw new Error(`Client not found: ${shopName}`);
    }

    const rowNumber = clientIndex + 2;

    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `Sheet1!C${rowNumber}`,
        valueInputOption: "RAW",
        requestBody: {
          values: [[newStatus]],
        },
      });

      logger.info({ shopName, newStatus }, "Updated client status");
    } catch (error: any) {
      logger.error(
        { error: error.message, shopName },
        "Failed to update client status",
      );
      throw new Error(`Failed to update status: ${error.message}`);
    }
  }

  /**
   * Update last synced timestamp
   */
  async updateLastSyncedAt(shopName: string): Promise<void> {
    const clients = await this.getAllClients();
    const clientIndex = clients.findIndex((c) => c.shop_name === shopName);

    if (clientIndex === -1) {
      throw new Error(`Client not found: ${shopName}`);
    }

    const now = new Date().toISOString();
    const rowNumber = clientIndex + 2;

    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `Sheet1!K${rowNumber}`,
        valueInputOption: "RAW",
        requestBody: {
          values: [[now]],
        },
      });
    } catch (error: any) {
      logger.error(
        { error: error.message, shopName },
        "Failed to update last synced timestamp",
      );
    }
  }

  /**
   * Convert a row from Google Sheets to ClientData object
   */
  private rowToClientData(row: string[]): ClientData {
    return {
      shop_name: row[0] || "",
      plan: (row[1] as "essentials" | "professional") || "essentials",
      status:
        (row[2] as "active" | "expired" | "grace_period" | "paused") ||
        "active",
      api_key: row[3] || "",
      huggingface_api_key: row[4] || undefined,
      contact_email: row[5] || undefined,
      contact_phone: row[6] || undefined,
      created_at: row[7] || new Date().toISOString(),
      expires_at: row[8] || undefined,
      last_login_at: row[9] || undefined,
      last_synced_at: row[10] || undefined,
      grace_period_ends: row[11] || undefined,
      billing_cycle:
        (row[12] as "monthly" | "yearly" | "lifetime") || "monthly",
      notes: row[13] || undefined,
    };
  }
}

// Singleton instance
let instance: GoogleSheetsService | null = null;

/**
 * Create or get the Google Sheets service instance
 */
export function getGoogleSheetsService(): GoogleSheetsService {
  if (!instance) {
    instance = new GoogleSheetsService();
  }

  return instance;
}

export default GoogleSheetsService;
