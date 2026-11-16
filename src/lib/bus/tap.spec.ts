import { stubReportError } from '../../../test/helpers.js';
import type { Bus, Tap, TapObserver } from '../domain/bus/bus.contract.js';
import { createBus } from './create-bus.js';

type Seen = [channel: string, value: unknown, retain: boolean];

// tap is optional on Bus (an older copy may serve the page), but createBus() always has it.
function openTap(bus: Bus, name: string, observer: TapObserver = () => {}): Tap {
  const tap = bus.tap!(name, observer);
  expect(tap, `tap "${name}" was refused`).toBeDefined();
  return tap!;
}

// Opens a tap that records every (channel, value, retain) it observes.
function record(bus: Bus, name: string): { seen: Seen[]; tap: Tap } {
  const seen: Seen[] = [];
  const tap = openTap(bus, name, ({ channel, value, retain }) =>
    seen.push([channel, value, retain])
  );
  return { seen, tap };
}

describe('bus.tap', () => {
  let bus: Bus;

  beforeEach(() => {
    bus = createBus();
  });

  describe('arguments', () => {
    it.each([undefined, 1, null, {}, Symbol('a')])('rejects %s as a name', name => {
      expect(() => bus.tap!(name as never, () => {})).toThrow(TypeError);
      expect(() => bus.tap!(name as never, () => {})).toThrow(/A tap name must be a string/);
    });

    it.each([undefined, 'fn', {}, null])('rejects %s as an observer', observer => {
      expect(() => bus.tap!('t', observer as never)).toThrow(TypeError);
      expect(() => bus.tap!('t', observer as never)).toThrow(/must be a function/);
    });

    it('refuses a second live tap with the same name, silently', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const first = record(bus, 't');
      const second = vi.fn();

      expect(bus.tap!('t', second)).toBeUndefined();
      bus.emit('a', 1);

      expect(first.seen).toEqual([['a', 1, true]]);
      expect(second).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });

    // Each observer gets its own envelope, so one tap cannot change what the next sees.
    it('gives every observer its own envelope', () => {
      openTap(bus, 'meddler', envelope => {
        envelope.channel = 'b';
        envelope.value = 2;
        envelope.retain = false;
      });
      const after = record(bus, 'after');

      bus.emit('a', 1);

      expect(after.seen).toEqual([['a', 1, true]]);
    });

    it('accepts any other name next to a live tap, the empty string included', () => {
      openTap(bus, 't');

      expect(bus.tap!('u', () => {})).toBeDefined();
      expect(bus.tap!('', () => {})).toBeDefined();
    });

    it('keeps names per bus', () => {
      openTap(bus, 't');

      expect(createBus().tap!('t', () => {})).toBeDefined();
    });
  });

  describe('observing emits', () => {
    it('passes every emit on any channel with its value and effective retain', () => {
      const { seen } = record(bus, 't');
      const value = { id: 1 };

      bus.emit('a', value);
      bus.emit('b', 2, { retain: false });
      bus.emit('c', 3, { retain: true });
      bus.emit('d', undefined);
      // retain goes through the same Boolean() as emit itself: 0 is off, 'yes' is on.
      bus.emit('e', 5, { retain: 0 as never });
      bus.emit('f', 6, { retain: 'yes' as never });
      bus.emit('g', 7, { retain: undefined });

      expect(seen).toEqual([
        ['a', value, true],
        ['b', 2, false],
        ['c', 3, true],
        ['d', undefined, true],
        ['e', 5, false],
        ['f', 6, true],
        ['g', 7, true],
      ]);
      expect(seen[0]![1]).toBe(value);
    });

    it('passes a fresh envelope, not the caller’s options', () => {
      const observer = vi.fn();
      openTap(bus, 't', observer);
      const options = { retain: true, extra: 1 } as never;

      bus.emit('a', 1, options);

      expect(observer.mock.calls[0]![0]).toStrictEqual({ channel: 'a', value: 1, retain: true });
    });

    it('calls every live tap', () => {
      const one = record(bus, 'one');
      const two = record(bus, 'two');

      bus.emit('a', 1);

      expect(one.seen).toEqual([['a', 1, true]]);
      expect(two.seen).toEqual([['a', 1, true]]);
    });

    it('sees nothing emitted before it opened', () => {
      bus.emit('a', 1);
      const { seen } = record(bus, 't');

      expect(seen).toEqual([]);
    });

    it('runs observers after the emit’s listeners, in the same task', () => {
      const log: string[] = [];
      bus.on('a', () => log.push('listener 1'));
      openTap(bus, 't', () => log.push('tap'));
      bus.on('a', () => log.push('listener 2'));

      bus.emit('a', 1);

      expect(log).toEqual(['listener 1', 'listener 2', 'tap']);
    });

    // Listener delivery is breadth-first: an emit made by a listener is queued behind the current
    // one. Taps must see emits in that same order, or a transport would reorder them.
    it('sees re-entrant emits in exactly listener-delivery order', () => {
      const log: string[] = [];
      bus.on('a', value => {
        log.push(`listener a:${value}`);
        bus.emit('b', 'from a');
        bus.emit('c', 'from a');
      });
      bus.on('a', value => log.push(`listener2 a:${value}`));
      bus.on('b', value => {
        log.push(`listener b:${value}`);
        bus.emit('c', 'from b');
      });
      bus.on('c', value => log.push(`listener c:${value}`));
      openTap(bus, 't', ({ channel, value }) => log.push(`tap ${channel}:${value}`));

      bus.emit('a', 1);

      expect(log).toEqual([
        'listener a:1',
        'listener2 a:1',
        'tap a:1',
        'listener b:from a',
        'tap b:from a',
        'listener c:from a',
        'tap c:from a',
        'listener c:from b',
        'tap c:from b',
      ]);
    });

    it('sees an emit made by an observer after the one it is observing', () => {
      const log: string[] = [];
      bus.on('b', value => log.push(`listener b:${value}`));
      openTap(bus, 'echo', ({ channel, value }) => {
        log.push(`echo ${channel}:${value}`);
        if (channel === 'a') bus.emit('b', 'from echo');
      });
      openTap(bus, 'other', ({ channel, value }) => log.push(`other ${channel}:${value}`));

      bus.emit('a', 1);

      expect(log).toEqual([
        'echo a:1',
        'other a:1',
        'listener b:from echo',
        'echo b:from echo',
        'other b:from echo',
      ]);
    });

    it('skips a tap closed by a listener of the emit being delivered', () => {
      const { seen, tap } = record(bus, 't');
      bus.on('a', () => tap.close());

      bus.emit('a', 1);

      expect(seen).toEqual([]);
    });

    it('skips a tap closed after a queued emit but before its task runs', () => {
      const { seen, tap } = record(bus, 't');
      bus.on('a', () => {
        bus.emit('b', 2);
        tap.close();
      });

      bus.emit('a', 1);

      expect(seen).toEqual([]);
    });

    it('reads the taps live, so a tap opened by a listener sees the emit being delivered', () => {
      const seen: Seen[] = [];
      bus.on('a', () => {
        openTap(bus, 'late', ({ channel, value, retain }) => seen.push([channel, value, retain]));
      });

      bus.emit('a', 1);

      expect(seen).toEqual([['a', 1, true]]);
    });

    it('still delivers to listeners when a tap is open', () => {
      openTap(bus, 't');
      const received: unknown[] = [];
      bus.on('a', value => received.push(value));

      bus.emit('a', 1);

      expect(received).toEqual([1]);
      expect(bus.peek('a')).toBe(1);
    });
  });

  describe('a throwing observer', () => {
    it('is reported, and other taps and listeners still run', () => {
      const reportError = stubReportError();
      const error = new Error('boom');
      const log: string[] = [];
      bus.on('a', () => log.push('listener'));
      openTap(bus, 'bad', () => {
        throw error;
      });
      openTap(bus, 'good', () => log.push('good'));

      bus.emit('a', 1);
      bus.emit('a', 2);

      expect(reportError.mock.calls).toEqual([[error], [error]]);
      expect(log).toEqual(['listener', 'good', 'listener', 'good']);
    });

    it('falls back to console.error without reportError', () => {
      const consoleError = stubReportError(false);
      const error = new Error('boom');
      openTap(bus, 'bad', () => {
        throw error;
      });

      bus.emit('a', 1);

      expect(consoleError).toHaveBeenCalledWith(error);
    });
  });

  describe('handle.emit', () => {
    it('delivers to listeners and retains like bus.emit', () => {
      const tap = openTap(bus, 't');
      const received: unknown[] = [];
      bus.on('a', value => received.push(value));
      const value = { id: 1 };

      tap.emit('a', value);

      expect(received).toEqual([value]);
      expect(received[0]).toBe(value);
      expect(bus.peek('a')).toBe(value);
    });

    it('honours retain: false, clearing the retained value', () => {
      const tap = openTap(bus, 't');
      bus.emit('a', 'stale');
      const received: unknown[] = [];
      bus.on('a', value => received.push(value), { replay: false });

      tap.emit('a', 'command', { retain: false });

      expect(received).toEqual(['command']);
      expect(bus.peek('a')).toBeUndefined();
    });

    it.each([1, undefined, null, {}])('rejects %s as a channel', channel => {
      const tap = openTap(bus, 't');

      expect(() => tap.emit(channel as never, 1)).toThrow(/A channel must be a string/);
    });

    it('is not seen by its own tap, but is seen by every other tap', () => {
      const own = record(bus, 'own');
      const other = record(bus, 'other');

      own.tap.emit('a', 1);
      own.tap.emit('b', 2, { retain: false });

      expect(own.seen).toEqual([]);
      expect(other.seen).toEqual([
        ['a', 1, true],
        ['b', 2, false],
      ]);
    });

    it('lets every tap, its own included, see emits that listeners make in response', () => {
      const own = record(bus, 'own');
      const other = record(bus, 'other');
      bus.on('a', value => bus.emit('b', `re:${value}`));

      own.tap.emit('a', 1);

      expect(own.seen).toEqual([['b', 're:1', true]]);
      expect(other.seen).toEqual([
        ['a', 1, true],
        ['b', 're:1', true],
      ]);
    });

    it('keeps the order of a re-entrant handle.emit made from a listener', () => {
      const log: string[] = [];
      const tap = openTap(bus, 't', ({ channel, value }) => log.push(`t ${channel}:${value}`));
      openTap(bus, 'u', ({ channel, value }) => log.push(`u ${channel}:${value}`));
      bus.on('a', () => {
        log.push('listener a');
        tap.emit('b', 'via t');
        bus.emit('c', 'via bus');
      });
      bus.on('b', () => log.push('listener b'));

      bus.emit('a', 1);

      expect(log).toEqual([
        'listener a',
        't a:1',
        'u a:1',
        'listener b',
        'u b:via t',
        't c:via bus',
        'u c:via bus',
      ]);
    });
  });

  describe('handle.replay', () => {
    it('passes every retained value to this tap only, in channel insertion order', () => {
      bus.emit('a', 1);
      bus.emit('b', 2);
      bus.emit('a', 'updated');
      bus.emit('c', undefined);
      const replaying = record(bus, 'replaying');
      const other = record(bus, 'other');

      replaying.tap.replay();

      expect(replaying.seen).toEqual([
        ['a', 'updated', true],
        ['b', 2, true],
        ['c', undefined, true],
      ]);
      expect(other.seen).toEqual([]);
    });

    it('skips channels with no retained value', () => {
      bus.emit('cleared', 1);
      bus.emit('cleared', 2, { retain: false });
      bus.emit('command', 3, { retain: false });
      bus.on('listened', () => {});
      const { seen, tap } = record(bus, 't');

      tap.replay();

      expect(seen).toEqual([]);
    });

    it('passes the exact retained reference', () => {
      const value = { id: 1 };
      bus.emit('a', value);
      const observer = vi.fn();
      const tap = openTap(bus, 't', observer);

      tap.replay();

      expect(observer).toHaveBeenCalledWith({ channel: 'a', value, retain: true });
      expect(observer.mock.calls[0]![0].value).toBe(value);
    });

    it('does not deliver to listeners or change what is retained', () => {
      bus.emit('a', 1);
      const listener = vi.fn();
      bus.on('a', listener, { replay: false });
      const tap = openTap(bus, 't');

      tap.replay();

      expect(listener).not.toHaveBeenCalled();
      expect(bus.peek('a')).toBe(1);
    });

    it('can replay again', () => {
      bus.emit('a', 1);
      const { seen, tap } = record(bus, 't');

      tap.replay();
      tap.replay();

      expect(seen).toEqual([
        ['a', 1, true],
        ['a', 1, true],
      ]);
    });

    // Like on()'s replay, it goes through the queue: what the observer emits meanwhile waits until
    // the replay is done.
    it('holds emits the observer makes until the replay has finished', () => {
      bus.emit('a', 1);
      bus.emit('b', 2);
      const log: string[] = [];
      bus.on('c', value => log.push(`listener c:${value}`), { replay: false });
      const tap = openTap(bus, 't', ({ channel, value }) => {
        log.push(`tap ${channel}:${value}`);
        if (channel === 'a') bus.emit('c', 'from replay');
      });

      tap.replay();

      expect(log).toEqual(['tap a:1', 'tap b:2', 'listener c:from replay', 'tap c:from replay']);
    });

    it('reports a throwing observer and continues with the next channel', () => {
      const reportError = stubReportError();
      const error = new Error('boom');
      bus.emit('a', 1);
      bus.emit('b', 2);
      const seen: string[] = [];
      const tap = openTap(bus, 't', ({ channel }) => {
        seen.push(channel);
        if (channel === 'a') throw error;
      });

      tap.replay();

      expect(reportError).toHaveBeenCalledWith(error);
      expect(seen).toEqual(['a', 'b']);
    });
  });

  describe('handle.close', () => {
    it('stops the observer', () => {
      const { seen, tap } = record(bus, 't');

      tap.close();
      bus.emit('a', 1);

      expect(seen).toEqual([]);
    });

    it('is idempotent', () => {
      const { tap } = record(bus, 't');

      tap.close();

      expect(() => tap.close()).not.toThrow();
    });

    it('frees the name for a new tap, which a second close of the old one does not remove', () => {
      const old = record(bus, 't');
      old.tap.close();
      const next = record(bus, 't');

      old.tap.close();
      bus.emit('a', 1);

      expect(next.seen).toEqual([['a', 1, true]]);
      expect(old.seen).toEqual([]);
      expect(bus.tap!('t', () => {})).toBeUndefined();
    });

    it('turns emit and replay into no-ops', () => {
      bus.emit('a', 'retained');
      const listener = vi.fn();
      bus.on('a', listener, { replay: false });
      const other = record(bus, 'other');
      const { seen, tap } = record(bus, 't');

      tap.close();
      tap.emit('a', 'after close');
      tap.replay();

      expect(listener).not.toHaveBeenCalled();
      expect(bus.peek('a')).toBe('retained');
      expect(other.seen).toEqual([]);
      expect(seen).toEqual([]);
    });

    it('leaves other taps open', () => {
      const closed = record(bus, 'closed');
      const open = record(bus, 'open');

      closed.tap.close();
      bus.emit('a', 1);

      expect(open.seen).toEqual([['a', 1, true]]);
    });
  });
});
