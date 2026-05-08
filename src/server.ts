import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { requireAuth } from './auth/require-auth';
import { deleteMe } from './routes/me';
import { startBoss } from './jobs/boss';
import { registerCleanupWorker } from './jobs/cleanup-deleted-user';
import { registerIngestPipelineQueue } from './jobs/ingest-pipeline';
import { captureRawBody } from './lib/webhook-trust';
import webhooksMetaRouter from './routes/webhooks-meta';

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGINS!.split(',') }));
// captureRawBody is express.json({ verify }) — parses JSON identically AND
// stashes raw bytes on req.rawBody for HMAC verification on /webhooks/meta.
app.use(captureRawBody);

app.get('/health', (_, res) => res.json({ ok: true }));

app.use('/me', requireAuth);

app.get('/me', (req, res) => {
  res.json({ user_id: req.userId, email: req.userEmail });
});

app.delete('/me', deleteMe);

// Webhook: HMAC-authenticated, no JWT middleware.
app.use('/', webhooksMetaRouter);

const port = Number(process.env.PORT ?? 8080);

(async () => {
  await startBoss();
  await registerCleanupWorker();
  await registerIngestPipelineQueue();
  app.listen(port, () => console.log(`backend listening on ${port}`));
})();
