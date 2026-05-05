import type { Request, Response } from 'express';
import { Pool } from 'pg';
import { boss } from '../jobs/boss';

const db = new Pool({ connectionString: process.env.DATABASE_URL });

export async function deleteMe(req: Request, res: Response) {
  const userId = req.userId!;

  await db.query(
    `update public.users set deleted_at = now() where id = $1 and deleted_at is null`,
    [userId]
  );

  await boss.send('cleanup-deleted-user', { user_id: userId });

  res.status(200).json({ ok: true });
}
