/**
 * Voucher Image IPC Handlers
 *
 * Thin wrapper over VoucherImageService for IPC communication.
 */

import { ipcMain } from "electron";
import { getVoucherImageService } from "@liratek/core";
import { requireRole } from "../session.js";

export function registerVoucherImageHandlers(): void {
  const voucherImageService = getVoucherImageService();

  // Get all voucher images
  ipcMain.handle("voucher-images:get-all", () => {
    return voucherImageService.getAllImages();
  });

  // Save/update a voucher image
  ipcMain.handle(
    "voucher-images:set",
    (
      event,
      data: {
        provider: string;
        category: string;
        itemKey: string;
        imageData: string;
      },
    ) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
      voucherImageService.setImage(
        data.provider,
        data.category,
        data.itemKey,
        data.imageData,
      );
      return { success: true };
    },
  );

  // Delete a voucher image
  ipcMain.handle("voucher-images:delete", (event, id: number) => {
    const auth = requireRole(event.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };
    voucherImageService.deleteImage(id);
    return { success: true };
  });
}
