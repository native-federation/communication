// @vitest-environment node
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';

// These specs install the build from global-setup.ts the way an app gets it: as
// node_modules/@softarc/native-federation-communication, resolved by name through its exports map.
// Nothing below imports a dist file by path.
const NAME = '@softarc/native-federation-communication';
const DIST = resolve(__dirname, '.dist');
const FIXTURES = resolve(__dirname, 'consumer');

let app: string;

beforeAll(() => {
  app = mkdtempSync(join(tmpdir(), 'nf-communication-consumer-'));
  cpSync(FIXTURES, app, { recursive: true });
  writeFileSync(join(app, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  mkdirSync(join(app, 'node_modules/@softarc'), { recursive: true });
  symlinkSync(DIST, join(app, 'node_modules', NAME), 'dir');
});

afterAll(() => {
  rmSync(app, { recursive: true, force: true });
});

// The settings a strict app would use; skipLibCheck: false makes tsc check the package's d.ts too.
const COMPILER = {
  strict: true,
  noEmit: true,
  skipLibCheck: false,
  target: ts.ScriptTarget.ES2022,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  types: [],
};
const RESOLUTIONS = {
  nodenext: {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  },
  bundler: { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler },
};

function typeErrors(
  files: string | string[],
  resolution: keyof typeof RESOLUTIONS = 'nodenext',
  extra: ts.CompilerOptions = {}
): string[] {
  const options = { ...COMPILER, ...RESOLUTIONS[resolution], ...extra };
  const roots = [files].flat().map(file => join(app, file));
  const program = ts.createProgram(roots, options);
  return ts
    .getPreEmitDiagnostics(program)
    .map(d => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
}

// Stands in for a remote that ships a later copy: the built d.ts with `edit` applied, installed
// under its own package name.
function installRemoteCopy(edit: (contract: string) => string): void {
  const dir = join(app, 'node_modules/remote-copy');
  rmSync(dir, { recursive: true, force: true });
  cpSync(join(DIST, 'types'), join(dir, 'types'), { recursive: true });
  const exports = { '.': { types: './types/index.d.ts' } };
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'remote-copy', exports }));

  const contract = join(dir, 'types/lib/domain/bus/bus.contract.d.ts');
  const original = readFileSync(contract, 'utf8');
  const edited = edit(original);
  expect(edited, 'the edit no longer matches the built d.ts').not.toBe(original);
  writeFileSync(contract, edited);
}

describe('the built package, consumed by name', () => {
  it('runs a plain-JS consumer under plain node', () => {
    // execFileSync throws with the failed assertion on stderr when consumer.mjs exits non-zero.
    const stdout = execFileSync(process.execPath, ['consumer.mjs'], { cwd: app, encoding: 'utf8' });

    expect(stdout).toContain('consumer ok');
  });

  it.each(Object.keys(RESOLUTIONS) as (keyof typeof RESOLUTIONS)[])(
    'types channels augmented under the package name (%s resolution)',
    resolution => {
      expect(typeErrors('channels.ts', resolution)).toEqual([]);
    }
  );

  it.each(Object.keys(RESOLUTIONS) as (keyof typeof RESOLUTIONS)[])(
    'types the typing recipes (%s resolution)',
    resolution => {
      expect(typeErrors('typing-recipes.ts', resolution)).toEqual([]);
    }
  );

  it.each(readdirSync(join(FIXTURES, 'typing')))(
    'publishes the %s typing recipe verbatim in docs/typing.md',
    file => {
      const docs = readFileSync(resolve(__dirname, '../docs/typing.md'), 'utf8');
      expect(docs).toContain(readFileSync(join(FIXTURES, 'typing', file), 'utf8').trim());
    }
  );

  // @ts-expect-error works under checkJs too, so the .js fixture asserts its own errors.
  it('types a // @ts-check JS consumer through a channels.d.ts', () => {
    const files = ['js/checked.js', 'js/channels.d.ts'];
    expect(typeErrors(files, 'nodenext', { allowJs: true, checkJs: true })).toEqual([]);
  });

  // Copies built from different versions all declare the global. Every later d.ts must match 4.0's
  // `var __NF_BUS__` type exactly, so only the interface it names may grow (and only by optional
  // members).
  describe('next to a later copy’s declarations', () => {
    it('compiles when the later copy adds an optional member and an option', () => {
      installRemoteCopy(contract =>
        contract
          .replace('retain?: boolean;', 'retain?: boolean;\n    priority?: number;')
          .replace(
            '        peek(channel: string): unknown;\n',
            '        peek(channel: string): unknown;\n        request?(channel: string): unknown;\n'
          )
      );

      expect(typeErrors('two-copies.ts')).toEqual([]);
    });

    // The control: proves the fixture would catch a declaration that does not merge.
    it('fails with TS2403 when the later copy types the global differently', () => {
      installRemoteCopy(contract =>
        contract.replace(
          'var __NF_BUS__: NativeFederationBus | undefined;',
          'var __NF_BUS__: Bus | undefined;'
        )
      );

      expect(typeErrors('two-copies.ts')).toEqual([
        expect.stringMatching(/^TS2403: Subsequent variable declarations must have the same type/),
      ]);
    });
  });
});
