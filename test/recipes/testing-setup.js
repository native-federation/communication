import { createBus } from '@softarc/native-federation-communication';

beforeEach(() => {
  vi.stubGlobal('__NF_BUS__', createBus());
  // a listener that throws, a failed expect included, now fails the emit and so the test
  vi.stubGlobal('reportError', error => {
    throw error;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
