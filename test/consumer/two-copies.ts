// An app that compiles against this build and a remote's later copy at once. consumer.spec.ts
// fabricates `remote-copy` from the built d.ts, with whatever a later version adds.
import { bus } from '@softarc/native-federation-communication';
import { bus as remoteBus } from 'remote-copy';

bus.emit('cart:count', 1);
remoteBus.emit('cart:count', 1);
globalThis.__NF_BUS__?.emit('cart:count', 1);
