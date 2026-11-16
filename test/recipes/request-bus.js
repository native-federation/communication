import { AsyncLocalStorage } from 'node:async_hooks';
import { busFrom, createBus, installNFBus } from '@softarc/native-federation-communication/setup';

const requests = new AsyncLocalStorage();

export function installRequestBus() {
  const requestBus = busFrom(() => requests.getStore());
  // a bus installed earlier would be shared by every request, so refuse to run on top of it
  if (installNFBus(requestBus) !== requestBus)
    throw new Error('__NF_BUS__ already holds another bus.');
}

export const withRequestBus = handle => requests.run(createBus(), handle);
