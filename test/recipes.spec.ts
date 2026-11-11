import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// The Testing recipe is this file's setup: every test gets a fresh bus and a throwing reportError.
import './recipes/testing-setup.js';

// Non-literal specifiers keep tsc from resolving the .js fixtures and the aliased package name.
const recipe = (name: string) => import(`./recipes/${name}.js`);
const pkg = '@softarc/native-federation-communication';

// jsdom's URL is not accepted by node:fs, so paths go through __dirname.
const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8');
const list = (dir: string) => readdirSync(resolve(__dirname, dir));

describe('the docs', () => {
  const docs = ['../README.md', ...list('../docs').map(f => `../docs/${f}`)];

  it.each(list('recipes'))('publish the %s fixture verbatim in docs/recipes.md', file => {
    expect(read('../docs/recipes.md')).toContain(read(`recipes/${file}`).trim());
  });

  // unpkg ranges such as @4 never match a prerelease, so the snippets pin the exact version.
  it('pin the version in package.json', () => {
    const { version } = JSON.parse(read('../package.json')) as { version: string };
    const pinned = docs.flatMap(doc =>
      [...read(doc).matchAll(/native-federation-communication@([^/\s'"]+)/g)].map(m => m[1])
    );

    expect(pinned.length).toBeGreaterThan(0);
    expect(new Set(pinned)).toEqual(new Set([version]));
  });
});

describe('the testing recipe', () => {
  it('fails the emit when a listener throws', () => {
    globalThis.__NF_BUS__?.on('recipe:cart', () => {
      throw new Error('failed expect');
    });

    expect(() => globalThis.__NF_BUS__?.emit('recipe:cart', 1)).toThrow('failed expect');
  });

  it('gives every test an empty bus', () => {
    expect(globalThis.__NF_BUS__?.peek('recipe:cart')).toBeUndefined();
  });
});

describe('the firstValue recipe', () => {
  it('resolves with a value retained before the call', async () => {
    const { firstValue } = await recipe('first-value');
    globalThis.__NF_BUS__?.emit('recipe:user', { id: 1 });

    await expect(firstValue('recipe:user')).resolves.toEqual({ id: 1 });
  });

  it('resolves with the next value and then unsubscribes', async () => {
    const { firstValue } = await recipe('first-value');
    const pending = firstValue('recipe:toast');

    globalThis.__NF_BUS__?.emit('recipe:toast', 'saved', { retain: false });
    globalThis.__NF_BUS__?.emit('recipe:toast', 'again', { retain: false });

    await expect(pending).resolves.toBe('saved');
  });

  it('rejects with the abort reason when the signal aborts first', async () => {
    const { firstValue } = await recipe('first-value');
    const controller = new AbortController();
    const pending = firstValue('recipe:user', { signal: controller.signal });

    controller.abort(new Error('gave up'));
    globalThis.__NF_BUS__?.emit('recipe:user', { id: 1 });

    await expect(pending).rejects.toThrow('gave up');
  });

  it('rejects at once for an aborted signal, even with a retained value', async () => {
    const { firstValue } = await recipe('first-value');
    globalThis.__NF_BUS__?.emit('recipe:user', { id: 1 });

    const pending = firstValue('recipe:user', { signal: AbortSignal.abort(new Error('aborted')) });

    await expect(pending).rejects.toThrow('aborted');
  });
});

describe('the custom element recipe', () => {
  it('follows its channels while connected', async () => {
    await recipe('custom-element');
    const badge = document.createElement('cart-badge');
    globalThis.__NF_BUS__?.emit('cart:changed', { count: 1 });

    document.body.append(badge);
    globalThis.__NF_BUS__?.emit('shell:theme', { name: 'dark' });
    badge.remove();
    globalThis.__NF_BUS__?.emit('cart:changed', { count: 2 });

    expect(badge.textContent).toBe('1');
    expect(badge.getAttribute('theme')).toBe('dark');
  });
});

describe('the request bus recipe', () => {
  afterEach(() => {
    delete globalThis.__NF_BUS__;
  });

  it('gives each request its own bus behind the global', async () => {
    const { installRequestBus, withRequestBus } = await recipe('request-bus');
    installRequestBus();
    const seen = (user: string) =>
      withRequestBus(async () => {
        globalThis.__NF_BUS__?.emit('recipe:user', user);
        await Promise.resolve();
        return globalThis.__NF_BUS__?.peek('recipe:user');
      });

    await expect(Promise.all([seen('a'), seen('b')])).resolves.toEqual(['a', 'b']);
  });

  it('ignores a call outside a request and warns once', async () => {
    const { installRequestBus } = await recipe('request-bus');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installRequestBus();

    globalThis.__NF_BUS__?.emit('recipe:user', 'a');
    const off = globalThis.__NF_BUS__?.on('recipe:user', () => {});

    expect(globalThis.__NF_BUS__?.peek('recipe:user')).toBeUndefined();
    expect(off).toBeTypeOf('function');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('is a bus for every copy of the package', async () => {
    const { installRequestBus, withRequestBus } = await recipe('request-bus');
    installRequestBus();
    const { bus, createBus } = await import(pkg);

    withRequestBus(() => {
      bus.emit('recipe:user', 'a');
      expect(globalThis.__NF_BUS__?.peek('recipe:user')).toBe('a');
    });
    expect(createBus().version).toBe(globalThis.__NF_BUS__?.version);
  });
});
