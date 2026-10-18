#!/usr/bin/env node
// BuildKit OCI evidence -> a stable, commit-bound CI release-set record. No deps.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOBS, SBOM_FORMAT, PROVENANCE_FORMATS, sha256, requireThat, readCommitMetadata, verifyReleaseSet } from './verify-release-set.mjs';

const INDEX = 'application/vnd.oci.image.index.v1+json';
const MANIFEST = 'application/vnd.oci.image.manifest.v1+json';
const ATTESTATION = 'application/vnd.docker.attestation.manifest.v1+json';
export function readOCI(root) {
  const read = file => {
    requireThat(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'OCI: regular file required');
    return readFileSync(file);
  };
  function blob(d) {
    requireThat(d && /^sha256:[a-f0-9]{64}$/.test(d.digest) && Number.isSafeInteger(d.size) && d.size >= 0, 'OCI: invalid descriptor');
    const bytes = read(join(root, 'blobs/sha256', d.digest.slice(7)));
    requireThat(bytes.length === d.size && `sha256:${sha256(bytes)}` === d.digest, 'OCI: blob digest/size mismatch');
    return bytes;
  }
  requireThat(JSON.parse(read(join(root, 'oci-layout'))).imageLayoutVersion === '1.0.0', 'OCI: unsupported layout');
  let indexBytes = read(join(root, 'index.json')), index = JSON.parse(indexBytes);
  // buildx wraps the exported image index in an OCI layout entry point.
  for (let depth = 0; index.manifests?.length === 1 && index.manifests[0].mediaType === INDEX; depth++) {
    requireThat(depth < 4, 'OCI: excessive index nesting');
    indexBytes = blob(index.manifests[0]); index = JSON.parse(indexBytes);
  }
  requireThat(index.schemaVersion === 2 && Array.isArray(index.manifests), 'OCI: image index required');
  const images = index.manifests.filter(d => d.mediaType === MANIFEST && d.platform?.os === 'linux' && d.platform?.architecture === 'amd64' && !d.platform?.variant);
  requireThat(images.length === 1, 'OCI: exactly one linux/amd64 image required');
  const imageDescriptor = images[0], image = JSON.parse(blob(imageDescriptor));
  requireThat(image.schemaVersion === 2 && image.mediaType === MANIFEST && Array.isArray(image.layers), 'OCI: invalid image manifest');
  const config = JSON.parse(blob(image.config));
  requireThat(config.os === 'linux' && config.architecture === 'amd64', 'OCI: image config platform mismatch');
  for (const layer of image.layers) blob(layer);
  const attestations = new Map();
  for (const descriptor of index.manifests.filter(d => d.mediaType === MANIFEST &&
    (d.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest' || d.artifactType === ATTESTATION))) {
    const att = JSON.parse(blob(descriptor));
    requireThat(att.schemaVersion === 2 && att.mediaType === MANIFEST && Array.isArray(att.layers), 'OCI: invalid attestation manifest');
    const targets = [att.subject?.digest, descriptor.annotations?.['vnd.docker.reference.digest']].filter(v => v !== undefined);
    requireThat(targets.length > 0 && targets.every(v => v === imageDescriptor.digest), 'OCI: attestation targets another image');
    blob(att.config);
    for (const layer of att.layers) {
      const bytes = blob(layer);
      if (layer.mediaType !== 'application/vnd.in-toto+json') continue;
      const statement = JSON.parse(bytes), format = statement.predicateType;
      requireThat(format === layer.annotations?.['in-toto.io/predicate-type'], 'OCI: predicate annotation mismatch');
      if (![SBOM_FORMAT, ...PROVENANCE_FORMATS].includes(format)) continue;
      // OCI artifact storage binds the image on the attestation manifest and
      // BuildKit emits an empty in-toto subject. Legacy storage binds it here.
      const boundSubject = Array.isArray(statement.subject) && (statement.subject.some(s => s.digest?.sha256 === imageDescriptor.digest.slice(7)) ||
        (statement.subject.length === 0 && statement._type === 'https://in-toto.io/Statement/v1' &&
          att.artifactType === ATTESTATION && att.subject?.digest === imageDescriptor.digest));
      requireThat(['https://in-toto.io/Statement/v0.1', 'https://in-toto.io/Statement/v1'].includes(statement._type) &&
        boundSubject && statement.predicate &&
        typeof statement.predicate === 'object', 'OCI: attestation subject/predicate mismatch');
      requireThat(!attestations.has(format), 'OCI: duplicate attestation predicate');
      attestations.set(format, { format, digest: layer.digest });
    }
  }
  const provenance = PROVENANCE_FORMATS.filter(format => attestations.has(format));
  requireThat(attestations.has(SBOM_FORMAT) && provenance.length === 1, 'OCI: SBOM and one supported provenance required');
  return {
    image: { digest: imageDescriptor.digest, index_digest: `sha256:${sha256(indexBytes)}`, config_digest: image.config.digest, platform: 'linux/amd64' },
    sbom: attestations.get(SBOM_FORMAT), provenance: attestations.get(provenance[0]),
  };
}

export function createImageEvidence(first, second, commit) {
  const a = readOCI(first), b = readOCI(second);
  return { source_commit: commit, ...a, reproducible: { checked: true, identical: a.image.digest === b.image.digest } };
}

export function createReleaseSet(evidence, context, root = process.cwd()) {
  requireThat(evidence.source_commit === context.commit, 'image evidence: source commit mismatch');
  const metadata = readCommitMetadata(root, context.commit);
  const manifest = {
    schema: 'joedesk.release-set.v1',
    version: metadata.release.version, version_scheme: metadata.release.version_scheme,
    release_channel: metadata.release.release_channel, release_sequence: metadata.release.release_sequence,
    source: { repository: context.repository, commit: context.commit, tree: metadata.tree, ref: context.ref, event: context.event },
    contracts: metadata.contracts, closure_sha256: metadata.closure_sha256,
    image: { ...evidence.image, base_image: metadata.base_image }, sbom: evidence.sbom, provenance: evidence.provenance,
    reproducible: evidence.reproducible,
    validation_run: { id: context.run_id, attempt: context.run_attempt, workflow: context.workflow,
      url: `${context.server_url}/${context.repository}/actions/runs/${context.run_id}`, jobs: [...JOBS] },
    generated_at: context.generated_at ?? new Date().toISOString(),
  };
  return verifyReleaseSet(manifest, { root, commit: context.commit });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    const git = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    requireThat(git(['status', '--porcelain', '--untracked-files=all']) === '', 'clean committed source required');
    requireThat(git(['rev-parse', 'HEAD']) === process.env.GITHUB_SHA, 'GITHUB_SHA must equal checkout HEAD');
    if (mode === 'image-evidence') {
      requireThat(args.length === 3, 'usage: release-set.mjs image-evidence <oci-layout> <repeat-layout> <output.json>');
      writeFileSync(args[2], JSON.stringify(createImageEvidence(args[0], args[1], process.env.GITHUB_SHA), null, 2) + '\n', { flag: 'wx' });
    } else {
      requireThat(mode === 'manifest' && args.length === 2, 'usage: release-set.mjs manifest <image-evidence.json> <release-set.json>');
      const manifest = createReleaseSet(JSON.parse(readFileSync(args[0])), {
        repository: process.env.GITHUB_REPOSITORY, commit: process.env.GITHUB_SHA, ref: process.env.GITHUB_REF,
        event: process.env.GITHUB_EVENT_NAME, run_id: process.env.GITHUB_RUN_ID, run_attempt: process.env.GITHUB_RUN_ATTEMPT,
        workflow: process.env.GITHUB_WORKFLOW, server_url: process.env.GITHUB_SERVER_URL,
      });
      const bytes = JSON.stringify(manifest, null, 2) + '\n';
      writeFileSync(args[1], bytes, { flag: 'wx' });
      writeFileSync(`${args[1]}.sha256`, `${sha256(bytes)}  ${basename(args[1])}\n`, { flag: 'wx' });
      console.log(`release-set: ${manifest.source.commit}; reproducible image: ${manifest.reproducible.identical}`);
    }
  } catch (error) { console.error(`release-set: ${error.message}`); process.exitCode = 1; }
}
