/**
 * Validation Middleware Tests
 *
 * Verifies validateRequest, validateQuery, and validateParams reject
 * invalid input with proper error format and pass valid input through.
 */

import { jest } from "@jest/globals";
import express, { type Express } from "express";
import request from "supertest";
import { z } from "zod";
import {
  validateRequest,
  validateQuery,
  validateParams,
} from "../validation.js";

// ---------- Schemas for testing ----------

const bodySchema = z.object({
  name: z.string().min(1, "Name is required"),
  age: z.number().int().positive("Age must be positive"),
});

const querySchema = z.object({
  page: z.string().regex(/^\d+$/, "Page must be numeric"),
  limit: z.string().regex(/^\d+$/, "Limit must be numeric"),
});

const paramsSchema = z.object({
  id: z.string().uuid("Invalid UUID"),
});

// ---------- App factories ----------

function bodyApp(): Express {
  const app = express();
  app.use(express.json());
  app.post("/items", validateRequest(bodySchema), (_req, res) =>
    res.status(200).json({ success: true, data: _req.body }),
  );
  return app;
}

function queryApp(): Express {
  const app = express();
  app.get("/items", validateQuery(querySchema), (_req, res) =>
    res.status(200).json({ success: true, data: _req.query }),
  );
  return app;
}

function paramsApp(): Express {
  const app = express();
  app.get("/items/:id", validateParams(paramsSchema), (_req, res) =>
    res.status(200).json({ success: true, data: _req.params }),
  );
  return app;
}

// ---------- Tests ----------

describe("Validation Middleware", () => {
  describe("validateRequest (body)", () => {
    it("passes valid body through to handler", async () => {
      const res = await request(bodyApp())
        .post("/items")
        .send({ name: "Widget", age: 5 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ name: "Widget", age: 5 });
    });

    it("returns 400 with field details for invalid body", async () => {
      const res = await request(bodyApp())
        .post("/items")
        .send({ name: "", age: -1 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details.errors).toBeInstanceOf(Array);
      expect(res.body.error.details.errors.length).toBeGreaterThan(0);

      const fieldNames = res.body.error.details.errors.map((e: any) => e.field);
      expect(fieldNames).toContain("name");
    });

    it("returns 400 when body is missing required fields", async () => {
      const res = await request(bodyApp()).post("/items").send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("includes field name in the top-level error response", async () => {
      const res = await request(bodyApp())
        .post("/items")
        .send({ name: 123, age: "not-a-number" });

      expect(res.status).toBe(400);
      expect(res.body.error.field).toBeDefined();
    });
  });

  describe("validateQuery (query params)", () => {
    it("passes valid query params through", async () => {
      const res = await request(queryApp()).get("/items?page=1&limit=10");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns 400 for invalid query params", async () => {
      const res = await request(queryApp()).get("/items?page=abc&limit=xyz");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details.errors).toBeInstanceOf(Array);
    });

    it("returns 400 when required query params are missing", async () => {
      const res = await request(queryApp()).get("/items");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("validateParams (route params)", () => {
    const validUUID = "550e8400-e29b-41d4-a716-446655440000";

    it("passes valid params through", async () => {
      const res = await request(paramsApp()).get(`/items/${validUUID}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns 400 for invalid params", async () => {
      const res = await request(paramsApp()).get("/items/not-a-uuid");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details.errors).toBeInstanceOf(Array);

      const firstErr = res.body.error.details.errors[0];
      expect(firstErr.field).toBe("id");
      expect(firstErr.message).toBe("Invalid UUID");
    });
  });
});
