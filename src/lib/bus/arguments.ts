export const noop = (): void => {};

function assertType(value: unknown, type: 'string' | 'function', what: string): void {
  if (typeof value !== type) {
    throw new TypeError(
      `[native-federation-communication] ${what} must be a ${type}, got ${typeof value}.`
    );
  }
}

export const assertChannel = (channel: unknown) => assertType(channel, 'string', 'A channel');
export const assertListener = (listener: unknown) => assertType(listener, 'function', 'A listener');
export const assertTapName = (name: unknown) => assertType(name, 'string', 'A tap name');
