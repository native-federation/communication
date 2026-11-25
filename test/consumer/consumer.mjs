// A plain-JS consumer, run by plain node from an app whose node_modules links the built package.
// Every import goes by package name, so it resolves through the published exports map.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import * as main from '@softarc/native-federation-communication';
import * as broadcastChannel from '@softarc/native-federation-communication/transport/broadcast-channel';
import * as setup from '@softarc/native-federation-communication/setup';

const NAME = '@softarc/native-federation-communication';
const { bus } = main;
const { createBus } = setup;

const manifestPath = createRequire(import.meta.url).resolve(`${NAME}/package.json`);
const manifest = createRequire(import.meta.url)(manifestPath);
const typesFiles = [
  manifest.typings,
  ...Object.values(manifest.exports).flatMap(entry => entry.types ?? []),
];
assert.deepEqual(
  [...new Set(typesFiles)],
  [
    './types/index.d.ts',
    './types/setup.d.ts',
    './types/install.d.ts',
    './types/transport/broadcast-channel.d.ts',
  ]
);
for (const file of typesFiles) {
  assert.ok(existsSync(join(dirname(manifestPath), file)), `${file} is missing`);
}

assert.deepEqual(Object.keys(main).sort(), ['bus', 'connectTransport']);
assert.deepEqual(Object.keys(setup).sort(), ['busFrom', 'createBus', 'installGlobalBus']);
assert.deepEqual(Object.keys(broadcastChannel), ['broadcastChannelTransport']);
assert.throws(() => import.meta.resolve(`${NAME}/domain`), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });

const own = createBus();
const received = [];
own.on('cart:count', value => received.push(value));
own.emit('cart:count', 1);
assert.deepEqual(received, [1]);
assert.equal(own.peek('cart:count'), 1);
assert.equal(own.version, manifest.version);

// With nothing installed the global bus drops values, installs nothing and says so once.
const warnings = [];
console.warn = message => warnings.push(message);
bus.emit('cart:count', 2);
bus.on('cart:count', () => assert.fail('the inert bus called a listener'));
assert.equal(bus.peek('cart:count'), undefined);
assert.equal(globalThis.__NF_BUS__, undefined);
assert.equal(warnings.length, 1);

// busFrom serves a bus from any source, and the global stays empty.
const scoped = createBus();
const facade = setup.busFrom(() => scoped);
facade.emit('cart:count', 4);
assert.equal(scoped.peek('cart:count'), 4);
assert.equal(globalThis.__NF_BUS__, undefined);

// ./install installs a bus, under node too, exports nothing, and `bus` follows it.
const install = await import(`${NAME}/install`);
assert.deepEqual(Object.keys(install), []);
const installed = globalThis.__NF_BUS__;
assert.equal(installed?.protocol, 1);
bus.emit('cart:count', 3);
assert.equal(installed.peek('cart:count'), 3);

// The installed bus can be tapped, so connectTransport opens a channel; close lets node exit.
const connection = main.connectTransport(broadcastChannel.broadcastChannelTransport('consumer'), ['cart:count']);
assert.equal(warnings.length, 1);
connection.close();

console.log('consumer ok');
