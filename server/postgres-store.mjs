import { randomUUID } from 'node:crypto';

/**
 * Neon/Postgres implementation of the Frame.io key/value store.
 * query(text, params) must use a pg-compatible parameterized query and return { rows }.
 * now() and expiresAt are Unix seconds. Request handlers never create tables.
 * The Frame.io handler encrypts token payloads before they reach this store.
 */
export function createPostgresStore(query, now = () => Math.floor(Date.now() / 1000)) {
  if (typeof query !== 'function') throw new TypeError('A Postgres query function is required.');
  if (typeof now !== 'function') throw new TypeError('A clock function is required.');
  const leases = new Map();
  function keyOf(key) {
    if (typeof key !== 'string' || !key || key.length > 1024) throw new TypeError('Invalid store key.');
    return key;
  }
  function timestamp(value) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Expiry must be Unix seconds.');
    return value;
  }
  function clock() { return timestamp(Math.floor(now())); }
  return {
    async get(key) {
      const result = await query('SELECT value FROM gws_frameio_kv WHERE key = $1 AND expires_at > $2', [keyOf(key), clock()]);
      return result.rows[0]?.value ?? null;
    },
    async set(key, value, expiresAt) {
      const encoded = JSON.stringify(value);
      if (encoded === undefined) throw new TypeError('Store values must be JSON serializable.');
      await query('INSERT INTO gws_frameio_kv (key, value, expires_at) VALUES ($1, $2::jsonb, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at', [keyOf(key), encoded, timestamp(expiresAt)]);
    },
    async delete(key) {
      await query('DELETE FROM gws_frameio_kv WHERE key = $1', [keyOf(key)]);
      leases.delete(key);
    },
    async tryLock(key, expiresAt) {
      const validKey = keyOf(key), lease = randomUUID();
      const result = await query("INSERT INTO gws_frameio_kv (key, value, expires_at) VALUES ($1, $2::jsonb, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at WHERE gws_frameio_kv.expires_at <= $4 RETURNING key", [validKey, JSON.stringify({ lease }), timestamp(expiresAt), clock()]);
      if (!result.rows.length) return false;
      leases.set(validKey, lease);
      return true;
    },
    async unlock(key) {
      const validKey = keyOf(key), lease = leases.get(validKey);
      if (!lease) return;
      // A holder from another instance cannot remove a lease acquired after its own expired.
      await query("DELETE FROM gws_frameio_kv WHERE key = $1 AND value ->> 'lease' = $2", [validKey, lease]);
      if (leases.get(validKey) === lease) leases.delete(validKey);
    },
    async cleanup() {
      const result = await query('WITH expired AS (SELECT key FROM gws_frameio_kv WHERE expires_at <= $1 ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED) DELETE FROM gws_frameio_kv AS kv USING expired WHERE kv.key = expired.key AND kv.expires_at <= $1 RETURNING kv.key', [clock()]);
      return result.rows.length;
    }
  };
}
