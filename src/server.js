import fs from 'node:fs';
import express from 'express';

import { countAccounts, findAccountByLookupKey, openDb } from './db.js';
import { ingestFile } from './ingest.js';
import { DEFAULT_CSV_PATH, DEFAULT_DB_PATH } from './paths.js';
import { centsToAmount, lookupKey } from './normalize.js';

const PORT = Number(process.env.PORT) || 3000;

// Render's free tier hands the service an ephemeral disk, so the SQLite file is
// gone after a redeploy. Reloading from the committed CSV keeps a fresh
// container deterministic. A real deployment would use a persistent disk and
// run ingestion as its own job.
async function ensureDatabase() {
  const db = openDb(DEFAULT_DB_PATH);
  const existing = countAccounts(db);
  db.close();

  if (existing > 0) return existing;

  if (!fs.existsSync(DEFAULT_CSV_PATH)) {
    console.warn(`Database is empty and no CSV found at ${DEFAULT_CSV_PATH}.`);
    return 0;
  }

  console.log('Database is empty, loading the bundled inventory CSV.');
  const { stats } = await ingestFile({ quiet: true });
  return stats.total;
}

function toApiAccount(row) {
  return {
    account_number: row.account_number,
    debtor_name: row.debtor_name,
    phone_number: row.phone_e164 ?? row.phone_number,
    balance: centsToAmount(row.balance_cents),
    status: row.status,
    client_name: row.client_name,
    updated_at: row.updated_at,
  };
}

function notFound(res, accountNumber) {
  return res.status(404).json({
    error: {
      code: 'ACCOUNT_NOT_FOUND',
      message: `No account found with account_number "${accountNumber}".`,
    },
  });
}

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', accounts: countAccounts(db) });
  });

  app.get('/accounts', (req, res) => {
    const accountNumber = req.query.account_number;

    if (typeof accountNumber !== 'string' || accountNumber.trim() === '') {
      return res.status(400).json({
        error: {
          code: 'MISSING_ACCOUNT_NUMBER',
          message: 'Provide an account number, e.g. /accounts?account_number=ACC-1001',
        },
      });
    }

    const row = findAccountByLookupKey(db, lookupKey(accountNumber));
    if (!row) return notFound(res, accountNumber);

    return res.json(toApiAccount(row));
  });

  app.get('/accounts/:accountNumber', (req, res) => {
    const { accountNumber } = req.params;

    const row = findAccountByLookupKey(db, lookupKey(accountNumber));
    if (!row) return notFound(res, accountNumber);

    return res.json(toApiAccount(row));
  });

  app.use((req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}.` },
    });
  });

  app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } });
  });

  return app;
}

const total = await ensureDatabase();
const db = openDb(DEFAULT_DB_PATH);

createApp(db).listen(PORT, '0.0.0.0', () => {
  console.log(`Atlas account lookup API http://localhost:${PORT} (${total} accounts loaded)`);
});
