# Liratek POS - Technical Quotation

**Date:** December 20, 2025

## Services & Pricing Breakdown

| Service Description                                                    | Price      |
| :--------------------------------------------------------------------- | :--------- |
| **Core POS License:** Sales, Multi-user (Admin/Staff), & Reports       | $550       |
| **Inventory & Debt Engine:** Stock tracking, repairs, & customer debts | $300       |
| **Digital Services Module:** OMT/Whish & Mobile Recharge integration   | $150       |
| **Crypto Module:** Binance transaction recording & tracking            | $100       |
| **Excel Data Migration:** Professional cleaning & system import        | $200       |
| **Premium Support:** 24/7 Full Maintenance & Emergency Response        | $200       |
| **Implementation:** On-site setup, training, & configuration           | $100       |
| **Subtotal**                                                           | $1,600     |
| **Discount**                                                           | -$400      |
| **Total Professional Investment**                                      | **$1,200** |

---

## Technical Robustness

### 1. Local-First Architecture

- **Offline Independence:** The system operates without internet; all data is saved locally to ensure zero downtime during connection drops.
- **Resilient Sync:** Uses a `sync_queue` with **Atomic Transactions** to ensure data reaches the cloud safely once connectivity is restored.

### 2. Enterprise-Grade Security

- **Hardware-Level Encryption:** Sensitive session data is encrypted using **macOS Keychain** or **Windows DPAPI**. Data cannot be decrypted if copied to a different machine.
- **Deep Authorization:** Role-Based Access Control (RBAC) is enforced at the system bridge (IPC), blocking unauthorized actions even if the user interface is tampered with.

### 3. Database Integrity & Accuracy

- **Crash Resistance:** Configured with **Write-Ahead Logging (WAL)**, making the database highly resistant to corruption during sudden power failures.
- **Immutable Snapshots:** Cost prices and exchange rates are saved _inside_ each sale record. Historical reports remain 100% accurate regardless of future price or rate changes.
- **Schema Enforcement:** Uses **Zod** validation to block malformed or "garbage" data before it ever touches your records.

### 4. Audit & Recovery

- **Activity Logs:** Full tracking of critical user actions for complete accountability.
- **Auto-Backups:** Automated, timestamped snapshots are saved to a dedicated local folder for easy disaster recovery.

---

## Support & Maintenance

- **24/7 Emergency Coverage:** Round-the-clock technical assistance for critical system issues to ensure zero business interruption.
- **Full Maintenance:** Regular system health checks, database optimization, and performance tuning post-deployment.

---

## Terms

- **Hardware:** Quoted separately at final market price (Scanner, Printer, Drawer, etc.).
- **Payment Plan:** 50% deposit | 50% on installation (**Negotiable**).
- **Timeline:** 7–9 weeks (includes data migration).

---

**Would you like me to add a signature section back in, or perhaps a list of the specific hardware items we should look for?**
