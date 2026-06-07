import fs from 'node:fs/promises';
import path from 'node:path';

const jsonPath = process.argv[2];
const outPath = process.argv[3] ?? '.env';

if (!jsonPath) {
  console.error('Usage: node scripts/load-env-from-json.mjs <json-file> [output-env-file]');
  process.exit(1);
}

const raw = await fs.readFile(jsonPath, 'utf8');
const parsed = JSON.parse(raw);
const values = Array.isArray(parsed?.values) ? parsed.values : [];
const map = new Map();

for (const entry of values) {
  if (!entry || entry.enabled === false || !entry.key) continue;
  map.set(String(entry.key), entry.value);
}

const pick = (key) => map.get(key);
const normalize = (value) => {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) {
    return value.filter((item) => item !== '' && item !== null && item !== undefined).join(',');
  }
  return String(value);
};

const env = {
  AJO_API_KEY: normalize(pick('API_KEY')),
  AJO_CLIENT_SECRET: normalize(pick('CLIENT_SECRET')),
  AJO_BEARER_TOKEN: normalize(pick('ACCESS_TOKEN')),
  AJO_SCOPES: normalize(pick('SCOPES')),
  AJO_TECHNICAL_ACCOUNT_ID: normalize(pick('TECHNICAL_ACCOUNT_ID')),
  AJO_IMS: normalize(pick('IMS')),
  AJO_IMS_ORG_ID: normalize(pick('IMS_ORG'))
};

const lines = [];
for (const [key, value] of Object.entries(env)) {
  if (!value) continue;
  const escaped = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  lines.push(`${key}="${escaped}"`);
}

await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
console.log(`Wrote ${outPath} from ${jsonPath}`);
