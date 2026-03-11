/**
 * Migration: Add sender/receiver fields to financial_services table
 * This allows proper tracking of both parties in OMT/WHISH transactions
 */

export const addSenderReceiverFieldsMigration = {
  version: 46,
  name: "add_sender_receiver_fields",
  description:
    "Add sender_name, sender_phone, receiver_name, receiver_phone, sender_client_id, receiver_client_id to financial_services",
  type: "typescript" as const,
  up(db: any) {
    // Add sender fields
    db.exec(`
      ALTER TABLE financial_services ADD COLUMN sender_name TEXT;
      ALTER TABLE financial_services ADD COLUMN sender_phone TEXT;
      ALTER TABLE financial_services ADD COLUMN receiver_name TEXT;
      ALTER TABLE financial_services ADD COLUMN receiver_phone TEXT;
      ALTER TABLE financial_services ADD COLUMN sender_client_id INTEGER REFERENCES clients(id);
      ALTER TABLE financial_services ADD COLUMN receiver_client_id INTEGER REFERENCES clients(id);
    `);

    console.log("Added sender/receiver fields to financial_services table");
  },
  down(db: any) {
    // SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
    // For rollback, we'll just leave the columns (they'll be NULL for old records)
    console.log(
      "Rollback: sender/receiver columns retained (SQLite limitation)",
    );
  },
};
