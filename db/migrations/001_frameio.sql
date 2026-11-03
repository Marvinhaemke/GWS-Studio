-- New application table only. Existing Neon schemas and data are not modified.
-- Token/state payloads are encrypted by the application before persistence.
CREATE TABLE IF NOT EXISTS gws_frameio_kv (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS gws_frameio_kv_expires_at ON gws_frameio_kv (expires_at);
