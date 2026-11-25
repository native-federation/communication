import type {
  Bus,
  EmitOptions,
  Listener,
  OnOptions,
  Tap,
  TapListener,
  Unsubscribe,
} from '../domain/bus/bus.contract.js';
import {
  assertChannel,
  assertListener,
  assertTapListener,
  assertTapName,
  noop,
} from './arguments.js';
import { safely } from './safely.js';

declare const __NF_COMMUNICATION_VERSION__: string;
export const VERSION = __NF_COMMUNICATION_VERSION__;

type Sub = { fn: Listener<unknown>; signal?: AbortSignal };
type Task = () => void;
type State = {
  retained: Map<string, unknown>;
  subs: Map<string, Set<Sub>>;
  taps: Map<string, TapListener>;
  hold: (step: Task) => void;
  enqueue: (task: Task) => void;
};

// undefined means the default (on); anything else goes through Boolean(), so `{ replay: 0 }` is off.
const enabled = (option: unknown): boolean => option === undefined || Boolean(option);

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

// Taps observe after the listeners, in the same task, so they see emits in delivery order.
function emitter({ retained, subs, taps, enqueue }: State, source?: TapListener) {
  return (channel: string, value: unknown, options?: EmitOptions): void => {
    assertChannel(channel);
    const retain = enabled(options?.retain);
    if (retain) retained.set(channel, value);
    else retained.delete(channel);
    // The snapshots are who listened at emit time; the live checks drop whoever left since.
    const live = subs.get(channel) ?? new Set<Sub>();
    const snapshot = [...live];
    const tapped = [...taps];
    enqueue(() => {
      snapshot.forEach(sub => {
        if (live.has(sub)) safely(() => sub.fn(value));
      });
      tapped.forEach(([name, tap]) => {
        if (tap !== source && taps.get(name) === tap) safely(() => tap({ channel, value, retain }));
      });
    });
  };
}

function subscribe(subs: Map<string, Set<Sub>>, channel: string, sub: Sub): Unsubscribe {
  const set = subs.get(channel) ?? new Set<Sub>();
  const off = (): void => {
    sub.signal?.removeEventListener('abort', off);
    // delete() is false the second time, so a stale off never drops a newer set.
    if (set.delete(sub) && set.size === 0) subs.delete(channel);
  };
  // Before subscribing: a signal that is not an AbortSignal throws here and leaves no listener behind.
  sub.signal?.addEventListener('abort', off, { once: true });
  subs.set(channel, set.add(sub));
  return off;
}

function replayOne({ retained, hold }: State, channel: string, fn: Listener<unknown>): void {
  if (retained.has(channel)) hold(() => safely(() => fn(retained.get(channel))));
}

function subscriber(state: State) {
  return (channel: string, fn: Listener<unknown>, options?: OnOptions): Unsubscribe => {
    assertChannel(channel);
    assertListener(fn);
    const { signal, replay } = options ?? {};
    if (signal?.aborted) return noop;
    const off = subscribe(state.subs, channel, { fn, signal });
    if (enabled(replay)) replayOne(state, channel, fn);
    return off;
  };
}

function opener(state: State) {
  const { retained, taps, hold } = state;
  return (name: string, listener: TapListener): Tap | undefined => {
    assertTapName(name);
    assertTapListener(listener);
    if (taps.has(name)) return undefined;
    // A fresh function per tap, so a closed handle never acts on a later tap with the same name.
    const own: TapListener = envelope => listener(envelope);
    taps.set(name, own);
    const live = (): boolean => taps.get(name) === own;
    const emit = emitter(state, own);
    return {
      emit: (channel: string, value: unknown, options?: EmitOptions) => {
        if (live()) emit(channel, value, options);
      },
      replay: () => {
        const values = live() ? [...retained] : [];
        hold(() =>
          values.forEach(([channel, value]) => safely(() => own({ channel, value, retain: true })))
        );
      },
      close: () => {
        if (live()) taps.delete(name);
      },
    };
  };
}

export function createBus(): Bus {
  const retained = new Map<string, unknown>();
  const state: State = { retained, subs: new Map(), taps: new Map(), ...createQueue() };

  // The untyped implementation can't satisfy Bus's generic signatures; it is checked against the global shape.
  const instance = {
    protocol: 1,
    version: VERSION,
    emit: emitter(state),
    on: subscriber(state),
    peek: (channel: string): unknown => {
      assertChannel(channel);
      return retained.get(channel);
    },
    tap: opener(state),
  } satisfies NativeFederationBus;
  return Object.freeze(instance) as Bus;
}
