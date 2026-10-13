/** Verify replacement against the installed host's actual slot and directory implementations.
 * node tools/verify-host.mjs /absolute/path/to/node_modules
 * Runs in an isolated VM, with simulated transport; does not contact or change the running app.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL, fileURLToPath } from 'node:url';
const moduleRoot = process.argv[2];
if (!moduleRoot || !path.isAbsolute(moduleRoot)) throw Error('Pass an absolute host node_modules directory.');
const { SlotCore } = await import(pathToFileURL(path.join(moduleRoot, '@deepseek-ai/dsh-client-ui-slots/lib/index.js')));
// The shipped snapshot module references bundler-only zustand/immer packages.
// Simulate this boundary explicitly; SlotCore and ModelDirectory remain real host code.
const storeModule = { createSnapshotStore(initial) {
  let state = initial;
  const listeners = new Set();
  const store = {
    getSnapshot: () => state,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    set: next => { state = next; for (const fn of Array.from(listeners)) fn(); },
    update: fn => { const next = { ...state }; fn(next); store.set(next); }
  };
  return store;
} };
const here = path.dirname(fileURLToPath(import.meta.url));
const cleanups = [];
const noop = () => {};
const document = {
  head: { appendChild: noop },
  querySelector: () => null,
  createElement: () => ({ dataset: {}, setAttribute: noop, remove: noop }),
};
function load(file, require) {
  let registration;
  const sandbox = { window: { __ModuleLoader__: { load: value => { registration = value; } } }, document, console, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return registration.factory(require);
}
const React = { createElement: (type, props) => ({ type, props }) };
const modules = {
  react: React, 'react-dom': {}, 'react/jsx-runtime': {},
  '@deepseek-ai/dsh-client-ui-primitives': {},
  '@deepseek-ai/cordis': { Service: class {} },
  '@deepseek-ai/dsh-client-store': storeModule,
};
const native = load(path.join(moduleRoot, '@deepseek-ai/dsh-client-ui-model-selection/lib/client.js'), name => {
  if (!(name in modules)) throw Error('Unexpected host import: ' + name);
  return modules[name];
});
const snapshot = { current: { provider: 'p', model: 'm' }, groups: [{ id: 'p', name: 'P', models: [{ id: 'm', name: 'M' }] }], status: 'ready' };
const catalog = { store: storeModule.createSnapshotStore({ status: 'ready', error: null, value: { groups: snapshot.groups, failures: [], default: snapshot.current } }), reasoningFor: () => undefined, load: async () => {} };
const projection = storeModule.createSnapshotStore({ next: snapshot.current });
const calls = [];
const directory = new native.ModelDirectory({ selectModel: async value => { calls.push(value); projection.set({ next: { provider: value.provider, model: value.model } }); return { ok: true }; } }, 'session', () => true, catalog, projection);
const slots = new SlotCore();
slots.register({ name: 'root', children: { 'conversation.input.model': { kind: 'single', scope: 'session' }, 'conversation.input.right': { kind: 'list', scope: 'session' }, 'settings.general.item': { kind: 'list', scope: 'root' } } }, noop);
slots.register({ name: 'conversation.input.model', registrant: 'official' }, noop);
// The installed Codex subscription registers this seat for all root sessions.
// Reproduce both plugin activation orders with the actual host election code.
let disposeCodex = slots.register({ name: 'conversation.input.model', priority: -10, registrant: 'codex-subscription' }, noop);
const owner = {};
const ctx = {
  slots: { inject: (_key, callback) => { const off = callback(); if (typeof off === 'function') cleanups.push(off); }, register: (options, component) => slots.register({ ...options, registrant: 'navigator' }, component) },
  sessions: { subagentAddress: () => undefined, binding: () => owner },
  modelDirectories: { directoryFor: () => directory },
  locale: { register: () => noop, bind: () => key => key },
  get: () => undefined, on: () => noop,
  effect: callback => { const off = callback(); if (typeof off === 'function') cleanups.push(off); return noop; }
};
const plugin = load(path.join(here, '../lib/client.js'), name => {
  if (name === 'react') return React;
  throw Error('Optional module unavailable: ' + name);
});
plugin.apply(ctx);
const winner = () => slots.entriesOfSlot('conversation.input.model')[0];
assert.equal(winner().registrant, 'navigator', 'navigator must replace the installed Codex picker too');
assert.equal(slots.entriesOfSlot('conversation.input.model').length, 1);
assert.equal(slots.entriesOfSlot('conversation.input.right').length, 0);
const face = winner().inject('session');
assert.equal(face.directory, directory.store, 'must read the actual official ModelDirectory store');
assert.equal((await face.select({ provider: 'p', model: 'second' })).ok, true);
await Promise.resolve();
assert.equal(directory.store.getSnapshot().current.model, 'second');
assert.equal(calls.length, 1);
face.store.patch({ enabled: false });
assert.equal(winner().registrant, 'codex-subscription', 'disabling must restore the previously active picker');
face.store.patch({ enabled: true });
assert.equal(winner().registrant, 'navigator');
disposeCodex();
disposeCodex = slots.register({ name: 'conversation.input.model', priority: -10, registrant: 'codex-subscription' }, noop);
assert.equal(winner().registrant, 'navigator', 'a later Codex registration must not hide the navigator');
slots.reportEntryError('conversation.input.model', winner(), Error('simulated renderer crash'), { abdicate: true });
assert.equal(winner().registrant, 'codex-subscription', 'renderer abdication must restore the previously active picker');
face.store.patch({ enabled: false });
face.store.patch({ enabled: true });
assert.equal(winner().registrant, 'navigator');
for (const off of cleanups.reverse()) off();
assert.equal(winner().registrant, 'codex-subscription');
disposeCodex();
assert.equal(winner().registrant, 'official');
directory.dispose();
console.log('PASS: real host slots + real ModelDirectory: single entry, shared projection, disable/enable, Codex priority conflict in both activation orders, crash fallback, unload.');
