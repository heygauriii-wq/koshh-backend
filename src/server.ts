import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { requireAuth } from './auth/require-auth';
import { deleteMe } from './routes/me';
import { startBoss } from './jobs/boss';
import { registerCleanupWorker } from './jobs/cleanup-deleted-user';
import { registerIngestPipelineQueue } from './jobs/ingest-pipeline';
import { captureRawBody } from './lib/webhook-trust';
import webhooksMetaRouter from './routes/webhooks-meta';
import { healthRouter } from './routes/health';

async function probeMetaToken() {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) {
    console.warn('[boot] META_PAGE_ACCESS_TOKEN missing — webhook resolver will fall through tiers');
    return;
  }
  try {
    const r = await fetch(`https://graph.instagram.com/v23.0/me?fields=user_id,username&access_token=${token}`);
    if (!r.ok) {
      const body = await r.text();
      console.error('[boot] META_PAGE_ACCESS_TOKEN invalid:', body.slice(0, 200));
    } else {
      const data = (await r.json()) as { id?: string; user_id?: string; username?: string };
      console.log('[boot] META_PAGE_ACCESS_TOKEN ok:', data.username ?? data.user_id ?? data.id);
    }
  } catch (e) {
    console.error('[boot] META_PAGE_ACCESS_TOKEN probe threw:', e);
  }
}

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGINS!.split(',') }));
// captureRawBody is express.json({ verify }) — parses JSON identically AND
// stashes raw bytes on req.rawBody for HMAC verification on /webhooks/meta.
app.use(captureRawBody);

app.use('/webhooks/meta', rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.get('/health', (_, res) => res.json({ ok: true }));
app.use('/health', healthRouter);

app.use('/me', requireAuth);

app.get('/me', (req, res) => {
  res.json({ user_id: req.userId, email: req.userEmail });
});

app.delete('/me', deleteMe);

// Webhook: HMAC-authenticated, no JWT middleware.
app.use('/', webhooksMetaRouter);

const port = Number(process.env.PORT ?? 8080);

(async () => {
  probeMetaToken().catch(() => {});
  await startBoss();
  await registerCleanupWorker();
  await registerIngestPipelineQueue();
  app.listen(port, () => console.log(`backend listening on ${port}`));
})();
