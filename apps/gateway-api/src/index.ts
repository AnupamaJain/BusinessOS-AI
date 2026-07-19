import * as path from 'path';
import { logger } from '@business-os-ai/shared-types';
import { buildServer } from './server';

// Load repo-root .env for local development (Vercel injects env directly).
try {
  process.loadEnvFile(path.resolve(__dirname, '../../../.env'));
} catch {
  // No .env file — rely on process environment.
}

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);

const { app } = buildServer(process.env);

app.listen(PORT, () => {
  logger.info(`Gateway API listening on port ${PORT}`);
});

export { app };
