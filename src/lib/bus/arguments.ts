export const noop = (): void => {};

export function assertChannel(channel: unknown): void {
  if (typeof channel !== 'string') {
    throw new TypeError(
      `[native-federation-communication] A channel must be a string, got ${typeof channel}.`
    );
  }
}

export function assertListener(listener: unknown): void {
  if (typeof listener !== 'function') {
    throw new TypeError(
      `[native-federation-communication] A listener must be a function, got ${typeof listener}.`
    );
  }
}
