/**
 * Moved to core (LIRA-289) so the phone app uses the same fee maths:
 * packages/core/src/utils/walletTransfer.ts. Re-exported here so existing
 * imports keep working.
 */
export {
  calculateOmtWhishAppFees,
  type OmtWhishAppFeeInputs,
  type OmtWhishAppFeeResult,
} from "@liratek/core";
