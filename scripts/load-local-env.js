// Loads `.env.local` then `.env` into process.env for standalone Node scripts.
// Next.js does this automatically; Playwright / Express do not.
import fs from 'node:fs';
import path from 'node:path';

export function loadLocalEnv() {
  const root = process.cwd();
  for (const name of ['.env.local', '.env']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      value = value.replace(/^["']+|["']+$/g, '').trim();
      if (process.env[key] == null || process.env[key] === '') process.env[key] = value;
    }
  }
}
