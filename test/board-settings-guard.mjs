import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const root = new URL('../public/joe/', import.meta.url);
const files = Object.fromEntries(readdirSync(root).filter(name => name.endsWith('.js'))
  .map(name => [name, readFileSync(new URL(name, root), 'utf8')]));
const source = readFileSync(new URL('../scripts/check-joe-ui.mjs', import.meta.url), 'utf8');
// Execute the actual writer guard in isolation, without the other UI/release checks.
const guard = source.slice(source.indexOf("const WRITER ="), source.indexOf('for (const [name, text] of modules) {\n  required(!/\\bmode'));
function failures(extra = {}) {
  const candidate = { ...files, ...extra }, errors = [];
  runInNewContext(guard, { files: candidate, modules: Object.entries(candidate),
    required: (ok, message) => { if (!ok) errors.push(message); } });
  return errors;
}

test('JOED-155 Low 5: real writer import guard rejects factory, aliases, namespaces and re-exports outside Settings', () => {
  assert.deepEqual(failures(), []);
  for (const text of [
    "import { createBoardSettings } from './board-settings.js'; createBoardSettings().save({accountStart:null});",
    "import { createBoardSettings as make } from './board-settings-write.js'; make().save({accountStart:null});",
    "import * as board from './board-settings-write.js'; board.createBoardSettings().save({accountStart:null});",
    "const board = await import('./board-settings-write.js'); board.createBoardSettings().save({accountStart:null});",
    "export { createBoardSettings as make } from './board-settings-write.js';",
    "export * from './board-settings-write.js';",
  ]) {
    for (const name of ['other.js', 'fleet-write.js']) {
      assert.ok(failures({ [name]: text }).some(error => /only Settings/.test(error)), `${name}: ${text}`);
    }
  }
});

test('JOED-155 Low 5: page facade exports no writable client or save capability', async () => {
  const board = await import('../public/joe/board-settings.js');
  assert.deepEqual(Object.keys(board).sort(), ['accountStart', 'boardSettingsState', 'onBoardSettingsChange', 'refreshBoardSettings', 'validateBoardSettings'].sort());
  assert.ok(failures({ 'board-settings.js': files['board-settings.js'] + "\nexport * from './board-settings-write.js';" }).length);
});
