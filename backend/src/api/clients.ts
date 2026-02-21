import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import {
  getClientService,
  createClientSchema,
  updateClientSchema,
  searchClientsSchema,
  createErrorResponse,
  createSuccessResponse,
  ErrorCodes,
} from "@liratek/core";
import { validateRequest, validateQuery } from "../middleware/validation.js";

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
    const result = service.createClient(req.body);

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

    res.status(201).json(createSuccessResponse({ id: result.id }));
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
    const result = service.updateClient(id, req.body);

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
  const result = service.deleteClient(id);

  if (!result.success) {
    const errorMsg = result.error || "Failed to delete client";
    res
      .status(400)
      .json(createErrorResponse(ErrorCodes.OPERATION_FAILED, errorMsg));
    return;
  }

  res.json(createSuccessResponse({ success: true }));
});

export default router;
