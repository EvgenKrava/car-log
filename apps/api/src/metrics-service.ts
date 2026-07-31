import type { MetricsResponse, ActivityItem } from '@carlog/contracts';
import { ADMIN_GROUP } from './admin-guard';
import { requireAdmin, type AdminActor } from './admin-service';
import type { CognitoUserAdmin } from './cognito-user-admin';
import type { MetricsPort } from './cloudwatch-metrics';
import type { EventRepository } from '@carlog/domain';

export async function getMetrics(
  deps: { users: CognitoUserAdmin; metrics: MetricsPort; events: EventRepository; apiId: string; now: Date },
  actor: AdminActor,
): Promise<MetricsResponse> {
  requireAdmin(actor);
  const { users, metrics, events, apiId, now } = deps;
  const start = new Date(now.getTime() - 30 * 86_400_000);
  const cutoff = start.toISOString();

  // Count all users (paginate).
  const all: { createdAt: string }[] = [];
  let token: string | undefined;
  do {
    const page = await users.listUsers(token);
    all.push(...page.users);
    token = page.nextToken;
  } while (token);
  const adminUsernames = await users.listGroupUsernames(ADMIN_GROUP);

  const [apiTraffic, errors, cost, recent] = await Promise.all([
    metrics.apiTraffic(apiId, start, now),
    metrics.errorTotals(apiId, start, now),
    metrics.estimatedCost(start, now),
    events.recentAcrossOwners(20),
  ]);

  const activity: ActivityItem[] = recent.map((e) => ({
    carId: e.carId, category: e.category, date: e.date, cost: e.cost,
    currency: e.currency, createdAt: e.createdAt, ownerId: e.ownerId,
  }));

  return {
    users: { total: all.length, admins: adminUsernames.size, newLast30d: all.filter((u) => u.createdAt >= cutoff).length },
    apiTraffic, errors, cost, activity,
  };
}
