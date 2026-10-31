#!/usr/bin/env node
// Offline build verification. Expected pins are committed literals, never
// recomputed from candidate bytes to make a check pass.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { reserveVersion, compareReleases } from '../release/versioning.mjs';

export const CLOSURE_SHA256 = 'bf1dedc623d81e5f09292188c2dc8cde4139f4a5c3dfca446d5ceb15078eef5f';
export const PRESENTATION_PIN = Object.freeze({
  source_commit: '01b3080948c21899cbbacbfa3447da6799af1b56',
  config_sha256: 'bf6aa144cd73dc97dc941f0f0914138b04ae0a28fbead5123465b15b1f2a2fd9',
  manifest_sha256: 'd4dcb8c05d0fcad7d60183156166c5a30f21e6abc1ac0c274ee3e0791e5ea912',
});
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function filesBelow(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.isSymbolicLink() || (!e.isDirectory() && !e.isFile())) throw new Error('closure_regular_files_required');
    const name = prefix + e.name;
    return e.isDirectory() ? filesBelow(path.join(dir, e.name), name + '/') : [name];
  });
}
export function checkRelease({ root = repoRoot } = {}) {
  const json = file => JSON.parse(fs.readFileSync(path.join(root, file)));
  const bundleRoot = path.join(root, 'public/joe/vendor/calver');
  const manifestBytes = fs.readFileSync(path.join(bundleRoot, 'manifest.json'));
  if (sha(manifestBytes) !== PRESENTATION_PIN.manifest_sha256) throw new Error('presentation_manifest_pin_mismatch');
  const manifest = JSON.parse(manifestBytes);
  if (manifest.revision !== PRESENTATION_PIN.source_commit || manifest.expectedConfigSha256 !== PRESENTATION_PIN.config_sha256 || manifest.schema !== 'inspr.calver-display.v3') throw new Error('presentation_source_mismatch');
  if (JSON.stringify(filesBelow(bundleRoot).sort()) !== JSON.stringify(['manifest.json', ...manifest.files.map(f => f.outputPath)].sort())) throw new Error('presentation_closure_mismatch');
  for (const f of manifest.files) {
    const file = path.join(bundleRoot, f.outputPath), stat = fs.lstatSync(file), bytes = fs.readFileSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || bytes.length !== f.size || sha(bytes) !== f.sha256) throw new Error('presentation_payload_mismatch');
  }
  const bytes = fs.readFileSync(path.join(root, 'release/closure.json'));
  if (sha(bytes) !== CLOSURE_SHA256) throw new Error('closure_manifest_pin_mismatch');
  const closure = JSON.parse(bytes);
  const names = closure.files.map(f => f.path);
  if (new Set(names).size !== names.length || names.some(n => !/^(?:public\/joe\/|contracts\/|server\/|release\/|[a-z-]+\.(?:mjs|json)$)/.test(n) || n.includes('..'))) throw new Error('closure_path_invalid');
  for (const f of closure.files) {
    const file = path.join(root, f.path), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== f.size || sha(fs.readFileSync(file)) !== f.sha256) throw new Error('closure_payload_mismatch');
  }
  // All browser, shared-contract and server payloads form one exact closure.
  for (const dir of ['public/joe', 'contracts', 'server', 'release']) {
    const actual = filesBelow(path.join(root, dir)).map(n => `${dir}/${n}`).filter(n => n !== 'release/closure.json').sort();
    if (JSON.stringify(actual) !== JSON.stringify(names.filter(n => n.startsWith(`${dir}/`)).sort())) throw new Error('closure_extra_or_missing');
  }
  if (fs.existsSync(path.join(root, '.git'))) {
    // Tarball/Docker/Nix builds carry the pinned closure; working-tree builds
    // additionally refuse untracked payloads even if their bytes match.
    execFileSync('git', ['ls-files', '--error-unmatch', '--', 'release/closure.json', 'scripts/check-release.mjs', ...names], { cwd: root, stdio: 'pipe' });
  }
  const active = json('release.json'), prep = json('release/preparation.json'), pkg = json('package.json');
  const reserved = reserveVersion(prep.previous_release, prep.reservation.reserved_at);
  for (const key of Object.keys(reserved)) if (reserved[key] !== prep.reservation[key]) throw new Error('reservation_mismatch');
  if (compareReleases(prep.previous_release, prep.reservation, prep.anchor) !== -1) throw new Error('anchor_order');
  for (const key of Object.keys(reserved)) if (active[key] !== reserved[key]) throw new Error('active_candidate_mismatch');
  if (pkg.version !== active.version || pkg.dependencies || pkg.devDependencies) throw new Error('release_package_mismatch');
  const contract = json('release/contracts.json');
  const entries = closure.files.filter(f => f.path.startsWith('contracts/'));
  if (sha(Buffer.from(JSON.stringify(entries))) !== contract.contract_set_sha256 ||
      JSON.stringify(json('contracts/manifest.json').compatibility) !== JSON.stringify(contract.compatibility)) throw new Error('contract_set_mismatch');
  for (const key of Object.keys(PRESENTATION_PIN)) if (prep.presentation[key] !== PRESENTATION_PIN[key]) throw new Error('presentation_pin_mismatch');
  if (prep.presentation.status !== 'integrated' || prep.status !== 'candidate') throw new Error('presentation_inactive');
  return { ok: true, candidate: reserved.version, contractSet: contract.contract_set_sha256, presentation: prep.presentation.status, authoritative: false };
}

export async function checkAdoptedRelease({ root = repoRoot, releaseSet } = {}) {
  const result = checkRelease({ root });
  // The normal Docker COPY set intentionally contains only this checker.
  // Adoption tooling and records are checkout-only and loaded after all build checks.
  const { checkAdoption } = await import('./check-adoption.mjs');
  const json = file => JSON.parse(fs.readFileSync(path.join(root, file)));
  const record = checkAdoption({ root, active: json('release.json'),
    reservation: json('release/preparation.json').reservation, contractSet: result.contractSet, releaseSet });
  return { ...result, adopted: record.version, authoritative: true };
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--require-adoption')) {
      const args = process.argv.slice(2), flags = args.filter(arg => arg === '--require-adoption');
      const rest = args.filter(arg => arg !== '--require-adoption');
      if (flags.length !== 1 || !(rest.length === 0 ||
          (rest.length === 2 && rest[0] === '--release-set' && rest[1] && !rest[1].startsWith('--')))) throw new Error('adoption_usage');
      console.log(JSON.stringify(await checkAdoptedRelease({ releaseSet: rest[1] })));
    } else console.log(JSON.stringify(checkRelease()));
  }
  catch (error) { console.error(`release-check: ${error.message}`); process.exitCode = 1; }
}
