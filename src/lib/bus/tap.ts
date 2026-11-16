import type { EmitOptions, Tap, TapObserver } from '../domain/bus/bus.contract.js';
import { assertListener, assertTapName } from './arguments.js';
import { safely } from './safely.js';

export type TapEntry = { name: string; observer: TapObserver };
export type Taps = Map<string, TapEntry>;
type Emit = Tap['emit'];
type TapContext = {
  taps: Taps;
  emitFrom: (source: TapEntry) => Emit;
  retained: () => [string, unknown][];
  hold: (step: () => void) => void;
};

export function notifyTaps(
  taps: Taps,
  source: TapEntry | undefined,
  [channel, value, { retain }]: Parameters<TapObserver>
): void {
  taps.forEach(entry => {
    if (entry !== source) safely(() => entry.observer(channel, value, { retain }));
  });
}

function handle(taps: Taps, entry: TapEntry, actions: { emit: Emit; replay: () => void }): Tap {
  const live = (): boolean => taps.get(entry.name) === entry;
  return Object.freeze({
    emit: (channel: string, value: unknown, options?: EmitOptions) => {
      if (live()) actions.emit(channel, value, options);
    },
    replay: () => {
      if (live()) actions.replay();
    },
    close: () => {
      if (live()) taps.delete(entry.name);
    },
  });
}

export function createTap({ taps, emitFrom, retained, hold }: TapContext) {
  const replayTo = ({ observer }: TapEntry): void => {
    const values = retained();
    hold(() =>
      values.forEach(([name, value]) => safely(() => observer(name, value, { retain: true })))
    );
  };

  return (name: string, observer: TapObserver): Tap | undefined => {
    assertTapName(name);
    assertListener(observer);
    if (taps.has(name)) return undefined;
    const entry = { name, observer };
    taps.set(name, entry);
    return handle(taps, entry, { emit: emitFrom(entry), replay: () => replayTo(entry) });
  };
}
