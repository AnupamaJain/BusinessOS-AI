import { describe, it, expect } from 'vitest';
import { ToolDataStore, generatePromoMedia } from '../index';

describe('generatePromoMedia tool', () => {
  it('generates AI promo video media result', async () => {
    const store = new ToolDataStore();
    const result = await generatePromoMedia(store, {
      organizationId: '11111111-1111-1111-1111-111111111111',
      campaignType: 'travel_itinerary_video',
      topic: 'Bali Honeymoon Private Villa',
      style: 'travel_reel',
      durationSec: 15,
      targetChannel: 'whatsapp',
    });

    expect(result.success).toBe(true);
    expect(result.mediaUrl).toContain('mp4');
    expect(result.mediaType).toBe('video');
    expect(result.durationSec).toBe(15);
    expect(result.caption).toContain('Bali Honeymoon Private Villa');
    expect(result.providerUsed).toBe('openmontage_zero_cost_engine');

    expect(store.auditEvents.length).toBe(1);
    expect(store.auditEvents[0]?.action).toBe('promo_media_generated');
  });
});
