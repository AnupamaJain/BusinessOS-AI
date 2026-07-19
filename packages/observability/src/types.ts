export interface TraceSpan {
  traceId: string;
  spanId: string;
  name: string;
  organizationId: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  attributes: Record<string, unknown>;
  status: 'ok' | 'error';
  errorMessage?: string;
}

export interface MetricCounter {
  name: string;
  value: number;
  tags: Record<string, string>;
  timestamp: string;
}
