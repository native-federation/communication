import type { Bus } from '../domain/bus/bus.contract.js';

type Slot = { __NF_BUS__?: Bus };

export const getNFBus = (loc: object = globalThis): Bus | undefined => (loc as Slot).__NF_BUS__;

// A classic script's `var __NF_BUS__;` leaves a non-configurable slot that only assignment can fill.
export function installNFBus(bus: Bus, loc: object = globalThis): Bus {
  if (getNFBus(loc) === undefined) {
    const slot = { value: bus, writable: false, enumerable: false, configurable: true };
    if (!Reflect.defineProperty(loc, '__NF_BUS__', slot)) (loc as Slot).__NF_BUS__ = bus;
  }
  return getNFBus(loc) as Bus;
}
