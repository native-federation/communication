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

type Sub = { fn: Listener<unknown> };
type Channel = { has: boolean; value: unknown; subs: Set<Sub>; dropIfEmpty: () => void };
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

function open(channels: Map<string, Channel>, name: string): Channel {
  const existing = channels.get(name);
  if (existing) return existing;

  const channel: Channel = {
    has: false,
    value: undefined,
    subs: new Set(),
    // A stale record (replaced after it emptied) must never delete its successor.
    dropIfEmpty: () => {
      const empty = !channel.has && channel.subs.size === 0;
      if (empty && channels.get(name) === channel) channels.delete(name);
    },
  };
  channels.set(name, channel);
  return channel;
}

function subscribe(channel: Channel, sub: Sub, signal?: AbortSignal): Unsubscribe {
  const off = (): void => {
    channel.subs.delete(sub);
    signal?.removeEventListener('abort', off);
    channel.dropIfEmpty();
  };
  // Before subs.add: a signal that is not an AbortSignal throws here and leaves no listener behind.
  signal?.addEventListener('abort', off, { once: true });
  channel.subs.add(sub);
  return off;
}

function retainedValues(channels: Map<string, Channel>): [string, unknown][] {
  return [...channels]
    .filter(([, channel]) => channel.has)
    .map(([name, channel]) => [name, channel.value]);
}

type Core = { channels: Map<string, Channel>; taps: Taps; enqueue: (task: Task) => void };

// Taps observe after the listeners, in the same task, so they see emits in delivery order.
function emitter({ channels, taps, enqueue }: Core) {
  return (source?: TapEntry) =>
    (name: string, value: unknown, options?: EmitOptions): void => {
      assertChannel(name);
      const channel = open(channels, name);
      const retain = enabled(options?.retain);
      channel.has = retain;
      channel.value = retain ? value : undefined;
      const subs = [...channel.subs];
      channel.dropIfEmpty();
      enqueue(() => {
        fanOut(subs, channel.subs, value);
        notifyTaps(taps, source, [name, value, { retain }]);
      });
    };
}

export function createBus(): Bus {
  const channels = new Map<string, Channel>();
  const taps: Taps = new Map();
  const { hold, enqueue } = createQueue();
  const emitFrom = emitter({ channels, taps, enqueue });
  const emit = emitFrom();
  const tap = createTap({ taps, emitFrom, retained: () => retainedValues(channels), hold });

  const replayRetained = (channel: Channel, sub: Sub): void => {
    if (channel.has) hold(() => deliver(sub, channel.value));
  };

  const on = (name: string, fn: Listener<unknown>, options?: OnOptions): Unsubscribe => {
    assertChannel(name);
    assertListener(fn);
    const { signal, replay } = options ?? {};
    if (signal?.aborted) return noop;
    const channel = open(channels, name);
    const sub = { fn };
    const off = subscribe(channel, sub, signal);
    if (enabled(replay)) replayRetained(channel, sub);
    return off;
  };

  const peek = (name: string): unknown => {
    assertChannel(name);
    const channel = channels.get(name);
    return channel?.has ? channel.value : undefined;
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
