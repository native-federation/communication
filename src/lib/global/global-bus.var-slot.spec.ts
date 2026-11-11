// @vitest-environment jsdom
// A classic script's `var __NF_BUS__;` leaves a non-configurable slot that no test can delete, so
// these cases get their own file and run in order on that one slot.
import { createBus } from '../bus/create-bus.js';

async function loadCopy() {
  vi.resetModules();
  return import('./global-bus.js');
}

describe('the page bus over a var-declared slot', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, '__NF_BUS__', {
      value: undefined,
      writable: true,
      enumerable: true,
      configurable: false,
    });
  });

  it('installs by assignment and is shared by every copy', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = await loadCopy();
    const b = await loadCopy();

    a.bus.emit('a', 1);

    expect(b.bus.peek('a')).toBe(1);
    expect(globalThis.__NF_BUS__?.peek('a')).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses a bus that a page script assigned to the slot', async () => {
    const assigned = createBus();
    globalThis.__NF_BUS__ = assigned;
    const { bus } = await loadCopy();

    bus.emit('a', 2);

    expect(assigned.peek('a')).toBe(2);
  });

  it('warns once and uses a private bus when the empty slot cannot be written', async () => {
    Object.defineProperty(globalThis, '__NF_BUS__', { value: undefined, writable: false });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bus } = await loadCopy();

    bus.emit('a', 1);
    bus.emit('a', 2);

    expect(bus.peek('a')).toBe(2);
    expect(globalThis.__NF_BUS__).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
