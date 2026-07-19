import { buildServer } from './server';

// Vercel serverless entrypoint — the Express app is the request handler.
const { app } = buildServer(process.env);

export default app;
