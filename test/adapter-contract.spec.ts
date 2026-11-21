// What the framework rows in docs/recipes.md rely on, pinned without installing any framework:
// every row subscribes with `on`; Angular, Svelte and Vue seed with `peek`, React's
// useSyncExternalStore reads it as its snapshot, and Solid's from relies on the synchronous replay
// alone. These properties of the installed bus are their whole contract.
import './recipes/testing-setup.js';

const pkg = '@softarc/native-federation-communication';
const { bus } = await import(pkg);

describe('the contract framework adapters rely on', () => {
  // Svelte's store contract calls run synchronously on subscribe; readable(peek, ...) relies on the
  // replay arriving before `on` returns, so the store never shows a stale seed.
  it('replays the retained value before on returns', () => {
    bus.emit('contract:user', 'ada');
    const seen: unknown[] = [];

    bus.on('contract:user', (user: unknown) => seen.push(user));
    seen.push('returned');

    expect(seen).toEqual(['ada', 'returned']);
  });

  // React StrictMode mounts, unmounts and mounts again; a command must not run on either mount.
  it('fires a replay: false command zero times across subscribe, unsubscribe, subscribe', () => {
    bus.emit('contract:toast', 'stale');
    const toast = vi.fn();

    bus.on('contract:toast', toast, { replay: false })();
    bus.on('contract:toast', toast, { replay: false });

    expect(toast).not.toHaveBeenCalled();
  });

  // The "seed with peek, keep replay on" rule: a value emitted between the seed and the subscribe,
  // e.g. by code that runs during the first render, still arrives. With replay: false it is lost.
  it('delivers a value emitted between the peek seed and the subscribe', () => {
    bus.emit('contract:user', 'ada');
    const withReplay = { current: bus.peek('contract:user') };
    const withoutReplay = { current: bus.peek('contract:user') };

    bus.emit('contract:user', 'grace');
    bus.on('contract:user', (user: unknown) => (withReplay.current = user));
    bus.on('contract:user', (user: unknown) => (withoutReplay.current = user), { replay: false });

    expect(withReplay.current).toBe('grace');
    expect(withoutReplay.current).toBe('ada');
  });

  // useSyncExternalStore re-renders forever when getSnapshot returns a new value on every call.
  it('returns the same reference from peek until the next emit', () => {
    const user = { name: 'ada' };
    bus.emit('contract:user', user);

    expect(bus.peek('contract:user')).toBe(bus.peek('contract:user'));
    expect(bus.peek('contract:user')).toBe(user);
  });

  // A state snapshot reads peek, so a command never shows up as state.
  it('keeps a retain: false value out of peek, inside the listener too', () => {
    bus.emit('contract:toast', 'old');
    const peeked: unknown[] = [];
    bus.on('contract:toast', () => peeked.push(bus.peek('contract:toast')), { replay: false });

    bus.emit('contract:toast', 'saved', { retain: false });

    expect(peeked).toEqual([undefined]);
  });

  // A component mounted by a listener, e.g. a route rendered on a nav command, subscribes while
  // the bus is delivering; it still gets its first value synchronously.
  it('replays synchronously to a subscriber added inside a listener', () => {
    bus.emit('contract:user', 'ada');
    const seen: unknown[] = [];
    bus.on(
      'contract:nav',
      () => {
        bus.on('contract:user', (user: unknown) => seen.push(user));
        seen.push('mounted');
      },
      { replay: false }
    );

    bus.emit('contract:nav', '/profile', { retain: false });

    expect(seen).toEqual(['ada', 'mounted']);
  });
});
