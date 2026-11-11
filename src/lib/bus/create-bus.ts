import type { Bus, Listener, OnOptions, EmitOptions, Unsubscribe } from '../domain/bus/bus.contract.js';

declare const __NF_COMMUNICATION_VERSION__: string;
export const VERSION = __NF_COMMUNICATION_VERSION__;

type Sub = { fn: Listener<unknown> };
type Channel = { has: boolean; value: unknown; subs: Set<Sub>; dropIfEmpty: () => void };
type Task = () => void;

export const noop = (): void => {};

function report(error: unknown): void {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
  else console.error(error);
}

function deliver(sub: Sub, value: unknown): void {
  try {
    sub.fn(value);
  } catch (error) {
    report(error);
  }
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
  channel.subs.add(sub);
  const off = (): void => {
    channel.subs.delete(sub);
    signal?.removeEventListener('abort', off);
    channel.dropIfEmpty();
  };
  signal?.addEventListener('abort', off, { once: true });
  return off;
}

export function createBus(): Bus {
  const channels = new Map<string, Channel>();
  const { hold, enqueue } = createQueue();

  const emit = (name: string, value: unknown, options?: EmitOptions): void => {
    const channel = open(channels, name);
    channel.has = options?.retain !== false;
    channel.value = channel.has ? value : undefined;
    const subs = [...channel.subs];
    channel.dropIfEmpty();
    enqueue(() => fanOut(subs, channel.subs, value));
  };

  const on = (name: string, fn: Listener<unknown>, options?: OnOptions): Unsubscribe => {
    const signal = options?.signal;
    if (signal?.aborted) return noop;
    const channel = open(channels, name);
    const sub = { fn };
    const off = subscribe(channel, sub, signal);
    if (channel.has) hold(() => deliver(sub, channel.value));
    return off;
  };

  const peek = (name: string): unknown => {
    const channel = channels.get(name);
    return channel?.has ? channel.value : undefined;
  };

  return Object.freeze({ protocol: 1, version: VERSION, emit, on, peek }) as Bus;
}
