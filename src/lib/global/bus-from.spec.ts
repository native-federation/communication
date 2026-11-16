import { createBus } from '../bus/create-bus.js';
import { connectTransport } from '../connect/connect.js';
import type { Bus, TapListener } from '../domain/bus/bus.contract.js';
import { busFrom } from './bus-from.js';

// A bus whose methods need `this`: a private field throws when a method is called unbound.
class ClassBus implements NativeFederationBus {
  readonly #inner = createBus();
  readonly protocol = 1;
  readonly version = this.#inner.version;
  emit(channel: string, value: unknown) {
    this.#inner.emit(channel, value);
  }
  on(channel: string, listener: (value: unknown) => void) {
    return this.#inner.on(channel, listener);
  }
  peek(channel: string) {
    return this.#inner.peek(channel);
  }
  tap(name: string, listener: TapListener) {
    return this.#inner.tap!(name, listener);
  }
}

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
    const getBus = vi.fn(() => current);
    const bus = busFrom(getBus);

    bus.emit('a', 1);
    current = second;
    bus.emit('a', 2);

    expect([first.peek('a'), second.peek('a')]).toEqual([1, 2]);
    expect([bus.protocol, bus.version]).toEqual([2, '9.0.0']);
    expect(bus.peek('a')).toBe(2);
    expect(getBus).toHaveBeenCalledTimes(5);
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

  // Without the guard each call re-enters the same facade until the stack overflows (RangeError).
  it('throws a prefixed TypeError when the getter returns the facade itself', () => {
    const bus: Bus = busFrom(() => bus);

    for (const use of [
      () => bus.emit('a', 1),
      () => bus.on('a', () => {}),
      () => bus.peek('a'),
      () => bus.protocol,
      () => bus.tap,
    ]) {
      expect(use).toThrow(TypeError);
      expect(use).toThrow(
        /^\[native-federation-communication\] This busFrom bus resolves to itself/
      );
    }
  });

  it('calls tap as a method of the bus, so a class-based bus can be tapped and connected', () => {
    const source = new ClassBus();
    const bus = busFrom(() => source);
    const seen: unknown[] = [];
    const sent: unknown[] = [];
    const transport = { name: 't', send: (e: unknown) => sent.push(e), listen: () => () => {} };

    bus.tap?.('logger', ({ value }) => seen.push(value));
    const connection = connectTransport(transport, ['a'], { bus });
    bus.emit('a', 1);
    connection?.close();

    expect(seen).toEqual([1]);
    expect(sent).toEqual([{ channel: 'a', value: 1, retain: true }]);
  });
});
