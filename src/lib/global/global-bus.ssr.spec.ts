// Runs in the unit project's default node environment: no window, as on a server or in a worker.
import { version } from '../../../package.json';

describe('the page bus without window', () => {
  it('adds no globals when the barrel is imported', async () => {
    const keys = Reflect.ownKeys(globalThis);
    vi.resetModules();

    await import('../../index.js');

    expect(Reflect.ownKeys(globalThis)).toEqual(keys);
  });

  it('is inert and installs nothing', async () => {
    vi.resetModules();
    const { bus } = await import('../../index.js');
    const listener = vi.fn();

    bus.emit('a', 1);
    const off = bus.on('a', listener);
    bus.emit('a', 2);
    off();

    expect(listener).not.toHaveBeenCalled();
    expect(bus.peek('a')).toBeUndefined();
    expect(bus.protocol).toBe(1);
    expect(bus.version).toBe(version);
    expect(globalThis.__NF_BUS__).toBeUndefined();
  });

  it('still offers isolated per-request buses through createBus', async () => {
    const { createBus } = await import('../../index.js');
    const requestA = createBus();
    const requestB = createBus();

    requestA.emit('user', 'ada');

    expect(requestA.peek('user')).toBe('ada');
    expect(requestB.peek('user')).toBeUndefined();
  });
});
