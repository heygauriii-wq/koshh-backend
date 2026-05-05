import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { requireAuth } from './auth/require-auth';

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGINS!.split(',') }));
app.use(express.json());

// Public routes
app.get('/health', (_, res) => res.json({ ok: true }));

// All /me/* routes require auth
app.use('/me', requireAuth);

app.get('/me', (req, res) => {
  res.json({ user_id: req.userId, email: req.userEmail });
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => console.log(`backend listening on ${port}`));
