import { describe, it, expect } from 'vitest';
import { OpenMontageMediaService } from './media';

describe('OpenMontageMediaService', () => {
  it('generates video teaser with default options', async () => {
    const service = new OpenMontageMediaService({});
    const result = await service.generateVideoTeaser({
      topic: 'Bali Romance Escapes',
      style: 'travel_reel',
    });

    expect(result.success).toBe(true);
    expect(result.mediaUrl).toContain('http');
    expect(result.mediaType).toBe('video');
    expect(result.durationSec).toBe(15);
    expect(result.caption).toContain('Bali Romance Escapes');
  });

  it('searches stock footage clips', async () => {
    const service = new OpenMontageMediaService({});
    const stock = await service.searchStockFootage({
      query: 'beach',
      mediaType: 'video',
    });

    expect(stock.items.length).toBeGreaterThan(0);
    expect(stock.items[0]?.provider).toBe('pexels');
    expect(stock.items[0]?.url).toContain('beach');
  });

  it('generates voice narration audio link', async () => {
    const service = new OpenMontageMediaService({});
    const narration = await service.generateVoiceNarration('Welcome to your luxury villa in Bali!');

    expect(narration.audioUrl).toContain('narration');
    expect(narration.durationSec).toBeGreaterThan(0);
  });
});
