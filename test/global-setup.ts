import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Builds the real bundles once per run so the dist specs test what gets published.
export default function setup(): void {
  const root = resolve(__dirname, '..');
  execFileSync(process.execPath, ['build.js', 'test/.dist'], { cwd: root, stdio: 'inherit' });
}
