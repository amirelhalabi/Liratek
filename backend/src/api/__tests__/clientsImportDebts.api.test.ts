/**
 * POST /api/clients/import-debts — the WEB half of the Excel debt import.
 *
 * This route did not exist. The Debts page called
 * `window.api.clients.importDebts()` directly, so importing in a browser threw
 * "Cannot read properties of undefined (reading 'clients')" — the feature had a
 * desktop half and nothing else (rule 19b).
 *
 * What these assert is the TRANSPORT, not the import logic: the admin gate, the
 * userId coming from the JWT rather than the body, the envelope the page reads,
 * and that validation is not stricter than the desktop handler's (which
 * validates nothing) — because a schema that rejects a spreadsheet desktop
 * accepts would give the two transports different behaviour, the exact thing
 * rule 19 exists to prevent.
 *
 * `importClientsWithDebts` itself is stubbed; it is covered by ClientService's
 * own suite and it owns every decision about what an import means.
 */

import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const importClientsWithDebts = jest.fn();
const auditLog = jest.fn();

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getClientService: () => ({ importClientsWithDebts }),
    getAuditService: () => ({ log: auditLog }),
    getAuditRepository: () => ({ log: auditLog }),
    runWithTenant: (_id: number, fn: () => unknown) => fn(),
    runWithoutTenant: (fn: () => unknown) => fn(),
  };
});

// The route's own auth: swap in a stub so these tests exercise the ROUTE, with
// the role gate still real in shape (admin vs not).
let currentUser: { userId: number; role: string; tenantId: number } | null = {
  userId: 42,
  role: "admin",
  tenantId: 1,
};
jest.mock("../../middleware/auth.js", () => ({
  authenticateJWT: (req: any, res: any, next: () => void) => {
    if (!currentUser)
      return res.status(401).json({ error: "No token provided" });
    req.user = currentUser;
    next();
  },
  requireRole: (roles: string[]) => (req: any, res: any, next: () => void) => {
    if (!roles.includes(req.user?.role))
      return res.status(403).json({ success: false, error: "Forbidden" });
    next();
  },
}));

jest.mock("../../middleware/audit.js", () => ({
  auditRest: (...args: unknown[]) => auditLog(...args),
}));

import express, { type Express } from "express";
import request from "supertest";
import clientRoutes from "../clients.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/clients", clientRoutes);
  return app;
}

const ENTRY = {
  date: "2026-01-05",
  amount_usd: 25,
  amount_lbp: 0,
  description: "Opening balance",
  type: "debt" as const,
};

const RESULT = {
  clientsCreated: 2,
  clientsSkipped: 1,
  clientsDiscarded: 0,
  entriesImported: 3,
  duplicatesSkipped: 0,
  errors: [],
};

function post(body: unknown) {
  return request(buildApp()).post("/api/clients/import-debts").send(body);
}

describe("POST /api/clients/import-debts", () => {
  beforeEach(() => {
    importClientsWithDebts.mockReset();
    auditLog.mockReset();
    importClientsWithDebts.mockReturnValue(RESULT);
    currentUser = { userId: 42, role: "admin", tenantId: 1 };
  });

  describe("access control — must match the desktop handler", () => {
    it("rejects an unauthenticated request", async () => {
      currentUser = null;
      await post({
        clients: [{ name: "A", phone: "03", entries: [ENTRY] }],
      }).expect(401);
      expect(importClientsWithDebts).not.toHaveBeenCalled();
    });

    it("rejects a non-admin — the IPC handler is requireRole(['admin'])", async () => {
      currentUser = { userId: 7, role: "staff", tenantId: 1 };
      await post({
        clients: [{ name: "A", phone: "03", entries: [ENTRY] }],
      }).expect(403);
      expect(importClientsWithDebts).not.toHaveBeenCalled();
    });
  });

  it("imports and returns the counts in the shape the page reads", async () => {
    const res = await post({
      clients: [
        { name: "Ali", phone: "03111111", entries: [ENTRY] },
        { name: "Sara", phone: "03222222", entries: [ENTRY, ENTRY] },
      ],
    }).expect(200);

    // The Debts page reads result.result.clientsCreated — keeping the IPC key
    // means the page needs no per-transport branch.
    expect(res.body.success).toBe(true);
    expect(res.body.data.result).toEqual(RESULT);
  });

  it("takes userId from the JWT, never from the body", async () => {
    await post({
      clients: [{ name: "Ali", phone: "03", entries: [ENTRY] }],
      // A caller trying to attribute the import to someone else.
      userId: 999,
    }).expect(200);

    const [, userId] = importClientsWithDebts.mock.calls[0] as [
      unknown,
      number,
    ];
    // 42 is the authenticated user; 999 must be ignored. Every imported
    // debt_ledger row is stamped with this.
    expect(userId).toBe(42);
  });

  it("passes the clients array through untouched", async () => {
    const clients = [{ name: "Ali", phone: "03111111", entries: [ENTRY] }];
    await post({ clients }).expect(200);
    expect(importClientsWithDebts.mock.calls[0]![0]).toEqual(clients);
  });

  describe("validation is not stricter than desktop", () => {
    it("accepts a client with NO phone — the service discards those and reports it", async () => {
      // Rejecting here would turn a partial import plus a summary into a total
      // failure, which is not what the desktop path does.
      await post({
        clients: [{ name: "No Phone", phone: "", entries: [ENTRY] }],
      }).expect(200);
      expect(importClientsWithDebts).toHaveBeenCalled();
    });

    it("accepts a long description rather than failing the whole import", async () => {
      const long = { ...ENTRY, description: "x".repeat(1500) };
      await post({
        clients: [{ name: "Ali", phone: "03", entries: [long] }],
      }).expect(200);
      expect(importClientsWithDebts).toHaveBeenCalled();
    });

    it("accepts a client with zero entries", async () => {
      await post({
        clients: [{ name: "Ali", phone: "03", entries: [] }],
      }).expect(200);
      expect(importClientsWithDebts).toHaveBeenCalled();
    });

    it("still rejects a payload that is not an import at all", async () => {
      const res = await post({ clients: "not-an-array" });
      expect(res.body.success).toBe(false);
      expect(importClientsWithDebts).not.toHaveBeenCalled();
    });

    it("rejects an empty client list", async () => {
      const res = await post({ clients: [] });
      expect(res.body.success).toBe(false);
      expect(importClientsWithDebts).not.toHaveBeenCalled();
    });
  });

  it("surfaces a service failure instead of hanging or 200-ing", async () => {
    importClientsWithDebts.mockImplementation(() => {
      throw new Error("debt_ledger insert failed");
    });
    const res = await post({
      clients: [{ name: "Ali", phone: "03", entries: [ENTRY] }],
    });
    expect(res.body.success).toBe(false);
    expect(JSON.stringify(res.body)).toContain("debt_ledger insert failed");
  });

  it("audits the import, matching the desktop handler's client_import row", async () => {
    await post({
      clients: [{ name: "Ali", phone: "03", entries: [ENTRY] }],
    }).expect(200);
    expect(auditLog).toHaveBeenCalled();
    const row = auditLog.mock.calls[0]!.at(-1) as Record<string, unknown>;
    expect(row.entity_type).toBe("client_import");
  });
});
