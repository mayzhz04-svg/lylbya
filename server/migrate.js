import { createPool, migrate } from './db.js';

const pool = createPool();
try {
  await migrate(pool);
  console.log('FCMS migrations and bank seed applied');
} catch (cause) {
  console.error('FCMS migration failed:', cause?.message || cause);
  process.exitCode = 1;
} finally {
  await pool.end();
}
