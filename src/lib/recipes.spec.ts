// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { bus, createBus, type ChannelName, type ChannelValue } from './index';

// The firstValue recipe from docs/recipes.md, verbatim between the markers; the last test keeps
// the two in sync.
// recipe:start
function firstValue<K extends ChannelName>(
  channel: K,
  { signal }: { signal?: AbortSignal } = {}
): Promise<ChannelValue<K>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const done = new AbortController();
    const onAbort = (): void => {
      done.abort();
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    bus.on(
      channel,
      value => {
        done.abort();
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      },
      { signal: done.signal }
    );
  });
}
// recipe:end

describe('the firstValue recipe', () => {
  afterEach(() => {
    delete globalThis.__NF_BUS__;
  });

  it('resolves with a value retained before the call', async () => {
    bus.emit('recipe:user', { id: 1 });

    await expect(firstValue('recipe:user')).resolves.toEqual({ id: 1 });
  });

  it('resolves with the next value when nothing is retained yet', async () => {
    const pending = firstValue('recipe:user');

    bus.emit('recipe:user', { id: 1 });
    bus.emit('recipe:user', { id: 2 });

    await expect(pending).resolves.toEqual({ id: 1 });
  });

  it('resolves with a command emitted while it waits', async () => {
    const pending = firstValue('recipe:toast');

    bus.emit('recipe:toast', 'saved', { retain: false });

    await expect(pending).resolves.toBe('saved');
  });

  it('resolves with the producer reference, functions included', async () => {
    const loaders = { loadRemoteModule: () => Promise.resolve() };
    bus.emit('recipe:init-ready', loaders);

    const received = (await firstValue('recipe:init-ready')) as typeof loaders;

    expect(received).toBe(loaders);
    expect(received.loadRemoteModule).toBe(loaders.loadRemoteModule);
  });

  it('rejects with the abort reason when the signal aborts before a value arrives', async () => {
    const controller = new AbortController();
    const pending = firstValue('recipe:user', { signal: controller.signal });

    controller.abort(new Error('gave up'));
    bus.emit('recipe:user', { id: 1 });

    await expect(pending).rejects.toThrow('gave up');
  });

  it('rejects at once for an already-aborted signal, even with a retained value', async () => {
    bus.emit('recipe:user', { id: 1 });

    const pending = firstValue('recipe:user', { signal: AbortSignal.abort(new Error('aborted')) });

    await expect(pending).rejects.toThrow('aborted');
  });

  it('removes its handler from the caller signal once resolved', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    bus.emit('recipe:user', { id: 1 });

    await firstValue('recipe:user', { signal: controller.signal });

    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  // vitest runs from the repository root; jsdom's URL rejects file: URLs for readFileSync.
  it('is the recipe published in docs/recipes.md', () => {
    const spec = readFileSync('src/lib/recipes.spec.ts', 'utf8');
    const recipe = spec.split('// recipe:start\n')[1]?.split('// recipe:end')[0];
    const docs = readFileSync('docs/recipes.md', 'utf8');

    expect(recipe).toBeTruthy();
    expect(docs).toContain(`export ${recipe}`);
  });
});

// The Testing section of docs/recipes.md: app code imports `bus`, tests swap the slot under it.
describe('the testing recipe', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete globalThis.__NF_BUS__;
  });

  it('routes the bus import to a bus stubbed into the slot', () => {
    const stub = createBus();
    vi.stubGlobal('__NF_BUS__', stub);

    bus.emit('recipe:cart', { count: 1 });

    expect(stub.peek('recipe:cart')).toEqual({ count: 1 });
  });

  it('can stub over a bus that is already installed', () => {
    bus.emit('recipe:cart', { count: 1 });
    const stub = createBus();

    vi.stubGlobal('__NF_BUS__', stub);

    expect(bus.peek('recipe:cart')).toBeUndefined();
    bus.emit('recipe:cart', { count: 2 });
    expect(stub.peek('recipe:cart')).toEqual({ count: 2 });
  });

  it('starts every test from an empty bus when the stub is renewed', () => {
    vi.stubGlobal('__NF_BUS__', createBus());
    bus.emit('recipe:cart', { count: 1 });

    vi.unstubAllGlobals();
    vi.stubGlobal('__NF_BUS__', createBus());

    expect(bus.peek('recipe:cart')).toBeUndefined();
  });

  it('installs a fresh bus on the next call after the slot is deleted', () => {
    bus.emit('recipe:cart', { count: 1 });

    delete globalThis.__NF_BUS__;

    expect(bus.peek('recipe:cart')).toBeUndefined();
    expect(globalThis.__NF_BUS__).toBeDefined();
  });
});
