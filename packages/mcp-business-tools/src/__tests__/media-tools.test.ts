import { describe, it, expect } from 'vitest';
import { ToolDataStore, generatePromoMedia } from '../index';

describe('generatePromoMedia tool', () => {
  it('reports honest unconfigured status (no fake URL) when no media keys are set', async () => {
    const store = new ToolDataStore();
    const result = await generatePromoMedia(store, {
      organizationId: '11111111-1111-1111-1111-111111111111',
      campaignType: 'travel_itinerary_video',
      topic: 'Bali Honeymoon Private Villa',
      style: 'travel_reel',
      durationSec: 15,
      targetChannel: 'whatsapp',
    });

    // No PEXELS/PIXABAY/TTS/SHOTSTACK keys in the test env → real service
    // returns 'unconfigured' rather than a fabricated URL.
    expect(result.mediaType).toBe('video');
    expect(result.durationSec).toBe(15);
    expect(result.renderStatus).toBe('unconfigured');
    expect(result.success).toBe(false);
    expect(result.mediaUrl).toBe('');
    expect(result.note).toMatch(/PEXELS_API_KEY/);

    // The audit event is still recorded regardless of provider config.
    expect(store.auditEvents.length).toBe(1);
    expect(store.auditEvents[0]?.action).toBe('promo_media_generated');
  });
});
