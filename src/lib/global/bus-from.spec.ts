import { createBus } from '../bus/create-bus.js';
import { busFrom } from './bus-from.js';

describe('busFrom', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterAll(() => {
    delete globalThis.__NF_BUS__;
  });

  it('serves the bus the getter returns, without touching the global slot', () => {
    const source = createBus();
    globalThis.__NF_BUS__ = createBus();
    const bus = busFrom(() => source);
    const received: unknown[] = [];

    bus.on('a', value => received.push(value));
    bus.emit('a', 1);

    expect(received).toEqual([1]);
    expect(source.peek('a')).toBe(1);
    expect(globalThis.__NF_BUS__.peek('a')).toBeUndefined();
    expect(Object.isFrozen(bus)).toBe(true);
  });

  // e.g. an AsyncLocalStorage store or a DI container that hands out a bus per scope.
  it('calls the getter on every access, so it follows the source', () => {
    const first = createBus();
    const second = { ...createBus(), protocol: 2, version: '9.0.0' };
    let current: NativeFederationBus | undefined = first;
    const get = vi.fn(() => current);
    const bus = busFrom(get);

    bus.emit('a', 1);
    current = second;
    bus.emit('a', 2);

    expect([first.peek('a'), second.peek('a')]).toEqual([1, 2]);
    expect([bus.protocol, bus.version]).toEqual([2, '9.0.0']);
    expect(bus.peek('a')).toBe(2);
    expect(get).toHaveBeenCalledTimes(5);
  });

  it('falls back to the inert bus while the getter returns undefined', () => {
    const bus = busFrom(() => undefined);
    const listener = vi.fn();

    bus.emit('a', 1);
    bus.on('a', listener)();

    expect(bus.peek('a')).toBeUndefined();
    expect(bus.tap).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/No bus is available here, so this call is dropped/);
  });
});
