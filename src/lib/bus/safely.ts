function report(error: unknown): void {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
  else console.error(error);
}

export function safely(task: () => void): void {
  try {
    task();
  } catch (error) {
    report(error);
  }
}
