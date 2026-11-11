// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';
import { version } from '../package.json';
import type { Bus } from '../src/lib/domain/bus/bus.contract.js';

// These specs run against the published artifacts that global-setup.ts builds into test/.dist.
const DIST = resolve(__dirname, '.dist');
const ESM = resolve(DIST, 'fesm2022/@softarc/native-federation-communication.mjs');
const SCRIPT = readFileSync(resolve(DIST, 'init-bus.js'), 'utf8');

type Copy = { bus: Bus; createBus: () => Bus };

// A distinct query string makes vite load the same file as a separate module instance, which is
// what two remotes shipping their own copy of the package look like on one page.
let copies = 0;
async function loadCopy(): Promise<Copy> {
  copies += 1;
  return import(/* @vite-ignore */ `${ESM}?copy=${copies}`);
}

const runInitScript = (): void => new Function(SCRIPT)();

describe('the published bundles', () => {
  beforeEach(() => {
    delete globalThis.__NF_BUS__;
  });

  afterAll(() => {
    delete globalThis.__NF_BUS__;
  });

  it('loads each copy as its own module instance', async () => {
    const a = await loadCopy();
    const b = await loadCopy();

    expect(a.createBus).not.toBe(b.createBus);
    expect(a.bus).not.toBe(b.bus);
  });

  it('installs nothing on import', async () => {
    await loadCopy();

    expect(globalThis.__NF_BUS__).toBeUndefined();
  });

  it.each([
    ['the first copy', 0],
    ['the second copy', 1],
  ])('shares one bus between two copies when %s touches the page first', async (_, first) => {
    const pair = [await loadCopy(), await loadCopy()];
    const [producer, consumer] = [pair[first]!.bus, pair[1 - first]!.bus];

    producer.emit('cart:count', 1);
    const received: unknown[] = [];
    consumer.on('cart:count', value => received.push(value));
    consumer.emit('cart:count', 2);

    expect(received).toEqual([1, 2]);
    expect(producer.peek('cart:count')).toBe(2);
    expect(globalThis.__NF_BUS__?.peek('cart:count')).toBe(2);
  });

  it('delivers the producer’s exact reference across copies, functions included', async () => {
    const a = await loadCopy();
    const b = await loadCopy();
    const loaders = { loadRemoteModule: () => 'module' };

    a.bus.emit('orch.init-ready', loaders);
    let received: unknown;
    b.bus.on('orch.init-ready', value => (received = value));

    expect(received).toBe(loaders);
  });

  it('keeps a command emitted with retain: false out of a later copy’s replay', async () => {
    const a = await loadCopy();
    const b = await loadCopy();
    const live: unknown[] = [];
    b.bus.on('toast:show', value => live.push(value));

    a.bus.emit('toast:show', 'saved', { retain: false });
    const late: unknown[] = [];
    (await loadCopy()).bus.on('toast:show', value => late.push(value));

    expect(live).toEqual(['saved']);
    expect(late).toEqual([]);
  });

  it('uses a newer bus already at the key', async () => {
    const emit = vi.fn();
    const newer = { protocol: 2, version: '9.0.0', emit, on: vi.fn(), peek: vi.fn(), extra: 1 };
    globalThis.__NF_BUS__ = newer;
    const { bus } = await loadCopy();

    bus.emit('a', 1);

    expect(emit).toHaveBeenCalledWith('a', 1, undefined);
    expect(bus.protocol).toBe(2);
  });

  it('carries the package version', async () => {
    const { bus, createBus } = await loadCopy();

    expect(bus.version).toBe(version);
    expect(createBus().version).toBe(version);
  });

  describe('init-bus.js', () => {
    it('installs the bus that a later ESM copy then uses', async () => {
      runInitScript();
      const installed = globalThis.__NF_BUS__;
      const { bus } = await loadCopy();

      bus.emit('a', 1);

      expect(installed?.protocol).toBe(1);
      expect(installed?.version).toBe(version);
      expect(installed?.peek('a')).toBe(1);
      expect(globalThis.__NF_BUS__).toBe(installed);
    });

    it('reuses the bus an ESM copy installed before it', async () => {
      const { bus } = await loadCopy();
      bus.emit('a', 1);
      const installed = globalThis.__NF_BUS__;

      expect(runInitScript).not.toThrow();
      expect(globalThis.__NF_BUS__).toBe(installed);
    });

    it('keeps the first bus when the script tag is on the page twice', () => {
      const errors: unknown[] = [];
      const virtualConsole = new VirtualConsole();
      virtualConsole.on('jsdomError', (error: Error) => errors.push(error));
      // The middle script emits on the first bus, so the third can only keep the value by reusing it.
      const html = [
        `<script>${SCRIPT}</script>`,
        '<script>window.firstBus = window.__NF_BUS__; window.__NF_BUS__.emit("a", 1);</script>',
        `<script>${SCRIPT}</script>`,
      ].join('');

      const { window } = new JSDOM(html, { runScripts: 'dangerously', virtualConsole });
      const page = window as unknown as { __NF_BUS__: Bus; firstBus: Bus };

      expect(errors).toEqual([]);
      expect(page.__NF_BUS__).toBe(page.firstBus);
      expect(page.__NF_BUS__.peek('a')).toBe(1);
    });

    it('does nothing and does not throw without window', () => {
      const context = vm.createContext({});

      expect(() => vm.runInContext(SCRIPT, context)).not.toThrow();
      expect(vm.runInContext('typeof __NF_BUS__', context)).toBe('undefined');
    });
  });
});
