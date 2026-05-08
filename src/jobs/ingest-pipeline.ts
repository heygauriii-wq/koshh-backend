import { boss } from './boss';

// M4a is the only sender; M5 will register the worker. Until then the queue
// just persists jobs durably. pg-boss v12 requires explicit createQueue before
// boss.send — same pattern M1 uses for cleanup-deleted-user.
export async function registerIngestPipelineQueue() {
  await boss.createQueue('ingest-pipeline');
}
