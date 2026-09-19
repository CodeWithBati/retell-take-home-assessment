// Shared by the ingest script and the API so a key written at ingest time and a
// key built from a request can't drift apart.

export function normalizeHeader(raw) {
  return String(raw ?? '')
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const HEADER_ALIASES = new Map([
  ['acct_no', 'account_number'],
  ['phone', 'phone_number'],
  ['client', 'client_name'],
]);

export function canonicalField(raw) {
  const header = normalizeHeader(raw);
  return HEADER_ALIASES.get(header) ?? header;
}

export function normalizeText(raw) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

// Consumers read account numbers aloud, so the punctuation in the CSV won't
// survive transcription. Match on letters and digits only.
export function lookupKey(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

// Accepts "$1,234.56", "1234.56", and accounting-style "(125.00)" for credits.
export function parseBalanceToCents(raw) {
  const original = String(raw ?? '').trim();
  if (original === '') {
    return { ok: false, reason: 'balance is empty' };
  }

  let text = original;
  let negative = false;

  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }

  text = text.replace(/[$\s,]/g, '');

  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  }

  if (!/^\d+(\.\d+)?$/.test(text)) {
    return { ok: false, reason: `balance "${original}" is not numeric` };
  }

  const cents = Math.round(Number(text) * 100);
  return { ok: true, cents: negative ? -cents : cents };
}

export function centsToAmount(cents) {
  return Number((cents / 100).toFixed(2));
}

export function normalizePhone(raw) {
  const original = String(raw ?? '').trim();
  if (original === '') {
    return { phone_number: null, phone_e164: null, warning: 'phone_number is empty' };
  }

  const digits = original.replace(/\D/g, '');

  if (original.startsWith('+') && digits.length >= 8 && digits.length <= 15) {
    return { phone_number: original, phone_e164: `+${digits}` };
  }
  if (digits.length === 10) {
    return { phone_number: original, phone_e164: `+1${digits}` };
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return { phone_number: original, phone_e164: `+${digits}` };
  }

  return {
    phone_number: original,
    phone_e164: null,
    warning: `phone_number "${original}" is not a recognizable number`,
  };
}

// Returns a storable record plus warnings, or a reason the row can't be used.
export function validateRow(row) {
  const warnings = [];

  const accountNumber = normalizeText(row.account_number);
  if (!accountNumber) {
    return { ok: false, reason: 'account_number is missing' };
  }

  const key = lookupKey(accountNumber);
  if (!key) {
    return { ok: false, reason: `account_number "${accountNumber}" has no usable characters` };
  }

  const debtorName = normalizeText(row.debtor_name);
  if (!debtorName) {
    return { ok: false, reason: 'debtor_name is missing' };
  }

  const balance = parseBalanceToCents(row.balance);
  if (!balance.ok) {
    return { ok: false, reason: balance.reason };
  }
  if (balance.cents < 0) {
    warnings.push(`negative balance treated as a credit on account ${accountNumber}`);
  }

  const phone = normalizePhone(row.phone_number);
  if (phone.warning) {
    warnings.push(`${phone.warning} on account ${accountNumber}`);
  }

  // Stored as supplied. See schema.sql.
  const rawStatus = normalizeText(row.status);
  if (!rawStatus) {
    warnings.push(`status is missing on account ${accountNumber}, stored as "Unknown"`);
  }

  return {
    ok: true,
    warnings,
    record: {
      account_number: accountNumber,
      lookup_key: key,
      debtor_name: debtorName,
      phone_number: phone.phone_number,
      phone_e164: phone.phone_e164,
      balance_cents: balance.cents,
      status: rawStatus ?? 'Unknown',
      client_name: normalizeText(row.client_name),
    },
  };
}
