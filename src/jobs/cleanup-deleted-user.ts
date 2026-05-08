import { supabaseAdmin as admin } from '../lib/supabase-admin';
import { boss } from './boss';

interface Payload { user_id: string }

export async function registerCleanupWorker() {
  await boss.createQueue('cleanup-deleted-user');
  await boss.work<Payload>('cleanup-deleted-user', async (jobs) => {
    for (const job of jobs) {
      const userId = job.data.user_id;
      console.log(`[cleanup] start user_id=${userId}`);

      // 1. Revoke all active sessions — invalidates any cached JWT immediately
      await admin.auth.admin.signOut(userId);

      // 2. Purge Storage objects under {user_id}/ prefix
      const { data: files } = await admin.storage
        .from('thumbnails')
        .list(userId, { limit: 1000 });
      if (files?.length) {
        const paths = files.map(f => `${userId}/${f.name}`);
        await admin.storage.from('thumbnails').remove(paths);
        console.log(`[cleanup] deleted ${paths.length} files`);
      }

      // 3. Hard-delete from auth.users — cascade wipes public.users + every user-scoped table
      await admin.auth.admin.deleteUser(userId);
      console.log(`[cleanup] done user_id=${userId}`);
    }
  });
}
