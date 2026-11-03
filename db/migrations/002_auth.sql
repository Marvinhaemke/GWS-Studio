-- Better Auth 1.7.14 core schema, namespaced for GWS Studio.
-- Source: https://better-auth.com/docs/concepts/database
-- Rate limiter: https://better-auth.com/docs/concepts/rate-limit
-- Additive migration: does not replace any existing Neon tables.
CREATE TABLE IF NOT EXISTS gws_auth_user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
  image TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS gws_auth_session (
  id TEXT PRIMARY KEY,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  token TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES gws_auth_user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS gws_auth_session_user_idx ON gws_auth_session("userId");
CREATE TABLE IF NOT EXISTS gws_auth_account (
  id TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES gws_auth_user(id) ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  scope TEXT,
  password TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gws_auth_account_user_idx ON gws_auth_account("userId");
CREATE INDEX IF NOT EXISTS gws_auth_account_provider_idx ON gws_auth_account("providerId", "accountId");
CREATE TABLE IF NOT EXISTS gws_auth_verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gws_auth_verification_identifier_idx ON gws_auth_verification(identifier);
CREATE TABLE IF NOT EXISTS gws_auth_rate_limit (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL DEFAULT 0,
  "lastRequest" BIGINT NOT NULL
);
