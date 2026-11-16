import { stubReportError } from '../../../test/helpers.js';
import { createBus } from '../bus/create-bus.js';
import type { Bus } from '../domain/bus/bus.contract.js';
import { shareAcrossTabs } from './share-across-tabs.js';

// The wire contract (docs/multiple-copies.md, "The protocol"): probes speak it directly.
const WIRE = 'native-federation-communication:1';
const Real = globalThis.BroadcastChannel;

// Every port the plugin opens goes through this subclass, so posts and closes are observable
// synchronously while messages still travel over the real BroadcastChannel.
const opened: RecordingChannel[] = [];
class RecordingChannel extends Real {
  posts: unknown[] = [];
  closes = 0;

  constructor(name: string) {
    super(name);
    opened.push(this);
  }

  // Recorded after super, so a post that throws (DataCloneError) is not counted as sent.
  override postMessage(message: unknown): void {
    super.postMessage(message);
    this.posts.push(message);
  }

  override close(): void {
    this.closes += 1;
    super.close();
  }
}

// An open channel keeps Node alive and would leak messages into the next test.
const stops: (() => void)[] = [];
const probes: BroadcastChannel[] = [];
const track = (stop: () => void): (() => void) => (stops.push(stop), stop);

let names = 0;
const fresh = (): string => `test:tabs-${++names}`;

type Tab = { bus: Bus; stop: () => void; port: RecordingChannel | undefined };

// One "tab": a bus of its own, bridged with an explicit { bus } like a test or isolated bus would.
function install(channels: string[], bus: Bus = createBus()): Tab {
  const before = opened.length;
  const stop = track(shareAcrossTabs(channels, { bus }));
  return { bus, stop, port: opened.length > before ? opened.at(-1) : undefined };
}

function probe(): BroadcastChannel {
  const channel = new Real(WIRE);
  probes.push(channel);
  return channel;
}

const allPosts = (): unknown[] => opened.flatMap(port => port.posts);

// BroadcastChannel only guarantees FIFO per sender and receiver. So a negative check posts a fence
// through the same sender after the action and waits until the same receiver has it: anything the
// action sent has then arrived, or never will.
let fences = 0;
async function fence(send: () => void, to: Bus, channel: string, id: number): Promise<void> {
  const seen: unknown[] = [];
  const off = to.on(channel, value => seen.push(value), { replay: false });
  send();
  await vi.waitFor(() => expect(seen).toContain(id));
  off();
}
const fenceVia = (from: Bus, to: Bus, channel: string): Promise<void> => {
  const id = ++fences;
  return fence(() => from.emit(channel, id, { retain: false }), to, channel, id);
};
const fenceFrom = (wire: BroadcastChannel, to: Bus, channel: string): Promise<void> => {
  const id = ++fences;
  return fence(() => wire.postMessage({ channel, value: id, retain: false }), to, channel, id);
};

const live = (bus: Bus, channel: string): unknown[] => {
  const values: unknown[] = [];
  bus.on(channel, value => values.push(value), { replay: false });
  return values;
};
const replayed = (bus: Bus, channel: string): unknown[] => {
  const values: unknown[] = [];
  bus.on(channel, value => values.push(value))();
  return values;
};

describe('shareAcrossTabs', () => {
  beforeEach(() => {
    vi.stubGlobal('BroadcastChannel', RecordingChannel);
  });

  afterEach(() => {
    stops.splice(0).forEach(stop => stop());
    probes.splice(0).forEach(channel => channel.close());
    const leaked = opened.splice(0).filter(port => port.closes === 0);
    expect(leaked, 'a port the plugin opened was never closed').toEqual([]);
  });

  describe('delivery between two tabs', () => {
    it('delivers a retained emit to the other tab, where peek and replay then see a copy', async () => {
      class Point {
        x = 1;
      }
      const c = fresh();
      const a = install([c]);
      const b = install([c]);
      const received = live(b.bus, c);
      const value = { user: { name: 'ada' }, at: new Point() };

      a.bus.emit(c, value);
      await vi.waitFor(() => expect(received).toHaveLength(1));

      const copy = received[0] as typeof value;
      expect(copy).toEqual({ user: { name: 'ada' }, at: { x: 1 } });
      expect(copy).not.toBe(value);
      expect(copy.user).not.toBe(value.user);
      // Structured clone keeps the data but drops the prototype.
      expect(Object.getPrototypeOf(copy.at)).toBe(Object.prototype);
      expect(b.bus.peek(c)).toBe(copy);
      expect(replayed(b.bus, c)).toEqual([copy]);
    });

    it('delivers retain: false live and clears what the other tab had retained', async () => {
      const [c, f] = [fresh(), fresh()];
      const a = install([c, f]);
      const b = install([c, f]);
      b.bus.emit(c, 'old');
      await fenceVia(b.bus, a.bus, f);
      const received = live(b.bus, c);

      a.bus.emit(c, 'toast', { retain: false });
      await vi.waitFor(() => expect(received).toEqual(['toast']));

      expect(b.bus.peek(c)).toBeUndefined();
      expect(replayed(b.bus, c)).toEqual([]);
      expect(a.port?.posts.at(-1)).toEqual({ channel: c, value: 'toast', retain: false });
    });

    // peek can't tell a retained undefined from none, so it always travels unretained,
    // even though the sending tab itself replays it (createBus retains undefined by default).
    it.each([
      ['emit(c, undefined, { retain: false })', { retain: false }],
      ['emit(c, undefined)', undefined],
    ])('sends %s unretained', async (_, options) => {
      const [c, f] = [fresh(), fresh()];
      const a = install([c, f]);
      const b = install([c, f]);
      b.bus.emit(c, 'old');
      await fenceVia(b.bus, a.bus, f);
      const received = live(b.bus, c);

      a.bus.emit(c, undefined, options);
      await vi.waitFor(() => expect(received).toHaveLength(1));

      expect(received).toEqual([undefined]);
      expect(a.port?.posts.at(-1)).toEqual({ channel: c, value: undefined, retain: false });
      expect(b.bus.peek(c)).toBeUndefined();
      expect(replayed(b.bus, c)).toEqual([]);
    });

    it('keeps a burst of emits from one tab in order', async () => {
      const c = fresh();
      const a = install([c]);
      const b = install([c]);
      const received = live(b.bus, c);
      const burst = Array.from({ length: 50 }, (_, i) => i);

      burst.forEach(value => a.bus.emit(c, value));

      await vi.waitFor(() => expect(received).toEqual(burst));
      expect(b.bus.peek(c)).toBe(49);
    });

    it('reports a value that cannot be cloned and leaves the other tab’s state alone', async () => {
      const report = stubReportError();
      const [c, f] = [fresh(), fresh()];
      const a = install([c, f]);
      const b = install([c, f]);
      a.bus.emit(c, 'old');
      await vi.waitFor(() => expect(b.bus.peek(c)).toBe('old'));
      const local = live(a.bus, c);
      const fn = (): void => {};

      expect(() => a.bus.emit(c, fn)).not.toThrow();
      await fenceVia(a.bus, b.bus, f);

      expect(local).toHaveLength(1);
      expect(local[0]).toBe(fn);
      expect(report).toHaveBeenCalledTimes(1);
      expect(report.mock.calls[0]![0]).toMatchObject({ name: 'DataCloneError' });
      expect(
        a.port?.posts.filter(post => (post as { channel: string }).channel === c)
      ).toHaveLength(1);
      expect(b.bus.peek(c)).toBe('old');
    });
  });

  describe('no echo', () => {
    it('posts once per local emit and applies a message without posting it back', async () => {
      const [c, f] = [fresh(), fresh()];
      const a = install([c, f]);
      const b = install([c, f]);
      const inA = live(a.bus, c);
      const inB = live(b.bus, c);

      a.bus.emit(c, 1);

      expect(a.port?.posts).toEqual([{ channel: c, value: 1, retain: true }]);
      await vi.waitFor(() => expect(inB).toEqual([1]));
      expect(b.port?.posts).toEqual([]);

      await fenceVia(a.bus, b.bus, f);
      expect(inA).toEqual([1]);
      expect(inB).toEqual([1]);
      expect(b.port?.posts).toEqual([]);
    });

    it('forwards a value a listener re-emits on the same channel while a message is applied', async () => {
      const c = fresh();
      const a = install([c]);
      const b = install([c]);
      b.bus.on(c, value => value === 1 && b.bus.emit(c, 2), { replay: false });
      const inA = live(a.bus, c);

      a.bus.emit(c, 1);
      await vi.waitFor(() => expect(inA).toEqual([1, 2]));

      expect(b.port?.posts).toEqual([{ channel: c, value: 2, retain: true }]);
    });

    // Documented in docs/cross-tab.md ("sync source channels, not derived ones").
    it('delivers a channel derived from another synced channel twice per tab, then settles', async () => {
      const [c, d] = [fresh(), fresh()];
      const derive = (bus: Bus): unknown[] => {
        bus.on(c, value => bus.emit(d, (value as number) * 2));
        return live(bus, d);
      };
      const busA = createBus();
      const busB = createBus();
      const inA = derive(busA);
      const inB = derive(busB);
      install([c, d], busA);
      install([c, d], busB);

      busA.emit(c, 1);
      await vi.waitFor(() => {
        expect(inA).toEqual([2, 2]);
        expect(inB).toEqual([2, 2]);
      });

      // A posts c and its own d; B posts the d it derived from the applied c. Both tabs have
      // received all three, and applying any of them posted nothing, so nothing is in flight.
      expect(allPosts()).toHaveLength(3);
      expect([busA.peek(d), busB.peek(d)]).toEqual([2, 2]);
    });
  });

  describe('what crosses', () => {
    it('never posts a channel that is not listed', () => {
      const [c, other] = [fresh(), fresh()];
      const a = install([c]);

      a.bus.emit(other, 1);

      expect(a.port?.posts).toEqual([]);
    });

    it.each([
      [
        'a channel this install does not own',
        (other: string) => ({ channel: other, value: 1, retain: true }),
      ],
      ['null', () => null],
      ['a primitive', () => 42],
      ['a string', () => 'cart:count'],
      ['an empty object', () => ({})],
    ])('silently ignores a message that is %s', async (_, message) => {
      const report = stubReportError();
      const [c, other] = [fresh(), fresh()];
      const b = install([c]);
      const unowned = live(b.bus, other);
      const wire = probe();

      wire.postMessage(message(other));
      await fenceFrom(wire, b.bus, c);

      expect(unowned).toEqual([]);
      expect(b.bus.peek(other)).toBeUndefined();
      expect(report).not.toHaveBeenCalled();
      expect(b.port?.posts).toEqual([]);
    });

    it('posts nothing on install, even with values already retained', () => {
      const c = fresh();
      const busA = createBus();
      const busB = createBus();
      busA.emit(c, 'before');
      busB.emit(c, 'own');

      install([c], busA);
      install([c], busB);

      expect(opened).toHaveLength(2);
      expect(allPosts()).toEqual([]);
      expect(busB.peek(c)).toBe('own');
    });

    it('opens no port for an empty list', () => {
      const tab = install([]);

      expect(tab.port).toBeUndefined();
      expect(opened).toEqual([]);
    });

    it('counts a duplicated name once', () => {
      const c = fresh();
      const a = install([c, c]);

      a.bus.emit(c, 1);

      expect(opened).toHaveLength(1);
      expect(a.port?.posts).toEqual([{ channel: c, value: 1, retain: true }]);
    });
  });

  describe('stop', () => {
    it('stops sending and receiving and closes the port once', async () => {
      const c = fresh();
      const a = install([c]);
      const b = install([c]);
      const wire = probe();
      const onWire: unknown[] = [];
      wire.onmessage = ({ data }: MessageEvent) => onWire.push(data);

      a.stop();
      a.bus.emit(c, 1);
      b.bus.emit(c, 2);
      await vi.waitFor(() => expect(onWire).toHaveLength(1));

      expect(a.port?.posts).toEqual([]);
      expect(a.port?.closes).toBe(1);
      expect(onWire).toEqual([{ channel: c, value: 2, retain: true }]);
      expect(a.bus.peek(c)).toBe(1);
    });

    // stop() closes the already closed port again, which BroadcastChannel ignores; what matters is
    // that a later install's claim stays.
    it('does nothing the second time, and does not release a later install’s claim', () => {
      const c = fresh();
      const first = install([c]);
      first.stop();
      const second = install([c], first.bus);

      expect(first.port?.closes).toBe(1);
      expect(first.stop).not.toThrow();
      const third = install([c], first.bus);

      expect(second.port).toBeDefined();
      expect(third.port).toBeUndefined();
    });

    // createBus skips a listener that unsubscribed earlier in the same fan-out.
    it('can be called from a listener during fan-out', () => {
      const report = stubReportError();
      const c = fresh();
      const bus = createBus();
      let stop = (): void => {};
      bus.on(c, () => stop());
      const tab = install([c], bus);
      stop = tab.stop;

      bus.emit(c, 1);
      expect(tab.port?.closes).toBe(1);
      bus.emit(c, 2);

      expect(report).not.toHaveBeenCalled();
      expect(tab.port?.posts).toEqual([]);
    });
  });

  describe('installs on one bus', () => {
    // The loop and duplicate regression. Two ports in one tab would each forward
    // what the other applied, since BroadcastChannel only skips the sending object.
    it('lets a second install claim only the free channels', async () => {
      const [c1, c2, c3, f] = [fresh(), fresh(), fresh(), fresh()];
      const first = install([c1, c2, f]);
      const second = install([c2, c3], first.bus);
      const third = install([c1, c3], first.bus);
      const b = install([c1, c2, c3, f]);
      const inA = live(first.bus, c2);
      const inB = live(b.bus, c2);

      first.bus.emit(c2, 'from a');
      first.bus.emit(c3, 'only the second');

      expect(third.port).toBeUndefined();
      expect(opened).toHaveLength(3);
      expect(first.port?.posts).toEqual([{ channel: c2, value: 'from a', retain: true }]);
      expect(second.port?.posts).toEqual([{ channel: c3, value: 'only the second', retain: true }]);

      await fenceVia(first.bus, b.bus, f);
      expect(inB).toEqual(['from a']);

      b.bus.emit(c2, 'from b');
      await fenceVia(b.bus, first.bus, f);
      expect(inA).toEqual(['from a', 'from b']);
      expect(first.port?.posts).toHaveLength(2);
      expect(second.port?.posts).toHaveLength(1);
    });

    // Docs say "install once, in the host".
    it('hands a stopped owner’s channels to a new install, not to an existing one', () => {
      const [c, d] = [fresh(), fresh()];
      const owner = install([c]);
      const existing = install([c, d], owner.bus);

      owner.stop();
      owner.bus.emit(c, 1);

      expect(allPosts()).toEqual([]);

      const next = install([c], owner.bus);
      owner.bus.emit(c, 2);

      expect(existing.port?.posts).toEqual([]);
      expect(next.port?.posts).toEqual([{ channel: c, value: 2, retain: true }]);
    });
  });

  describe('unsupported environments', () => {
    it('is a no-op without BroadcastChannel, and the local bus still works', () => {
      vi.stubGlobal('BroadcastChannel', undefined);
      const c = fresh();
      const bus = createBus();
      const local = live(bus, c);

      const stop = shareAcrossTabs([c], { bus });
      bus.emit(c, 1);

      expect(stop).not.toThrow();
      expect(opened).toEqual([]);
      expect(local).toEqual([1]);
      expect(bus.peek(c)).toBe(1);
    });

    it.each([
      ['with BroadcastChannel', RecordingChannel],
      ['without BroadcastChannel', undefined],
    ])('throws a TypeError for a channel that is not a string %s', (_, implementation) => {
      vi.stubGlobal('BroadcastChannel', implementation);

      expect(() => shareAcrossTabs([42 as unknown as string], { bus: createBus() })).toThrow(
        TypeError
      );
      expect(opened).toEqual([]);
    });

    describe('without an explicit bus', () => {
      beforeEach(() => {
        delete globalThis.__NF_BUS__;
      });

      afterAll(() => {
        delete globalThis.__NF_BUS__;
      });

      // This project runs in node, so there is no page and no tab to share with.
      it('is a no-op outside a page', () => {
        const stop = shareAcrossTabs([fresh()]);

        expect(stop).not.toThrow();
        expect(opened).toEqual([]);
        expect(globalThis.__NF_BUS__).toBeUndefined();
      });

      // On a page it bridges the real __NF_BUS__.
      it('bridges the page bus when window is the global', () => {
        vi.stubGlobal('window', globalThis);
        const c = fresh();

        track(shareAcrossTabs([c]));
        globalThis.__NF_BUS__?.emit(c, 1);

        expect(opened).toHaveLength(1);
        expect(opened[0]?.posts).toEqual([{ channel: c, value: 1, retain: true }]);
      });
    });
  });
});
