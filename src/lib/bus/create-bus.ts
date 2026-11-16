import type {
  Bus,
  Listener,
  OnOptions,
  EmitOptions,
  Unsubscribe,
} from '../domain/bus/bus.contract.js';
import { assertChannel, assertListener, noop } from './arguments.js';
import { safely } from './safely.js';
import { createTap, notifyTaps, type TapEntry, type Taps } from './tap.js';

declare const __NF_COMMUNICATION_VERSION__: string;
export const VERSION = __NF_COMMUNICATION_VERSION__;

type Sub = { fn: Listener<unknown>; signal?: AbortSignal };
type Subs = Map<string, Set<Sub>>;
type Task = () => void;

// undefined means the default (on); anything else goes through Boolean(), so `{ replay: 0 }` is off.
const enabled = (option: unknown): boolean => option === undefined || Boolean(option);

function deliver(sub: Sub, value: unknown): void {
  safely(() => sub.fn(value));
}

// `subs` is the snapshot taken at emit time; `live` drops whoever unsubscribed since.
function fanOut(subs: Sub[], live: Set<Sub>, value: unknown): void {
  subs.forEach(sub => {
    if (live.has(sub)) deliver(sub, value);
  });
}

// hold() runs a step now; anything enqueued meanwhile is delivered after it, by the outermost call.
function createQueue() {
  const tasks: Task[] = [];
  let draining = false;

  const hold = (step: Task): void => {
    if (draining) return step();
    draining = true;
    try {
      step();
      for (const task of tasks) task();
    } finally {
      tasks.length = 0;
      draining = false;
    }
  };

  return { hold, enqueue: (task: Task) => hold(() => tasks.push(task)) };
}

function subscribe(subs: Subs, name: string, sub: Sub): Unsubscribe {
  const set = subs.get(name) ?? new Set<Sub>();
  const off = (): void => {
    sub.signal?.removeEventListener('abort', off);
    // delete() is false the second time, so a stale off never drops a newer set.
    if (set.delete(sub) && set.size === 0) subs.delete(name);
  };
  // Before subscribing: a signal that is not an AbortSignal throws here and leaves no listener behind.
  sub.signal?.addEventListener('abort', off, { once: true });
  subs.set(name, set.add(sub));
  return off;
}

type Core = {
  retained: Map<string, unknown>;
  subs: Subs;
  taps: Taps;
  enqueue: (task: Task) => void;
};

// Taps observe after the listeners, in the same task, so they see emits in delivery order.
function emitter({ retained, subs, taps, enqueue }: Core) {
  return (source?: TapEntry) =>
    (name: string, value: unknown, options?: EmitOptions): void => {
      assertChannel(name);
      const retain = enabled(options?.retain);
      if (retain) retained.set(name, value);
      else retained.delete(name);
      const live = subs.get(name) ?? new Set<Sub>();
      const snapshot = [...live];
      enqueue(() => {
        fanOut(snapshot, live, value);
        notifyTaps(taps, source, { channel: name, value, retain });
      });
    };
}

export function createBus(): Bus {
  const retained = new Map<string, unknown>();
  const subs: Subs = new Map();
  const taps: Taps = new Map();
  const { hold, enqueue } = createQueue();
  const emitFrom = emitter({ retained, subs, taps, enqueue });
  const emit = emitFrom();
  const tap = createTap({ taps, emitFrom, retained: () => [...retained], hold });

  const replayRetained = (name: string, sub: Sub): void => {
    if (retained.has(name)) hold(() => deliver(sub, retained.get(name)));
  };

  const on = (name: string, fn: Listener<unknown>, options?: OnOptions): Unsubscribe => {
    assertChannel(name);
    assertListener(fn);
    const { signal, replay } = options ?? {};
    if (signal?.aborted) return noop;
    const sub = { fn, signal };
    const off = subscribe(subs, name, sub);
    if (enabled(replay)) replayRetained(name, sub);
    return off;
  };

  const peek = (name: string): unknown => {
    assertChannel(name);
    return retained.get(name);
  };

  // The untyped implementation can't satisfy Bus's generic signatures; it is checked against the global shape.
  const instance = {
    protocol: 1,
    version: VERSION,
    emit,
    on,
    peek,
    tap,
  } satisfies NativeFederationBus;
  return Object.freeze(instance) as Bus;
}
