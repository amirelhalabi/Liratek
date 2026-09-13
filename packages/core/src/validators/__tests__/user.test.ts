/**
 * packages/core/src/validators/user.ts — shared user-management schemas.
 *
 * Two things matter here:
 *  1. Each schema accepts exactly the payload shape the frontend/IPC/REST
 *     layers actually send, and rejects the obvious bad inputs.
 *  2. `createUserSchema` does NOT require `full_name` — that field belongs
 *     to the dead, deleted `validators/auth.ts` schemas of the same name,
 *     which required it even though the `users` table has never had a
 *     `full_name` column. This is the trap Task 2 of the web-user-management
 *     fix removed: the next person reaching for `createUserSchema` by name
 *     must land on THIS definition, not resurrect the old one.
 */

import {
  createUserSchema,
  setUserPasswordBodySchema,
  setUserPasswordSchema,
  setUserActiveBodySchema,
  setUserActiveSchema,
  setUserRoleBodySchema,
  setUserRoleSchema,
} from "../user";

describe("createUserSchema", () => {
  it("accepts the exact payload the frontend/IPC send", () => {
    const result = createUserSchema.safeParse({
      username: "cashier1",
      password: "1234",
      role: "staff",
    });
    expect(result.success).toBe(true);
  });

  it("does NOT require full_name — the trap the old validators/auth.ts copy set", () => {
    const result = createUserSchema.safeParse({
      username: "cashier1",
      password: "1234",
      role: "staff",
      // deliberately no full_name key at all
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("full_name");
    }
  });

  it("rejects an empty username", () => {
    const result = createUserSchema.safeParse({
      username: "",
      password: "1234",
      role: "staff",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a password shorter than 4 characters", () => {
    const result = createUserSchema.safeParse({
      username: "cashier1",
      password: "123",
      role: "staff",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a 4-character password (the exact boundary)", () => {
    const result = createUserSchema.safeParse({
      username: "cashier1",
      password: "1234",
      role: "staff",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a role outside admin/staff", () => {
    const result = createUserSchema.safeParse({
      username: "cashier1",
      password: "1234",
      role: "super_admin",
    });
    expect(result.success).toBe(false);
  });
});

describe("setUserPasswordBodySchema / setUserPasswordSchema", () => {
  it("body schema accepts just { password } — REST's body shape (id comes from the URL param)", () => {
    const result = setUserPasswordBodySchema.safeParse({ password: "5678" });
    expect(result.success).toBe(true);
  });

  it("body schema rejects a short password", () => {
    const result = setUserPasswordBodySchema.safeParse({ password: "abc" });
    expect(result.success).toBe(false);
  });

  it("full schema accepts IPC's flat { id, password } payload", () => {
    const result = setUserPasswordSchema.safeParse({ id: 5, password: "5678" });
    expect(result.success).toBe(true);
  });

  it("full schema rejects a non-positive id", () => {
    const result = setUserPasswordSchema.safeParse({ id: 0, password: "5678" });
    expect(result.success).toBe(false);
  });

  it("full schema rejects a missing id (REST-shaped payload used where IPC's is required)", () => {
    const result = setUserPasswordSchema.safeParse({ password: "5678" });
    expect(result.success).toBe(false);
  });
});

describe("setUserActiveBodySchema / setUserActiveSchema", () => {
  it("body schema accepts is_active: 1 and is_active: 0", () => {
    expect(setUserActiveBodySchema.safeParse({ is_active: 1 }).success).toBe(
      true,
    );
    expect(setUserActiveBodySchema.safeParse({ is_active: 0 }).success).toBe(
      true,
    );
  });

  it("body schema rejects a boolean or any value other than the literals 0/1", () => {
    expect(setUserActiveBodySchema.safeParse({ is_active: true }).success).toBe(
      false,
    );
    expect(setUserActiveBodySchema.safeParse({ is_active: 2 }).success).toBe(
      false,
    );
  });

  it("full schema accepts IPC's flat { id, is_active } payload", () => {
    const result = setUserActiveSchema.safeParse({ id: 3, is_active: 0 });
    expect(result.success).toBe(true);
  });

  it("full schema rejects a non-positive id", () => {
    const result = setUserActiveSchema.safeParse({ id: -1, is_active: 1 });
    expect(result.success).toBe(false);
  });
});

describe("setUserRoleBodySchema / setUserRoleSchema", () => {
  it("body schema accepts { role: 'admin' } and { role: 'staff' } — REST's body shape", () => {
    expect(setUserRoleBodySchema.safeParse({ role: "admin" }).success).toBe(
      true,
    );
    expect(setUserRoleBodySchema.safeParse({ role: "staff" }).success).toBe(
      true,
    );
  });

  it("body schema rejects an unrecognized role", () => {
    const result = setUserRoleBodySchema.safeParse({ role: "super_admin" });
    expect(result.success).toBe(false);
  });

  it("full schema accepts IPC's flat { id, role } payload", () => {
    const result = setUserRoleSchema.safeParse({ id: 7, role: "admin" });
    expect(result.success).toBe(true);
  });

  it("full schema rejects a non-integer id", () => {
    const result = setUserRoleSchema.safeParse({ id: 1.5, role: "admin" });
    expect(result.success).toBe(false);
  });
});
