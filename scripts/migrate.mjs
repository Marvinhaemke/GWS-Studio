import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION_LOCK = 715884091;
class MigrationSetupError extends Error {}

/** Validates names only; never logs a database URL or credentials. */
export function verifyMigrationEnvironment(env, { confirmed = false, linkedProject = null } = {}) {
  if (!confirmed) throw new MigrationSetupError('Confirm the linked Vercel project and environment first, then pass --confirm-environment.');
  if (!linkedProject || typeof linkedProject.projectId !== 'string' || !linkedProject.projectId || typeof linkedProject.orgId !== 'string' || !linkedProject.orgId) {
    throw new MigrationSetupError('Link this checkout to the intended Vercel project before running migrations (.vercel/project.json is missing or invalid).');
  }
  const connectionString = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
  if (!connectionString) throw new MigrationSetupError('DATABASE_URL is missing. Connect the intended Neon resource and pull the verified environment first.');
  let url;
  try { url = new URL(connectionString); } catch { throw new MigrationSetupError('DATABASE_URL must be a valid Postgres connection string.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw new MigrationSetupError('DATABASE_URL must be a valid Postgres connection string.');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode'))) {
    throw new MigrationSetupError('Use the TLS-enabled Neon connection string (sslmode=require or stricter).');
  }
  return { connectionString, projectId: linkedProject.projectId };
}

export async function loadMigrations(directory = join(root, 'db/migrations')) {
  const names = (await readdir(directory)).filter(name => /^\d{3}_[a-z0-9_-]+\.sql$/.test(name)).sort();
  if (!names.length) throw new MigrationSetupError('No versioned SQL migrations were found.');
  return Promise.all(names.map(async name => {
    const sql = await readFile(join(directory, name), 'utf8');
    if (!sql.trim()) throw new MigrationSetupError('A versioned SQL migration is empty.');
    return { id: name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}

/** Uses one connected pg Client so BEGIN, the lock and every statement share a connection. */
export async function applyMigrations(client, migrations) {
  const applied = [], skipped = [];
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
    await client.query('CREATE TABLE IF NOT EXISTS gws_schema_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    const history = await client.query('SELECT id, checksum FROM gws_schema_migrations');
    const known = new Map(history.rows.map(row => [row.id, row.checksum]));
    for (const migration of migrations) {
      if (!/^\d{3}_[a-z0-9_-]+\.sql$/.test(migration.id) || typeof migration.sql !== 'string' || !/^[a-f0-9]{64}$/.test(migration.checksum)) throw new MigrationSetupError('Invalid versioned migration metadata.');
      const actual = createHash('sha256').update(migration.sql).digest('hex');
      if (actual !== migration.checksum) throw new MigrationSetupError('Migration content does not match its checksum.');
      if (known.has(migration.id)) {
        if (known.get(migration.id) !== migration.checksum) throw new MigrationSetupError('An applied migration was modified. Restore it and add a new migration instead.');
        skipped.push(migration.id);
        continue;
      }
      await client.query(migration.sql);
      await client.query('INSERT INTO gws_schema_migrations (id, checksum) VALUES ($1, $2)', [migration.id, migration.checksum]);
      known.set(migration.id, migration.checksum);
      applied.push(migration.id);
    }
    await client.query('COMMIT');
    return { applied, skipped };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  }
}

export async function main() {
  let linkedProject;
  try { linkedProject = JSON.parse(await readFile(join(root, '.vercel/project.json'), 'utf8')); } catch {}
  const { connectionString } = verifyMigrationEnvironment(process.env, { confirmed: process.argv.includes('--confirm-environment'), linkedProject });
  const migrations = await loadMigrations();
  const { Client } = await import('pg');
  const client = new Client({ connectionString, connectionTimeoutMillis: 10000, statement_timeout: 30000 });
  try {
    await client.connect();
    const result = await applyMigrations(client, migrations);
    console.log(`Database migrations complete: ${result.applied.length} applied, ${result.skipped.length} already applied.`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    // Driver errors may contain connection details. Print only our known setup errors.
    console.error(error instanceof MigrationSetupError ? error.message : 'Database migration failed. Check connectivity and schema permissions in the selected environment; credentials were not logged.');
    process.exitCode = 1;
  });
}
