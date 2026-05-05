import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { requireAuth } from './auth/require-auth';
import { deleteMe } from './routes/me';
import { startBoss } from './jobs/boss';
import { registerCleanupWorker } from './jobs/cleanup-deleted-user';

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGINS!.split(',') }));
app.use(express.json());

app.get('/health', (_, res) => res.json({ ok: true }));

app.use('/me', requireAuth);

app.get('/me', (req, res) => {
  res.json({ user_id: req.userId, email: req.userEmail });
});

app.delete('/me', deleteMe);

const port = Number(process.env.PORT ?? 8080);

(async () => {
  await startBoss();
  await registerCleanupWorker();
  app.listen(port, () => console.log(`backend listening on ${port}`));
})();
