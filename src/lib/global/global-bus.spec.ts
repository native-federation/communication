import { version } from '../../../package.json';
import { createBus } from '../bus/create-bus.js';
import type { Bus } from '../domain/bus/bus.contract.js';
import { installNFBus } from './slot.js';

// A protocol-1 bus as a copy built before tap existed installs it.
const createBusLike = () => ({
  protocol: 1,
  version: '4.0.0',
  emit: vi.fn(),
  on: vi.fn(() => () => {}),
  peek: vi.fn(),
});

// Each test gets a fresh copy of the module (and so a fresh warn-once state) and an empty slot.
async function loadCopy() {
  vi.resetModules();
  return import('./global-bus.js');
}

describe('the global bus', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete globalThis.__NF_BUS__;
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterAll(() => {
    delete globalThis.__NF_BUS__;
  });

  it('adds no globals and warns nothing when the module is imported', async () => {
    const keys = Reflect.ownKeys(globalThis);

    await loadCopy();

    expect(Reflect.ownKeys(globalThis)).toEqual(keys);
    expect(warn).not.toHaveBeenCalled();
  });

  describe('with nothing installed', () => {
    it('is inert and installs nothing on use', async () => {
      const { bus } = await loadCopy();
      const listener = vi.fn();

      bus.emit('a', 1);
      const off = bus.on('a', listener);
      bus.emit('a', 2);
      off();

      expect(listener).not.toHaveBeenCalled();
      expect(bus.peek('a')).toBeUndefined();
      expect(bus.protocol).toBe(1);
      expect(bus.version).toBe(version);
      expect(globalThis.__NF_BUS__).toBeUndefined();
    });

    it('warns once per copy that no bus is available and how to install one', async () => {
      const { bus } = await loadCopy();

      bus.emit('a', 1);
      bus.on('a', () => {});
      bus.peek('a');

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(
        /No bus is available here.*\/install'.*native-federation-communication\/setup'/s
      );

      (await loadCopy()).bus.peek('a');
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['emit', (bus: Bus) => bus.emit('a', 1)],
      ['on', (bus: Bus) => bus.on('a', () => {})],
      ['peek', (bus: Bus) => bus.peek('a')],
    ])('warns from %s alone, but not when protocol or version is read', async (_, call) => {
      const { bus } = await loadCopy();

      expect([bus.protocol, bus.version]).toEqual([1, version]);
      expect(warn).not.toHaveBeenCalled();

      call(bus);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('has no tap, and the facade returns undefined without a warning', async () => {
      const { bus } = await loadCopy();

      expect(bus.tap?.('t', () => {})).toBeUndefined();
      expect(bus.tap).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    });

    it('throws the same TypeErrors as a real bus', async () => {
      const { bus } = await loadCopy();

      expect(() => bus.emit(undefined as unknown as string, 1)).toThrow(TypeError);
      expect(() => bus.on(42 as unknown as string, () => {})).toThrow(TypeError);
      expect(() => bus.on('a', undefined as unknown as () => void)).toThrow(TypeError);
      expect(() => bus.peek(null as unknown as string)).toThrow(TypeError);
      expect(warn).not.toHaveBeenCalled();
    });

    // No lazy install: the facade starts serving a bus as soon as one is installed.
    it('follows a bus installed later', async () => {
      const { bus } = await loadCopy();
      bus.emit('a', 1);

      const installed = createBus();
      globalThis.__NF_BUS__ = installed;
      bus.emit('a', 2);

      expect(installed.peek('a')).toBe(2);
    });
  });

  describe('the facade', () => {
    it('shares one installed bus between two copies of the module', async () => {
      const a = await loadCopy();
      const b = await loadCopy();
      installNFBus(createBus());
      expect(a.bus).not.toBe(b.bus);

      a.bus.emit('a', 'from a');
      const received: unknown[] = [];
      b.bus.on('a', value => received.push(value));
      b.bus.emit('a', 'from b');

      expect(received).toEqual(['from a', 'from b']);
      expect(a.bus.peek('a')).toBe('from b');
    });

    it('uses a newer copy at the slot as is, ignoring members it does not know', async () => {
      const newer: Bus & { extra: () => void } = {
        protocol: 2,
        version: '9.0.0',
        emit: vi.fn(),
        on: vi.fn(() => () => {}),
        peek: vi.fn(() => 'from newer' as never),
        extra: vi.fn(),
      };
      globalThis.__NF_BUS__ = newer;
      const { bus } = await loadCopy();

      bus.emit('a', 1, { retain: false });

      expect(newer.emit).toHaveBeenCalledWith('a', 1, { retain: false });
      expect(bus.peek('a')).toBe('from newer');
      expect(bus.protocol).toBe(2);
      expect(bus.version).toBe('9.0.0');
      expect(globalThis.__NF_BUS__).toBe(newer);
    });

    // There is no detection: a value that is not a bus is used as is and fails on use.
    it.each([
      ['an object without methods', { protocol: 1 }],
      ['a number', 1],
    ])('fails on use when the slot holds %s', async (_, foreign) => {
      (globalThis as { __NF_BUS__?: unknown }).__NF_BUS__ = foreign;
      const { bus } = await loadCopy();

      expect(() => bus.emit('a', 1)).toThrow(TypeError);
      expect(warn).not.toHaveBeenCalled();
    });

    it('passes the options of emit and on through to the installed bus', async () => {
      const { bus } = await loadCopy();
      installNFBus(createBus());
      const controller = new AbortController();
      bus.emit('a', 'stale');
      bus.emit('b', 1, { retain: false });

      const received: unknown[] = [];
      bus.on('a', value => received.push(value), { replay: false, signal: controller.signal });
      bus.emit('a', 'live');
      controller.abort();
      bus.emit('a', 'after abort');

      expect(received).toEqual(['live']);
      expect(bus.peek('b')).toBeUndefined();
    });

    it('works with destructured methods', async () => {
      const { bus } = await loadCopy();
      installNFBus(createBus());
      const { emit, on, peek } = bus;
      const received: unknown[] = [];

      on('a', value => received.push(value));
      emit('a', 1);

      expect(received).toEqual([1]);
      expect(peek('a')).toBe(1);
    });

    it('reports the protocol and version of the installed bus and is frozen', async () => {
      const { bus } = await loadCopy();
      installNFBus(createBus());

      expect(bus.protocol).toBe(1);
      expect(bus.version).toBe(version);
      expect(Object.isFrozen(bus)).toBe(true);
    });

    describe('tap', () => {
      it('opens a tap on the installed bus', async () => {
        const { bus } = await loadCopy();
        const installed = installNFBus(createBus());
        const seen: unknown[] = [];

        expect(bus.tap).toBeTypeOf('function');
        const tap = bus.tap!('t', ({ channel, value }) => seen.push([channel, value]));
        installed.emit('a', 1);
        tap?.emit('b', 2);
        const received: unknown[] = [];
        installed.on('b', value => received.push(value));

        expect(seen).toEqual([['a', 1]]);
        expect(received).toEqual([2]);
        expect(installed.tap?.('t', () => {})).toBeUndefined();
      });

      it('passes name and listener through to a bus installed by another copy', async () => {
        const tap = { emit: vi.fn(), replay: vi.fn(), close: vi.fn() };
        const installed = { ...createBusLike(), tap: vi.fn(() => tap) };
        globalThis.__NF_BUS__ = installed;
        const { bus } = await loadCopy();
        const listener = vi.fn();

        expect(bus.tap?.('t', listener)).toBe(tap);
        expect(installed.tap).toHaveBeenCalledWith('t', listener);
      });

      // An older copy installed the bus before tap existed.
      it('returns undefined when the installed bus has no tap', async () => {
        globalThis.__NF_BUS__ = Object.freeze(createBusLike());
        const { bus } = await loadCopy();

        expect(bus.tap?.('t', () => {})).toBeUndefined();
        // Lets callers feature-detect with `bus.tap?.()` as the docs advise.
        expect(bus.tap).toBeUndefined();
      });

      // The facade reads tap from the slot on every access, not once at import.
      it('follows the installed bus', async () => {
        globalThis.__NF_BUS__ = Object.freeze(createBusLike());
        const { bus } = await loadCopy();
        expect(bus.tap).toBeUndefined();

        const tap = vi.fn();
        globalThis.__NF_BUS__ = { ...createBusLike(), tap };
        bus.tap?.('t', () => {});

        expect(tap).toHaveBeenCalledOnce();
      });
    });
  });

  // The global stays untyped so copies built against different versions merge without TS2403.
  it('types the global slot loosely and the typed Bus as assignable to it', () => {
    expectTypeOf<Bus>().toExtend<NativeFederationBus>();
    expectTypeOf(globalThis.__NF_BUS__).toEqualTypeOf<NativeFederationBus | undefined>();
    expectTypeOf<ReturnType<NativeFederationBus['peek']>>().toEqualTypeOf<unknown>();
  });
});
