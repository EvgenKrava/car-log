import { z } from 'zod';
import { EventCategorySchema } from './event';

export const MAX_REMINDERS_PER_CAR = 20;
export const REMINDER_LEAD_DAYS = 30;
export const REMINDER_LEAD_KM = 1000;

// Same empty-string→undefined convention as event.ts optText: the form submits ''
// for cleared optional inputs.
const optText = (s: z.ZodString) => z.literal('').transform(() => undefined).or(s.optional());

const ReminderFieldsSchema = z.object({
  title: z.string().min(1).max(120),
  category: EventCategorySchema,
  notes: optText(z.string().max(500)),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').optional(),
  dueMileage: z.number().int().min(0).optional(),
  repeatMonths: z.number().int().min(1).max(120).optional(),
  repeatKm: z.number().int().min(100).optional(),
});

// A repeat interval without its base target is meaningless — there is nothing to advance.
const reminderRules = (r: z.infer<typeof ReminderFieldsSchema>, ctx: z.RefinementCtx): void => {
  if (r.dueDate === undefined && r.dueMileage === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'set dueDate or dueMileage', path: ['dueDate'] });
  }
  if (r.repeatMonths !== undefined && r.dueDate === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'repeatMonths requires dueDate', path: ['repeatMonths'] });
  }
  if (r.repeatKm !== undefined && r.dueMileage === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'repeatKm requires dueMileage', path: ['repeatKm'] });
  }
};

export const CreateReminderSchema = ReminderFieldsSchema.superRefine(reminderRules);

export const ReminderSchema = ReminderFieldsSchema.extend({
  id: z.string().uuid(),
  carId: z.string().uuid(),
  ownerId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).superRefine(reminderRules);

export const CompleteReminderSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
  mileage: z.number().int().min(0),
});

export type Reminder = z.infer<typeof ReminderSchema>;
export type CreateReminderInput = z.infer<typeof CreateReminderSchema>;
export type CompleteReminderInput = z.infer<typeof CompleteReminderSchema>;