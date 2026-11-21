import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// The Testing recipe is this file's setup: every test gets a fresh bus and a throwing reportError.
import './recipes/testing-setup.js';

// Non-literal specifiers keep tsc from resolving the .js fixtures and the aliased package name.
const recipe = (name: string) => import(`./recipes/${name}.js`);
const pkg = '@softarc/native-federation-communication';

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

describe('the values recipe', () => {
  const emit = (channel: string, value: unknown, options?: { retain?: boolean }) =>
    globalThis.__NF_BUS__?.emit(channel, value, options);

  // Wraps the stubbed bus so a test can see whether the recipe's listener was removed.
  async function spyOnSubscription() {
    const { createBus } = await import(`${pkg}/setup`);
    const real = createBus();
    const seen: { signal?: AbortSignal } = {};
    vi.stubGlobal('__NF_BUS__', {
      ...real,
      on: (channel: string, fn: (value: unknown) => void, options?: { signal?: AbortSignal }) => (
        (seen.signal = options?.signal),
        real.on(channel, fn, options)
      ),
    });
    return seen;
  }

  it('yields the retained value, then every later value in order', async () => {
    const { values } = await recipe('values');
    emit('recipe:toast', 't0');
    const toasts = values('recipe:toast');

    // a synchronous burst: buffer-all keeps t1 and t2, latest-only would drop them
    emit('recipe:toast', 't1', { retain: false });
    emit('recipe:toast', 't2', { retain: false });
    emit('recipe:toast', 't3', { retain: false });

    const got = [];
    for await (const toast of toasts) if (got.push(toast) === 4) break;
    expect(got).toEqual(['t0', 't1', 't2', 't3']);
  });

  // An async generator would subscribe only on the first next() and lose t1.
  it('subscribes when called, not on the first next()', async () => {
    const { values } = await recipe('values');
    const toasts = values('recipe:toast', { replay: false });

    emit('recipe:toast', 't1', { retain: false });

    await expect(toasts.next()).resolves.toEqual({ done: false, value: 't1' });
  });

  it('skips the retained value with replay: false', async () => {
    const { values } = await recipe('values');
    emit('recipe:toast', 'old');
    const toasts = values('recipe:toast', { replay: false });

    emit('recipe:toast', 'new', { retain: false });

    await expect(toasts.next()).resolves.toEqual({ done: false, value: 'new' });
  });

  it('unsubscribes on break', async () => {
    const seen = await spyOnSubscription();
    const { values } = await recipe('values');
    emit('recipe:toast', 't0');

    for await (const _ of values('recipe:toast')) break;

    expect(seen.signal?.aborted).toBe(true);
  });

  it('ends quietly when the signal aborts while it waits', async () => {
    const { values } = await recipe('values');
    const controller = new AbortController();
    const got: unknown[] = [];

    const loop = (async () => {
      for await (const toast of values('recipe:toast', { signal: controller.signal }))
        got.push(toast);
    })();
    emit('recipe:toast', 't1', { retain: false });
    // a macrotask lets the loop take t1 and park on its next next(), so the abort lands mid-wait
    await new Promise(resolve => setTimeout(resolve));
    controller.abort(new Error('torn down'));
    emit('recipe:toast', 't2', { retain: false });

    await expect(loop).resolves.toBeUndefined();
    expect(got).toEqual(['t1']);
  });

  it('drops the values it has not taken when it ends', async () => {
    const { values } = await recipe('values');
    const controller = new AbortController();
    const toasts = values('recipe:toast', { signal: controller.signal });
    emit('recipe:toast', 't1', { retain: false });
    emit('recipe:toast', 't2', { retain: false });

    await expect(toasts.next()).resolves.toEqual({ done: false, value: 't1' });
    controller.abort();

    await expect(toasts.next()).resolves.toEqual({ done: true, value: undefined });
  });

  // return() of an async generator would queue behind the pending next() and never run.
  it('settles a pending next() and unsubscribes when return() is called', async () => {
    const seen = await spyOnSubscription();
    const { values } = await recipe('values');
    const toasts = values('recipe:toast');

    const pending = toasts.next();
    await toasts.return();

    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    expect(seen.signal?.aborted).toBe(true);
  });

  it('yields nothing for an aborted signal, even with a retained value', async () => {
    const { values } = await recipe('values');
    emit('recipe:toast', 't0');

    const toasts = values('recipe:toast', { signal: AbortSignal.abort() });

    await expect(toasts.next()).resolves.toEqual({ done: true, value: undefined });
  });
});

describe('the request bus recipe', () => {
  // The testing setup stubs a bus into the slot, and installRequestBus refuses to run on top of one.
  beforeEach(() => {
    delete globalThis.__NF_BUS__;
  });

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

  // Each await yields a macrotask, so the two requests alternate step by step.
  it('keeps interleaved requests apart: retained values, replay and listeners', async () => {
    const { installRequestBus, withRequestBus } = await recipe('request-bus');
    installRequestBus();
    const { bus } = await import(pkg);
    const turn = () => new Promise(resolve => setTimeout(resolve));
    const request = (user: string) =>
      withRequestBus(async () => {
        const live: unknown[] = [];
        bus.on('recipe:cart', (value: unknown) => live.push(value));
        await turn();
        bus.emit('recipe:user', user);
        await turn();
        bus.emit('recipe:cart', `${user}-cart`);
        await turn();
        const replayed: unknown[] = [];
        globalThis.__NF_BUS__?.on('recipe:user', value => replayed.push(value));
        return { live, replayed, peeked: bus.peek('recipe:user') };
      });

    const [a, b] = await Promise.all([request('a'), request('b')]);

    expect(a).toEqual({ live: ['a-cart'], replayed: ['a'], peeked: 'a' });
    expect(b).toEqual({ live: ['b-cart'], replayed: ['b'], peeked: 'b' });
  });

  it('leaves nothing behind for the next request', async () => {
    const { installRequestBus, withRequestBus } = await recipe('request-bus');
    installRequestBus();
    await withRequestBus(async () => globalThis.__NF_BUS__?.emit('recipe:user', 'a'));

    const next = withRequestBus(() => globalThis.__NF_BUS__?.peek('recipe:user'));

    expect(next).toBeUndefined();
  });

  it('ignores a call outside a request and warns once', async () => {
    const { installRequestBus } = await recipe('request-bus');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installRequestBus();

    const listener = vi.fn();

    globalThis.__NF_BUS__?.emit('recipe:user', 'a');
    const off = globalThis.__NF_BUS__?.on('recipe:user', listener);
    globalThis.__NF_BUS__?.emit('recipe:user', 'b');

    expect(globalThis.__NF_BUS__?.peek('recipe:user')).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    expect(off).toBeTypeOf('function');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/No bus is available here/);
  });

  // Like the package's inert bus: a bad argument throws before anything is warned or dropped.
  it('throws the bus TypeErrors outside a request, without warning', async () => {
    const { installRequestBus } = await recipe('request-bus');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installRequestBus();
    const slot = globalThis.__NF_BUS__ as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;

    expect(() => slot.emit?.(42, 'a')).toThrow(TypeError);
    expect(() => slot.on?.('recipe:user')).toThrow(TypeError);
    expect(() => slot.peek?.(null)).toThrow(TypeError);
    expect(warn).not.toHaveBeenCalled();
  });

  // The slot takes only the first install: a process-wide bus already there would leak between
  // requests, so the recipe refuses to start on top of it.
  it('throws when another bus is already installed, and leaves that bus in place', async () => {
    const { installRequestBus } = await recipe('request-bus');
    const { createBus, installGlobalBus } = await import(`${pkg}/setup`);
    const first = installGlobalBus(createBus());

    expect(() => installRequestBus()).toThrow(/already holds another bus/);
    expect(globalThis.__NF_BUS__).toBe(first);
  });

  it('installs a read-only, non-enumerable slot', async () => {
    const { installRequestBus } = await recipe('request-bus');
    installRequestBus();

    expect(Object.getOwnPropertyDescriptor(globalThis, '__NF_BUS__')).toMatchObject({
      writable: false,
      enumerable: false,
      configurable: true,
    });
  });

  it('still serves requests after an out-of-scope call', async () => {
    const { installRequestBus, withRequestBus } = await recipe('request-bus');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    installRequestBus();
    globalThis.__NF_BUS__?.emit('recipe:user', 'outside');

    const seen = withRequestBus(() => {
      globalThis.__NF_BUS__?.emit('recipe:user', 'inside');
      return globalThis.__NF_BUS__?.peek('recipe:user');
    });

    expect(seen).toBe('inside');
  });

  it('is a bus for every copy of the package', async () => {
    const { installRequestBus, withRequestBus } = await recipe('request-bus');
    installRequestBus();
    const { bus } = await import(pkg);
    const { createBus } = await import(`${pkg}/setup`);

    withRequestBus(() => {
      bus.emit('recipe:user', 'a');
      expect(globalThis.__NF_BUS__?.peek('recipe:user')).toBe('a');
    });
    expect(createBus().version).toBe(globalThis.__NF_BUS__?.version);
    expect(globalThis.__NF_BUS__?.protocol).toBe(1);
    expect(Object.isFrozen(globalThis.__NF_BUS__)).toBe(true);
  });
});
