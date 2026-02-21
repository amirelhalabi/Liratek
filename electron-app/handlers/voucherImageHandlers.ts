/**
 * Voucher Image IPC Handlers
 *
 * Thin wrapper over VoucherImageService for IPC communication.
 */

import { ipcMain } from "electron";
import { getVoucherImageService } from "@liratek/core";

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
      _event,
      data: {
        provider: string;
        category: string;
        itemKey: string;
        imageData: string;
      },
    ) => {
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
  ipcMain.handle("voucher-images:delete", (_event, id: number) => {
    voucherImageService.deleteImage(id);
    return { success: true };
  });
}
