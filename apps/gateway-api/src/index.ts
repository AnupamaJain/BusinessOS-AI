import express from 'express';
import { createApp } from './app';
import { MockWhatsAppAdapter } from './adapters/mock-whatsapp-adapter';
import { MetaCloudApiAdapter } from './adapters/meta-cloud-api-adapter';
import { IdempotencyService } from './services/idempotency-service';
import { MessageService } from './services/message-service';
import { logger } from '@whatsapp-smb/shared-types';

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
const VERIFY_TOKEN = process.env['META_VERIFY_TOKEN'] ?? 'test-verify-token';
const DEFAULT_ORG_ID = process.env['DEFAULT_ORG_ID'] ?? '11111111-1111-1111-1111-111111111111';

// Dynamic adapter selection: use Meta Cloud API adapter if real tokens are provided
const accessToken = process.env['META_WHATSAPP_ACCESS_TOKEN'];
const phoneNumberId = process.env['META_WHATSAPP_PHONE_NUMBER_ID'];

let adapter;
if (accessToken && phoneNumberId) {
  logger.info('Meta API configuration detected. Initializing live MetaCloudApiAdapter...');
  adapter = new MetaCloudApiAdapter({
    accessToken,
    phoneNumberId,
    verifyToken: VERIFY_TOKEN,
  });
} else {
  logger.info('No Meta API credentials found. Falling back to local MockWhatsAppAdapter...');
  adapter = new MockWhatsAppAdapter(VERIFY_TOKEN);
}

const idempotencyService = new IdempotencyService();
const messageService = new MessageService();

const app: express.Express = createApp({
  adapter,
  idempotencyService,
  messageService,
  defaultOrgId: DEFAULT_ORG_ID,
  onInboundMessage: async (_orgId, message) => {
    logger.info('Agent invocation placeholder', { providerMessageId: message.providerMessageId });
  },
});

app.listen(PORT, () => {
  logger.info(`Gateway API listening on port ${PORT}`);
});

export { app };
