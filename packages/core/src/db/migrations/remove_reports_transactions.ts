/**
 * Migration: Remove Reports and Transactions modules
 * These modules were redundant with Dashboard and Profits
 */

export const removeReportsTransactionsMigration = {
  version: 45,
  name: "remove_reports_transactions_modules",
  description: "Remove redundant Reports and Transactions modules",
  type: "typescript" as const,
  up(db: any) {
    // Remove modules
    db.exec(`DELETE FROM modules WHERE key IN ('reports', 'transactions')`);

    // Remove from currency_modules junction
    db.exec(
      `DELETE FROM currency_modules WHERE module_key IN ('reports', 'transactions')`,
    );

    console.log("Removed Reports and Transactions modules");
  },
  down(db: any) {
    // Re-add modules (if needed for rollback)
    db.exec(`
      INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, is_enabled, admin_only, is_system)
      VALUES 
        ('reports', 'Reports', 'BarChart2', '/reports', 14, 1, 1, 0),
        ('transactions', 'Transactions', 'ClipboardList', '/transactions', 15, 1, 1, 0)
    `);

    // Re-add currency modules
    db.exec(`
      INSERT OR IGNORE INTO currency_modules (currency_code, module_key)
      VALUES 
        ('USD', 'reports'), ('USD', 'transactions'),
        ('LBP', 'reports'), ('LBP', 'transactions')
    `);

    console.log("Restored Reports and Transactions modules");
  },
};
