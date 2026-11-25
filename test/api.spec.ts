import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Every published declaration file, in one snapshot. A diff in __snapshots__/api.d.ts.snap is an
// API change: in 4.x it may only add (see docs/multiple-copies.md#compatibility). Accept a
// reviewed change with `vitest -u`.
const TYPES = resolve(__dirname, '.dist/types');

describe('the published types', () => {
  it('match the reviewed API', async () => {
    const files = readdirSync(TYPES, { recursive: true, encoding: 'utf8' })
      .filter(file => file.endsWith('.d.ts'))
      .sort();
    const api = files
      .map(file => `// ${file}\n${readFileSync(join(TYPES, file), 'utf8').trim()}\n`)
      .join('\n');

    await expect(api).toMatchFileSnapshot('__snapshots__/api.d.ts.snap');
  });
});
