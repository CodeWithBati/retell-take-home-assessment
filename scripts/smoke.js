// Checks a running API, local or deployed.
//   npm run smoke
//   npm run smoke -- https://your-service.onrender.com

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const REQUIRED_FIELDS = [
  'account_number',
  'debtor_name',
  'phone_number',
  'balance',
  'status',
  'client_name',
];

let failures = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

async function get(path) {
  const response = await fetch(`${BASE}${path}`);
  try {
    return { status: response.status, body: await response.json() };
  } catch {
    return { status: response.status, body: null };
  }
}

console.log(`\nSmoke testing ${BASE}\n`);

const health = await get('/health');
check('health returns 200', health.status === 200, `got ${health.status}`);
check('accounts are loaded', (health.body?.accounts ?? 0) > 0, JSON.stringify(health.body));

const valid = await get('/accounts/ACC-1001');
check('valid account returns 200', valid.status === 200, `got ${valid.status}`);
check(
  'all required fields present',
  REQUIRED_FIELDS.every((field) => valid.body && field in valid.body),
  JSON.stringify(valid.body),
);
check('balance is a number', typeof valid.body?.balance === 'number');
check(
  'duplicate row overwrote the first',
  valid.body?.balance === 2100 && valid.body?.status === 'Settlement Eligible',
  JSON.stringify(valid.body),
);

const query = await get('/accounts?account_number=ACC-1001');
check('query form returns 200', query.status === 200, `got ${query.status}`);
check('query form matches path form', JSON.stringify(query.body) === JSON.stringify(valid.body));

const spoken = await get('/accounts/acc1001');
check('acc1001 resolves to ACC-1001', spoken.body?.account_number === 'ACC-1001');

const spaced = await get('/accounts?account_number=ACC-1008');
check(
  'account stored as "acc 1008" is found',
  spaced.status === 200 && spaced.body?.debtor_name === 'Omar Haddad',
  JSON.stringify(spaced.body),
);

const missing = await get('/accounts/ACC-9999');
check('unknown account returns 404', missing.status === 404, `got ${missing.status}`);
check('404 carries an error code', missing.body?.error?.code === 'ACCOUNT_NOT_FOUND');

const blank = await get('/accounts');
check('missing account number returns 400', blank.status === 400, `got ${blank.status}`);

const rejected = await get('/accounts/ACC-1006');
check('row rejected at ingest is absent', rejected.status === 404, `got ${rejected.status}`);

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
