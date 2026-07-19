import { describe, it, expect, beforeEach } from 'vitest';
import { chunkMarkdown, ingestMarkdownDocuments, retrieveRelevantChunks, simulatedChunks } from '../rag';
import { ToolDataStore } from '@whatsapp-smb/mcp-business-tools';
import * as path from 'path';
import * as fs from 'fs';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

describe('RAG System', () => {
  let store: ToolDataStore;

  beforeEach(() => {
    store = new ToolDataStore();
    simulatedChunks.length = 0; // Clear simulated db chunks
  });

  describe('chunkMarkdown', () => {
    it('splits markdown text into logical paragraphs/chunks', () => {
      const text = 'Paragraph one text.\n\nParagraph two text.\n\nParagraph three text.';
      const chunks = chunkMarkdown(text, 20, 0);
      expect(chunks.length).toBe(3);
      expect(chunks[0]).toBe('Paragraph one text.');
      expect(chunks[1]).toBe('Paragraph two text.');
      expect(chunks[2]).toBe('Paragraph three text.');
    });

    it('combines small paragraphs under limit', () => {
      const text = 'Short one.\n\nShort two.\n\nShort three.';
      const chunks = chunkMarkdown(text, 500, 50);
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toContain('Short one.');
      expect(chunks[0]).toContain('Short three.');
    });
  });

  describe('ingestMarkdownDocuments and retrieveRelevantChunks', () => {
    const tempKbDir = path.join(__dirname, 'test-kb');

    beforeAll(() => {
      if (!fs.existsSync(tempKbDir)) {
        fs.mkdirSync(tempKbDir, { recursive: true });
      }
      fs.writeFileSync(
        path.join(tempKbDir, 'sunscreen.md'),
        '# Sunscreen Details\n\nAquaShield SPF 50 is best for oily skin. It has a matte finish.',
      );
      fs.writeFileSync(
        path.join(tempKbDir, 'shipping.md'),
        '# Shipping Details\n\nStandard shipping is 5 to 7 days. Free above 999.',
      );
    });

    afterAll(() => {
      fs.rmSync(tempKbDir, { recursive: true, force: true });
    });

    it('ingests files and retrieves only scoped by organization ID', async () => {
      await ingestMarkdownDocuments(store, ORG_A, tempKbDir);

      // Verify simulated database chunks exist
      expect(simulatedChunks.length).toBeGreaterThan(0);

      // Query for oily skin sunscreen
      const results = await retrieveRelevantChunks(ORG_A, 'sunscreen for oily skin', 0.1);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.content).toContain('AquaShield SPF 50');

      // Query for shipping rules
      const shippingResults = await retrieveRelevantChunks(ORG_A, 'How long does shipping take?', 0.1);
      expect(shippingResults.length).toBeGreaterThan(0);
      expect(shippingResults[0]?.content).toContain('5 to 7 days');

      // Verify tenant isolation: Org B querying sunscreen gets empty results
      const crossOrgResults = await retrieveRelevantChunks(ORG_B, 'sunscreen for oily skin', 0.1);
      expect(crossOrgResults.length).toBe(0);
    });
  });
});
