import { Router } from 'express';
import { boss } from '../jobs/boss';

export const healthRouter = Router();

// pg-boss v12 dropped getQueueSize; getQueueStats returns
// { queuedCount, activeCount, deferredCount, totalCount, ... }.
healthRouter.get('/queues', async (_req, res) => {
  try {
    const [ingest, cleanup] = await Promise.all([
      boss.getQueueStats('ingest-pipeline'),
      boss.getQueueStats('cleanup-deleted-user'),
    ]);
    res.json({
      ingest_pipeline: {
        queued: ingest.queuedCount,
        active: ingest.activeCount,
        deferred: ingest.deferredCount,
        total: ingest.totalCount,
      },
      cleanup_deleted_user: {
        queued: cleanup.queuedCount,
        active: cleanup.activeCount,
        deferred: cleanup.deferredCount,
        total: cleanup.totalCount,
      },
      checked_at: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: 'queue_check_failed', detail: String(e) });
  }
});
