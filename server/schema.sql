CREATE TABLE IF NOT EXISTS frameio_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS frameio_kv_expires_at ON frameio_kv(expires_at);
