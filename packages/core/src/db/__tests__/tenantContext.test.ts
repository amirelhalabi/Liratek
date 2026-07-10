/**
 * Tenant context (WP1b) — AsyncLocalStorage-based, fail-closed.
 *
 * These tests are the proof that the fail-closed design backbone actually
 * holds: no default tenant ever, ALS scoping survives interleaved async
 * work, nested scopes override cleanly, and the Electron fixed-fallback
 * mode only kicks in when there is no active per-request scope.
 */

import {
  TenantContextError,
  runWithTenant,
  runWithoutTenant,
  getCurrentTenantId,
  isTenantBypass,
  initFixedTenantContext,
  resetTenantContext,
} from "../tenantContext";

describe("tenantContext", () => {
  // The package-wide jest setup (src/jest.setup.ts) calls
  // initFixedTenantContext(1) once for the whole test process, so every test
  // here must reset it in beforeEach (not just afterEach) — otherwise the
  // very first "fail-closed" case would start with that fallback still set.
  beforeEach(() => {
    resetTenantContext();
  });

  afterEach(() => {
    // Clear the fixed fallback between tests so cases don't leak into each
    // other — ALS scopes never leak on their own (they end when run() returns).
    resetTenantContext();
  });

  // ---------------------------------------------------------------------------
  // Fail-closed
  // ---------------------------------------------------------------------------

  describe("fail-closed (no context)", () => {
    it("throws TenantContextError when nothing is set", () => {
      expect(() => getCurrentTenantId()).toThrow(TenantContextError);
      expect(() => getCurrentTenantId()).toThrow(/no tenant context/i);
    });

    it("isTenantBypass() is false with no context", () => {
      expect(isTenantBypass()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // runWithTenant
  // ---------------------------------------------------------------------------

  describe("runWithTenant", () => {
    it("scopes getCurrentTenantId() to the given tenant for the extent of fn", () => {
      const result = runWithTenant(7, () => {
        expect(getCurrentTenantId()).toBe(7);
        return "done";
      });
      expect(result).toBe("done");
    });

    it("un-scopes once the callback returns — throws again outside", () => {
      runWithTenant(3, () => {
        expect(getCurrentTenantId()).toBe(3);
      });
      expect(() => getCurrentTenantId()).toThrow(TenantContextError);
    });

    it("supports an async fn, keeping the scope across every await inside it", async () => {
      const result = await runWithTenant(9, async () => {
        expect(getCurrentTenantId()).toBe(9);
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(getCurrentTenantId()).toBe(9);
        await Promise.resolve();
        return getCurrentTenantId();
      });
      expect(result).toBe(9);
      expect(() => getCurrentTenantId()).toThrow(TenantContextError);
    });
  });

  // ---------------------------------------------------------------------------
  // Nested override
  // ---------------------------------------------------------------------------

  describe("nested runWithTenant", () => {
    it("a nested call overrides the outer tenant for its own extent, then restores it", () => {
      const seen: number[] = [];
      runWithTenant(1, () => {
        seen.push(getCurrentTenantId()); // 1
        runWithTenant(2, () => {
          seen.push(getCurrentTenantId()); // 2 — overridden
        });
        seen.push(getCurrentTenantId()); // back to 1
      });
      expect(seen).toEqual([1, 2, 1]);
    });
  });

  // ---------------------------------------------------------------------------
  // Async interleaving — the whole reason this is ALS-based and not a plain
  // module-level variable: two concurrent "requests" must never see each
  // other's tenant id, even though their awaits interleave on the event loop.
  // ---------------------------------------------------------------------------

  describe("async interleaving", () => {
    it("two interleaved async chains with different tenant ids never leak into each other", async () => {
      const observedA: number[] = [];
      const observedB: number[] = [];

      const chainA = runWithTenant(101, async () => {
        observedA.push(getCurrentTenantId());
        await new Promise((resolve) => setTimeout(resolve, 15));
        observedA.push(getCurrentTenantId());
        await new Promise((resolve) => setTimeout(resolve, 5));
        observedA.push(getCurrentTenantId());
      });

      const chainB = runWithTenant(202, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        observedB.push(getCurrentTenantId());
        await new Promise((resolve) => setTimeout(resolve, 15));
        observedB.push(getCurrentTenantId());
        observedB.push(getCurrentTenantId());
      });

      // Both chains are in flight concurrently, their setTimeout callbacks
      // firing in an interleaved order (B's first timer fires before A's).
      await Promise.all([chainA, chainB]);

      expect(observedA).toEqual([101, 101, 101]);
      expect(observedB).toEqual([202, 202, 202]);
    });

    it("survives Promise.all fan-out of many tenants without cross-talk", async () => {
      const tenantIds = [11, 22, 33, 44, 55];
      const results = await Promise.all(
        tenantIds.map((tenantId) =>
          runWithTenant(tenantId, async () => {
            // Randomize ordering via variable delays so callbacks interleave.
            await new Promise((resolve) =>
              setTimeout(resolve, (tenantId % 5) + 1),
            );
            return getCurrentTenantId();
          }),
        ),
      );
      expect(results).toEqual(tenantIds);
    });
  });

  // ---------------------------------------------------------------------------
  // Fixed fallback (Electron/desktop mode)
  // ---------------------------------------------------------------------------

  describe("fixed fallback", () => {
    it("resolves to the fixed tenant id when no ALS scope is active", () => {
      initFixedTenantContext(1);
      expect(getCurrentTenantId()).toBe(1);
    });

    it("resetTenantContext() clears the fixed fallback — throws again after", () => {
      initFixedTenantContext(5);
      expect(getCurrentTenantId()).toBe(5);
      resetTenantContext();
      expect(() => getCurrentTenantId()).toThrow(TenantContextError);
    });

    it("ALS scope wins over the fixed fallback", () => {
      initFixedTenantContext(1);
      runWithTenant(999, () => {
        expect(getCurrentTenantId()).toBe(999);
      });
      // Outside the ALS scope, falls back to the fixed tenant again.
      expect(getCurrentTenantId()).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Bypass (runWithoutTenant) — control-plane escape hatch
  // ---------------------------------------------------------------------------

  describe("runWithoutTenant (bypass)", () => {
    it("isTenantBypass() is true only inside the bypass scope", () => {
      expect(isTenantBypass()).toBe(false);
      runWithoutTenant(() => {
        expect(isTenantBypass()).toBe(true);
      });
      expect(isTenantBypass()).toBe(false);
    });

    it("getCurrentTenantId() throws inside a bypass scope, even with a fixed fallback set", () => {
      initFixedTenantContext(1);
      runWithoutTenant(() => {
        expect(() => getCurrentTenantId()).toThrow(TenantContextError);
      });
    });

    it("getCurrentTenantId() throws inside a bypass scope nested under runWithTenant", () => {
      runWithTenant(42, () => {
        expect(getCurrentTenantId()).toBe(42);
        runWithoutTenant(() => {
          expect(isTenantBypass()).toBe(true);
          expect(() => getCurrentTenantId()).toThrow(TenantContextError);
        });
        // Outer tenant scope is restored once the bypass callback returns.
        expect(getCurrentTenantId()).toBe(42);
        expect(isTenantBypass()).toBe(false);
      });
    });

    it("a runWithTenant nested inside runWithoutTenant overrides the bypass", () => {
      runWithoutTenant(() => {
        expect(isTenantBypass()).toBe(true);
        runWithTenant(7, () => {
          expect(isTenantBypass()).toBe(false);
          expect(getCurrentTenantId()).toBe(7);
        });
        expect(isTenantBypass()).toBe(true);
      });
    });
  });
});
