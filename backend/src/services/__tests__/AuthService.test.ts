/**
 * AuthService Unit Tests
 *
 * Tests all business logic in AuthService with mocked repository and crypto.
 */

import { jest } from '@jest/globals';
import { AuthService, resetAuthService } from "../AuthService";
import { UserRepository } from "../../database/repositories";
import {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  ConflictError,
  BusinessRuleError,
} from "../../utils/errors";

// Mock the repository module
jest.mock("../../database/repositories", () => ({
  getUserRepository: jest.fn(),
  UserRepository: jest.fn(),
}));

// Mock crypto utils
jest.mock("../../utils/crypto", () => ({
  hashPassword: jest.fn().mockResolvedValue("hashed_password"),
  verifyPassword: jest.fn().mockResolvedValue(true),
  needsMigration: jest.fn().mockReturnValue(false),
  validatePasswordComplexity: jest
    .fn()
    .mockReturnValue({ valid: true, errors: [] }),
}));

import {
  hashPassword,
  verifyPassword,
  needsMigration,
  validatePasswordComplexity,
} from "../../utils/crypto";

describe("AuthService", () => {
  let service: AuthService;
  let mockRepo: jest.Mocked<UserRepository>;

  beforeEach(() => {
    resetAuthService();
    jest.clearAllMocks();

    // Create mock repository
    mockRepo = {
      findByUsername: jest.fn(),
      findById: jest.fn(),
      findByIdSafe: jest.fn(),
      updatePassword: jest.fn(),
      usernameExists: jest.fn(),
      createUser: jest.fn(),
      softDeleteById: jest.fn(),
      restore: jest.fn(),
      countActiveAdmins: jest.fn(),
      findAllSafe: jest.fn(),
      findAllIncludingInactive: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    service = new AuthService(mockRepo);
  });

  // ===========================================================================
  // Authentication
  // ===========================================================================

  describe("login", () => {
    const mockUser = {
      id: 1,
      username: "testuser",
      password_hash: "existing_hash",
      role: "cashier" as const,
      is_active: 1,
    };

    const mockSafeUser = {
      id: 1,
      username: "testuser",
      role: "cashier" as const,
      is_active: 1,
    };

    it("successfully logs in a user", async () => {
      mockRepo.findByUsername.mockReturnValue(mockUser as any);
      mockRepo.findByIdSafe.mockReturnValue(mockSafeUser as any);
      (verifyPassword as jest.Mock).mockResolvedValue(true);

      const result = await service.login("testuser", "password123");

      expect(result.success).toBe(true);
      expect(result.user).toEqual(mockSafeUser);
    });

    it("throws ValidationError for empty username", async () => {
      await expect(service.login("", "password123")).rejects.toThrow(
        ValidationError,
      );
    });

    it("throws ValidationError for empty password", async () => {
      await expect(service.login("testuser", "")).rejects.toThrow(
        ValidationError,
      );
    });

    it("throws AuthenticationError for non-existent user", async () => {
      mockRepo.findByUsername.mockReturnValue(null);

      await expect(service.login("unknown", "password123")).rejects.toThrow(
        AuthenticationError,
      );
    });

    it("throws AuthenticationError for invalid password", async () => {
      mockRepo.findByUsername.mockReturnValue(mockUser as any);
      (verifyPassword as jest.Mock).mockResolvedValue(false);

      await expect(service.login("testuser", "wrongpassword")).rejects.toThrow(
        AuthenticationError,
      );
    });

    it("migrates password if needed", async () => {
      mockRepo.findByUsername.mockReturnValue(mockUser as any);
      mockRepo.findByIdSafe.mockReturnValue(mockSafeUser as any);
      (verifyPassword as jest.Mock).mockResolvedValue(true);
      (needsMigration as jest.Mock).mockReturnValue(true);
      (hashPassword as jest.Mock).mockResolvedValue("new_hash");

      await service.login("testuser", "password123");

      expect(mockRepo.updatePassword).toHaveBeenCalledWith(1, "new_hash");
    });

    it("does not migrate password if not needed", async () => {
      mockRepo.findByUsername.mockReturnValue(mockUser as any);
      mockRepo.findByIdSafe.mockReturnValue(mockSafeUser as any);
      (verifyPassword as jest.Mock).mockResolvedValue(true);
      (needsMigration as jest.Mock).mockReturnValue(false);

      await service.login("testuser", "password123");

      expect(mockRepo.updatePassword).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // User Management
  // ===========================================================================

  describe("createUser", () => {
    it("creates user successfully as admin", async () => {
      mockRepo.usernameExists.mockReturnValue(false);
      mockRepo.createUser.mockReturnValue({ id: 2 } as any);
      mockRepo.findByIdSafe.mockReturnValue({
        id: 2,
        username: "newuser",
        role: "cashier",
        is_active: 1,
      } as any);

      const result = await service.createUser(
        { username: "newuser", password: "Password123!", role: "cashier" },
        "admin",
      );

      expect(result.success).toBe(true);
      expect(result.user?.username).toBe("newuser");
    });

    it("throws AuthorizationError for non-admin actor", async () => {
      await expect(
        service.createUser(
          { username: "newuser", password: "Password123!", role: "cashier" },
          "cashier",
        ),
      ).rejects.toThrow(AuthorizationError);
    });

    it("throws ValidationError for empty username", async () => {
      await expect(
        service.createUser(
          { username: "", password: "Password123!", role: "cashier" },
          "admin",
        ),
      ).rejects.toThrow(ValidationError);
    });

    it("throws ValidationError for short username", async () => {
      await expect(
        service.createUser(
          { username: "ab", password: "Password123!", role: "cashier" },
          "admin",
        ),
      ).rejects.toThrow(ValidationError);
    });

    it("throws ValidationError for invalid password", async () => {
      (validatePasswordComplexity as jest.Mock).mockReturnValue({
        valid: false,
        errors: ["Password too weak"],
      });

      await expect(
        service.createUser(
          { username: "newuser", password: "weak", role: "cashier" },
          "admin",
        ),
      ).rejects.toThrow(ValidationError);
    });

    it("throws ConflictError for duplicate username", async () => {
      (validatePasswordComplexity as jest.Mock).mockReturnValue({
        valid: true,
        errors: [],
      });
      mockRepo.usernameExists.mockReturnValue(true);

      await expect(
        service.createUser(
          {
            username: "existinguser",
            password: "Password123!",
            role: "cashier",
          },
          "admin",
        ),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("changePassword", () => {
    const mockUser = {
      id: 1,
      username: "testuser",
      password_hash: "existing_hash",
      role: "cashier",
    };

    beforeEach(() => {
      (validatePasswordComplexity as jest.Mock).mockReturnValue({
        valid: true,
        errors: [],
      });
    });

    it("changes password successfully", async () => {
      mockRepo.findById.mockReturnValue(mockUser as any);
      mockRepo.updatePassword.mockReturnValue(true);
      (verifyPassword as jest.Mock).mockResolvedValue(true);

      const result = await service.changePassword(
        1,
        "oldPassword",
        "NewPassword123!",
      );

      expect(result.success).toBe(true);
      expect(mockRepo.updatePassword).toHaveBeenCalled();
    });

    it("throws AuthenticationError for non-existent user", async () => {
      mockRepo.findById.mockReturnValue(null);

      await expect(
        service.changePassword(999, "oldPassword", "NewPassword123!"),
      ).rejects.toThrow(AuthenticationError);
    });

    it("throws AuthenticationError for incorrect current password", async () => {
      mockRepo.findById.mockReturnValue(mockUser as any);
      (verifyPassword as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword(1, "wrongPassword", "NewPassword123!"),
      ).rejects.toThrow(AuthenticationError);
    });

    it("throws ValidationError for invalid new password", async () => {
      mockRepo.findById.mockReturnValue(mockUser as any);
      (verifyPassword as jest.Mock).mockResolvedValue(true);
      (validatePasswordComplexity as jest.Mock).mockReturnValue({
        valid: false,
        errors: ["Password too weak"],
      });

      await expect(
        service.changePassword(1, "oldPassword", "weak"),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("resetPassword", () => {
    const mockUser = {
      id: 1,
      username: "testuser",
      password_hash: "existing_hash",
      role: "cashier",
    };

    beforeEach(() => {
      (validatePasswordComplexity as jest.Mock).mockReturnValue({
        valid: true,
        errors: [],
      });
    });

    it("resets password successfully as admin", async () => {
      mockRepo.findById.mockReturnValue(mockUser as any);
      mockRepo.updatePassword.mockReturnValue(true);

      const result = await service.resetPassword(1, "NewPassword123!", "admin");

      expect(result.success).toBe(true);
    });

    it("throws AuthorizationError for non-admin actor", async () => {
      await expect(
        service.resetPassword(1, "NewPassword123!", "cashier"),
      ).rejects.toThrow(AuthorizationError);
    });

    it("throws AuthenticationError for non-existent user", async () => {
      mockRepo.findById.mockReturnValue(null);

      await expect(
        service.resetPassword(999, "NewPassword123!", "admin"),
      ).rejects.toThrow(AuthenticationError);
    });
  });

  describe("deactivateUser", () => {
    const mockUser = {
      id: 2,
      username: "otheruser",
      role: "cashier",
      is_active: 1,
    };

    it("deactivates user successfully as admin", () => {
      mockRepo.findById.mockReturnValue(mockUser as any);
      mockRepo.softDeleteById.mockReturnValue(true);

      const result = service.deactivateUser(2, 1, "admin");

      expect(result).toBe(true);
      expect(mockRepo.softDeleteById).toHaveBeenCalledWith(2);
    });

    it("throws AuthorizationError for non-admin actor", () => {
      expect(() => service.deactivateUser(2, 1, "cashier")).toThrow(
        AuthorizationError,
      );
    });

    it("throws BusinessRuleError when trying to deactivate self", () => {
      expect(() => service.deactivateUser(1, 1, "admin")).toThrow(
        BusinessRuleError,
      );
    });

    it("throws BusinessRuleError when deactivating last admin", () => {
      const adminUser = {
        id: 2,
        username: "admin",
        role: "admin",
        is_active: 1,
      };
      mockRepo.findById.mockReturnValue(adminUser as any);
      mockRepo.countActiveAdmins.mockReturnValue(1);

      expect(() => service.deactivateUser(2, 1, "admin")).toThrow(
        BusinessRuleError,
      );
    });
  });

  describe("reactivateUser", () => {
    it("reactivates user successfully as admin", () => {
      mockRepo.restore.mockReturnValue(true);

      const result = service.reactivateUser(2, "admin");

      expect(result).toBe(true);
      expect(mockRepo.restore).toHaveBeenCalledWith(2);
    });

    it("throws AuthorizationError for non-admin actor", () => {
      expect(() => service.reactivateUser(2, "cashier")).toThrow(
        AuthorizationError,
      );
    });
  });

  // ===========================================================================
  // Query Methods
  // ===========================================================================

  describe("getAllUsers", () => {
    it("returns all active users", () => {
      const mockUsers = [
        { id: 1, username: "user1", role: "admin", is_active: 1 },
        { id: 2, username: "user2", role: "cashier", is_active: 1 },
      ];
      mockRepo.findAllSafe.mockReturnValue(mockUsers as any);

      const result = service.getAllUsers();

      expect(result).toEqual(mockUsers);
    });
  });

  describe("getAllUsersIncludingInactive", () => {
    it("returns all users including inactive as admin", () => {
      const mockUsers = [
        { id: 1, username: "user1", role: "admin", is_active: 1 },
        { id: 2, username: "user2", role: "cashier", is_active: 0 },
      ];
      mockRepo.findAllIncludingInactive.mockReturnValue(mockUsers as any);

      const result = service.getAllUsersIncludingInactive("admin");

      expect(result).toEqual(mockUsers);
    });

    it("throws AuthorizationError for non-admin actor", () => {
      expect(() => service.getAllUsersIncludingInactive("cashier")).toThrow(
        AuthorizationError,
      );
    });
  });

  describe("getUserById", () => {
    it("returns user by ID", () => {
      const mockUser = {
        id: 1,
        username: "testuser",
        role: "cashier",
        is_active: 1,
      };
      mockRepo.findByIdSafe.mockReturnValue(mockUser as any);

      const result = service.getUserById(1);

      expect(result).toEqual(mockUser);
    });

    it("returns null for non-existent user", () => {
      mockRepo.findByIdSafe.mockReturnValue(null);

      const result = service.getUserById(999);

      expect(result).toBeNull();
    });
  });

  describe("canPerformAction", () => {
    it("allows admin to perform admin actions", () => {
      expect(service.canPerformAction("admin", "admin")).toBe(true);
    });

    it("denies cashier from admin actions", () => {
      expect(service.canPerformAction("cashier", "admin")).toBe(false);
    });

    it("allows admin to perform cashier actions", () => {
      expect(service.canPerformAction("admin", "cashier")).toBe(true);
    });

    it("allows cashier to perform cashier actions", () => {
      expect(service.canPerformAction("cashier", "cashier")).toBe(true);
    });
  });
});
