import { describe, it, expect, beforeEach } from 'vitest';
import { TracerService, MetricsCollector } from '../index';

const ORG_A = '11111111-1111-1111-1111-111111111111';

describe('Observability Package', () => {
  let tracer: TracerService;
  let metrics: MetricsCollector;

  beforeEach(() => {
    tracer = new TracerService();
    metrics = new MetricsCollector();
  });

  it('starts and ends trace spans accurately', () => {
    const span = tracer.startSpan('agent_graph_execution', ORG_A, { intent: 'package_inquiry' });
    expect(span.spanId).toBeDefined();

    const completed = tracer.endSpan(span.spanId, 'ok');
    expect(completed?.durationMs).toBeGreaterThanOrEqual(0);
    expect(completed?.status).toBe('ok');

    const history = tracer.getCompletedSpans(ORG_A);
    expect(history.length).toBe(1);
  });

  it('increments and sums metrics counters correctly', () => {
    metrics.increment('messages_processed_total', 1, { organizationId: ORG_A, channel: 'whatsapp' });
    metrics.increment('messages_processed_total', 2, { organizationId: ORG_A, channel: 'whatsapp' });

    const total = metrics.getMetricSum('messages_processed_total', { organizationId: ORG_A });
    expect(total).toBe(3);
  });
});
