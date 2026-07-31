import { z } from 'zod';

export const AdminUserSchema = z.object({
  username: z.string().min(1),
  sub: z.string().min(1),
  email: z.string().email().or(z.literal('')),
  status: z.string(),
  enabled: z.boolean(),
  createdAt: z.string(),
  isAdmin: z.boolean(),
});

export const ListUsersResponseSchema = z.object({
  users: z.array(AdminUserSchema),
  nextToken: z.string().optional(),
});

export const SetEnabledSchema = z.object({ enabled: z.boolean() });

export type AdminUser = z.infer<typeof AdminUserSchema>;
export type ListUsersResponse = z.infer<typeof ListUsersResponseSchema>;
export type SetEnabledInput = z.infer<typeof SetEnabledSchema>;
