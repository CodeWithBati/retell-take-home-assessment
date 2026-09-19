-- Mirror of the latest inventory CSV Atlas uploads. One row per account.

CREATE TABLE IF NOT EXISTS accounts (
  account_number TEXT PRIMARY KEY,
  lookup_key     TEXT NOT NULL,      -- uppercased, alphanumeric only
  debtor_name    TEXT NOT NULL,
  phone_number   TEXT,
  phone_e164     TEXT,
  balance_cents  INTEGER NOT NULL,   -- cents, not a float

  -- Free text, not an enum. The brief lists Active and Closed, but
  -- "Settlement Eligible" shows up too, so the real set is open-ended.
  status         TEXT NOT NULL,

  client_name    TEXT,
  source_file    TEXT,
  source_row     INTEGER,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_lookup_key ON accounts (lookup_key);
CREATE INDEX IF NOT EXISTS idx_accounts_phone_e164 ON accounts (phone_e164);
