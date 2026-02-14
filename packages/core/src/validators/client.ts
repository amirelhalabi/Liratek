import { z } from "zod";
import { phoneNumberSchema } from "./common.js";

/**
 * Client validation schemas
 */

export const createClientSchema = z.object({
  full_name: z.string().min(1, "Name is required").max(255),
  phone_number: phoneNumberSchema,
  notes: z.string().max(1000).optional(),
  whatsapp_opt_in: z.boolean().default(true),
});

export const updateClientSchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string().min(1).max(255).optional(),
  phone_number: phoneNumberSchema.optional(),
  notes: z.string().max(1000).optional(),
  whatsapp_opt_in: z.boolean().optional(),
});

export const getClientSchema = z.object({
  id: z.number().int().positive(),
});

export const searchClientsSchema = z.object({
  search: z.string().optional(),
  limit: z.number().int().positive().max(100).default(50),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type GetClientInput = z.infer<typeof getClientSchema>;
export type SearchClientsInput = z.infer<typeof searchClientsSchema>;
