import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import {
  getClientService,
  createClientSchema,
  updateClientSchema,
  searchClientsSchema,
  importClientDebtsSchema,
  createErrorResponse,
  createSuccessResponse,
  ErrorCodes,
} from "@liratek/core";
import { validateRequest, validateQuery } from "../middleware/validation.js";
import { auditRest } from "../middleware/audit.js";

const router = express.Router();

// All clients routes require auth
router.use(authenticateJWT);

// GET /api/clients?search=...
router.get("/", validateQuery(searchClientsSchema), (req, res) => {
  const service = getClientService();
  const search =
    typeof req.query.search === "string" ? req.query.search : undefined;
  const clients = service.getClients(search);
  res.json(createSuccessResponse({ clients }));
});

// GET /api/clients/:id
router.get("/:id", (req, res): void => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res
      .status(400)
      .json(
        createErrorResponse(ErrorCodes.VALIDATION_ERROR, "Invalid client ID"),
      );
    return;
  }

  const service = getClientService();
  const client = service.getClientById(id);
  if (!client) {
    res
      .status(404)
      .json(
        createErrorResponse(ErrorCodes.CLIENT_NOT_FOUND, "Client not found"),
      );
    return;
  }

  res.json(createSuccessResponse({ client }));
});

// POST /api/clients (admin)
router.post(
  "/",
  requireRole(["admin"]),
  validateRequest(createClientSchema),
  (req, res): void => {
    const service = getClientService();
    const result = service.createClient(req.body, req.user!.userId);

    if (!result.success) {
      const errorMsg = result.error || "Failed to create client";
      const statusCode = errorMsg.includes("already") ? 409 : 400;
      res
        .status(statusCode)
        .json(
          createErrorResponse(
            errorMsg.includes("already")
              ? ErrorCodes.DUPLICATE_PHONE
              : ErrorCodes.VALIDATION_ERROR,
            errorMsg,
          ),
        );
      return;
    }

    // Mirrors clientHandlers.ts's clients:create audit (create/client).
    auditRest(req, {
      action: "create",
      entity_type: "client",
      entity_id: String(result.id ?? ""),
      summary: `Created client "${req.body.full_name}"`,
    });

    res.status(201).json(createSuccessResponse({ id: result.id }));
  },
);

// POST /api/clients/import-debts (admin) — bulk Excel import
//
// The web half of a feature that only ever existed on desktop. The Debts page
// called `window.api.clients.importDebts()` directly, so in a browser it threw
// "Cannot read properties of undefined (reading 'clients')" — it had never
// worked there. Mirrors electron-app/handlers/clientHandlers.ts
// `clients:import-debts`: same admin gate, same core service, same envelope.
//
// No logic lives here (rule 13). `importClientsWithDebts` already owns the
// decisions — which clients to create, which to discard for a missing phone,
// which entries are duplicate re-imports — and both transports get them
// identically because they call the same method.
router.post(
  "/import-debts",
  requireRole(["admin"]),
  validateRequest(importClientDebtsSchema),
  (req, res): void => {
    const service = getClientService();

    try {
      // userId comes from the JWT, never the body (rule 19c): this stamps the
      // author of every imported debt_ledger row.
      const result = service.importClientsWithDebts(
        req.body.clients,
        req.user!.userId,
      );

      // Mirrors the desktop handler's create/client_import audit row.
      auditRest(req, {
        action: "create",
        entity_type: "client_import",
        summary: `Imported ${result.clientsCreated} clients, ${result.entriesImported} debt entries`,
      });

      // `result` (not `data`) to match the IPC shape the page already reads.
      res.json(createSuccessResponse({ result }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import failed";
      // HTTP 200 with success:false would match IPC exactly, but every other
      // failure in this router answers 4xx/5xx and the adapter branches on
      // `success` either way.
      res
        .status(500)
        .json(createErrorResponse(ErrorCodes.INTERNAL_ERROR, message));
    }
  },
);

// PUT /api/clients/:id (admin)
router.put(
  "/:id",
  requireRole(["admin"]),
  validateRequest(updateClientSchema.omit({ id: true })),
  (req, res): void => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res
        .status(400)
        .json(
          createErrorResponse(ErrorCodes.VALIDATION_ERROR, "Invalid client ID"),
        );
      return;
    }

    const service = getClientService();
    const result = service.updateClient(id, req.body, req.user!.userId);

    if (!result.success) {
      const errorMsg = result.error || "Failed to update client";
      const statusCode = errorMsg.includes("not found") ? 404 : 400;
      res
        .status(statusCode)
        .json(
          createErrorResponse(
            errorMsg.includes("not found")
              ? ErrorCodes.CLIENT_NOT_FOUND
              : ErrorCodes.VALIDATION_ERROR,
            errorMsg,
          ),
        );
      return;
    }

    // Mirrors clientHandlers.ts's clients:update audit (update/client).
    auditRest(req, {
      action: "update",
      entity_type: "client",
      entity_id: String(id),
      summary: `Updated client "${req.body.full_name}"`,
    });

    res.json(createSuccessResponse({ success: true }));
  },
);

// DELETE /api/clients/:id (admin)
router.delete("/:id", requireRole(["admin"]), (req, res): void => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res
      .status(400)
      .json(
        createErrorResponse(ErrorCodes.VALIDATION_ERROR, "Invalid client ID"),
      );
    return;
  }

  const service = getClientService();
  const result = service.deleteClient(id, req.user!.userId);

  if (!result.success) {
    const errorMsg = result.error || "Failed to delete client";
    res
      .status(400)
      .json(createErrorResponse(ErrorCodes.OPERATION_FAILED, errorMsg));
    return;
  }

  // Mirrors clientHandlers.ts's clients:delete audit (delete/client).
  auditRest(req, {
    action: "delete",
    entity_type: "client",
    entity_id: String(id),
    summary: `Deleted client #${id}`,
  });

  res.json(createSuccessResponse({ success: true }));
});

export default router;
