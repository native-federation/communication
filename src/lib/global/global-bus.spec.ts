// @vitest-environment jsdom
import { version } from '../../../package.json';
import type { Bus } from '../domain/bus/bus.contract.js';

// A protocol-1 bus as a copy built before tap existed installs it.
const createBusLike = () => ({
  protocol: 1,
  version: '4.0.0',
  emit: vi.fn(),
  on: vi.fn(() => () => {}),
  peek: vi.fn(),
});

// Each test gets a fresh copy of the module (and so a fresh private fallback) and an empty slot.
async function loadCopy() {
  vi.resetModules();
  return import('./global-bus.js');
}

describe('the page bus', () => {
  beforeEach(() => {
    delete globalThis.__NF_BUS__;
  });

  afterAll(() => {
    delete globalThis.__NF_BUS__;
  });

  it('installs nothing at import', async () => {
    await loadCopy();

    expect(globalThis.__NF_BUS__).toBeUndefined();
  });

  it('installs a frozen, non-writable, non-enumerable, configurable slot on first use', async () => {
    const { bus } = await loadCopy();

    bus.emit('a', 1);

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, '__NF_BUS__');
    expect(descriptor).toMatchObject({ writable: false, enumerable: false, configurable: true });
    expect(Object.isFrozen(descriptor?.value)).toBe(true);
    expect(globalThis.__NF_BUS__?.protocol).toBe(1);
    expect(globalThis.__NF_BUS__?.peek('a')).toBe(1);
  });

  it('refuses a blind reassignment and keeps the original bus', async () => {
    const { bus } = await loadCopy();
    bus.emit('a', 1);
    const installed = globalThis.__NF_BUS__;

    expect(() => {
      (globalThis as { __NF_BUS__?: unknown }).__NF_BUS__ = {};
    }).toThrow(TypeError);
    expect(globalThis.__NF_BUS__).toBe(installed);
  });

  it('shares one bus between two copies of the module', async () => {
    const a = await loadCopy();
    const b = await loadCopy();
    expect(a.bus).not.toBe(b.bus);

    a.bus.emit('a', 'from a');
    const received: unknown[] = [];
    b.bus.on('a', value => received.push(value));
    b.bus.emit('a', 'from b');

    expect(received).toEqual(['from a', 'from b']);
    expect(a.bus.peek('a')).toBe('from b');
  });

  it('uses a newer copy at the key as-is, ignoring members it does not know', async () => {
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

  it.each([
    ['an object without protocol', { emit: () => {}, on: () => {}, peek: () => {} }],
    ['a protocol below 1', { protocol: 0, emit: () => {}, on: () => {}, peek: () => {} }],
    ['a non-numeric protocol', { protocol: '1', emit: () => {}, on: () => {}, peek: () => {} }],
    ['a protocol without methods', { protocol: 1 }],
    ['a protocol without peek', { protocol: 1, emit: () => {}, on: () => {} }],
    ['methods that are not functions', { protocol: 1, emit: 1, on: 1, peek: 1 }],
    ['null', null],
    ['a number', 1],
  ])('warns once and uses a private bus when the key holds %s', async (_, foreign) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (globalThis as { __NF_BUS__?: unknown }).__NF_BUS__ = foreign;
    const { bus } = await loadCopy();

    bus.emit('a', 1);
    const received: unknown[] = [];
    bus.on('a', value => received.push(value));

    expect(received).toEqual([1]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect((globalThis as { __NF_BUS__?: unknown }).__NF_BUS__).toBe(foreign);
  });

  it('passes the options of emit and on through to the bus serving the page', async () => {
    const { bus } = await loadCopy();
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
    const { emit, on, peek } = bus;
    const received: unknown[] = [];

    on('a', value => received.push(value));
    emit('a', 1);

    expect(received).toEqual([1]);
    expect(peek('a')).toBe(1);
  });

  it('works with destructured methods of the installed global', async () => {
    const { getGlobalBus } = await loadCopy();
    getGlobalBus();
    const { emit, on } = globalThis.__NF_BUS__!;
    const received: unknown[] = [];

    on('a', value => received.push(value));
    emit('a', 1);

    expect(received).toEqual([1]);
  });

  describe('tap', () => {
    it('opens a tap on the bus serving the page', async () => {
      const { bus } = await loadCopy();
      const seen: unknown[] = [];

      expect(bus.tap).toBeTypeOf('function');
      const tap = bus.tap!('t', (channel, value) => seen.push([channel, value]));
      globalThis.__NF_BUS__!.emit('a', 1);
      tap?.emit('b', 2);
      const received: unknown[] = [];
      globalThis.__NF_BUS__!.on('b', value => received.push(value));

      expect(seen).toEqual([['a', 1]]);
      expect(received).toEqual([2]);
      expect(globalThis.__NF_BUS__!.tap?.('t', () => {})).toBeUndefined();
    });

    it('passes name and observer through to a bus installed by another copy', async () => {
      const tap = { emit: vi.fn(), replay: vi.fn(), close: vi.fn() };
      const installed = { ...createBusLike(), tap: vi.fn(() => tap) };
      globalThis.__NF_BUS__ = installed;
      const { bus } = await loadCopy();
      const observer = vi.fn();

      expect(bus.tap?.('t', observer)).toBe(tap);
      expect(installed.tap).toHaveBeenCalledWith('t', observer);
    });

    // An older copy installed the page bus before tap existed.
    it('returns undefined when the bus serving the page has no tap', async () => {
      globalThis.__NF_BUS__ = Object.freeze(createBusLike());
      const { bus } = await loadCopy();

      expect(bus.tap?.('t', () => {})).toBeUndefined();
      // Lets callers feature-detect with `bus.tap?.()` as the docs advise.
      expect(bus.tap).toBeUndefined();
    });

    // The facade reads tap from the slot on every access, not once at import.
    it('follows the bus currently serving the page', async () => {
      globalThis.__NF_BUS__ = Object.freeze(createBusLike());
      const { bus } = await loadCopy();
      expect(bus.tap).toBeUndefined();

      const tap = vi.fn();
      globalThis.__NF_BUS__ = { ...createBusLike(), tap };

      expect(bus.tap).toBe(tap);
    });
  });

  it('reports the protocol and version of the bus serving the page', async () => {
    const { bus } = await loadCopy();

    expect(bus.protocol).toBe(1);
    expect(bus.version).toBe(version);
    expect(Object.isFrozen(bus)).toBe(true);
  });
});
