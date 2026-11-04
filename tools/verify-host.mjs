/** Verify replacement against the installed host's actual slot and directory implementations.
 * node tools/verify-host.mjs /absolute/path/to/node_modules [/absolute/path/to/dsh-client-ui-slots]
 * Host 0.2.1 bundles SlotCore into the web frontend and no longer ships
 * @deepseek-ai/dsh-client-ui-slots in node_modules; pass the npm package
 * directory of the same version as the second argument.
 * Runs in an isolated VM, with simulated transport; does not contact or change the running app.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL, fileURLToPath } from 'node:url';
const moduleRoot = process.argv[2];
if (!moduleRoot || !path.isAbsolute(moduleRoot)) throw Error('Pass an absolute host node_modules directory.');
const hostVersion = JSON.parse(fs.readFileSync(path.join(moduleRoot, '@deepseek-ai/dsh-client-ui-model-selection/package.json'), 'utf8')).version;
const slotsRoot = process.argv[3] ?? path.join(moduleRoot, '@deepseek-ai/dsh-client-ui-slots');
if (!path.isAbsolute(slotsRoot) || !fs.existsSync(path.join(slotsRoot, 'lib/index.js'))) {
  throw Error(`SlotCore not found at ${slotsRoot}. Host ${hostVersion} may bundle it; pass the @deepseek-ai/dsh-client-ui-slots@${hostVersion} package directory as the second argument.`);
}
const slotsVersion = JSON.parse(fs.readFileSync(path.join(slotsRoot, 'package.json'), 'utf8')).version;
if (slotsVersion !== hostVersion) throw Error(`SlotCore ${slotsVersion} does not match host ${hostVersion}.`);
const { SlotCore } = await import(pathToFileURL(path.join(slotsRoot, 'lib/index.js')));
console.log(`host model-selection ${hostVersion}, SlotCore ${slotsVersion}`);
const cordis = await import(pathToFileURL(path.join(moduleRoot, '@deepseek-ai/cordis/lib/index.js')));
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
  '@deepseek-ai/cordis': cordis,
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
let rejectNext = null;
// 0.2.1 appends isBlank and track to the constructor; earlier hosts ignore extra arguments.
const directory = new native.ModelDirectory({ selectModel: async value => {
  calls.push(value);
  if (rejectNext !== null) { const error = rejectNext; rejectNext = null; return { ok: false, error }; }
  projection.set({ next: { provider: value.provider, model: value.model } });
  return { ok: true };
} }, 'session', () => true, catalog, projection, () => false, undefined);
const slots = new SlotCore();
slots.register({ name: 'root', children: { 'conversation.input.model': { kind: 'single', scope: 'session' }, 'conversation.input.right': { kind: 'list', scope: 'session' }, 'settings.general.item': { kind: 'list', scope: 'root' } } }, noop);
// The official picker declares the model label child slot (0.2.1+); the navigator must not declare it again.
const LABEL_SLOT = 'conversation.input.model.label';
slots.register({ name: 'conversation.input.model', registrant: 'official', children: { [LABEL_SLOT]: { kind: 'single', scope: 'session', inline: true } } }, noop);
// The installed Codex subscription registers this seat for all root sessions.
// Reproduce both plugin activation orders with the actual host election code.
let disposeCodex = slots.register({ name: 'conversation.input.model', priority: -10, registrant: 'codex-subscription' }, noop);
const owner = {};
const ctx = {
  slots: {
    inject: (_key, callback) => { const off = callback(); if (typeof off === 'function') cleanups.push(off); },
    register: (options, component) => slots.register({ ...options, registrant: 'navigator' }, component),
    // SlotCore read API the navigator uses to render conversation.input.model.label entries.
    entriesOfSlot: key => slots.entriesOfSlot(key),
    subscribe: (key, fn) => slots.subscribe(key, fn),
    getVersion: key => slots.getVersion(key),
  },
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
assert.equal(winner().children, undefined, 'navigator must not declare the label child slot a second time');
const face = winner().inject('session');
assert.equal(face.directory, directory.store, 'must read the actual official ModelDirectory store');
assert.equal((await face.select({ provider: 'p', model: 'second' })).ok, true);
await Promise.resolve();
assert.equal(directory.store.getSnapshot().current.model, 'second');
assert.equal(calls.length, 1);
// Host snapshot semantics the navigator relies on (0.2.1+): a background refresh
// keeps groups while status is loading; a failed select flips the whole directory
// to error with "code: message"; per-provider failures pass through.
if ('failures' in directory.store.getSnapshot()) {
  const loaded = catalog.store.getSnapshot();
  catalog.store.set({ ...loaded, status: 'loading' });
  let state = directory.store.getSnapshot();
  assert.equal(state.status, 'loading');
  assert.equal(state.groups.length, 1, 'refresh must retain groups');
  assert.equal(state.current.model, 'second', 'refresh must retain the current selection');
  catalog.store.set({ ...loaded, value: { ...loaded.value, failures: [{ id: 'q', name: 'Q', message: 'offline' }] } });
  assert.deepEqual(directory.store.getSnapshot().failures.map(f => f.id), ['q']);
  rejectNext = { code: 'session/writer-held', message: 'held' };
  assert.equal((await face.select({ provider: 'p', model: 'm' })).ok, false);
  state = directory.store.getSnapshot();
  assert.equal(state.status, 'error');
  assert.equal(state.error, 'session/writer-held: held', 'navigator matches this string to tell select errors from catalog errors');
  assert.equal(state.groups.length, 1);
  // face.load() is fire-and-forget (UI buttons call it without awaiting); the host's
  // load() still awaits catalog.load() before syncInputs(), so drain the task queue.
  face.load();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(directory.store.getSnapshot().status, 'ready', 'load() clears a select error');
  catalog.store.set(loaded);
  console.log('PASS: host 0.2.1 directory semantics: refresh keeps groups, select failure sets error string, failures pass through.');
}
// A label plugin (e.g. the "1017" badge) registers into the official child slot.
// The navigator reads the winning entry through SlotCore and must see it while it owns the seat.
assert.equal(typeof face.labels.slots.entriesOfSlot, 'function', 'face must expose the SlotCore read API for labels');
const labelVersion = face.labels.slots.getVersion(LABEL_SLOT);
let labelNotified = 0;
const offLabel = face.labels.slots.subscribe(LABEL_SLOT, () => { labelNotified += 1; });
const LabelBadge = () => null;
const disposeLabel = slots.register({ name: LABEL_SLOT, registrant: 'label-1017', locale: 'label-1017', inject: () => ({}) }, LabelBadge);
const labelEntries = face.labels.slots.entriesOfSlot(LABEL_SLOT);
assert.equal(labelEntries.length, 1, 'label entry must be visible while the navigator owns the model seat');
assert.equal(labelEntries[0].registrant, 'label-1017');
assert.equal(labelEntries[0].component, LabelBadge, 'navigator renders entry.component');
assert.equal(labelEntries[0].locale, 'label-1017', 'navigator binds t to entry.locale');
assert.equal(typeof labelEntries[0].inject, 'function', 'navigator merges entry.inject(sessionId) into props');
// SlotCore batches change notifications into a microtask; drain before asserting.
const drainMicrotasks = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };
await drainMicrotasks();
assert.ok(labelNotified > 0, 'subscribe must fire (microtask-batched) when a label entry registers');
const labelVersionAfter = face.labels.slots.getVersion(LABEL_SLOT);
assert.notEqual(labelVersionAfter, labelVersion, 'getVersion must move when a label entry registers');
const notifiedBeforeDispose = labelNotified;
disposeLabel();
assert.equal(face.labels.slots.entriesOfSlot(LABEL_SLOT).length, 0);
await drainMicrotasks();
assert.ok(labelNotified > notifiedBeforeDispose, 'subscribe must fire when a label entry is disposed');
assert.notEqual(face.labels.slots.getVersion(LABEL_SLOT), labelVersionAfter);
offLabel();
console.log('PASS: model label slot: official declaration only, label entry visible to the navigator with component/locale/inject, batched subscribe + version move on register/dispose.');
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

// Exercise a cold resolver with the real Cordis caller-context tracing. A direct
// ModelDirectory fixture above skips this dependency boundary entirely.
const coldRoot = new cordis.Context();
const coldRegistrations = [];
const coldProjection = storeModule.createSnapshotStore({ next: snapshot.current });
// 0.2.1 reads session.getSnapshot().blank for selection analytics.
const coldSession = () => ({ projections: { faceOf: () => coldProjection }, getSnapshot: () => ({ blank: false }) });
let coldOwner = { session: coldSession() };
const coldCalls = [];
const wire = {
  modelCatalog: async () => ({ ok: true, value: { groups: snapshot.groups, failures: [], default: snapshot.current } }),
  selectModel: async value => {
    coldCalls.push(value);
    coldProjection.set({ next: { provider: value.provider, model: value.model } });
    return { ok: true };
  },
};
class Remote extends cordis.Service {
  constructor(ctx) { super(ctx, 'remote'); }
  get session() { return this.ctx['remote.session']; }
  $on() { return noop; }
}
// Services must live in a sibling provider fiber. Providing on the root would
// bypass consumer injection checks through the root's own service store.
const transportFiber = coldRoot.plugin({ apply(ctx) {
  ctx.provide('remote.session', wire);
  new Remote(ctx);
  ctx.provide('sessions', { scope: () => coldRoot, binding: () => coldOwner, subagentAddress: () => undefined });
  ctx.provide('slots', {
    inject: (_key, callback) => callback(),
    register: (options, component) => { coldRegistrations.push({ options, component }); return noop; },
  });
  ctx.provide('locale', { register: () => noop, bind: () => key => key });
} });
await transportFiber.await();
const resolverFiber = coldRoot.plugin(native.ModelDirectoryResolver);
await resolverFiber.await();
const pickerFiber = coldRoot.plugin(plugin);
await pickerFiber.await();
const coldEntry = coldRegistrations.find(entry => entry.options.name === 'conversation.input.model');
assert.ok(coldEntry, 'navigator must activate without Codex or WorkBuddy');
const coldFace = coldEntry.options.inject('cold-session');
assert.equal(coldFace.available, true, JSON.stringify(coldFace.lastError));
// Same fire-and-forget load as above: wait for wire.modelCatalog → catalog → syncInputs.
coldFace.load();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(coldFace.directory.getSnapshot().groups.length, 1);
assert.equal((await coldFace.select({ provider: 'p', model: 'cold-selected' })).ok, true);
assert.equal(coldFace.directory.getSnapshot().current.model, 'cold-selected');
assert.equal(coldCalls.length, 1);
// Recreating a session binding must also create a directory through this path.
coldOwner = { session: coldSession() };
const reboundFace = coldEntry.options.inject('cold-session');
assert.notEqual(reboundFace, coldFace);
assert.equal(reboundFace.available, true, JSON.stringify(reboundFace.lastError));
assert.notEqual(reboundFace.directory, coldFace.directory);
await pickerFiber.dispose();
await resolverFiber.dispose();
await transportFiber.dispose();
console.log('PASS: real Cordis + real ModelDirectoryResolver: cold first consumer without Codex/WorkBuddy, shared catalog, selection, recreated binding.');
