import { createBus } from '../bus/create-bus.js';
import { getGlobalBus, installGlobalBus } from './slot.js';

describe('the __NF_BUS__ slot', () => {
  beforeEach(() => {
    delete globalThis.__NF_BUS__;
  });

  afterAll(() => {
    delete globalThis.__NF_BUS__;
  });

  describe('getGlobalBus', () => {
    it('returns the value at the slot as is, or undefined', () => {
      const installed = createBus();

      expect(getGlobalBus()).toBeUndefined();
      globalThis.__NF_BUS__ = installed;
      expect(getGlobalBus()).toBe(installed);
    });
  });

  describe('installGlobalBus', () => {
    it('installs a non-writable, non-enumerable, configurable slot and returns the bus', () => {
      const created = createBus();

      expect(installGlobalBus(created)).toBe(created);

      const descriptor = Object.getOwnPropertyDescriptor(globalThis, '__NF_BUS__');
      expect(descriptor).toMatchObject({ writable: false, enumerable: false, configurable: true });
      expect(descriptor?.value).toBe(created);
    });

    it('refuses a blind reassignment and keeps the original bus', () => {
      const installed = installGlobalBus(createBus());

      expect(() => {
        (globalThis as { __NF_BUS__?: unknown }).__NF_BUS__ = {};
      }).toThrow(TypeError);
      expect(globalThis.__NF_BUS__).toBe(installed);
    });

    it('keeps and returns the bus already installed', () => {
      const first = createBus();
      installGlobalBus(first);

      expect(installGlobalBus(createBus())).toBe(first);
      expect(globalThis.__NF_BUS__).toBe(first);
    });

    it('keeps whatever value is at the slot, even one that is not a bus', () => {
      const foreign = { protocol: 1 };
      (globalThis as { __NF_BUS__?: unknown }).__NF_BUS__ = foreign;

      expect(installGlobalBus(createBus())).toBe(foreign);
    });

    it('works with destructured methods of the installed bus', () => {
      installGlobalBus(createBus());
      const { emit, on } = globalThis.__NF_BUS__!;
      const received: unknown[] = [];

      on('a', value => received.push(value));
      emit('a', 1);

      expect(received).toEqual([1]);
    });
  });
});
