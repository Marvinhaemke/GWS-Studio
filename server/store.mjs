/** The handler encrypts token/state payloads before storing them. TTL uses epoch seconds. */
export function createD1Store(db, now = () => Math.floor(Date.now() / 1000)) {
  const requireDb = () => { if (!db) throw new Error('Frame.io session database is not configured'); };
  return {
    async get(key) {
      requireDb();
      const row = await db.prepare('SELECT value, expires_at FROM frameio_kv WHERE key = ?').bind(key).first();
      if (!row || row.expires_at <= now()) return null;
      return JSON.parse(row.value);
    },
    async set(key, value, expiresAt) {
      requireDb();
      await db.prepare('INSERT INTO frameio_kv (key,value,expires_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires_at=excluded.expires_at')
        .bind(key, JSON.stringify(value), expiresAt).run();
    },
    async delete(key) {
      requireDb();
      await db.prepare('DELETE FROM frameio_kv WHERE key = ?').bind(key).run();
    },
    async tryLock(key, expiresAt) {
      requireDb();
      const row = await db.prepare('INSERT INTO frameio_kv (key,value,expires_at) VALUES (?,\'null\',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires_at=excluded.expires_at WHERE frameio_kv.expires_at <= ? RETURNING key')
        .bind(key, expiresAt, now()).first();
      return !!row;
    },
    async unlock(key) { await this.delete(key); },
    async cleanup() {
      requireDb();
      await db.prepare('DELETE FROM frameio_kv WHERE key IN (SELECT key FROM frameio_kv WHERE expires_at <= ? LIMIT 500)').bind(now()).run();
    }
  };
}
