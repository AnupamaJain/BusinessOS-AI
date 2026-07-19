import type { MetricCounter } from './types';

export class MetricsCollector {
  private metricsStore: MetricCounter[] = [];

  public increment(name: string, value: number = 1, tags: Record<string, string> = {}): void {
    this.metricsStore.push({
      name,
      value,
      tags,
      timestamp: new Date().toISOString()
    });
  }

  public getMetricSum(name: string, tags?: Record<string, string>): number {
    return this.metricsStore
      .filter(m => m.name === name && (!tags || Object.entries(tags).every(([k, v]) => m.tags[k] === v)))
      .reduce((sum, m) => sum + m.value, 0);
  }
}
