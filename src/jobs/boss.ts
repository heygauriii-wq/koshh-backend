import { PgBoss } from 'pg-boss';

export const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL!,
  schema: 'pgboss',
});

export async function startBoss() {
  await boss.start();
  console.log('pg-boss started');
}
