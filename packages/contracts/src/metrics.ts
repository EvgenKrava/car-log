import { z } from 'zod';

export const MetricPointSchema = z.object({ date: z.string(), count: z.number() });
export const CostPointSchema = z.object({ date: z.string(), amount: z.number() });
export const ActivityItemSchema = z.object({
  carId: z.string(),
  category: z.string(),
  date: z.string(),
  cost: z.number(),
  currency: z.string(),
  createdAt: z.string(),
  ownerId: z.string(),
});
export const MetricsResponseSchema = z.object({
  users: z.object({ total: z.number(), admins: z.number(), newLast30d: z.number() }),
  apiTraffic: z.array(MetricPointSchema),
  errors: z.object({ count4xx: z.number(), count5xx: z.number(), p95LatencyMs: z.number() }),
  cost: z.object({ currency: z.string(), amount: z.number(), series: z.array(CostPointSchema) }),
  activity: z.array(ActivityItemSchema),
});

export type MetricPoint = z.infer<typeof MetricPointSchema>;
export type ActivityItem = z.infer<typeof ActivityItemSchema>;
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;