import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const script of ['scripts/check.mjs']) {
  const result = spawnSync(process.execPath, [script], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
const tests = spawnSync(process.execPath, ['--test', 'tests/*.test.js'], { stdio: 'inherit' });
if (tests.status !== 0) process.exit(tests.status || 1);
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const output = join('dist', 'LivingWorld');
rmSync('dist', { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const file of ['manifest.json', 'index.js', 'style.css', 'README.md', 'LICENSE', 'src']) {
  cpSync(file, join(output, file), { recursive: true });
}
const archive = join('dist', `LivingWorld-v${manifest.version}.zip`);
let result;
if (process.platform === 'win32') {
  result = spawnSync('tar', ['-a', '-c', '-f', archive, '-C', 'dist', 'LivingWorld'], { stdio: 'inherit' });
} else {
  result = spawnSync('zip', ['-qr', `LivingWorld-v${manifest.version}.zip`, 'LivingWorld'], { cwd: 'dist', stdio: 'inherit' });
}
if (result.error || result.status !== 0) {
  console.warn('ZIP creation unavailable; the dist/LivingWorld directory is ready for release.');
}
if (!existsSync(output)) process.exit(1);
console.log(`Built ${output}${existsSync(archive) ? ` and ${archive}` : ''}`);
