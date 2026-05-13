// M4a Step 10 — Recurring sweeper for dm_staging.
//
// Polls dm-staging every 5 seconds, enqueues rows whose ready_at has passed.
// Lives in-process via setInterval because pg-boss v12 scheduled jobs have
// ~minute-resolution (monitor loop), and our 10s merge window needs faster
// cadence. Single-replica safe on Railway today; multi-replica would race on
// the read-then-mark pattern (rare double-enqueue) — defer until that's a
// real constraint.

import { sweepReady } from '../lib/dm-staging';

const SWEEP_INTERVAL_MS = 5_000;

let timer: NodeJS.Timeout | null = null;

export function startDmStagingSweeper(): void {
  if (timer) return;

  const tick = () => {
    void sweepReady()
      .then(({ swept, errors }) => {
        // Only log when we did work — keeps Railway logs from being filled
        // with empty-sweep noise every 5s.
        if (swept > 0 || errors > 0) {
          console.log(JSON.stringify({
            kind: 'dm_staging_sweep',
            ts: new Date().toISOString(),
            swept,
            errors,
          }));
        }
      })
      .catch((e) => {
        console.error(JSON.stringify({
          kind: 'dm_staging_sweep_fatal',
          ts: new Date().toISOString(),
          error: e instanceof Error ? e.message : String(e),
        }));
      });
  };

  tick(); // run once immediately so cold-start latency doesn't add 5s
  timer = setInterval(tick, SWEEP_INTERVAL_MS);
  // Don't keep the event loop alive for the timer alone.
  if (timer.unref) timer.unref();
  console.log('dm-staging sweeper started');
}

export function stopDmStagingSweeper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
