import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAlreadyAnonymous, readResults, ResultsFixtureError } from './anonymize-results.mjs';

export function realResultsFixtures(directory = fileURLToPath(new URL('../fixtures/results/real/', import.meta.url))) {
  const files = readdirSync(directory, { withFileTypes: true }).filter(f => f.name !== 'README.md');
  return files.sort((a, b) => a.name.localeCompare(b.name)).map((file, i) => {
    if (!file.isFile() || !file.name.endsWith('.json')) throw new ResultsFixtureError('real fixture must be a regular JSON file at $');
    const payload = readResults(join(directory, file.name));
    assertAlreadyAnonymous(payload);
    // Labels never expose a file name supplied with producer data.
    return { name: `real-${i + 1}`, payload, now: payload.receivedAt ?? payload.generatedAt };
  });
}
