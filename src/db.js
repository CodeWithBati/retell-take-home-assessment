import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { DEFAULT_DB_PATH, SCHEMA_PATH } from './paths.js';

export function openDb(dbPath = DEFAULT_DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

  return db;
}

export function countAccounts(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
}

export function findAccountByLookupKey(db, key) {
  return db.prepare('SELECT * FROM accounts WHERE lookup_key = ?').get(key);
}
