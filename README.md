# Atlas Recovery — Account Lookup

Lets the CollectWise AI agent look up a debtor account by account number, from the CSV Atlas uploads periodically. The agent can already look up by phone; this adds the second path.

Node + SQLite + Express.

## Running it

```bash
npm install
npm run ingest
npm start
```

The API comes up on `http://localhost:3000`. To load a different file:

```bash
npm run ingest -- path/to/atlas_inventory.csv
```

`npm run smoke` runs an end-to-end check against a running server (local or deployed).

## Endpoint

`GET /accounts/:accountNumber` and `GET /accounts?account_number=...` both work and return the same thing.

```bash
curl http://localhost:3000/accounts/ACC-1001
```

```json
{
  "account_number": "ACC-1001",
  "debtor_name": "John Doe",
  "phone_number": "+15550101234",
  "balance": 2100,
  "status": "Settlement Eligible",
  "client_name": "Alpha Bank",
  "updated_at": "2026-09-19T17:03:03.219Z"
}
```

Unknown account returns 404:

```json
{ "error": { "code": "ACCOUNT_NOT_FOUND", "message": "No account found with account_number \"ACC-9999\"." } }
```

The query form with no account number returns 400 (`MISSING_ACCOUNT_NUMBER`). There's also `GET /health`, which reports the account count — useful as a deploy health check.

## Decisions

**Duplicate account numbers overwrite.** Each upload is a refresh of live inventory, not a delta, so balances and statuses change between files. Skipping would leave the agent quoting a stale balance on a live call, and erroring would let one repeated row block a good batch. Inside a single file the last row wins, and the collision is reported rather than silently resolved — a file with internal duplicates is something Atlas should know about. `ACC-1001` appears twice in the sample CSV; the API returns the later row.

**Account numbers match on a normalized key.** Every row stores a `lookup_key` — uppercase, letters and digits only — and lookups run through the same function. Consumers read their account number aloud and the agent transcribes it, so the punctuation in the CSV won't survive the round trip. `ACC-1001`, `acc 1001` and `ACC1001` all find the same account. The original spelling is what the API echoes back. `ACC-1008` is stored as `acc 1008` in the sample file to cover this.

**Status is stored as-is.** The brief mentions Active and Closed, but `Settlement Eligible` turns up too, so the list clearly grows. Mapping unknown statuses to something "safe" at ingest is how an account ends up silently in the wrong bucket, which is the same failure as the payment-plan eligibility bug. Unknown values load unchanged; a blank one becomes `Unknown` and warns.

**Balances are integer cents.** They get read aloud to consumers and drive payment plan maths, so no floats.

**Bad rows are skipped, not fatal.** A row missing an account number, a name, or with a non-numeric balance is rejected and logged. Everything else loads. The file is applied in one transaction so the agent never reads a half-loaded inventory.

An unparseable phone number is a warning, not a rejection — the account still works for account-number lookup, and dropping a real debt over formatting would be the wrong call.

## What ingest tells you

```
Ingested atlas_inventory.csv
  rows read           14
  inserted            10
  updated             0
  duplicates in file  1
  rejected            3
  accounts in db      10

Warnings (3):
  - line 7: phone_number "123" is not a recognizable number on account ACC-1005
  - line 12: negative balance treated as a credit on account ACC-1009
  - line 16: account ACC-1001 also appears on line 2; the later row wins

Rejected rows (3) written to data/rejects.csv:
  - line 8: account_number is missing
  - line 9: balance "N/A" is not numeric
  - line 10: debtor_name is missing
```

`data/rejects.csv` holds each rejected row with its line number, reason and original contents, so Atlas can be told exactly what didn't load instead of just how many.

The sample CSV also covers `$1,234.56` formatting, `(125.00)` credits, a blank line, an extra column, and messy headers.

## Schema

```sql
CREATE TABLE accounts (
  account_number TEXT PRIMARY KEY,
  lookup_key     TEXT NOT NULL,
  debtor_name    TEXT NOT NULL,
  phone_number   TEXT,
  phone_e164     TEXT,
  balance_cents  INTEGER NOT NULL,
  status         TEXT NOT NULL,
  client_name    TEXT,
  source_file    TEXT,
  source_row     INTEGER,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
```

`phone_e164` is indexed so this table can serve the existing phone lookup too, rather than becoming a second source of truth next to it. `source_file` and `source_row` mean a surprising value on a call can be traced back to a line of a specific upload. The schema is created on first run; there's no separate migration step.

## Deploying

Running on Render as a web service — build `npm install`, start `npm start`, health check `/health`.

**URL:** TODO — fill in after deploy

```bash
npm run smoke -- https://<url>
```

Render's free tier gives the service an ephemeral disk, so the SQLite file doesn't survive a redeploy. `npm start` notices an empty database and loads the committed CSV, which keeps a fresh container deterministic with nothing external to depend on. That's a prototype trade — in production the database would sit on a persistent disk or managed Postgres, and ingestion would be its own scheduled job triggered by Atlas's upload rather than something the web server does at boot.

## Layout

```
src/normalize.js    field cleaning, validation, the shared lookup key
src/ingest.js       CSV -> DB
src/server.js       the API
src/db.js           connection and queries
src/schema.sql
scripts/smoke.js
data/               sample CSV; the db and rejects file are generated
```

`normalize.js` is shared by both paths on purpose — if the key written at ingest and the key built from a request came from different code, accounts would quietly stop being findable.

## Assumptions

- `account_number` is unique and stable across uploads; it's the identity of a row.
- Each upload is the current full inventory, not a delta.
- Statuses outside Active/Closed are expected.
- Phone numbers are mostly US 10-digit; `+`-prefixed international ones pass through.
- No auth, since the endpoint is internal to the agent. In production it would need an API key at minimum — it returns consumer PII and balances.
