/**
 * Voucher Image IPC Handlers
 *
 * Thin wrapper over VoucherImageService for IPC communication.
 */

import { ipcMain } from "electron";
import { getVoucherImageService } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";

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
      audit(event.sender.id, {
        action: "update",
        entity_type: "voucher_image",
        summary: `Set voucher image for ${data.provider}/${data.category}/${data.itemKey}`,
        metadata: {
          provider: data.provider,
          category: data.category,
          itemKey: data.itemKey,
        },
      });
      return { success: true };
    },
  );

  // Delete a voucher image
  ipcMain.handle("voucher-images:delete", (event, id: number) => {
    const auth = requireRole(event.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };
    voucherImageService.deleteImage(id);
    audit(event.sender.id, {
      action: "delete",
      entity_type: "voucher_image",
      entity_id: String(id),
      summary: `Deleted voucher image #${id}`,
    });
    return { success: true };
  });
}
