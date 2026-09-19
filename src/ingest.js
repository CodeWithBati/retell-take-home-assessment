import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse';

import { openDb } from './db.js';
import { DEFAULT_CSV_PATH, DEFAULT_DB_PATH, REJECTS_PATH } from './paths.js';
import { canonicalField, validateRow } from './normalize.js';

const REQUIRED_HEADERS = ['account_number', 'debtor_name', 'balance'];

// Duplicate account_number: last row wins. Each upload is a refresh of live
// inventory, so skipping would leave the agent quoting a stale balance on a
// call, and erroring would let one repeated row block the whole batch.
// Collisions inside a single file are still reported -- that's Atlas's bug to
// know about, not ours to swallow.
export async function ingestFile({
  csvPath = DEFAULT_CSV_PATH,
  dbPath = DEFAULT_DB_PATH,
  quiet = false,
} = {}) {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }

  const db = openDb(dbPath);
  const sourceFile = path.basename(csvPath);
  const now = new Date().toISOString();

  const selectExisting = db.prepare('SELECT account_number FROM accounts WHERE lookup_key = ?');
  const insertRow = db.prepare(`
    INSERT INTO accounts (
      account_number, lookup_key, debtor_name, phone_number, phone_e164,
      balance_cents, status, client_name, source_file, source_row,
      created_at, updated_at
    ) VALUES (
      @account_number, @lookup_key, @debtor_name, @phone_number, @phone_e164,
      @balance_cents, @status, @client_name, @source_file, @source_row,
      @now, @now
    )
  `);
  const updateRow = db.prepare(`
    UPDATE accounts SET
      account_number = @account_number,
      debtor_name    = @debtor_name,
      phone_number   = @phone_number,
      phone_e164     = @phone_e164,
      balance_cents  = @balance_cents,
      status         = @status,
      client_name    = @client_name,
      source_file    = @source_file,
      source_row     = @source_row,
      updated_at     = @now
    WHERE lookup_key = @lookup_key
  `);

  const stats = { csvPath, rowsRead: 0, inserted: 0, updated: 0, duplicatesInFile: 0, rejected: 0 };
  const warnings = [];
  const rejects = [];
  const seenInFile = new Map();
  const pending = [];

  let headers = null;
  const parser = fs.createReadStream(csvPath).pipe(
    parse({
      bom: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
      info: true,
      columns: (header) => {
        headers = header.map(canonicalField);
        return headers;
      },
    }),
  );

  for await (const { record, info } of parser) {
    const line = info.lines;

    if (Object.values(record).every((value) => String(value ?? '').trim() === '')) {
      continue;
    }

    stats.rowsRead += 1;

    const result = validateRow(record);
    if (!result.ok) {
      stats.rejected += 1;
      rejects.push({ line, account_number: record.account_number ?? '', reason: result.reason, record });
      continue;
    }

    for (const warning of result.warnings) {
      warnings.push(`line ${line}: ${warning}`);
    }

    const key = result.record.lookup_key;
    if (seenInFile.has(key)) {
      stats.duplicatesInFile += 1;
      warnings.push(
        `line ${line}: account ${result.record.account_number} also appears on line ` +
          `${seenInFile.get(key)}; the later row wins`,
      );
    }
    seenInFile.set(key, line);

    pending.push({ ...result.record, source_file: sourceFile, source_row: line, now });
  }

  if (headers) {
    const missing = REQUIRED_HEADERS.filter((name) => !headers.includes(name));
    if (missing.length > 0) {
      db.close();
      throw new Error(
        `CSV is missing required column(s): ${missing.join(', ')}. Found: ${headers.join(', ')}`,
      );
    }
  }

  // All or nothing, so the agent never reads a half-loaded inventory.
  const applyAll = db.transaction((rows) => {
    for (const row of rows) {
      if (selectExisting.get(row.lookup_key)) {
        updateRow.run(row);
        stats.updated += 1;
      } else {
        insertRow.run(row);
        stats.inserted += 1;
      }
    }
  });
  applyAll(pending);

  // A duplicate lands as an insert then an update; count it once.
  stats.updated -= stats.duplicatesInFile;
  stats.total = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;

  writeRejects(rejects);
  db.close();

  if (!quiet) {
    report(stats, warnings, rejects);
  }

  return { stats, warnings, rejects };
}

function csvValue(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeRejects(rejects) {
  if (rejects.length === 0) {
    if (fs.existsSync(REJECTS_PATH)) fs.rmSync(REJECTS_PATH);
    return;
  }

  const lines = ['line,account_number,reason,raw_row'];
  for (const reject of rejects) {
    lines.push(
      [
        reject.line,
        csvValue(reject.account_number),
        csvValue(reject.reason),
        csvValue(JSON.stringify(reject.record)),
      ].join(','),
    );
  }

  fs.mkdirSync(path.dirname(REJECTS_PATH), { recursive: true });
  fs.writeFileSync(REJECTS_PATH, `${lines.join('\n')}\n`);
}

function report(stats, warnings, rejects) {
  console.log(`\nIngested ${path.basename(stats.csvPath)}`);
  console.log(`  rows read           ${stats.rowsRead}`);
  console.log(`  inserted            ${stats.inserted}`);
  console.log(`  updated             ${stats.updated}`);
  console.log(`  duplicates in file  ${stats.duplicatesInFile}`);
  console.log(`  rejected            ${stats.rejected}`);
  console.log(`  accounts in db      ${stats.total}`);

  if (warnings.length > 0) {
    console.log(`\nWarnings (${warnings.length}):`);
    for (const warning of warnings) console.log(`  - ${warning}`);
  }

  if (rejects.length > 0) {
    console.log(`\nRejected rows (${rejects.length}) written to data/rejects.csv:`);
    for (const reject of rejects) console.log(`  - line ${reject.line}: ${reject.reason}`);
  }

  console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const csvPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_CSV_PATH;

  try {
    const { stats } = await ingestFile({ csvPath });
    if (stats.total === 0) {
      console.error('Nothing was ingested. Check the rejects above.');
      process.exit(1);
    }
  } catch (error) {
    console.error(`Ingest failed: ${error.message}`);
    process.exit(1);
  }
}
