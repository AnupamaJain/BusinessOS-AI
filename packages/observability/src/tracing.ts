import type { TraceSpan } from './types';
import { randomUUID } from 'crypto';
import { logger } from '@business-os-ai/shared-types';

export class TracerService {
  private activeSpans: Map<string, TraceSpan> = new Map();
  private completedSpans: TraceSpan[] = [];

  public startSpan(name: string, organizationId: string, attributes: Record<string, unknown> = {}): TraceSpan {
    const spanId = randomUUID();
    const traceId = (attributes['traceId'] as string) ?? randomUUID();
    const span: TraceSpan = {
      traceId,
      spanId,
      name,
      organizationId,
      startTime: Date.now(),
      attributes,
      status: 'ok'
    };

    this.activeSpans.set(spanId, span);
    return span;
  }

  public endSpan(spanId: string, status: 'ok' | 'error' = 'ok', errorMessage?: string): TraceSpan | undefined {
    const span = this.activeSpans.get(spanId);
    if (span) {
      span.endTime = Date.now();
      span.durationMs = span.endTime - span.startTime;
      span.status = status;
      span.errorMessage = errorMessage;

      this.activeSpans.delete(spanId);
      this.completedSpans.push(span);

      logger.info(`[TraceSpan] ${span.name} completed in ${span.durationMs}ms`, {
        traceId: span.traceId,
        organizationId: span.organizationId,
        status: span.status
      });

      return span;
    }
    return undefined;
  }

  public getCompletedSpans(organizationId?: string): TraceSpan[] {
    if (organizationId) {
      return this.completedSpans.filter(s => s.organizationId === organizationId);
    }
    return this.completedSpans;
  }
}
