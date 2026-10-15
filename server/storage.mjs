import fs from 'node:fs';
import path from 'node:path';

export function readJson(file, maxBytes) {
  const fd = fs.openSync(file, 'r');
  try {
    if (fs.fstatSync(fd).size > maxBytes) throw new Error('storage_size_limit');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
}

// Callers validate and byte-bound the complete envelope before entering here.
export function atomicWrite(file, value, maxBytes, mode = 0o600) {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > maxBytes) throw new Error('storage_size_limit');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // One bounded retry file per store. O_NOFOLLOW prevents a leftover symlink
  // from redirecting writes; failed retries cannot accumulate 8MiB temp files.
  const tmp = `${file}.next`;
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, mode);
  try { fs.fchmodSync(fd, mode); fs.writeFileSync(fd, body); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  try {
    const dir = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } catch (error) { error.committed = true; throw error; }
}
