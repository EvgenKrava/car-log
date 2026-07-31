import {
  CloudWatchClient, GetMetricDataCommand, type MetricDataQuery,
} from '@aws-sdk/client-cloudwatch';

export type ApiTrafficPoint = { date: string; count: number };

export interface MetricsPort {
  apiTraffic(apiId: string, start: Date, end: Date): Promise<ApiTrafficPoint[]>;
  errorTotals(apiId: string, start: Date, end: Date): Promise<{ count4xx: number; count5xx: number; p95LatencyMs: number }>;
  estimatedCost(start: Date, end: Date): Promise<{ currency: string; amount: number; series: { date: string; amount: number }[] }>;
}

const apiDim = (apiId: string) => [{ Name: 'ApiId', Value: apiId }];
const iso = (d: Date) => d.toISOString().slice(0, 10);

export class AwsCloudWatchMetrics implements MetricsPort {
  constructor(private readonly client: CloudWatchClient) {}

  private async get(queries: MetricDataQuery[], start: Date, end: Date) {
    const res = await this.client.send(new GetMetricDataCommand({
      StartTime: start, EndTime: end, MetricDataQueries: queries, ScanBy: 'TimestampAscending',
    }));
    return res.MetricDataResults ?? [];
  }

  async apiTraffic(apiId: string, start: Date, end: Date): Promise<ApiTrafficPoint[]> {
    const [r] = await this.get([{
      Id: 'count',
      MetricStat: { Metric: { Namespace: 'AWS/ApiGateway', MetricName: 'Count', Dimensions: apiDim(apiId) }, Period: 86400, Stat: 'Sum' },
    }], start, end);
    const ts = r?.Timestamps ?? []; const vs = r?.Values ?? [];
    return ts.map((t, i) => ({ date: iso(t), count: vs[i] ?? 0 }));
  }

  async errorTotals(apiId: string, start: Date, end: Date) {
    const results = await this.get([
      { Id: 'e4', MetricStat: { Metric: { Namespace: 'AWS/ApiGateway', MetricName: '4xx', Dimensions: apiDim(apiId) }, Period: 2592000, Stat: 'Sum' } },
      { Id: 'e5', MetricStat: { Metric: { Namespace: 'AWS/ApiGateway', MetricName: '5xx', Dimensions: apiDim(apiId) }, Period: 2592000, Stat: 'Sum' } },
      { Id: 'lat', MetricStat: { Metric: { Namespace: 'AWS/ApiGateway', MetricName: 'Latency', Dimensions: apiDim(apiId) }, Period: 2592000, Stat: 'p95' } },
    ], start, end);
    const sum = (id: string) => (results.find((x) => x.Id === id)?.Values ?? []).reduce((a, b) => a + b, 0);
    const p95 = (results.find((x) => x.Id === 'lat')?.Values ?? [])[0] ?? 0;
    return { count4xx: sum('e4'), count5xx: sum('e5'), p95LatencyMs: Math.round(p95) };
  }

  async estimatedCost(start: Date, end: Date) {
    const [r] = await this.get([{
      Id: 'cost',
      MetricStat: { Metric: { Namespace: 'AWS/Billing', MetricName: 'EstimatedCharges', Dimensions: [{ Name: 'Currency', Value: 'USD' }] }, Period: 86400, Stat: 'Maximum' },
    }], start, end);
    const ts = r?.Timestamps ?? []; const vs = r?.Values ?? [];
    const series = ts.map((t, i) => ({ date: iso(t), amount: vs[i] ?? 0 }));
    return { currency: 'USD', amount: series.length ? series[series.length - 1]!.amount : 0, series };
  }
}