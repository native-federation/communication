import type { Bus } from '../domain/bus/bus.contract.js';

export const getGlobalBus = (): Bus | undefined => globalThis.__NF_BUS__ as Bus | undefined;

// A classic script's `var __NF_BUS__;` leaves a non-configurable slot that only assignment can fill.
export function installGlobalBus(bus: Bus): Bus {
  if (getGlobalBus() === undefined) {
    const slot = { value: bus, writable: false, enumerable: false, configurable: true };
    if (!Reflect.defineProperty(globalThis, '__NF_BUS__', slot)) globalThis.__NF_BUS__ = bus;
  }
  return getGlobalBus() as Bus;
}
