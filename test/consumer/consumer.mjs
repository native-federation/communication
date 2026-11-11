// A plain-JS consumer, run by plain node from an app whose node_modules links the built package.
// Every import goes by package name, so it resolves through the published exports map.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import * as main from '@softarc/native-federation-communication';
import * as domain from '@softarc/native-federation-communication/domain';

const NAME = '@softarc/native-federation-communication';
const { bus, createBus } = main;

const manifestPath = createRequire(import.meta.url).resolve(`${NAME}/package.json`);
const manifest = createRequire(import.meta.url)(manifestPath);
const typesFiles = [
  manifest.typings,
  ...Object.values(manifest.exports).flatMap(entry => entry.types ?? []),
];
assert.deepEqual([...new Set(typesFiles)], ['./types/index.d.ts', './types/domain.d.ts']);
for (const file of typesFiles) {
  assert.ok(existsSync(join(dirname(manifestPath), file)), `${file} is missing`);
}

assert.deepEqual(Object.keys(main).sort(), ['bus', 'createBus']);
// ./domain holds types only, so at runtime it is an empty module
assert.deepEqual(Object.keys(domain), []);

const own = createBus();
const received = [];
own.on('cart:count', value => received.push(value));
own.emit('cart:count', 1);
assert.deepEqual(received, [1]);
assert.equal(own.peek('cart:count'), 1);
assert.equal(own.version, manifest.version);

// Outside a browser the page bus drops values, installs nothing and says so once.
const warnings = [];
console.warn = message => warnings.push(message);
bus.emit('cart:count', 2);
bus.on('cart:count', () => assert.fail('the inert bus called a listener'));
assert.equal(bus.peek('cart:count'), undefined);
assert.equal(globalThis.__NF_BUS__, undefined);
assert.equal(warnings.length, 1);

// A realm whose window is the global counts as a page: init-bus.js installs, and `bus` follows it.
globalThis.window = globalThis;
await import(`${NAME}/init-bus.js`);
const installed = globalThis.__NF_BUS__;
assert.equal(installed?.protocol, 1);
bus.emit('cart:count', 3);
assert.equal(installed.peek('cart:count'), 3);

console.log('consumer ok');
