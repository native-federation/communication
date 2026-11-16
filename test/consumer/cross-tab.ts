// The ./cross-tab subpath, imported by package name like an app would.
import { bus } from '@softarc/native-federation-communication';
import {
  shareAcrossTabs,
  type CrossTabOptions,
} from '@softarc/native-federation-communication/cross-tab';

export const stop: () => void = shareAcrossTabs(['cart:count'], { bus });
shareAcrossTabs(['cart:count'], { bus: globalThis.__NF_BUS__! });
export const options: CrossTabOptions = {};
// @ts-expect-error channels is a list, not a single name
shareAcrossTabs('cart:count');
