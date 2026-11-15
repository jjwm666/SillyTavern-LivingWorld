import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
for (const required of [manifest.js, manifest.css]) {
  if (!existsSync(required)) throw new Error(`manifest 引用不存在：${required}`);
}
const sources = ['index.js', ...files('src'), ...files('demo'), ...files('scripts'), ...files('tests')]
  .filter((file) => extname(file) === '.js' || extname(file) === '.mjs');
for (const file of sources) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(result.stderr);
    process.exit(result.status || 1);
  }
}
console.log(`Checked ${sources.length} JavaScript files and manifest references.`);
