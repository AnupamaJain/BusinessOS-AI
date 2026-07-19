import { describe, it, expect } from 'vitest';
import { VerticalRegistry, travelVertical, skincareVertical } from '../index';

describe('VerticalRegistry', () => {
  it('registers and retrieves built-in verticals', () => {
    const verticals = VerticalRegistry.list();
    expect(verticals.length).toBeGreaterThanOrEqual(2);

    const travel = VerticalRegistry.get('travel');
    expect(travel).toBeDefined();
    expect(travel?.name).toBe('Travel & Tourism');
    expect(travel?.agents.length).toBe(2);

    const skincare = VerticalRegistry.get('d2c-skincare');
    expect(skincare).toBeDefined();
    expect(skincare?.name).toBe('D2C Skincare & Personal Care');
  });

  it('contains travel catalog schema and knowledge templates', () => {
    expect(travelVertical.catalogSchema.itemType).toBe('Holiday Package');
    expect(travelVertical.knowledgeTemplates.length).toBe(2);
    expect(travelVertical.knowledgeTemplates[0]?.filename).toBe('travel-packages.md');
  });
});
