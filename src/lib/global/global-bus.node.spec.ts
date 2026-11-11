// Runs in the unit project's default node environment: no window, as on a server or in a worker.
import { version } from '../../../package.json';
import { createBus } from '../bus/create-bus.js';
import type { Bus } from '../domain/bus/bus.contract.js';

// Each test gets a fresh copy of the module (and so a fresh warn-once state) and an empty slot.
async function loadCopy() {
  vi.resetModules();
  return import('../../index.js');
}

describe('the page bus without window', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete globalThis.__NF_BUS__;
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterAll(() => {
    delete globalThis.__NF_BUS__;
  });

  it('adds no globals and warns nothing when the barrel is imported', async () => {
    const keys = Reflect.ownKeys(globalThis);

    await loadCopy();

    expect(Reflect.ownKeys(globalThis)).toEqual(keys);
    expect(warn).not.toHaveBeenCalled();
  });

  it('is inert and installs nothing', async () => {
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

  it('warns once per copy that the inert bus drops values', async () => {
    const { bus } = await loadCopy();

    bus.emit('a', 1);
    bus.on('a', () => {});
    bus.peek('a');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/drops every value.*request-scoped bus/s);

    (await loadCopy()).bus.peek('a');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('throws the same TypeErrors as a real bus', async () => {
    const { bus } = await loadCopy();

    expect(() => bus.emit(undefined as unknown as string, 1)).toThrow(TypeError);
    expect(() => bus.on(42 as unknown as string, () => {})).toThrow(TypeError);
    expect(() => bus.on('a', undefined as unknown as () => void)).toThrow(TypeError);
    expect(() => bus.peek(null as unknown as string)).toThrow(TypeError);
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses a bus installed in the slot', async () => {
    const installed = createBus();
    globalThis.__NF_BUS__ = installed;
    const { bus } = await loadCopy();
    const received: unknown[] = [];

    bus.on('a', value => received.push(value));
    installed.emit('a', 1);
    bus.emit('a', 2);

    expect(received).toEqual([1, 2]);
    expect(installed.peek('a')).toBe(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once and uses a private bus when the slot holds something else', async () => {
    (globalThis as { __NF_BUS__?: unknown }).__NF_BUS__ = { protocol: 1 };
    const { bus } = await loadCopy();

    bus.emit('a', 1);
    bus.emit('a', 2);

    expect(bus.peek('a')).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/not a bus/);
  });

  it('does not install when a shim defines a window that is not the global', async () => {
    vi.stubGlobal('window', {});
    const { bus } = await loadCopy();

    bus.emit('a', 1);

    expect(bus.peek('a')).toBeUndefined();
    expect(globalThis.__NF_BUS__).toBeUndefined();
  });

  // The known hole: a `global.window = global` shim looks like a page, so one bus serves every
  // request unless the server installs its own bus first.
  it('installs when a shim makes window the global', async () => {
    vi.stubGlobal('window', globalThis);
    const { bus } = await loadCopy();

    bus.emit('a', 1);

    expect(globalThis.__NF_BUS__?.peek('a')).toBe(1);
  });

  it('still offers isolated per-request buses through createBus', async () => {
    const { createBus } = await loadCopy();
    const requestA = createBus();
    const requestB = createBus();

    requestA.emit('user', 'ada');

    expect(requestA.peek('user')).toBe('ada');
    expect(requestB.peek('user')).toBeUndefined();
  });

  // The global stays untyped so copies built against different versions merge without TS2403.
  it('types the global slot loosely and the typed Bus as assignable to it', () => {
    expectTypeOf<Bus>().toExtend<NativeFederationBus>();
    expectTypeOf(globalThis.__NF_BUS__).toEqualTypeOf<NativeFederationBus | undefined>();
    expectTypeOf<ReturnType<NativeFederationBus['peek']>>().toEqualTypeOf<unknown>();
  });
});
