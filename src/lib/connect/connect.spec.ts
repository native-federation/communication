import { stubReportError } from '../../../test/helpers.js';
import { createBus } from '../bus/create-bus.js';
import type { Bus, Envelope } from '../domain/bus/bus.contract.js';
import type { Connection, Transport } from '../domain/connect/connect.contract.js';
import { connect } from './connect.js';

type Receive = (envelope: Envelope) => void;

// An in-memory transport. send() hands the envelope straight to the peer's receivers, so a
// round trip between two buses is synchronous and these specs need no timers.
type Endpoint = Transport & {
  sent: Envelope[];
  receivers: Set<Receive>;
  unlistens: number;
  peer?: Endpoint;
  // Delivers anything to this side's receivers, as if it came over the wire.
  inject(data: unknown): void;
};

function endpoint(name = 'memory'): Endpoint {
  const self: Endpoint = {
    name,
    sent: [],
    receivers: new Set(),
    unlistens: 0,
    send: envelope => {
      self.sent.push(envelope);
      self.peer?.inject(envelope);
    },
    listen: vi.fn((receive: Receive) => {
      self.receivers.add(receive);
      return () => {
        self.unlistens += 1;
        self.receivers.delete(receive);
      };
    }),
    inject: data => [...self.receivers].forEach(receive => receive(data as Envelope)),
  };
  return self;
}

function wire(a: Endpoint, b: Endpoint): void {
  a.peer = b;
  b.peer = a;
}

type Side = { bus: Bus; transport: Endpoint; connection: Connection };

// Two buses (two tabs, or a page and a native app) connected over one in-memory wire.
function pair(channels: string[]): [Side, Side] {
  const [ta, tb] = [endpoint(), endpoint()];
  wire(ta, tb);
  const [a, b] = [createBus(), createBus()];
  return [
    { bus: a, transport: ta, connection: connect(ta, channels, { bus: a })! },
    { bus: b, transport: tb, connection: connect(tb, channels, { bus: b })! },
  ];
}

const live = (bus: Bus, channel: string): unknown[] => {
  const values: unknown[] = [];
  bus.on(channel, value => values.push(value), { replay: false });
  return values;
};

// What a late subscriber gets: the retained value, if any.
const replayed = (bus: Bus, channel: string): unknown[] => {
  const values: unknown[] = [];
  bus.on(channel, value => values.push(value))();
  return values;
};

// A protocol-1 bus installed by a copy built before tap existed.
const withoutTap = (): NativeFederationBus =>
  Object.freeze({
    protocol: 1,
    version: '4.0.0',
    emit: vi.fn(),
    on: vi.fn(() => () => {}),
    peek: vi.fn(),
  });

// The warn-once state lives in the module, so warning specs load a fresh copy.
async function freshConnect(): Promise<typeof connect> {
  vi.resetModules();
  return (await import('./connect.js')).connect;
}

describe('connect', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    delete globalThis.__NF_BUS__;
  });

  describe('arguments', () => {
    const valid = (): Transport => ({ name: 't', send: () => {}, listen: () => () => {} });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a string', 'broadcast'],
      ['a function', () => {}],
      ['an object without a name', { send: () => {}, listen: () => () => {} }],
      ['a non-string name', { ...valid(), name: 1 }],
      ['a send that is not a function', { ...valid(), send: 'post' }],
      ['a missing listen', { name: 't', send: () => {} }],
      ['a listen that is not a function', { ...valid(), listen: {} }],
    ])('rejects %s as a transport', (_, transport) => {
      expect(() => connect(transport as never, ['a'], { bus: createBus() })).toThrow(TypeError);
    });

    it.each([1, undefined, null, {}])('rejects %s in the channel list', channel => {
      const transport = endpoint();

      expect(() => connect(transport, ['a', channel as never], { bus: createBus() })).toThrow(
        /A channel must be a string/
      );
      expect(transport.listen).not.toHaveBeenCalled();
    });

    it('accepts an empty channel list and then carries nothing', () => {
      const [a, b] = [endpoint(), endpoint()];
      wire(a, b);
      const bus = createBus();
      connect(a, [], { bus });

      bus.emit('a', 1);
      a.inject({ channel: 'a', value: 2, retain: true });

      expect(a.sent).toEqual([]);
      expect(bus.peek('a')).toBe(1);
    });
  });

  describe('the bus', () => {
    it('uses the bus installed on the global when none is given', () => {
      const installed = createBus();
      globalThis.__NF_BUS__ = installed;
      const transport = endpoint();

      connect(transport, ['a']);
      installed.emit('a', 1);
      transport.inject({ channel: 'a', value: 2, retain: true });

      expect(transport.sent).toEqual([{ channel: 'a', value: 1, retain: true }]);
      expect(installed.peek('a')).toBe(2);
    });

    it('accepts the untyped global bus as an option', () => {
      const installed = createBus();
      globalThis.__NF_BUS__ = installed;
      const transport = endpoint();

      connect(transport, ['a'], { bus: globalThis.__NF_BUS__ });
      installed.emit('a', 1);

      expect(transport.sent).toHaveLength(1);
    });

    // Node has no window, so the page bus is the inert one, which has no tap.
    it('is refused on the inert bus outside a single-user realm', async () => {
      const transport = endpoint();
      const connection = (await freshConnect())(transport, ['a']);

      expect(connection).toBeUndefined();
      expect(transport.listen).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('a bus without tap', () => {
    it('warns once per module and returns undefined without listening', async () => {
      const fresh = await freshConnect();
      const bus = withoutTap();
      const first = endpoint('first');
      const second = endpoint('second');

      const connections = [fresh(first, ['a'], { bus }), fresh(second, ['a'], { bus })];
      first.inject({ channel: 'a', value: 1, retain: true });

      expect(connections).toEqual([undefined, undefined]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/^\[native-federation-communication\] /);
      expect(first.listen).not.toHaveBeenCalled();
      expect(second.listen).not.toHaveBeenCalled();
      expect(first.sent).toEqual([]);
      expect(first.unlistens).toBe(0);
      expect(bus.emit).not.toHaveBeenCalled();
      expect(bus.on).not.toHaveBeenCalled();
    });

    it('warns again from another copy of the module', async () => {
      (await freshConnect())(endpoint(), ['a'], { bus: withoutTap() });
      (await freshConnect())(endpoint(), ['a'], { bus: withoutTap() });

      expect(warn).toHaveBeenCalledTimes(2);
    });
  });

  describe('a transport name already connected to the bus', () => {
    // Like tap, a taken name is refused silently: the undefined result tells the caller.
    it('is refused with undefined and no warning, without listening', () => {
      const bus = createBus();
      const original = endpoint('broadcast:x');
      const duplicate = endpoint('broadcast:x');
      connect(original, ['a'], { bus });

      const connection = connect(duplicate, ['a'], { bus });
      bus.emit('a', 1);

      expect(connection).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
      expect(duplicate.listen).not.toHaveBeenCalled();
      expect(duplicate.sent).toEqual([]);
      expect(original.sent).toEqual([{ channel: 'a', value: 1, retain: true }]);
    });

    // A tap and a transport share one namespace per bus.
    it('is refused when a tap holds the name', () => {
      const bus = createBus();
      bus.tap!('logger', () => {});

      expect(connect(endpoint('logger'), ['a'], { bus })).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    });

    it('is accepted on another bus', () => {
      connect(endpoint(), ['a'], { bus: createBus() });
      const transport = endpoint();

      connect(transport, ['a'], { bus: createBus() });

      expect(transport.listen).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
    });

    // Without closing the tap, a failed listen would keep sending and hold the name forever.
    it('rethrows a throwing listen and frees the name for a retry', () => {
      const bus = createBus();
      const error = new Error('cannot listen');
      const broken: Endpoint = {
        ...endpoint(),
        listen: vi.fn(() => {
          throw error;
        }),
      };

      expect(() => connect(broken, ['a'], { bus })).toThrow(error);
      bus.emit('a', 1);
      const retry = endpoint();
      connect(retry, ['a'], { bus });
      bus.emit('a', 2);

      expect(broken.sent).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
      expect(retry.sent).toEqual([{ channel: 'a', value: 2, retain: true }]);
    });

    it('is accepted again once the first connection is closed', () => {
      const bus = createBus();
      connect(endpoint(), ['a'], { bus })!.close();
      const transport = endpoint();

      connect(transport, ['a'], { bus });
      bus.emit('a', 1);

      expect(warn).not.toHaveBeenCalled();
      expect(transport.sent).toHaveLength(1);
    });
  });

  describe('outbound', () => {
    it('sends an emit on a listed channel with its value and retain', () => {
      const bus = createBus();
      const transport = endpoint();
      connect(transport, ['a', 'b'], { bus });
      const value = { id: 1 };

      bus.emit('a', value);
      bus.emit('b', 2, { retain: false });

      expect(transport.sent).toEqual([
        { channel: 'a', value, retain: true },
        { channel: 'b', value: 2, retain: false },
      ]);
      expect(transport.sent[0]!.value).toBe(value);
    });

    // The envelope comes from the core as is: nothing from emit's options rides along.
    it('sends exactly { channel, value, retain }', () => {
      const bus = createBus();
      const transport = endpoint();
      connect(transport, ['a'], { bus });

      bus.emit('a', 1, { retain: false, extra: 1 } as never);

      expect(transport.sent[0]).toStrictEqual({ channel: 'a', value: 1, retain: false });
    });

    it('sends nothing for a channel that is not listed', () => {
      const bus = createBus();
      const transport = endpoint();
      connect(transport, ['a'], { bus });

      bus.emit('b', 1);
      bus.emit('a:sub', 1);

      expect(transport.sent).toEqual([]);
    });

    it('sends nothing before an emit: connecting does not push the retained state', () => {
      const bus = createBus();
      bus.emit('a', 1);
      const transport = endpoint();

      connect(transport, ['a'], { bus });

      expect(transport.sent).toEqual([]);
    });

    it('sends in listener-delivery order, re-entrant emits included', () => {
      const bus = createBus();
      const transport = endpoint();
      connect(transport, ['a', 'b'], { bus });
      bus.on('a', value => bus.emit('b', `re:${value}`));

      bus.emit('a', 1);
      bus.emit('a', 2);

      expect(transport.sent.map(({ channel, value }) => `${channel}:${value}`)).toEqual([
        'a:1',
        'b:re:1',
        'a:2',
        'b:re:2',
      ]);
    });

    it('reports a throwing send and leaves local delivery and other taps intact', () => {
      const reportError = stubReportError();
      const error = new Error('cannot clone');
      const bus = createBus();
      const broken = {
        ...endpoint('broken'),
        send: () => {
          throw error;
        },
      };
      const healthy = endpoint('healthy');
      connect(broken, ['a'], { bus });
      connect(healthy, ['a'], { bus });
      const received = live(bus, 'a');

      bus.emit('a', 1);

      expect(reportError).toHaveBeenCalledWith(error);
      expect(received).toEqual([1]);
      expect(bus.peek('a')).toBe(1);
      expect(healthy.sent).toEqual([{ channel: 'a', value: 1, retain: true }]);
    });
  });

  describe('inbound', () => {
    it('emits a listed envelope on the bus, retained when it says so', () => {
      const bus = createBus();
      const transport = endpoint();
      connect(transport, ['a', 'b'], { bus });
      const a = live(bus, 'a');
      const b = live(bus, 'b');
      const value = { id: 1 };

      transport.inject({ channel: 'a', value, retain: true });
      transport.inject({ channel: 'b', value: 2, retain: false });

      expect(a).toEqual([value]);
      expect(a[0]).toBe(value);
      expect(b).toEqual([2]);
      expect(bus.peek('a')).toBe(value);
      expect(bus.peek('b')).toBeUndefined();
    });

    // The envelope's retain goes to tap.emit as is, so a missing one takes the bus default (retain)
    // and any other value follows emit's coercion.
    it.each([
      ['missing', undefined, true],
      ['false', false, false],
      ['1', 1, true],
    ])('follows emit for a %s retain', (_, retain, retained) => {
      const bus = createBus();
      const transport = endpoint();
      connect(transport, ['a'], { bus });
      const received = live(bus, 'a');

      transport.inject({ channel: 'a', value: 1, retain });

      expect(received).toEqual([1]);
      expect(bus.peek('a')).toBe(retained ? 1 : undefined);
    });

    it('ignores an envelope on a channel that is not listed', () => {
      const bus = createBus();
      const transport = endpoint();
      connect(transport, ['a'], { bus });
      const received = live(bus, 'b');

      transport.inject({ channel: 'b', value: 1, retain: true });

      expect(received).toEqual([]);
      expect(bus.peek('b')).toBeUndefined();
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a string', 'a'],
      ['a number', 1],
      ['an empty object', {}],
      ['a non-string channel', { channel: 1, value: 1, retain: true }],
      ['a boxed channel', { channel: new String('a'), value: 1, retain: true }],
      ['an array', ['a', 1, true]],
    ])('ignores %s arriving as an envelope', (_, data) => {
      const reportError = stubReportError();
      const bus = createBus();
      const transport = endpoint();
      connect(transport, ['a', '1'], { bus });
      const listener = vi.fn();
      bus.on('a', listener);
      bus.on('1', listener);

      expect(() => transport.inject(data)).not.toThrow();

      expect(listener).not.toHaveBeenCalled();
      expect(reportError).not.toHaveBeenCalled();
    });

    it('does not send an applied envelope back over the transport it came from', () => {
      const bus = createBus();
      const transport = endpoint();
      connect(transport, ['a'], { bus });

      transport.inject({ channel: 'a', value: 1, retain: true });

      expect(transport.sent).toEqual([]);
    });

    it('sends what local listeners emit in response to an applied envelope', () => {
      const bus = createBus();
      const transport = endpoint();
      connect(transport, ['a', 'ack'], { bus });
      bus.on('a', value => bus.emit('ack', value, { retain: false }), { replay: false });

      transport.inject({ channel: 'a', value: 1, retain: true });

      expect(transport.sent).toEqual([{ channel: 'ack', value: 1, retain: false }]);
    });
  });

  describe('between two buses', () => {
    it('delivers both ways, the exact reference over an in-memory transport', () => {
      const [a, b] = pair(['cart']);
      const atA = live(a.bus, 'cart');
      const atB = live(b.bus, 'cart');
      const value = { items: 1 };

      a.bus.emit('cart', value);
      b.bus.emit('cart', 2);

      expect(atB).toEqual([value, 2]);
      expect(atB[0]).toBe(value);
      expect(atA).toEqual([value, 2]);
      expect(a.bus.peek('cart')).toBe(2);
      expect(b.bus.peek('cart')).toBe(2);
    });

    it('never echoes a value back to the side that sent it', () => {
      const [a, b] = pair(['cart']);
      const atA = live(a.bus, 'cart');

      a.bus.emit('cart', 1);
      b.bus.emit('cart', 2);

      expect(a.transport.sent).toEqual([{ channel: 'cart', value: 1, retain: true }]);
      expect(b.transport.sent).toEqual([{ channel: 'cart', value: 2, retain: true }]);
      expect(atA).toEqual([1, 2]);
    });

    it('carries a retained undefined, which a late subscriber on the other side replays', () => {
      const [a, b] = pair(['user']);

      a.bus.emit('user', 'ada');
      a.bus.emit('user', undefined);

      expect(replayed(b.bus, 'user')).toEqual([undefined]);
    });

    it('carries retain: false, which clears the other side’s retained value', () => {
      const [a, b] = pair(['toast']);
      const atB = live(b.bus, 'toast');

      a.bus.emit('toast', 'stale');
      a.bus.emit('toast', 'saved', { retain: false });

      expect(atB).toEqual(['stale', 'saved']);
      expect(b.bus.peek('toast')).toBeUndefined();
      expect(replayed(b.bus, 'toast')).toEqual([]);
    });

    it('carries only the listed channels, in either direction', () => {
      const [ta, tb] = [endpoint(), endpoint()];
      wire(ta, tb);
      const [a, b] = [createBus(), createBus()];
      connect(ta, ['shared', 'a-only'], { bus: a });
      connect(tb, ['shared', 'b-only'], { bus: b });

      a.emit('a-only', 1);
      b.emit('b-only', 2);
      a.emit('shared', 3);

      expect(b.peek('a-only')).toBeUndefined();
      expect(a.peek('b-only')).toBeUndefined();
      expect(b.peek('shared')).toBe(3);
      // Each side sends what it lists; the receiving side drops what it does not.
      expect(ta.sent.map(({ channel }) => channel)).toEqual(['a-only', 'shared']);
      expect(tb.sent.map(({ channel }) => channel)).toEqual(['b-only']);
    });
  });

  describe('replay', () => {
    it('sends every retained listed value, retained undefined included, and nothing else', () => {
      const bus = createBus();
      bus.emit('a', 1);
      bus.emit('unlisted', 2);
      bus.emit('b', undefined);
      bus.emit('command', 3, { retain: false });
      const transport = endpoint();
      const connection = connect(transport, ['a', 'b', 'command'], { bus })!;

      connection.replay();

      expect(transport.sent).toEqual([
        { channel: 'a', value: 1, retain: true },
        { channel: 'b', value: undefined, retain: true },
      ]);
    });

    it('brings a side that connected later up to date', () => {
      const [ta, tb] = [endpoint(), endpoint()];
      wire(ta, tb);
      const [a, b] = [createBus(), createBus()];
      a.emit('cart', 3);
      const atA = connect(ta, ['cart'], { bus: a })!;
      connect(tb, ['cart'], { bus: b });
      expect(b.peek('cart')).toBeUndefined();

      atA.replay();

      expect(b.peek('cart')).toBe(3);
      // b applied it without sending it back.
      expect(tb.sent).toEqual([]);
    });

    it('does not reach other connections on the same bus', () => {
      const bus = createBus();
      bus.emit('a', 1);
      const one = endpoint('one');
      const two = endpoint('two');
      const connection = connect(one, ['a'], { bus })!;
      connect(two, ['a'], { bus });

      connection.replay();

      expect(one.sent).toHaveLength(1);
      expect(two.sent).toEqual([]);
    });
  });

  describe('close', () => {
    it('stops both directions and unlistens once, however often it is called', () => {
      const bus = createBus();
      const transport = endpoint();
      const connection = connect(transport, ['a'], { bus })!;

      connection.close();
      connection.close();
      bus.emit('a', 1);
      transport.inject({ channel: 'a', value: 2, retain: true });
      connection.replay();

      expect(transport.unlistens).toBe(1);
      expect(transport.receivers.size).toBe(0);
      expect(transport.sent).toEqual([]);
      expect(bus.peek('a')).toBe(1);
    });

    // A transport may still deliver a message already in flight after unlisten.
    it('ignores a receive called after close by a transport that keeps the callback', () => {
      const bus = createBus();
      let receive: Receive | undefined;
      const transport: Transport = {
        name: 'leaky',
        send: () => {},
        listen: fn => ((receive = fn), () => {}),
      };
      const connection = connect(transport, ['a'], { bus })!;
      const received = live(bus, 'a');

      connection.close();
      receive!({ channel: 'a', value: 1, retain: true });

      expect(received).toEqual([]);
      expect(bus.peek('a')).toBeUndefined();
    });

    it('leaves the bus and its other connections working', () => {
      const bus = createBus();
      const closed = endpoint('closed');
      const open = endpoint('open');
      connect(closed, ['a'], { bus })!.close();
      connect(open, ['a'], { bus });
      const received = live(bus, 'a');

      bus.emit('a', 1);

      expect(received).toEqual([1]);
      expect(open.sent).toHaveLength(1);
    });
  });

  // A hub bus with two connections forwards between them: a value arriving over one transport is
  // an ordinary emit for every other tap on the bus.
  describe('a hub', () => {
    function hub() {
      const [aToHub, hubToA] = [endpoint('to-hub'), endpoint('to-a')];
      const [cToHub, hubToC] = [endpoint('to-hub'), endpoint('to-c')];
      wire(aToHub, hubToA);
      wire(cToHub, hubToC);
      const [a, h, c] = [createBus(), createBus(), createBus()];
      connect(aToHub, ['cart'], { bus: a });
      connect(hubToA, ['cart'], { bus: h });
      connect(hubToC, ['cart'], { bus: h });
      connect(cToHub, ['cart'], { bus: c });
      return { a, h, c, aToHub, hubToA, hubToC, cToHub };
    }

    it('forwards a value from one leaf to the other exactly once, with no echo', () => {
      const { a, h, c, aToHub, hubToA, hubToC, cToHub } = hub();
      const [atA, atH, atC] = [live(a, 'cart'), live(h, 'cart'), live(c, 'cart')];

      a.emit('cart', 1);

      expect(atA).toEqual([1]);
      expect(atH).toEqual([1]);
      expect(atC).toEqual([1]);
      expect(aToHub.sent).toHaveLength(1);
      expect(hubToC.sent).toEqual([{ channel: 'cart', value: 1, retain: true }]);
      expect(hubToA.sent).toEqual([]);
      expect(cToHub.sent).toEqual([]);
    });

    it('forwards the other way and from the hub itself, retain included', () => {
      const { a, h, c, hubToA, hubToC } = hub();
      const [atA, atC] = [live(a, 'cart'), live(c, 'cart')];

      c.emit('cart', 'from c', { retain: false });
      h.emit('cart', 'from hub');

      expect(atA).toEqual(['from c', 'from hub']);
      expect(atC).toEqual(['from c', 'from hub']);
      expect(hubToA.sent).toEqual([
        { channel: 'cart', value: 'from c', retain: false },
        { channel: 'cart', value: 'from hub', retain: true },
      ]);
      expect(hubToC.sent).toEqual([{ channel: 'cart', value: 'from hub', retain: true }]);
    });
  });
});
