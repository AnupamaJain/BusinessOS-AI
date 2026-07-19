import type { VerticalDefinition } from './types';
import { travelVertical } from './travel';
import { skincareVertical } from './skincare';

export class VerticalRegistry {
  private static verticals: Map<string, VerticalDefinition> = new Map([
    [travelVertical.id, travelVertical],
    [skincareVertical.id, skincareVertical]
  ]);

  public static get(id: string): VerticalDefinition | undefined {
    return this.verticals.get(id);
  }

  public static list(): VerticalDefinition[] {
    return Array.from(this.verticals.values());
  }

  public static register(vertical: VerticalDefinition): void {
    this.verticals.set(vertical.id, vertical);
  }
}
