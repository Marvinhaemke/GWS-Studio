import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPostgresStore } from '../server/postgres-store.mjs';
import { verifyMigrationEnvironment, applyMigrations, loadMigrations } from '../scripts/migrate.mjs';

function database() {
  const rows = new Map(), calls = [];
  async function query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT value FROM gws_frameio_kv')) {
      const row = rows.get(params[0]);
      return { rows: row && row.expiresAt > params[1] ? [{ value: structuredClone(row.value) }] : [] };
    }
    if (sql.startsWith('INSERT INTO gws_frameio_kv') && sql.includes('RETURNING key')) {
      const row = rows.get(params[0]);
      if (row && row.expiresAt > params[3]) return { rows: [] };
      rows.set(params[0], { value: JSON.parse(params[1]), expiresAt: params[2] });
      return { rows: [{ key: params[0] }] };
    }
    if (sql.startsWith('INSERT INTO gws_frameio_kv')) {
      rows.set(params[0], { value: JSON.parse(params[1]), expiresAt: params[2] });
      return { rows: [] };
    }
    if (sql.startsWith('DELETE FROM gws_frameio_kv') && sql.includes("value ->> 'lease'")) {
      if (rows.get(params[0])?.value?.lease === params[1]) rows.delete(params[0]);
      return { rows: [] };
    }
    if (sql.startsWith('DELETE FROM gws_frameio_kv')) { rows.delete(params[0]); return { rows: [] }; }
    if (sql.startsWith('WITH expired AS')) {
      const expired = [...rows].filter(([, value]) => value.expiresAt <= params[0]).sort((a, b) => a[1].expiresAt - b[1].expiresAt).slice(0, 500);
      for (const [key] of expired) rows.delete(key);
      return { rows: expired.map(([key]) => ({ key })) };
    }
    throw new Error('Unexpected test query');
  }
  return { rows, calls, query };
}

test('Postgres store shares JSON values across instances, replaces values, and expires them', async () => {
  let now = 100;
  const db = database(), first = createPostgresStore(db.query, () => now), second = createPostgresStore(db.query, () => now);
  await first.set('session:user', { tokenCipher: 'encrypted-payload', count: 1 }, 200);
  assert.deepEqual(await second.get('session:user'), { tokenCipher: 'encrypted-payload', count: 1 });
  await second.set('session:user', { tokenCipher: 'new-encrypted-payload' }, 300);
  assert.deepEqual(await first.get('session:user'), { tokenCipher: 'new-encrypted-payload' });
  now = 300;
  assert.equal(await first.get('session:user'), null);
  await first.delete('session:user');
  assert.equal(db.rows.has('session:user'), false);
});

test('store parameters contain hostile keys/values without interpolating them into SQL', async () => {
  const db = database(), store = createPostgresStore(db.query, () => 1);
  const key = "session:'; DROP TABLE users; --", value = { text: "'; SELECT 'untrusted'" };
  await store.set(key, value, 200);
  assert.deepEqual(await store.get(key), value);
  for (const call of db.calls) { assert.ok(!call.sql.includes(key)); assert.ok(!call.sql.includes(value.text)); }
  assert.deepEqual(db.calls[0].params, [key, JSON.stringify(value), 200]);
  assert.ok(db.calls.every(call => !/\b(CREATE|ALTER|DROP)\s+TABLE/i.test(call.sql)));
});

test('competing instances obtain one lease and expired holders cannot unlock a new owner', async () => {
  let now = 100;
  const db = database(), first = createPostgresStore(db.query, () => now), second = createPostgresStore(db.query, () => now);
  assert.deepEqual(await Promise.all([first.tryLock('refresh:session', 110), second.tryLock('refresh:session', 110)]), [true, false]);
  now = 111;
  assert.equal(await second.tryLock('refresh:session', 130), true);
  await first.unlock('refresh:session');
  assert.equal(await first.tryLock('refresh:session', 140), false);
  await second.unlock('refresh:session');
  assert.equal(await first.tryLock('refresh:session', 140), true);
  assert.ok(db.calls.some(call => call.sql.includes('ON CONFLICT') && call.sql.includes('WHERE gws_frameio_kv.expires_at <= $4')));
});

test('cleanup deletes at most 500 expired records and retains live values', async () => {
  const db = database(), store = createPostgresStore(db.query, () => 100);
  for (let i = 0; i < 510; i++) db.rows.set('expired:' + i, { value: {}, expiresAt: 99 });
  db.rows.set('live', { value: { retained: true }, expiresAt: 200 });
  assert.equal(await store.cleanup(), 500);
  assert.equal(db.rows.size, 11);
  assert.deepEqual(await store.get('live'), { retained: true });
  assert.match(db.calls[0].sql, /FOR UPDATE SKIP LOCKED/);
});

test('store rejects invalid keys, expiry units and undefined JSON before querying', async () => {
  const db = database(), store = createPostgresStore(db.query);
  await assert.rejects(() => store.set('', {}, 100), /Invalid store key/);
  await assert.rejects(() => store.set('key', {}, 1.5), /Unix seconds/);
  await assert.rejects(() => store.set('key', undefined, 100), /JSON serializable/);
  assert.equal(db.calls.length, 0);
});

const linkedProject = { projectId: 'prj_test', orgId: 'team_test' };
const env = { DATABASE_URL: 'postgresql://test:placeholder@ep-example.neon.tech/neondb?sslmode=require' };
test('migration guard requires explicit environment confirmation, project linkage, database and TLS', () => {
  assert.throws(() => verifyMigrationEnvironment(env, { linkedProject }), /confirm-environment/);
  assert.throws(() => verifyMigrationEnvironment(env, { confirmed: true }), /Link this checkout/);
  assert.throws(() => verifyMigrationEnvironment({}, { confirmed: true, linkedProject }), /DATABASE_URL is missing/);
  assert.throws(() => verifyMigrationEnvironment({ DATABASE_URL: 'https://example.com/' }, { confirmed: true, linkedProject }), /Postgres/);
  assert.throws(() => verifyMigrationEnvironment({ DATABASE_URL: 'postgresql://x:y@db.example.com/db' }, { confirmed: true, linkedProject }), /TLS-enabled/);
  const result = verifyMigrationEnvironment(env, { confirmed: true, linkedProject });
  assert.equal(result.connectionString, env.DATABASE_URL);
  assert.equal(result.projectId, linkedProject.projectId);
  const direct = env.DATABASE_URL.replace('ep-example', 'ep-direct');
  assert.equal(verifyMigrationEnvironment({ ...env, DATABASE_URL_UNPOOLED: direct }, { confirmed: true, linkedProject }).connectionString, direct);
});

function migration(id = '001_test.sql', sql = 'CREATE TABLE IF NOT EXISTS example (id TEXT PRIMARY KEY);') {
  return { id, sql, checksum: createHash('sha256').update(sql).digest('hex') };
}
function migrationClient(history = [], failSql = null) {
  const calls = [];
  return { calls, async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql === 'SELECT id, checksum FROM gws_schema_migrations') return { rows: history };
    if (sql === failSql) throw new Error('test failure');
    return { rows: [] };
  } };
}

test('migrations use one transaction and advisory lock, skip applied SQL and record checksums', async () => {
  const first = migration(), next = migration('002_next.sql', 'CREATE TABLE IF NOT EXISTS next_example (id TEXT PRIMARY KEY);');
  const client = migrationClient([{ id: first.id, checksum: first.checksum }]);
  assert.deepEqual(await applyMigrations(client, [first, next]), { applied: [next.id], skipped: [first.id] });
  assert.equal(client.calls[0].sql, 'BEGIN');
  assert.match(client.calls[1].sql, /pg_advisory_xact_lock\(\$1\)/);
  assert.ok(!client.calls.some(call => call.sql === first.sql));
  assert.ok(client.calls.some(call => call.sql === next.sql));
  assert.ok(client.calls.some(call => call.sql.startsWith('INSERT INTO gws_schema_migrations') && call.params[1] === next.checksum));
  assert.equal(client.calls.at(-1).sql, 'COMMIT');
});

test('modified applied migrations and failed SQL roll the complete transaction back', async () => {
  const changed = migration(), client = migrationClient([{ id: changed.id, checksum: '0'.repeat(64) }]);
  await assert.rejects(() => applyMigrations(client, [changed]), /applied migration was modified/);
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
  assert.ok(!client.calls.some(call => call.sql === changed.sql));
  const failed = migration('002_failure.sql'), failing = migrationClient([], failed.sql);
  await assert.rejects(() => applyMigrations(failing, [failed]), /test failure/);
  assert.equal(failing.calls.at(-1).sql, 'ROLLBACK');
  assert.ok(!failing.calls.some(call => call.sql === 'COMMIT'));
});

test('checked-in Neon migration is additive JSONB/BIGINT SQL with a verified source checksum', async () => {
  const migrations = await loadMigrations();
  const frameio = migrations.find(item => item.id === '001_frameio.sql');
  assert.ok(frameio);
  assert.match(frameio.sql, /value JSONB NOT NULL/);
  assert.match(frameio.sql, /expires_at BIGINT NOT NULL/);
  assert.doesNotMatch(frameio.sql, /\b(DROP|TRUNCATE|DELETE|ALTER)\b/i);
  const raw = await readFile(new URL('../db/migrations/001_frameio.sql', import.meta.url), 'utf8');
  assert.equal(frameio.checksum, createHash('sha256').update(raw).digest('hex'));
});
