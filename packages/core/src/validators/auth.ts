import { z } from "zod";

/**
 * Authentication validation schemas
 */

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required").max(100),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().default(false),
});

export const createUserSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(100),
  password: z.string().min(6, "Password must be at least 6 characters"),
  full_name: z.string().min(1, "Full name is required").max(255),
  role: z.enum(["admin", "cashier", "viewer"]),
});

export const updateUserSchema = z.object({
  id: z.number().int().positive(),
  username: z.string().min(3).max(100).optional(),
  password: z.string().min(6).optional(),
  full_name: z.string().min(1).max(255).optional(),
  role: z.enum(["admin", "cashier", "viewer"]).optional(),
  is_active: z.boolean().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
