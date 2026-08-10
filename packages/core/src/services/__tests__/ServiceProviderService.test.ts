/**
 * ServiceProviderService — write path (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md
 * §5b phase 5). Unit-tested against a MOCKED repository (rule 13 — services
 * are testable without a DB), isolating the two money-safety invariants this
 * service layer exists to enforce:
 *
 * 1. `createProvider` ALWAYS forces `drawer_name: "General"` — never the
 *    caller's value, even if one is present on the input (a hand-built
 *    IPC/REST payload, or a future caller that forgot the Zod schema
 *    doesn't offer the field).
 * 2. `updateProvider` forwards ONLY `label`/`is_active` to the repository —
 *    `code`/`drawer_name`/`is_system_provider` are never forwarded, even if
 *    present on the input.
 *
 * Rule 17: both invariants were written test-first against the pre-fix
 * service (a version that spread `...data` into the repository call instead
 * of hardcoding the safe fields) — the "forces General" and "forwards only
 * label/is_active" tests failed against that version (observed directly
 * while developing this file, then reverted) before the current
 * hardcoded-field implementation made them pass.
 */

import {
  ServiceProviderService,
  type ServiceProviderResult,
} from "../ServiceProviderService.js";
import type { ServiceProviderRepository } from "../../repositories/ServiceProviderRepository.js";

function makeMockRepo() {
  return {
    getAll: jest.fn(),
    getActive: jest.fn(),
    getByCode: jest.fn(),
    getById: jest.fn(),
    createProvider: jest.fn(),
    updateProvider: jest.fn(),
    deleteProvider: jest.fn(),
  } as unknown as jest.Mocked<ServiceProviderRepository>;
}

describe("ServiceProviderService — write path (§5b phase 5)", () => {
  describe("createProvider", () => {
    it("forces drawer_name to 'General', ignoring any caller-supplied value", () => {
      const repo = makeMockRepo();
      (repo.createProvider as jest.Mock).mockReturnValue({
        success: true,
        id: 42,
      } as ServiceProviderResult);
      const service = new ServiceProviderService(repo);

      const result = service.createProvider({
        code: "SYRIA",
        label: "Syria",
        // @ts-expect-error — not part of CreateServiceProviderInput;
        // simulate a hand-built payload that includes it anyway.
        drawer_name: "Whish_System",
      });

      expect(result).toEqual({ success: true, id: 42 });
      expect(repo.createProvider).toHaveBeenCalledTimes(1);
      expect(repo.createProvider).toHaveBeenCalledWith({
        code: "SYRIA",
        label: "Syria",
        drawer_name: "General",
      });
    });

    it("does not forward is_system_provider even if the caller supplies it", () => {
      const repo = makeMockRepo();
      (repo.createProvider as jest.Mock).mockReturnValue({ success: true });
      const service = new ServiceProviderService(repo);

      service.createProvider({
        code: "SYRIA",
        label: "Syria",
        // @ts-expect-error — same reasoning as above.
        is_system_provider: 1,
      });

      const call = (repo.createProvider as jest.Mock).mock.calls[0][0];
      expect(call).not.toHaveProperty("is_system_provider");
    });

    it("rejects an empty code without calling the repository", () => {
      const repo = makeMockRepo();
      const service = new ServiceProviderService(repo);

      const result = service.createProvider({ code: "", label: "Syria" });

      expect(result.success).toBe(false);
      expect(repo.createProvider).not.toHaveBeenCalled();
    });

    it("rejects an empty label without calling the repository", () => {
      const repo = makeMockRepo();
      const service = new ServiceProviderService(repo);

      const result = service.createProvider({ code: "SYRIA", label: "  " });

      expect(result.success).toBe(false);
      expect(repo.createProvider).not.toHaveBeenCalled();
    });

    it("rejects a code containing whitespace without calling the repository", () => {
      const repo = makeMockRepo();
      const service = new ServiceProviderService(repo);

      const result = service.createProvider({
        code: "SY RIA",
        label: "Syria",
      });

      expect(result.success).toBe(false);
      expect(repo.createProvider).not.toHaveBeenCalled();
    });

    it("propagates a repository failure (e.g. duplicate code) unchanged", () => {
      const repo = makeMockRepo();
      (repo.createProvider as jest.Mock).mockReturnValue({
        success: false,
        error: "Service provider code 'SYRIA' already exists",
      });
      const service = new ServiceProviderService(repo);

      const result = service.createProvider({
        code: "SYRIA",
        label: "Syria",
      });

      expect(result).toEqual({
        success: false,
        error: "Service provider code 'SYRIA' already exists",
      });
    });

    it("propagates a thrown repository error as a structured failure instead of throwing", () => {
      const repo = makeMockRepo();
      (repo.createProvider as jest.Mock).mockImplementation(() => {
        throw new Error("boom");
      });
      const service = new ServiceProviderService(repo);

      const result = service.createProvider({
        code: "SYRIA",
        label: "Syria",
      });

      expect(result).toEqual({ success: false, error: "boom" });
    });
  });

  describe("updateProvider", () => {
    it("forwards only label/is_active to the repository", () => {
      const repo = makeMockRepo();
      (repo.updateProvider as jest.Mock).mockReturnValue({ success: true });
      const service = new ServiceProviderService(repo);

      service.updateProvider(7, { label: "Syria Remit", is_active: 0 });

      expect(repo.updateProvider).toHaveBeenCalledWith(7, {
        label: "Syria Remit",
        is_active: 0,
      });
    });

    it("never forwards code/drawer_name/is_system_provider, even if present on the input", () => {
      const repo = makeMockRepo();
      (repo.updateProvider as jest.Mock).mockReturnValue({ success: true });
      const service = new ServiceProviderService(repo);

      service.updateProvider(7, {
        label: "Syria Remit",
        // @ts-expect-error — simulate a hand-built payload with smuggled
        // fields that UpdateServiceProviderInput does not declare.
        code: "HACKED",
        drawer_name: "Whish_System",
        is_system_provider: 1,
      });

      const [, forwarded] = (repo.updateProvider as jest.Mock).mock.calls[0];
      expect(forwarded).toEqual({ label: "Syria Remit", is_active: undefined });
      expect(forwarded).not.toHaveProperty("code");
      expect(forwarded).not.toHaveProperty("drawer_name");
      expect(forwarded).not.toHaveProperty("is_system_provider");
    });

    it("propagates a repository failure unchanged", () => {
      const repo = makeMockRepo();
      (repo.updateProvider as jest.Mock).mockReturnValue({
        success: false,
        error: "Service provider not found",
      });
      const service = new ServiceProviderService(repo);

      const result = service.updateProvider(999, { label: "Nope" });

      expect(result).toEqual({
        success: false,
        error: "Service provider not found",
      });
    });
  });

  describe("deleteProvider", () => {
    it("delegates to the repository and returns its result unchanged (system-row rejection surfaces as-is)", () => {
      const repo = makeMockRepo();
      (repo.deleteProvider as jest.Mock).mockReturnValue({
        success: false,
        error: "Cannot delete system service provider",
      });
      const service = new ServiceProviderService(repo);

      const result = service.deleteProvider(1);

      expect(result).toEqual({
        success: false,
        error: "Cannot delete system service provider",
      });
      expect(repo.deleteProvider).toHaveBeenCalledWith(1);
    });

    it("returns success for a real deletion", () => {
      const repo = makeMockRepo();
      (repo.deleteProvider as jest.Mock).mockReturnValue({ success: true });
      const service = new ServiceProviderService(repo);

      const result = service.deleteProvider(2);

      expect(result).toEqual({ success: true });
    });
  });

  describe("listAll / listActive", () => {
    it("listAll delegates to repo.getAll", () => {
      const repo = makeMockRepo();
      (repo.getAll as jest.Mock).mockReturnValue([{ id: 1 }]);
      const service = new ServiceProviderService(repo);

      expect(service.listAll()).toEqual([{ id: 1 }]);
    });

    it("listAll returns [] (not a throw) if the repository throws", () => {
      const repo = makeMockRepo();
      (repo.getAll as jest.Mock).mockImplementation(() => {
        throw new Error("boom");
      });
      const service = new ServiceProviderService(repo);

      expect(service.listAll()).toEqual([]);
    });
  });
});
