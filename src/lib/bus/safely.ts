export function safely(task: () => void): void {
  try {
    task();
  } catch (error) {
    (globalThis.reportError ?? console.error)(error);
  }
}
