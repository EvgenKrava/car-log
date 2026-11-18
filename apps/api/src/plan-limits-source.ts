import { GetParameterCommand, type SSMClient } from '@aws-sdk/client-ssm';
import { DEFAULT_PLAN_LIMITS, parsePlanLimits, type PlanLimits } from '@carlog/domain';

const TTL_MS = 5 * 60_000;

// Reads the shared Only Tools plan limits from SSM, cached per warm Lambda for 5 minutes.
// A missing parameter or any read error falls back to the defaults, so a broken SSM read
// never blocks a user (it only means the built-in Free/Plus numbers apply).
export function ssmPlanLimits(ssm: SSMClient, name: string, now: () => number = Date.now): () => Promise<PlanLimits> {
  let cached: { at: number; value: PlanLimits } | null = null;
  return async () => {
    if (cached && now() - cached.at < TTL_MS) return cached.value;
    let value = DEFAULT_PLAN_LIMITS;
    try {
      const res = await ssm.send(new GetParameterCommand({ Name: name }));
      value = parsePlanLimits(res.Parameter?.Value);
    } catch (err) {
      if ((err as { name?: string })?.name !== 'ParameterNotFound') console.warn('plan limits: using defaults', err);
    }
    cached = { at: now(), value };
    return value;
  };
}
