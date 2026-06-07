import fs from 'node:fs/promises';
import path from 'node:path';

const jsonPath = process.argv[2];
const outPath = process.argv[3] ?? '.env.settings';

if (!jsonPath) {
  console.error('Usage: node scripts/load-settings-env.mjs <settings-json-file> [output-env-file]');
  process.exit(1);
}

const raw = await fs.readFile(jsonPath, 'utf8');
const parsed = JSON.parse(raw);

const sandboxName =
  parsed?.sandboxName ??
  parsed?.sandbox_name ??
  parsed?.AJO_SANDBOX_NAME ??
  parsed?.sandbox ??
  '';

const escape = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const lines = [];
if (sandboxName) {
  lines.push(`if [ -z "\${AJO_SANDBOX_NAME:-}" ]; then export AJO_SANDBOX_NAME="${escape(sandboxName)}"; fi`);
}

await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
console.error(`Wrote ${outPath} from ${jsonPath}`);
