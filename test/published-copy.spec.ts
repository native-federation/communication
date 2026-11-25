import { resolve } from 'node:path';
import type { Bus, Envelope } from '../src/lib/domain/bus/bus.contract.js';
import type { Connection, Transport } from '../src/lib/domain/connect/connect.contract.js';

// HEAD next to a copy that is already on npm, the way a page mixes remotes released at different
// times. `nfc-pinned` is an npm alias in devDependencies. Once 4.0.0 is out, pin it to 4.0.0 for
// all of 4.x: the oldest copy 4.x promises to work with (docs/multiple-copies.md#compatibility).
const FESM = 'fesm2022/@softarc/native-federation-communication';
const HEAD = resolve(__dirname, '.dist');
const PINNED = resolve(__dirname, '../node_modules/nfc-pinned');

type Copy = {
  bus: Bus;
  connectTransport: (
    transport: Transport,
    channels: string[],
    options?: { bus?: Bus }
  ) => Connection | undefined;
  createBus: () => Bus;
  installGlobalBus: (bus: Bus) => Bus;
};

// A distinct query string loads each copy as its own module instance.
let copies = 0;
async function loadCopy(root: string): Promise<Copy> {
  copies += 1;
  const load = (file: string) => import(/* @vite-ignore */ `${resolve(root, file)}?copy=${copies}`);
  return { ...(await load(`${FESM}.mjs`)), ...(await load(`${FESM}-setup.mjs`)) };
}

// Two in-memory ends of one wire: what one side sends, the other receives at once.
function wire(): [Transport, Transport] {
  const receivers = [new Set<(e: Envelope) => void>(), new Set<(e: Envelope) => void>()];
  const end = (own: number): Transport => ({
    name: 'memory',
    send: envelope => receivers[1 - own]!.forEach(receive => receive(envelope)),
    listen: receive => {
      receivers[own]!.add(receive);
      return () => receivers[own]!.delete(receive);
    },
  });
  return [end(0), end(1)];
}

describe.each([
  ['the published copy installs', PINNED, HEAD],
  ['HEAD installs', HEAD, PINNED],
])('next to a published copy, when %s', (_, installer, user) => {
  let installed: Copy;
  let other: Copy;

  beforeEach(async () => {
    delete globalThis.__NF_BUS__;
    installed = await loadCopy(installer);
    other = await loadCopy(user);
    installed.installGlobalBus(installed.createBus());
  });

  afterAll(() => {
    delete globalThis.__NF_BUS__;
  });

  it('shares the installed bus both ways', () => {
    const seen: unknown[] = [];
    other.bus.on('cart:count', value => seen.push(value));

    installed.bus.emit('cart:count', 1);
    other.bus.emit('cart:count', 2);

    expect(seen).toEqual([1, 2]);
    expect(installed.bus.peek('cart:count')).toBe(2);
    expect(other.installGlobalBus(other.createBus())).toBe(globalThis.__NF_BUS__);
  });

  it('keeps retain: false out of the other copy’s replay', () => {
    installed.bus.emit('ui:toast', 'stale');
    installed.bus.emit('ui:toast', 'now', { retain: false });

    expect(other.bus.peek('ui:toast')).toBeUndefined();
    const replayed: unknown[] = [];
    other.bus.on('ui:toast', value => replayed.push(value));
    expect(replayed).toEqual([]);
  });

  it('carries values both ways over a transport the other copy connects to the installed bus', () => {
    const [page, remote] = wire();
    const far = other.createBus();
    const near = other.connectTransport(page, ['cart:count']);
    const away = other.connectTransport(remote, ['cart:count'], { bus: far });
    const farSeen: unknown[] = [];
    far.on('cart:count', value => farSeen.push(value), { replay: false });

    installed.bus.emit('cart:count', 1);
    far.emit('cart:count', 2);

    expect(near).toBeDefined();
    expect(farSeen).toEqual([1, 2]);
    expect(installed.bus.peek('cart:count')).toBe(2);
    near?.close();
    away?.close();
  });
});
