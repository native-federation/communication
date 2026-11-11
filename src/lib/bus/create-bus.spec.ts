import { version } from '../../../package.json';
import { collect, stubReportError, type Collected } from '../../../test/helpers.js';
import type { Bus, ChannelValue } from '../domain/bus/bus.contract.js';
import { createBus } from './create-bus.js';

// The one augmentation in the suite; `test:` names keep it from colliding with real channels.
declare module '../domain/bus/bus.contract.js' {
  interface Channels {
    'test:count': number;
    'test:user': { name: string };
  }
}

describe('createBus', () => {
  let bus: Bus;

  beforeEach(() => {
    bus = createBus();
  });

  describe('publish and subscribe', () => {
    it('delivers the producer’s exact reference', () => {
      const value = { id: 1 };
      const listener = vi.fn();
      bus.on('a', listener);

      bus.emit('a', value);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]![0]).toBe(value);
    });

    it('fans out to all listeners in subscription order', () => {
      const calls: string[] = [];
      bus.on('a', () => calls.push('first'));
      bus.on('a', () => calls.push('second'));
      bus.on('a', () => calls.push('third'));

      bus.emit('a', 1);

      expect(calls).toEqual(['first', 'second', 'third']);
    });

    it('treats the same function subscribed twice as two subscriptions', () => {
      const listener = vi.fn();
      const offFirst = bus.on('a', listener);
      bus.on('a', listener);

      bus.emit('a', 1);
      offFirst();
      bus.emit('a', 2);

      expect(listener.mock.calls).toEqual([[1], [1], [2]]);
    });

    it.each(['__proto__', 'constructor', '', 'hasOwnProperty'])(
      'keeps channel %j isolated like any other name',
      name => {
        const own = collect(bus, name);
        const other = collect(bus, 'other');

        bus.emit(name, 'value');

        expect(own.values).toEqual(['value']);
        expect(other.values).toEqual([]);
        expect(bus.peek(name)).toBe('value');
        expect(bus.peek('other')).toBeUndefined();
      }
    );

    it('emits to a channel without listeners without throwing', () => {
      expect(() => bus.emit('nobody', 1)).not.toThrow();
    });

    it('keeps two buses isolated', () => {
      const other = createBus();
      bus.emit('a', 1);

      expect(collect(other, 'a').values).toEqual([]);
      expect(other.peek('a')).toBeUndefined();
    });
  });

  describe('retained values', () => {
    it('replays the retained value synchronously, before on returns, then live values', () => {
      bus.emit('a', 1);
      bus.emit('a', 2);

      const received = collect(bus, 'a');
      expect(received.values).toEqual([2]);

      bus.emit('a', 3);
      expect(received.values).toEqual([2, 3]);
    });

    it('replays a value emitted before subscribing, then the next one, once each', () => {
      bus.emit('a', 1);
      const received = collect(bus, 'a');
      bus.emit('a', 2);

      expect(received.values).toEqual([1, 2]);
    });

    it('fires once for a channel emitted once, whether on comes before or after the emit', () => {
      const before = collect(bus, 'a');
      bus.emit('a', 'ready');
      const after = collect(bus, 'a');

      expect(before.values).toEqual(['ready']);
      expect(after.values).toEqual(['ready']);
    });

    it('returns the retained value from peek, and undefined for an untouched channel', () => {
      expect(bus.peek('a')).toBeUndefined();
      bus.emit('a', 1);
      bus.emit('a', 2);
      expect(bus.peek('a')).toBe(2);
    });

    it('retains undefined as a real value', () => {
      bus.emit('a', undefined);

      const listener = vi.fn();
      bus.on('a', listener);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(undefined);
    });

    it('delivers and replays functions and objects holding functions intact', () => {
      const fn = () => 'loaded';
      const loaders = { loadRemoteModule: fn };
      const live = collect(bus, 'fn');
      const liveObject = collect(bus, 'loaders');

      bus.emit('fn', fn);
      bus.emit('loaders', loaders);

      expect(live.values[0]).toBe(fn);
      expect(collect(bus, 'fn').values[0]).toBe(fn);
      expect(liveObject.values[0]).toBe(loaders);
      expect((collect(bus, 'loaders').values[0] as typeof loaders).loadRemoteModule).toBe(fn);
    });

    it('gives live, replayed and peeked values as the same reference', () => {
      const value = { nested: { deep: true } };
      const live = collect(bus, 'a');
      bus.emit('a', value);
      const replayed = collect(bus, 'a');

      expect(live.values[0]).toBe(value);
      expect(replayed.values[0]).toBe(value);
      expect(bus.peek('a')).toBe(value);
    });

    it('never clones, so BigInts, cycles and class instances do not throw', () => {
      class Session {
        constructor(readonly user: string) {}
      }
      const cycle: { self?: unknown } = {};
      cycle.self = cycle;
      const values = [10n, cycle, new Session('ada')];

      values.forEach((value, i) => {
        expect(() => bus.emit(`v${i}`, value)).not.toThrow();
        expect(collect(bus, `v${i}`).values[0]).toBe(value);
      });
    });
  });

  describe('retain: false', () => {
    it('clears the retained value, so a late on gets nothing and peek is undefined', () => {
      bus.emit('a', 1);
      bus.emit('a', 2, { retain: false });

      expect(collect(bus, 'a').values).toEqual([]);
      expect(bus.peek('a')).toBeUndefined();
    });

    it('lets a later retained emit be replayed again', () => {
      bus.emit('a', 1, { retain: false });
      bus.emit('a', 2);

      expect(collect(bus, 'a').values).toEqual([2]);
    });

    it('still delivers the value to live listeners', () => {
      const received = collect(bus, 'toast');

      bus.emit('toast', 'saved', { retain: false });

      expect(received.values).toEqual(['saved']);
    });

    it('leaves a channel without listeners usable afterwards', () => {
      bus.emit('toast', 'lost', { retain: false });

      const received = collect(bus, 'toast');
      bus.emit('toast', 'seen', { retain: false });

      expect(received.values).toEqual(['seen']);
      expect(bus.peek('toast')).toBeUndefined();
    });
  });

  describe('unsubscribe', () => {
    it('stops delivery on off, and a second off is a no-op', () => {
      const received = collect(bus, 'a');
      bus.emit('a', 1);
      received.off();
      received.off();
      bus.emit('a', 2);

      expect(received.values).toEqual([1]);
    });

    it('never lets a stale off remove a newer subscription', () => {
      const offA = bus.on('a', () => {});
      offA();
      const b = collect(bus, 'a');
      offA();

      bus.emit('a', 1);

      expect(b.values).toEqual([1]);
    });

    it('keeps the retained value after the last listener leaves', () => {
      const received = collect(bus, 'a');
      bus.emit('a', 1);
      received.off();

      expect(collect(bus, 'a').values).toEqual([1]);
    });

    it('skips a listener that a sibling removed during the same fan-out', () => {
      const x = vi.fn();
      let offX: () => void = () => {};
      bus.on('a', () => offX());
      offX = bus.on('a', x);

      bus.emit('a', 1);

      expect(x).not.toHaveBeenCalled();
    });

    it('gives a listener added during a fan-out no queued value that predates it', () => {
      const late: unknown[] = [];
      bus.on('a', value => {
        if (value === 1) {
          bus.emit('a', 2);
          bus.on('a', v => late.push(v));
        }
      });

      bus.emit('a', 1);

      expect(late).toEqual([2]);
    });
  });

  describe('AbortSignal', () => {
    it('stops delivery when the signal aborts', () => {
      const controller = new AbortController();
      const received = collect(bus, 'a', { signal: controller.signal });
      bus.emit('a', 1);
      controller.abort();
      bus.emit('a', 2);

      expect(received.values).toEqual([1]);
    });

    it('neither subscribes nor replays for an already-aborted signal', () => {
      bus.emit('a', 1);
      const listener = vi.fn();

      const off = bus.on('a', listener, { signal: AbortSignal.abort() });
      bus.emit('a', 2);

      expect(listener).not.toHaveBeenCalled();
      expect(() => off()).not.toThrow();
    });

    it('removes its abort handler on off', () => {
      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, 'removeEventListener');

      const off = bus.on('a', () => {}, { signal: controller.signal });
      off();

      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('takes one value when aborting inside the sync replay: no later delivery, no listener left', () => {
      bus.emit('a', 1);
      const controller = new AbortController();
      const listener = vi.fn(() => controller.abort());

      bus.on('a', listener, { signal: controller.signal });
      bus.emit('a', 2);

      expect(listener.mock.calls).toEqual([[1]]);
    });
  });

  describe('replay: false', () => {
    // The subscriber's defence against a producer that forgot retain: false on a command.
    it.each([false, 0, null, ''])(
      'skips the retained value with replay: %j, then gets live ones',
      replay => {
        bus.emit('a', 'stale');

        const received = collect(bus, 'a', { replay: replay as boolean });
        bus.emit('a', 'live');

        expect(received.values).toEqual(['live']);
        expect(bus.peek('a')).toBe('live');
      }
    );

    it.each([undefined, true, 1, 'yes'])('replays with replay: %j', replay => {
      bus.emit('a', 1);

      const received = collect(bus, 'a', { replay: replay as boolean });

      expect(received.values).toEqual([1]);
    });

    it('still unsubscribes through its off and its signal', () => {
      const controller = new AbortController();
      const viaOff = collect(bus, 'a', { replay: false });
      const viaSignal = collect(bus, 'a', { replay: false, signal: controller.signal });
      bus.emit('a', 1);
      viaOff.off();
      controller.abort();
      bus.emit('a', 2);

      expect(viaOff.values).toEqual([1]);
      expect(viaSignal.values).toEqual([1]);
    });
  });

  describe('argument handling', () => {
    const notStrings = [undefined, null, 42, Symbol('a'), { toString: () => 'a' }];

    it.each(notStrings)('throws a TypeError for the channel %s in emit, on and peek', channel => {
      const name = channel as string;

      expect(() => bus.emit(name, 1)).toThrow(TypeError);
      expect(() => bus.on(name, () => {})).toThrow(TypeError);
      expect(() => bus.peek(name)).toThrow(TypeError);
    });

    // A subscribed non-function would fail at the next emit, reported far from the cause.
    it.each([undefined, null, 'fn', {}])(
      'throws a TypeError for the listener %s and subscribes nothing',
      fn => {
        const reported = stubReportError();
        bus.emit('a', 1);

        expect(() => bus.on('a', fn as () => void)).toThrow(TypeError);
        bus.emit('a', 2);

        expect(reported).not.toHaveBeenCalled();
      }
    );

    it('checks the channel before the listener, so swapped arguments name the channel', () => {
      const swapped = () => bus.on((() => {}) as unknown as string, 'a' as unknown as () => void);

      expect(swapped).toThrow(/channel must be a string, got function/);
    });

    it('throws for a listener even when the signal is already aborted', () => {
      expect(() =>
        bus.on('a', undefined as unknown as () => void, { signal: AbortSignal.abort() })
      ).toThrow(TypeError);
    });

    it('throws for a signal that is not an AbortSignal and leaves no listener behind', () => {
      const listener = vi.fn();
      const signal = new AbortController() as unknown as AbortSignal;

      expect(() => bus.on('a', listener, { signal })).toThrow(TypeError);
      bus.emit('a', 1);

      expect(listener).not.toHaveBeenCalled();
    });

    it.each([false, 0, null, ''])('retains nothing with retain: %j', retain => {
      bus.emit('a', 1);
      bus.emit('a', 2, { retain: retain as boolean });

      expect(bus.peek('a')).toBeUndefined();
      expect(collect(bus, 'a').values).toEqual([]);
    });

    it.each([undefined, true, 1])('retains with retain: %j', retain => {
      bus.emit('a', 1, { retain: retain as boolean });

      expect(bus.peek('a')).toBe(1);
    });

    it.each([null, 0, 'x'])('reads %j as options with nothing set', options => {
      bus.emit('a', 1, options as never);

      expect(collect(bus, 'a', options as never).values).toEqual([1]);
    });

    it('has finished the replay when on returns', () => {
      bus.emit('a', 1);
      let replayed = false;

      bus.on('a', () => (replayed = true));

      expect(replayed).toBe(true);
    });
  });

  describe('error isolation', () => {
    it('reports a throwing listener; siblings run and emit does not throw', () => {
      const reported = stubReportError();
      const error = new Error('boom');
      const sibling = vi.fn();
      bus.on('a', () => {
        throw error;
      });
      bus.on('a', sibling);

      expect(() => bus.emit('a', 1)).not.toThrow();
      expect(sibling).toHaveBeenCalledWith(1);
      expect(reported).toHaveBeenCalledWith(error);
    });

    it('falls back to console.error without reportError', () => {
      const logged = stubReportError(false);
      const error = new Error('boom');
      bus.on('a', () => {
        throw error;
      });

      bus.emit('a', 1);

      expect(logged).toHaveBeenCalledWith(error);
    });

    it('survives a listener throwing during replay: on does not throw and later deliveries work', () => {
      const reported = stubReportError();
      bus.emit('a', 1);
      const calls: unknown[] = [];

      expect(() =>
        bus.on('a', value => {
          calls.push(value);
          throw new Error('replay');
        })
      ).not.toThrow();
      const later = collect(bus, 'a');
      bus.emit('a', 2);

      expect(calls).toEqual([1, 2]);
      expect(later.values).toEqual([1, 2]);
      expect(reported).toHaveBeenCalledTimes(2);
    });

    it('keeps delivering after the error reporter itself throws', () => {
      const reporterError = new Error('reporter down');
      vi.stubGlobal(
        'reportError',
        vi.fn(() => {
          throw reporterError;
        })
      );
      const unsubscribe = bus.on('a', () => {
        throw new Error('listener');
      });

      expect(() => bus.emit('a', 1)).toThrow(reporterError);
      unsubscribe();
      const received = collect(bus, 'a');
      bus.emit('a', 2);

      expect(received.values).toEqual([1, 2]);
    });
  });

  describe('re-entrancy and ordering', () => {
    it('delivers v1 before v2 to every listener when a listener emits on the same channel', () => {
      const seen: string[] = [];
      let peeked: unknown;
      bus.on('a', value => {
        seen.push(`first:${value}`);
        if (value === 1) {
          bus.emit('a', 2);
          peeked = bus.peek('a');
        }
      });
      bus.on('a', value => seen.push(`second:${value}`));

      bus.emit('a', 1);

      expect(seen).toEqual(['first:1', 'second:1', 'first:2', 'second:2']);
      expect(peeked).toBe(2);
    });

    it('keeps FIFO order across channels', () => {
      const seen: string[] = [];
      bus.on('a', value => {
        seen.push(`a:${value}`);
        bus.emit('b', value);
      });
      bus.on('a', value => seen.push(`a2:${value}`));
      bus.on('b', value => seen.push(`b:${value}`));

      bus.emit('a', 1);

      expect(seen).toEqual(['a:1', 'a2:1', 'b:1']);
    });

    it('replays the retained value exactly once to an on made inside a listener', () => {
      bus.emit('b', 'state');
      let inner: Collected | undefined;
      bus.on('a', () => {
        inner = collect(bus, 'b');
      });

      bus.emit('a', 1);

      expect(inner?.values).toEqual(['state']);
    });

    it('delivers an emit made inside a replay callback after the replayed value, in the same order for siblings', () => {
      const seen: string[] = [];
      bus.emit('a', 1);
      bus.on('a', value => seen.push(`sibling:${value}`));

      bus.on('a', value => {
        seen.push(`new:${value}`);
        if (value === 1) bus.emit('a', 2);
      });

      expect(seen).toEqual(['sibling:1', 'new:1', 'sibling:2', 'new:2']);
    });

    // Emitting before recording is what tells a queued delivery apart from one nested inside the
    // replay: nested, 'new:2' would land before 'new:1'.
    it('queues an emit made inside a replay callback until the replay returns', () => {
      const seen: string[] = [];
      bus.emit('a', 1);
      bus.on('a', value => seen.push(`sibling:${value}`));

      bus.on('a', value => {
        if (value === 1) bus.emit('a', 2);
        seen.push(`new:${value}`);
      });

      expect(seen).toEqual(['sibling:1', 'new:1', 'sibling:2', 'new:2']);
    });

    it('lets the outer drain deliver an emit made inside a replay inside a listener', () => {
      const seen: string[] = [];
      bus.emit('b', 'b1');
      bus.on('b', value => seen.push(`b-live:${value}`));
      bus.on('a', () => {
        bus.on('b', value => {
          seen.push(`b-new:${value}`);
          if (value === 'b1') bus.emit('b', 'b2');
        });
        seen.push('a-done');
      });
      bus.on('a', () => seen.push('a-sibling'));

      bus.emit('a', 1);

      expect(seen).toEqual([
        'b-live:b1',
        'b-new:b1',
        'a-done',
        'a-sibling',
        'b-live:b2',
        'b-new:b2',
      ]);
    });
  });

  describe('protocol object', () => {
    it('is frozen, reports protocol 1 and the package version', () => {
      expect(Object.isFrozen(bus)).toBe(true);
      expect(bus.protocol).toBe(1);
      expect(bus.version).toBe(version);
    });

    it('works with destructured methods', () => {
      const { emit, on, peek } = bus;
      const values: unknown[] = [];
      on('a', value => values.push(value));

      emit('a', 1);

      expect(values).toEqual([1]);
      expect(peek('a')).toBe(1);
    });
  });

  describe('types', () => {
    it('types declared channels and leaves undeclared ones unknown', () => {
      expectTypeOf<ChannelValue<'test:count'>>().toEqualTypeOf<number>();
      expectTypeOf<ChannelValue<'test:undeclared'>>().toEqualTypeOf<unknown>();
      expectTypeOf(bus.peek('test:user')).toEqualTypeOf<{ name: string } | undefined>();

      bus.on('test:count', value => expectTypeOf(value).toEqualTypeOf<number>());
      bus.emit('test:count', 1);
      bus.emit('test:undeclared', { anything: true });
      // @ts-expect-error a declared channel rejects a value of the wrong type
      bus.emit('test:count', 'one');
      // @ts-expect-error retain is a boolean
      bus.emit('test:count', 1, { retain: 'no' });
      // @ts-expect-error replay is a boolean
      bus.on('test:count', () => {}, { replay: 'no' });
    });
  });
});
