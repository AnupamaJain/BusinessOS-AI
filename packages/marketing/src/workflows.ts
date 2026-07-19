import type { WorkflowRule } from './types';
import { randomUUID } from 'crypto';

export class WorkflowService {
  private workflowsStore: WorkflowRule[] = [];

  public createWorkflowRule(params: {
    organizationId: string;
    name: string;
    triggerEvent: WorkflowRule['triggerEvent'];
    conditions: WorkflowRule['conditions'];
    action: WorkflowRule['action'];
  }): WorkflowRule {
    const rule: WorkflowRule = {
      id: randomUUID(),
      organizationId: params.organizationId,
      name: params.name,
      triggerEvent: params.triggerEvent,
      conditions: params.conditions,
      action: params.action,
      isActive: true
    };

    this.workflowsStore.push(rule);
    return rule;
  }

  public evaluateEvent(organizationId: string, eventName: WorkflowRule['triggerEvent'], eventData: Record<string, unknown>): WorkflowRule[] {
    const activeRules = this.workflowsStore.filter(
      r => r.organizationId === organizationId && r.isActive && r.triggerEvent === eventName
    );

    return activeRules.filter(rule => {
      return rule.conditions.every(cond => {
        const val = eventData[cond.field];
        if (cond.operator === 'equals') return val === cond.value;
        if (cond.operator === 'greater_than') return typeof val === 'number' && val > Number(cond.value);
        return false;
      });
    });
  }
}
