import { boss } from './boss';
import { runPipeline } from '../lib/pipeline/run';
import type { PipelinePayload } from '../lib/pipeline/types';

const QUEUE = 'ingest-pipeline';

// M4a-side: create the queue with retry config (queue-level options are
// inherited by every job sent via boss.send unless overridden per-send).
// retryLimit/retryBackoff catch INFRA failure — DB unreachable, worker
// crash, unhandled throw from runPipeline. Step-level retries (3x on
// view_snapshots insert) live inside runPipeline against
// saved_items.retry_count and are independent of this.
//
// pg-boss v12 moved retryLimit/retryBackoff off WorkOptions and onto the
// queue/job options, so this is the right home for them.
export async function registerIngestPipelineQueue() {
  await boss.createQueue(QUEUE, {
    retryLimit: 5,
    retryBackoff: true,
  });
}

// M5-side: consumer. localConcurrency:1 is the v12 equivalent of v11's
// teamSize:1 — single concurrent pipeline run at MVP. 100 users x 10
// saves/day fits a single worker by ~3 orders of magnitude.
export async function registerIngestPipelineWorker() {
  await boss.work<PipelinePayload>(
    QUEUE,
    { localConcurrency: 1 },
    async (jobs) => {
      for (const job of jobs) {
        try {
          await runPipeline(job.data);
        } catch (err) {
          console.error(JSON.stringify({
            kind: 'pipeline_threw',
            ts: new Date().toISOString(),
            job_id: job.id,
            err: err instanceof Error ? err.message : String(err),
          }));
          throw err;
        }
      }
    },
  );
}
