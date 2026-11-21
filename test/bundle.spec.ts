import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';
import { version } from '../package.json';
import type { Bus } from '../src/lib/domain/bus/bus.contract.js';
import type {
  Connection,
  ConnectTransportOptions,
  Transport,
} from '../src/lib/domain/connect/connect.contract.js';

// These specs run against the published artifacts that global-setup.ts builds into test/.dist.
const DIST = resolve(__dirname, '.dist');
const FESM = 'fesm2022/@softarc/native-federation-communication';
const SCRIPT = readFileSync(resolve(DIST, 'install.js'), 'utf8');
const BROADCAST_CHANNEL_PATH = `${FESM}-transport-broadcast-channel.mjs`;

type Manifest = {
  exports: Record<string, Record<string, string>>;
  sideEffects: string[];
};
const manifest = (): Manifest => JSON.parse(readFileSync(resolve(DIST, 'package.json'), 'utf8'));

// The root and ./setup entries of one copy of the package.
type Copy = {
  bus: Bus;
  connectTransport: (
    transport: Transport,
    channels: string[],
    options?: ConnectTransportOptions
  ) => Connection | undefined;
  createBus: () => Bus;
  busFrom: (getBus: () => NativeFederationBus | undefined) => Bus;
  getGlobalBus: () => Bus | undefined;
  installGlobalBus: (bus: Bus) => Bus;
};

// A distinct query string makes vite load the same file as a separate module instance, which is
// what two remotes shipping their own copy of the package look like on one page.
let copies = 0;
const load = (file: string) => import(/* @vite-ignore */ `${resolve(DIST, file)}?copy=${copies}`);

async function loadCopy(): Promise<Copy> {
  copies += 1;
  return { ...(await load(`${FESM}.mjs`)), ...(await load(`${FESM}-setup.mjs`)) };
}

// Runs one copy's ./install entry.
async function install(): Promise<void> {
  copies += 1;
  await load(`${FESM}-install.mjs`);
}

type BroadcastChannelCopy = { broadcastChannelTransport: (wire?: string) => Transport };

async function loadBroadcastChannel(): Promise<BroadcastChannelCopy> {
  copies += 1;
  return load(BROADCAST_CHANNEL_PATH);
}

const runScript = (): void => new Function(SCRIPT)();

type Page = { __NF_BUS__: unknown; firstBus: unknown };

// Runs the scripts as classic <script> tags in a fresh page, the way a host's index.html would.
function loadPage(scripts: string[]) {
  const errors: unknown[] = [];
  const warnings: unknown[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error: Error) => errors.push(error));
  virtualConsole.on('warn', (message: unknown) => warnings.push(message));
  const html = scripts.map(script => `<script>${script}</script>`).join('');

  const { window } = new JSDOM(html, { runScripts: 'dangerously', virtualConsole });
  return { page: window as unknown as Page, errors, warnings };
}

describe('the published bundles', () => {
  beforeEach(() => {
    delete globalThis.__NF_BUS__;
  });

  afterAll(() => {
    delete globalThis.__NF_BUS__;
  });

  it('maps each entry to files that exist', () => {
    const { exports } = manifest();
    const entry = (name: string) => ({
      types: `./types/${name}.d.ts`,
      import: `./${FESM}-${name}.mjs`,
      default: `./${FESM}-${name}.mjs`,
    });

    expect(exports).toEqual({
      './package.json': { default: './package.json' },
      '.': {
        types: './types/index.d.ts',
        import: `./${FESM}.mjs`,
        default: `./${FESM}.mjs`,
      },
      './domain': entry('domain'),
      './setup': entry('setup'),
      './install': entry('install'),
      './transport/broadcast-channel': {
        types: './types/transport/broadcast-channel.d.ts',
        import: `./${BROADCAST_CHANNEL_PATH}`,
        default: `./${BROADCAST_CHANNEL_PATH}`,
      },
      './install.js': { default: './install.js' },
    });
    Object.values(exports)
      .flatMap(Object.values)
      .forEach(file => expect(existsSync(resolve(DIST, file)), file).toBe(true));
  });

  it('lists exactly the install files as side effects', () => {
    expect(manifest().sideEffects).toEqual([`./${FESM}-install.mjs`, './install.js']);
  });

  it('loads each copy as its own module instance', async () => {
    const a = await loadCopy();
    const b = await loadCopy();

    expect(a.createBus).not.toBe(b.createBus);
    expect(a.bus).not.toBe(b.bus);
  });

  it('installs nothing on import or use', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bus } = await loadCopy();

    bus.emit('a', 1);

    expect(globalThis.__NF_BUS__).toBeUndefined();
    expect(warn.mock.calls[0]?.[0]).toMatch(/No bus is available here/);
  });

  describe('./install', () => {
    it('installs a bus that every copy then uses', async () => {
      await install();
      const installed = globalThis.__NF_BUS__;
      const { bus, getGlobalBus } = await loadCopy();

      bus.emit('a', 1);

      expect(installed?.peek('a')).toBe(1);
      expect(getGlobalBus()).toBe(installed);
    });

    it('keeps the first bus when a second copy runs its install', async () => {
      await install();
      const first = globalThis.__NF_BUS__;
      first?.emit('a', 1);

      await install();

      expect(globalThis.__NF_BUS__).toBe(first);
      expect(globalThis.__NF_BUS__?.peek('a')).toBe(1);
    });
  });

  describe('./setup', () => {
    it('builds a bus over a custom source with busFrom, which connectTransport then uses', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { busFrom, connectTransport, createBus } = await loadCopy();
      const holder: { bus?: Bus } = {};
      const facade = busFrom(() => holder.bus);
      const sent: unknown[] = [];
      const transport = { name: 't', send: (e: unknown) => sent.push(e), listen: () => () => {} };

      expect(connectTransport(transport, ['a'], { bus: facade })).toBeUndefined();
      holder.bus = createBus();
      const connection = connectTransport(transport, ['a'], { bus: facade });
      facade.emit('a', 1);
      connection?.close();

      expect(holder.bus.peek('a')).toBe(1);
      expect(sent).toEqual([{ channel: 'a', value: 1, retain: true }]);
      expect(globalThis.__NF_BUS__).toBeUndefined();
    });

    it('keeps a bus another copy installed', async () => {
      const a = await loadCopy();
      const b = await loadCopy();
      const first = a.installGlobalBus(a.createBus());

      expect(b.installGlobalBus(b.createBus())).toBe(first);
    });
  });

  // No detection: a foreign value is used as is.
  it('fails on use when the key holds something that is not a bus', async () => {
    (globalThis as { __NF_BUS__?: unknown }).__NF_BUS__ = { protocol: 1 };
    const { bus } = await loadCopy();

    expect(() => bus.emit('a', 1)).toThrow(TypeError);
  });

  it.each([
    ['the first copy', 0],
    ['the second copy', 1],
  ])('shares the installed bus between two copies when %s emits first', async (_, first) => {
    runScript();
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
    runScript();
    const a = await loadCopy();
    const b = await loadCopy();
    const loaders = { loadRemoteModule: () => 'module' };

    a.bus.emit('orch.init-ready', loaders);
    let received: unknown;
    b.bus.on('orch.init-ready', value => (received = value));

    expect(received).toBe(loaders);
  });

  it('keeps a command emitted with retain: false out of a later copy’s replay', async () => {
    runScript();
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

  describe('install.js', () => {
    it('installs the bus that a later ESM copy then uses', async () => {
      runScript();
      const installed = globalThis.__NF_BUS__;
      const { bus } = await loadCopy();

      bus.emit('a', 1);

      expect(installed?.protocol).toBe(1);
      expect(installed?.version).toBe(version);
      expect(installed?.peek('a')).toBe(1);
      expect(globalThis.__NF_BUS__).toBe(installed);
    });

    it('keeps a bus installed before it', async () => {
      const { createBus, installGlobalBus } = await loadCopy();
      const installed = installGlobalBus(createBus());

      expect(runScript).not.toThrow();
      expect(globalThis.__NF_BUS__).toBe(installed);
    });

    // The middle script emits on the first bus, so the last can only keep the value by reusing it.
    const FIRST_EMITS = 'window.firstBus = window.__NF_BUS__; window.__NF_BUS__.emit("a", 1);';

    it('keeps the first bus when the script tag is on the page twice', () => {
      const { page, errors } = loadPage([SCRIPT, FIRST_EMITS, SCRIPT]);
      const installed = page.__NF_BUS__ as Bus;

      expect(errors).toEqual([]);
      expect(installed).toBe(page.firstBus);
      expect(installed.peek('a')).toBe(1);
    });

    // A var at the top of a classic script makes the slot a non-configurable global property.
    it('installs over a page script’s `var __NF_BUS__;` and is reused by a second copy', () => {
      const { page, errors, warnings } = loadPage(['var __NF_BUS__;', SCRIPT, FIRST_EMITS, SCRIPT]);
      const installed = page.__NF_BUS__ as Bus;

      expect(Object.getOwnPropertyDescriptor(page, '__NF_BUS__')?.configurable).toBe(false);
      expect(errors).toEqual([]);
      expect(warnings).toEqual([]);
      expect(installed).toBe(page.firstBus);
      expect(installed.peek('a')).toBe(1);
    });

    it('leaves a foreign value at the key alone, without a warning', () => {
      const { page, errors, warnings } = loadPage([
        'window.__NF_BUS__ = { protocol: 1 };',
        SCRIPT,
        SCRIPT,
      ]);

      expect(errors).toEqual([]);
      expect(warnings).toEqual([]);
      expect(page.__NF_BUS__).toEqual({ protocol: 1 });
    });

    // There is no page detection: wherever the script runs, it installs.
    it('installs without window too', () => {
      const context = vm.createContext({});

      vm.runInContext(SCRIPT, context);

      expect(vm.runInContext('__NF_BUS__.protocol', context)).toBe(1);
    });
  });

  describe('the transport/broadcast-channel subpath', () => {
    // Counts the channels the copies open; messages still travel over the real BroadcastChannel.
    const ports: BroadcastChannel[] = [];
    const connections: Connection[] = [];
    class CountingChannel extends BroadcastChannel {
      constructor(name: string) {
        super(name);
        ports.push(this);
      }
    }

    beforeEach(() => {
      vi.stubGlobal('BroadcastChannel', CountingChannel);
    });

    // An open channel keeps the worker alive.
    afterEach(() => {
      connections.splice(0).forEach(connection => connection.close());
      ports.length = 0;
    });

    // Two copies of the package each connect broadcastChannelTransport() to the page bus: the transport
    // name is the cross-copy contract that keeps the second from doubling every message. A
    // private bus stands in for the other tab.
    it('forwards each value once when two copies connect it on the page', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      runScript();
      const channel = 'test:cross-tab';
      const [one, two] = [await loadCopy(), await loadCopy()];
      const [tabsOne, tabsTwo] = [await loadBroadcastChannel(), await loadBroadcastChannel()];
      const otherTab = one.createBus();
      const here: unknown[] = [];
      const there: unknown[] = [];
      one.bus.on(channel, value => here.push(value));
      otherTab.on(channel, value => there.push(value));

      const first = one.connectTransport(tabsOne.broadcastChannelTransport(), [channel])!;
      const refused = two.connectTransport(tabsTwo.broadcastChannelTransport(), [channel]);
      connections.push(
        first,
        one.connectTransport(tabsOne.broadcastChannelTransport(), [channel], { bus: otherTab })!
      );
      expect(refused).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(
        /Transport 'broadcast:native-federation-communication\/1' is not connected: the name is/
      );
      two.bus.emit(channel, 1);
      two.bus.emit(channel, 2);
      await vi.waitFor(() => expect(there).toEqual([1, 2]));
      otherTab.emit(channel, 3);
      await vi.waitFor(() => expect(here).toEqual([1, 2, 3]));

      // Fences in both directions: a duplicate or an echo sent earlier by the same port would
      // have arrived before them.
      one.bus.emit(channel, 4);
      await vi.waitFor(() => expect(there).toEqual([1, 2, 3, 4]));
      otherTab.emit(channel, 5);
      await vi.waitFor(() => expect(here).toEqual([1, 2, 3, 4, 5]));
      expect(ports).toHaveLength(2);
      expect(globalThis.__NF_BUS__?.peek(channel)).toBe(5);
    });
  });
});
