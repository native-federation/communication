import type { Mock } from 'vitest';
import type { Bus, OnOptions, Unsubscribe } from '../src/lib/bus.contract';

export type Collected = { values: unknown[]; off: Unsubscribe };

// Subscribes and records every value the listener receives, in delivery order.
export function collect(bus: Bus, channel: string, options?: OnOptions): Collected {
  const values: unknown[] = [];
  const off = bus.on(channel, value => values.push(value), options);
  return { values, off };
}

// Neither Node 24 nor jsdom implements reportError, so both branches are stubbed. Returns the mock
// that receives listener errors: the reportError stub, or a console.error spy when it is absent.
export function stubReportError(present = true): Mock {
  if (present) {
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    return reportError;
  }
  vi.stubGlobal('reportError', undefined);
  return vi.spyOn(console, 'error').mockImplementation(() => {}) as unknown as Mock;
}
