import { createBus } from '../bus/create-bus.js';
import { connectTransport } from '../connect/connect.js';
import type { Bus, Envelope } from '../domain/bus/bus.contract.js';
import type { Connection, Transport } from '../domain/connect/connect.contract.js';
import { noop } from '../bus/arguments.js';
import { broadcastChannelTransport } from './broadcast-channel-transport.js';

const Real = globalThis.BroadcastChannel;

// Every channel the transport opens goes through this subclass, so opens and closes are
// observable while messages still travel over Node's real BroadcastChannel.
const opened: RecordingChannel[] = [];
class RecordingChannel extends Real {
  closes = 0;

  constructor(name: string) {
    super(name);
    opened.push(this);
  }

  override close(): void {
    this.closes += 1;
    super.close();
  }
}

// An open channel keeps Node alive and would leak messages into the next test.
const cleanups: (() => void)[] = [];
const track = <T extends () => void>(stop: T): T => (cleanups.push(stop), stop);

let wires = 0;
const fresh = (): string => `test:wire-${++wires}`;

type Side = { transport: Transport; received: unknown[]; unlisten: () => void };

function listening(wire: string): Side {
  const transport = broadcastChannelTransport(wire);
  const received: unknown[] = [];
  const unlisten = track(transport.listen(envelope => received.push(envelope)));
  return { transport, received, unlisten };
}

// BroadcastChannel only guarantees FIFO per sender and receiver. So a negative check sends a fence
// through the same sender afterwards and waits until the same receiver has it: anything sent
// before it has then arrived, or never will.
let fences = 0;
async function fence(from: Transport, to: Side): Promise<void> {
  const envelope: Envelope = { channel: 'test:fence', value: ++fences, retain: false };
  from.send(envelope);
  await vi.waitFor(() => expect(to.received).toContainEqual(envelope));
  const rest = to.received.filter(seen => (seen as Envelope).channel !== envelope.channel);
  to.received.splice(0, Infinity, ...rest);
}

describe('broadcastChannelTransport', () => {
  beforeEach(() => {
    vi.stubGlobal('BroadcastChannel', RecordingChannel);
  });

  afterEach(() => {
    cleanups.splice(0).forEach(stop => stop());
    const leaked = opened.splice(0).filter(channel => channel.closes === 0);
    expect(leaked, 'a channel the transport opened was never closed').toEqual([]);
  });

  describe('name', () => {
    it('is broadcast: plus the default wire', () => {
      expect(broadcastChannelTransport().name).toBe('broadcast:native-federation-communication');
    });

    it('is broadcast: plus a given wire', () => {
      expect(broadcastChannelTransport('my-app').name).toBe('broadcast:my-app');
    });
  });

  describe('between two transports on the same wire', () => {
    it('delivers a task later, not synchronously, and not back to the sender', async () => {
      const wire = fresh();
      const a = listening(wire);
      const b = listening(wire);
      const envelope: Envelope = { channel: 'cart', value: { items: [1] }, retain: true };

      a.transport.send(envelope);
      expect(b.received).toEqual([]);

      await vi.waitFor(() => expect(b.received).toEqual([envelope]));
      // A structured clone: equal, not the same object.
      expect(b.received[0]).not.toBe(envelope);
      await fence(b.transport, a);
      expect(a.received).toEqual([]);
    });

    it('delivers in both directions', async () => {
      const wire = fresh();
      const a = listening(wire);
      const b = listening(wire);
      const ab: Envelope = { channel: 'x', value: 1, retain: true };
      const ba: Envelope = { channel: 'x', value: 2, retain: false };

      a.transport.send(ab);
      b.transport.send(ba);

      await vi.waitFor(() => expect(b.received).toEqual([ab]));
      await vi.waitFor(() => expect(a.received).toEqual([ba]));
    });

    it('opens one channel per listen, on the wire’s name', () => {
      const wire = fresh();
      listening(wire);

      expect(opened.map(channel => channel.name)).toEqual([wire]);
    });

    it('does not reach a transport on another wire', async () => {
      const wire = fresh();
      const a = listening(wire);
      const b = listening(wire);
      const other = listening(fresh());

      a.transport.send({ channel: 'x', value: 1, retain: true });
      await fence(a.transport, b);

      expect(b.received).toEqual([{ channel: 'x', value: 1, retain: true }]);
      expect(other.received).toEqual([]);
    });

    // connectTransport reports this throw; see connect.spec.ts.
    it('throws from send on a value structured clone cannot copy', () => {
      const a = listening(fresh());

      expect(() => a.transport.send({ channel: 'x', value: () => {}, retain: true })).toThrow();
    });
  });

  describe('opening lazily', () => {
    it('opens nothing until listen', () => {
      broadcastChannelTransport(fresh());

      expect(opened).toEqual([]);
    });

    it('sends nothing before listen', async () => {
      const wire = fresh();
      const sender = broadcastChannelTransport(wire);
      const receiver = listening(wire);

      expect(() => sender.send({ channel: 'x', value: 'early', retain: true })).not.toThrow();
      expect(opened).toHaveLength(1);
      track(sender.listen(() => {}));
      await fence(sender, receiver);

      expect(receiver.received).toEqual([]);
    });

    it('opens nothing for a connectTransport refused as a duplicate', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const bus = createBus();
      const wire = fresh();
      track(connectTransport(broadcastChannelTransport(wire), ['x'], { bus })!.close);

      const duplicate = connectTransport(broadcastChannelTransport(wire), ['x'], { bus });

      expect(duplicate).toBeUndefined();
      expect(opened).toHaveLength(1);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('unlisten', () => {
    it('closes the channel, after which send does nothing', async () => {
      const wire = fresh();
      const a = listening(wire);
      const b = listening(wire);

      a.unlisten();

      expect(opened[0]!.closes).toBe(1);
      expect(() => a.transport.send({ channel: 'x', value: 1, retain: true })).not.toThrow();
      await fence(listening(wire).transport, b);
      expect(b.received).toEqual([]);
    });

    it('stops delivery to the closed side', async () => {
      const wire = fresh();
      const a = listening(wire);
      const b = listening(wire);
      const c = listening(wire);

      b.unlisten();
      a.transport.send({ channel: 'x', value: 1, retain: true });
      await fence(a.transport, c);

      expect(b.received).toEqual([]);
    });
  });

  // send cannot tell two listens apart, so a second one would make the first side hear itself.
  describe('one instance listened twice', () => {
    const already = (wire: string): string =>
      `[native-federation-communication] broadcastChannelTransport('${wire}') is already listening; use one instance per connection.`;

    it('throws on the second listen, naming the wire, and the first side keeps working', async () => {
      const wire = fresh();
      const transport = broadcastChannelTransport(wire);
      const first: Side = { transport, received: [], unlisten: noop };
      track(transport.listen(envelope => first.received.push(envelope)));
      const other = listening(wire);

      expect(() => transport.listen(() => {})).toThrow(already(wire));

      expect(opened).toHaveLength(2);
      await fence(transport, other);
      await fence(other.transport, first);
    });

    // Relies on connectTransport closing the tap when listen throws.
    it('throws when connected to a second bus, leaving that bus’s tap name free', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const wire = fresh();
      const transport = broadcastChannelTransport(wire);
      track(connectTransport(transport, ['x'], { bus: createBus() })!.close);
      const second = createBus();

      expect(() => connectTransport(transport, ['x'], { bus: second })).toThrow(already(wire));

      track(connectTransport(broadcastChannelTransport(wire), ['x'], { bus: second })!.close);
      expect(warn).not.toHaveBeenCalled();
      expect(opened).toHaveLength(2);
    });

    it('can listen again after unlisten', async () => {
      const wire = fresh();
      const transport = broadcastChannelTransport(wire);
      transport.listen(() => {})();
      const received: unknown[] = [];

      expect(() => track(transport.listen(envelope => received.push(envelope)))).not.toThrow();
      const other = listening(wire);
      await fence(other.transport, { transport, received, unlisten: noop });

      expect(opened).toHaveLength(3);
    });
  });

  describe('without BroadcastChannel', () => {
    it('listens and sends as no-ops', () => {
      vi.stubGlobal('BroadcastChannel', undefined);
      const transport = broadcastChannelTransport(fresh());
      const receive = vi.fn();

      const unlisten = transport.listen(receive);

      expect(unlisten).toBeTypeOf('function');
      expect(() => unlisten()).not.toThrow();
      expect(() => transport.listen(receive)()).not.toThrow();
      expect(() => transport.send({ channel: 'x', value: 1, retain: true })).not.toThrow();
      expect(receive).not.toHaveBeenCalled();
    });

    it('makes connectTransport a working no-op that keeps local delivery', () => {
      vi.stubGlobal('BroadcastChannel', undefined);
      const bus = createBus();
      const connection = connectTransport(broadcastChannelTransport(fresh()), ['x'], { bus })!;
      const received: unknown[] = [];
      bus.on('x', value => received.push(value));

      bus.emit('x', 1);
      connection.replayRetained();
      connection.close();

      expect(received).toEqual([1]);
    });
  });

  // Two buses stand in for two tabs.
  describe('through connectTransport', () => {
    function tab(wire: string, channels: string[]): { bus: Bus; connection: Connection } {
      const bus = createBus();
      const connection = connectTransport(broadcastChannelTransport(wire), channels, { bus })!;
      track(connection.close);
      return { bus, connection };
    }

    const live = (bus: Bus, channel: string): unknown[] => {
      const values: unknown[] = [];
      bus.on(channel, value => values.push(value), { replay: false });
      return values;
    };

    it('carries a listed channel to the other tab, retained undefined included', async () => {
      const wire = fresh();
      const a = tab(wire, ['cart', 'user']);
      const b = tab(wire, ['cart', 'user']);
      const cart = live(b.bus, 'cart');
      const user = live(b.bus, 'user');

      a.bus.emit('cart', { items: 1 });
      a.bus.emit('user', undefined);

      await vi.waitFor(() => expect(user).toEqual([undefined]));
      expect(cart).toEqual([{ items: 1 }]);
      expect(b.bus.peek('cart')).toEqual({ items: 1 });
      const replayed: unknown[] = [];
      b.bus.on('user', value => replayed.push(value))();
      expect(replayed).toEqual([undefined]);
    });

    it('carries retain: false, clearing the other tab’s retained value', async () => {
      const wire = fresh();
      const a = tab(wire, ['toast']);
      const b = tab(wire, ['toast']);
      const toast = live(b.bus, 'toast');

      a.bus.emit('toast', 'stale');
      a.bus.emit('toast', 'saved', { retain: false });

      await vi.waitFor(() => expect(toast).toEqual(['stale', 'saved']));
      expect(b.bus.peek('toast')).toBeUndefined();
    });

    it('does not echo a value back to the tab that sent it', async () => {
      const wire = fresh();
      const a = tab(wire, ['cart']);
      const b = tab(wire, ['cart']);
      const atA = live(a.bus, 'cart');
      const atB = live(b.bus, 'cart');

      a.bus.emit('cart', 1);
      await vi.waitFor(() => expect(atB).toEqual([1]));
      // A round trip from b: an echo of 1 from b would have arrived before b's own 2.
      b.bus.emit('cart', 2);
      await vi.waitFor(() => expect(atA).toEqual([1, 2]));

      expect(atB).toEqual([1, 2]);
    });

    it('replayRetained pushes this tab’s retained state to a tab that connected later', async () => {
      const wire = fresh();
      const a = tab(wire, ['cart']);
      a.bus.emit('cart', 3);
      const b = tab(wire, ['cart']);

      a.connection.replayRetained();

      await vi.waitFor(() => expect(b.bus.peek('cart')).toBe(3));
    });
  });
});
