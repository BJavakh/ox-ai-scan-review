/**
 * Re-record the OSV fixtures used by tests and mock mode from the live API.
 * Usage: npx tsx scripts/record-osv-fixtures.ts
 * Writes fixtures/osv/index.json (name@version -> ids) and fixtures/osv/vulns/{id}.json.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { NpmDependencyResolver } from '../src/integrations/npm/NpmDependencyResolver.js';

const root = resolve(import.meta.dirname, '../fixtures');
const resolver = new NpmDependencyResolver();
const keys = new Map<string, { name: string; version: string }>();

for (const repo of await readdir(join(root, 'github'))) {
  const dir = join(root, 'github', repo);
  const files = new Map<string, string>();
  for (const name of resolver.manifestsToFetch(await readdir(dir))) {
    files.set(name, await readFile(join(dir, name), 'utf8'));
  }
  if (files.size === 0) continue;
  for (const dep of resolver.resolve(files).dependencies)
    keys.set(`${dep.name}@${dep.version}`, dep);
}

const queries = [...keys.values()].map((d) => ({
  package: { name: d.name, ecosystem: 'npm' },
  version: d.version,
}));
const batch = (await (
  await fetch('https://api.osv.dev/v1/querybatch', {
    method: 'POST',
    body: JSON.stringify({ queries }),
  })
).json()) as {
  results: { vulns?: { id: string }[] }[];
};

const index: Record<string, string[]> = {};
[...keys.keys()].forEach((key, i) => {
  index[key] = (batch.results[i]?.vulns ?? []).map((v) => v.id).sort();
});
await mkdir(join(root, 'osv', 'vulns'), { recursive: true });
await writeFile(join(root, 'osv', 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

const ids = [...new Set(Object.values(index).flat())];
for (const id of ids) {
  const vuln: unknown = await (
    await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`)
  ).json();
  await writeFile(join(root, 'osv', 'vulns', `${id}.json`), `${JSON.stringify(vuln, null, 2)}\n`);
}
process.stdout.write(
  `Recorded ${String(keys.size)} packages and ${String(ids.length)} advisories.\n`,
);
