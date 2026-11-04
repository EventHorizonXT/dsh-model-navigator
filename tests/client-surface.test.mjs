// 用 Node 的 vm 在最小模拟环境里真正「执行」打包产物 lib/client.js：
//   1. 把内联的 __core 与 src/core/*.mjs 的导出逐一对比（防转译/手抄漂移）；
//   2. 调用真实的 apply(ctx) → slots.register → inject() → 用自带的
//      迷你 React 渲染器执行一次组件，把「首屏崩溃」在离线测试里抓住
//      （live 页面的刷新只能由用户完成）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const CLIENT = path.join(ROOT, "lib", "client.js");
const PROBE = path.join(ROOT, "lib", "client.with-embeds.js");

/**
 * 最近一次 loadBundle 读到的插件 inject 声明。
 *
 * 真实客户端 ctx 对属性访问按 inject 门禁（未声明就抛
 * `cannot get property "<name>" without inject`），fakeCtx 必须复刻这条规则，
 * 否则「读了没声明的服务」这类缺陷在离线测试里会静默通过——正是它让
 * dsh-model-navigator 0.1.0 在真实页面里把整个 web boot 拖挂。
 */
let LAST_INJECT = null;

/* ================================================================== *
 * 迷你 React：真正的渲染 + hook 复用（只覆盖模板用到的 API）
 * ================================================================== */

/**
 * 造一个可渲染的 React 替身。
 * @param overrides 按需覆盖初始 hook 值（例如让菜单一开始就是打开的）。
 */
function makeHarness(overrides = {}) {
  // 每个函数组件实例一份 hook 表，键 = 组件链（例如 "root/ComposerEntry/ModelNavigator"）。
  // 真实 React 按「树中位置 + 元素类型」维护实例状态：包装组件与它渲染的内层组件
  // 各有各的 hook 表。早期版本只有一份共享数组、仅按 index 取 cell，于是给入口加一个
  // 带 hook 的包装组件（ComposerEntry）就会让内层 ModelNavigator 读到外层的 cell
  // （useState 的 [0] 被当成 directory 快照），供应商/模型行全部渲染不出来——
  // 那是 harness 保真度不足，不是产品缺陷。
  const instances = new Map();
  let currentHooks = [];
  const cursor = { index: 0, element: null };

  function withHooks(key, fn) {
    const outerIndex = cursor.index;
    const outerHooks = currentHooks;
    const element = cursor.element;
    let hooks = instances.get(key);
    if (hooks === undefined) {
      hooks = [];
      instances.set(key, hooks);
    }
    currentHooks = hooks;
    cursor.index = 0;
    try {
      return fn();
    } finally {
      currentHooks = outerHooks;
      cursor.index = outerIndex;
      cursor.element = element;
    }
  }

  function slot(initial) {
    const index = cursor.index;
    cursor.index += 1;
    if (currentHooks[index] === undefined) currentHooks[index] = { value: initial };
    return currentHooks[index];
  }

  const React = {
    createElement(type, props, ...children) {
      const next = props === null || props === undefined ? {} : { ...props };
      if (children.length > 0) next.children = children;
      return { type, props: next, children };
    },
    useCallback(fn) {
      return fn;
    },
    useMemo(fn) {
      return fn();
    },
    useEffect(fn, deps) {
      // 真的执行副作用（带依赖比较与清理），这样「外部点击 / Esc 取消」也能被离线测到
      const index = cursor.index;
      cursor.index += 1;
      const prev = currentHooks[index];
      if (prev !== undefined && prev.hooks === true && sameDeps(prev.deps, deps)) return;
      if (prev !== undefined && prev.hooks === true && typeof prev.cleanup === "function") prev.cleanup();
      const cleanup = fn();
      currentHooks[index] = {
        hooks: true,
        deps: Array.isArray(deps) ? deps.slice() : deps,
        cleanup: typeof cleanup === "function" ? cleanup : undefined,
      };
    },
    useRef(initial) {
      return slot({ current: initial }).value;
    },
    useState(initial) {
      const cell = slot([initial]);
      const set = (next) => {
        cell.value = [typeof next === "function" ? next(cell.value[0]) : next];
      };
      return [cell.value[0], set];
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      const cell = slot(undefined);
      if (overrides.useSyncExternalStore) {
        const forced = overrides.useSyncExternalStore(cursor.element);
        if (forced !== undefined) {
          cell.value = forced;
          return forced;
        }
      }
      // 真实 React 每次渲染都会重读 getSnapshot（订阅回调负责触发重渲染）。
      // 早期只在第一次渲染时读，于是「写入偏好 → 重新渲染」在离线测试里看不到效果，
      // 家族折叠、开关这类「写偏好后界面立刻变化」的行为就测不出来。
      cell.value = typeof getSnapshot === "function" ? getSnapshot() : undefined;
      return cell.value;
    },
  };

  // 与真实 React 一样，布局副作用在离线替身里按普通副作用同步执行。
  React.useLayoutEffect = React.useEffect;
  // 最小类组件：只为错误边界（标签槽位的 LabelBoundary）服务。必须是普通函数，产物用 Component.call(this, props)。
  function Component(props) {
    this.props = props;
    this.state = null;
  }
  Component.prototype.isReactComponent = {};
  Component.prototype.setState = function (next) {
    this.state = { ...this.state, ...(typeof next === "function" ? next(this.state, this.props) : next) };
  };
  React.Component = Component;
  const classInstances = new Map();

  /**
   * 渲染一棵元素树，真正调用函数组件（因此 hook 会按真实顺序执行）。
   * 元素里的 ref 不参与渲染，只回报给调用方，便于排查。
   */
  function render(node, key) {
    const base = key === undefined ? "root" : key;
    if (node === null || node === undefined || node === false || node === true) return null;
    if (Array.isArray(node)) return node.map((child, index) => render(child, base + "/" + index));
    if (typeof node !== "object") return node;
    const { type, props } = node;
    if (typeof type === "function" && type.prototype !== undefined && type.prototype.isReactComponent) {
      // 类组件：按 位置 + 类型名 + key 保持实例；子树渲染抛错时走 getDerivedStateFromError/componentDidCatch。
      const instanceKey = base + "/" + (type.name || "AnonymousClass") + (props.key === undefined ? "" : String(props.key));
      let inst = classInstances.get(instanceKey);
      if (inst === undefined) {
        inst = new type(props);
        classInstances.set(instanceKey, inst);
      }
      inst.props = props;
      try {
        return render(inst.render(), instanceKey);
      } catch (error) {
        if (typeof type.getDerivedStateFromError !== "function") throw error;
        inst.state = { ...inst.state, ...type.getDerivedStateFromError(error) };
        if (typeof inst.componentDidCatch === "function") inst.componentDidCatch(error);
        return render(inst.render(), instanceKey);
      }
    }
    if (typeof type === "function") {
      const outer = cursor.element;
      const instanceKey = base + "/" + (type.name === undefined || type.name === "" ? "anonymous" : type.name);
      cursor.element = node;
      let element;
      try {
        element = withHooks(instanceKey, () => type(props));
      } finally {
        cursor.element = outer;
      }
      return render(element, instanceKey);
    }
    const children = props.children === undefined ? [] : props.children.map((child, index) => render(child, base + "/" + index));
    return { type, props, children };
  }

  return { React, render, document: createFakeDocument() };
}

/** 依赖数组比较（与 React 相同的逐项 Object.is 语义）。 */
function sameDeps(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) if (!Object.is(left[i], right[i])) return false;
  return true;
}

/**
 * 最小 document：事件监听 + `createElement("style")` / `head.appendChild`，
 * 后者用来验证插件自己插样式表并打上 data-plugin（宿主按包名清理/HMR 记账）。
 */
function createFakeDocument() {
  const listeners = new Map();
  const appended = [];
  const removed = [];
  const nodes = [];
  const head = {
    appendChild(node) {
      node.parent = head;
      appended.push(node);
      if (nodes.indexOf(node) === -1) nodes.push(node);
      return node;
    },
  };
  const document = {
    listeners,
    head,
    appended,
    removed,
    nodes,
    /** 测试用的显式挂载点：document.attach(node) 之后才能被 querySelectorAll 找到。 */
    attach(node) {
      if (node !== null && node !== undefined && nodes.indexOf(node) === -1) nodes.push(node);
      return node;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      const at = list.indexOf(fn);
      if (at >= 0) list.splice(at, 1);
    },
    dispatch(type, event) {
      const list = (listeners.get(type) || []).slice();
      for (const fn of list) fn(event === undefined ? {} : event);
      return list.length;
    },
    countOf(type) {
      return (listeners.get(type) || []).length;
    },
    /**
     * 只支持诊断探针真正用到的选择器：标签名、`.class`、`[attr]` / `[attr=value]`。
     * 不支持组合子，也不模拟 DOM 层级。
     */
    querySelectorAll(selector) {
      return nodes.filter((node) => matchesSelector(node, selector));
    },
    createElement(tagName) {
      const tag = String(tagName).toUpperCase();
      const node = {
        tagName: tag,
        className: "",
        attributes: {},
        children: [],
        textContent: "",
        innerHTML: "",
        hidden: false,
        parent: null,
        parentElement: null,
        style: {},
        setAttribute(name, value) {
          this.attributes[name] = String(value);
          if (name === "class") this.className = String(value);
        },
        getAttribute(name) {
          return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
        },
        addEventListener() {},
        removeEventListener() {},
        appendChild(child) {
          child.parent = this;
          child.parentElement = this;
          this.children.push(child);
          if (nodes.indexOf(child) === -1) nodes.push(child);
          return child;
        },
        getBoundingClientRect() {
          return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
        },
        remove() {
          const at = appended.indexOf(this);
          if (at >= 0) appended.splice(at, 1);
          const seen = nodes.indexOf(this);
          if (seen >= 0) nodes.splice(seen, 1);
          removed.push(this);
          this.parent = null;
          this.parentElement = null;
        },
        node: document,
      };
      return node;
    },
  };
  return document;
}

/** 诊断探针用到的极简选择器匹配（标签 / `.class` / `[attr]` / `[attr=value]`）。 */
function matchesSelector(node, selector) {
  if (node === null || node === undefined) return false;
  const text = String(selector).trim();
  if (text === "") return false;
  const classMatch = /\.([A-Za-z0-9_-]+)/.exec(text);
  const attrMatch = /\[([A-Za-z0-9_-]+)(?:=(["']?)([^\]"']*)\2)?\]/.exec(text);
  const tagText = text.replace(/\[[^\]]*\]/g, "").replace(/\.[A-Za-z0-9_-]+/g, "").trim();
  if (tagText !== "" && String(node.tagName).toUpperCase() !== tagText.toUpperCase()) return false;
  if (classMatch !== null) {
    const name = typeof node.className === "string" ? node.className : "";
    if (name.split(/\s+/).indexOf(classMatch[1]) === -1) return false;
  }
  if (attrMatch !== null) {
    const value = typeof node.getAttribute === "function" ? node.getAttribute(attrMatch[1]) : undefined;
    if (value === null || value === undefined) return false;
    if (attrMatch[3] !== undefined && attrMatch[3] !== "" && String(value) !== attrMatch[3]) return false;
  }
  return true;
}

/** 样式表里所有 dsmn- 类都在这里登记，避免样式与组件选择器漂移。 */
function styleTextOf(document) {
  return document.appended
    .filter((node) => node.tagName === "STYLE")
    .map((node) => node.textContent)
    .join("\n");
}

/* ================================================================== *
 * 加载打包产物
 * ================================================================== */

function loadBundle(file, harness = makeHarness()) {
  const code = fs.readFileSync(file, "utf8");
  const loadCalls = [];
  const sandbox = {
    document: harness.document,
    window: {
      __ModuleLoader__: {
        load(registration) {
          loadCalls.push(registration);
        },
      },
      listeners: new Map(),
      addEventListener(type, fn) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const list = this.listeners.get(type) || [];
        const at = list.indexOf(fn);
        if (at >= 0) list.splice(at, 1);
      },
      dispatch(type) {
        const list = (this.listeners.get(type) || []).slice();
        for (const fn of list) fn({});
        return list.length;
      },
    },
    console,
    setTimeout: harness.setTimeout || setTimeout,
    clearTimeout: harness.clearTimeout || clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file });
  assert.equal(loadCalls.length, 1, "bundle must register exactly one module");
  const registration = loadCalls[0];
  assert.equal(registration.id, "dsh-model-navigator");
  const require = (name) => {
    if (name === "react") return harness.React;
    // 只有显式挂了 harness.ReactDOM 的用例才提供 react-dom：默认仍然是「平台种子表里
    // 没有 react-dom」，用来覆盖内联回退路径（见下面的两个浮层渲染测试）。
    if (name === "react-dom" && harness.ReactDOM !== undefined && harness.ReactDOM !== null) return harness.ReactDOM;
    // 同理：默认「平台种子里没有官方 atoms」，用例可显式提供以覆盖复用路径。
    if (name === "@deepseek-ai/dsh-client-ui-primitives" && harness.Primitives !== undefined && harness.Primitives !== null) return harness.Primitives;
    throw new Error(`unexpected require(${JSON.stringify(name)})`);
  };
  const exports = registration.factory(require);
  LAST_INJECT = Array.isArray(exports.inject) ? exports.inject.slice() : null;
  return {
    registration,
    exports,
    window: sandbox.window,
    render: harness.render,
    document: harness.document,
  };
}

/** 去掉注释后再做「是否残留现代语法」的检查。 */
function codeOf(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");
}

/** 把 vm realm 里的值（可能是 Map）转成可跨 realm 比较的普通结构。 */
function plain(value) {
  // vm realm 的 Map 与宿主 realm 的 Map 不同源，因此按形状识别。
  if (value && typeof value.entries === "function" && typeof value.size === "number" && typeof value.get === "function") {
    return Array.from(value.entries()).map((pair) => [pair[0], plain(pair[1])]);
  }
  // 注意用 Array.from：vm realm 的 Array.prototype.map 会把结果继续留在 vm realm，
  // 而 assert.deepStrictEqual 比较原型，跨 realm 数组会被判为「结构相同但引用不等」。
  if (Array.isArray(value)) return Array.from(value, plain);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) out[key] = plain(value[key]);
    return out;
  }
  return value;
}

test("bundle registers the expected module id and exports apply/inject", () => {
  const { exports } = loadBundle(CLIENT);
  assert.equal(typeof exports.apply, "function");
  assert.ok(Array.isArray(exports.inject));
});

test("bundle replaces the model seat without adding a second entry", () => {
  const code = codeOf(fs.readFileSync(CLIENT, "utf8"));
  assert.ok(code.includes("conversation.input.model"), "must use the official model seat");
  assert.ok(!code.includes("name: \"conversation.input.right\""), "must not add another entry");
});

test("generated core is one strict function scope without module syntax", () => {
  // 宿主加载器直接运行现代语法，不再转译；这里只守住「内联后仍是合法脚本」：
  // 所有 src/core 片段都在同一个严格模式 IIFE 里，且不残留 import / export。
  const source = fs.readFileSync(CLIENT, "utf8");
  const open = source.indexOf("var __core = (function () {");
  const start = source.indexOf("/* ==== src/core/identity.mjs");
  const end = source.indexOf("})();", start);
  assert.ok(open > 0 && start > open && end > start, "generated core markers must be present");
  const generated = source.slice(open, end);
  assert.ok(generated.includes('"use strict";'), "core keeps ESM strict semantics");
  for (const name of ["identity", "classify", "search", "sort", "draft", "preferences"]) {
    assert.ok(generated.includes(`/* ==== src/core/${name}.mjs`), `missing inlined ${name}.mjs`);
  }
  assert.doesNotMatch(generated, /^\s*(?:import|export)\s/m, "no module syntax may survive inlining");
  assert.ok(!source.includes("window.__DSH_MODEL_NAVIGATOR_CORE__"), "shipped bundle must not expose the test probe");
});

test("bundle reports the package version in diagnostics", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const { exports, window } = loadBundle(CLIENT);
  exports.apply(fakeCtx().ctx);
  assert.equal(window.__DSMN_DIAG__.version, pkg.version, "build must inject package.json version, not the template placeholder");
});

test("inline __core covers every src/core export", async () => {
  const modules = {
    identity: await import("../src/core/identity.mjs"),
    classify: await import("../src/core/classify.mjs"),
    search: await import("../src/core/search.mjs"),
    sort: await import("../src/core/sort.mjs"),
    draft: await import("../src/core/draft.mjs"),
    preferences: await import("../src/core/preferences.mjs"),
  };
  const { window } = loadBundle(PROBE);
  const core = window.__DSH_MODEL_NAVIGATOR_CORE__;
  assert.ok(core, "__core must be exposed on window for probe builds");

  for (const [name, mod] of Object.entries(modules)) {
    for (const key of Object.keys(mod)) {
      if (key === "default") continue;
      assert.ok(
        Object.prototype.hasOwnProperty.call(core, key),
        `inline __core is missing ${name}.${key}`,
      );
    }
  }
});

test("inline __core matches src/core on a representative catalog", async () => {
  const sortMod = await import("../src/core/sort.mjs");
  const draftMod = await import("../src/core/draft.mjs");
  const classifyMod = await import("../src/core/classify.mjs");
  const searchMod = await import("../src/core/search.mjs");
  const { window } = loadBundle(PROBE);
  const core = window.__DSH_MODEL_NAVIGATOR_CORE__;

  const origin = {
    groups: [
      { id: "vendor-b", label: "Vendor B", models: [{ id: "claude-sonnet", name: "Claude Sonnet" }] },
      {
        id: "deepseek-account",
        label: "DeepSeek",
        models: [
          { id: "deepseek-flash", name: "DeepSeek Flash" },
          { id: "qwen3-max", name: "Qwen3 Max" },
        ],
      },
    ],
  };
  const options = { classify: classifyMod.classifyModel };
  // 跨 realm 的 deepStrictEqual 会因为原型不同而失败，这里比较规范化后的 JSON。
  assert.equal(
    JSON.stringify(plain(core.buildCatalog(origin, options))),
    JSON.stringify(plain(sortMod.buildCatalog(origin, options))),
  );

  const providers = core.buildCatalog(origin, options).providers;
  assert.equal(
    JSON.stringify(plain(core.searchModels(providers, "qwen"))),
    JSON.stringify(plain(searchMod.searchModels(providers, "qwen"))),
  );
  assert.equal(JSON.stringify(core.searchModels(providers, "")), "[]");

  const state = {
    groups: origin.groups.map((group) => ({
      id: group.id,
      label: group.label,
      models: group.models.map((model) => ({
        id: model.id,
        name: model.name,
        reasoning: { efforts: [{ id: "low", name: "Low" }], defaultEffort: "low" },
      })),
    })),
    current: { provider: "deepseek-account", model: "deepseek-flash" },
  };
  const draft = core.createDraft("session-1", state.current, 0);
  assert.equal(
    JSON.stringify(plain(core.resolveDraft(draft, state, {}))),
    JSON.stringify(plain(draftMod.resolveDraft(draft, state, {}))),
  );
  assert.equal(
    JSON.stringify(core.buildSelection("p", "m", "provider-default")),
    JSON.stringify({ provider: "p", model: "m" }),
  );
  assert.equal(
    JSON.stringify(core.buildSelection("p", "m", "low")),
    JSON.stringify({ provider: "p", model: "m", reasoningEffort: "low" }),
  );
});

/* ================================================================== *
 * 运行时 smoke：apply → register → inject → 真的渲染一次
 * ================================================================== */

const SNAPSHOT = {
  current: { provider: "deepseek-account", model: "deepseek-flash" },
  routable: true,
  groups: [
    {
      id: "deepseek-account",
      label: "DeepSeek",
      models: [
        {
          id: "deepseek-flash",
          name: "DeepSeek Flash",
          reasoning: { efforts: [{ id: "low", name: "低" }, { id: "high", name: "高" }], defaultEffort: "low" },
        },
        { id: "deepseek-chat", name: "DeepSeek Chat" },
      ],
    },
    {
      id: "vendor-b",
      label: "Vendor B",
      models: [{ id: "qwen3-max", name: "Qwen3 Max", reasoning: { efforts: [{ id: "low", name: "Low" }] } }],
    },
  ],
  failures: [],
  status: "ready",
};

/**
 * 造一个最小 ctx：只提供模板真正读取的服务。
 * 会记录 register 调用与注入回调，便于断言「只注册 conversation.input.right」。
 */
/**
 * 复刻真实客户端 ctx 的**属性访问门禁**。
 *
 * 0.2.0-rc.2 的 client ctx 只会给「在 inject 里声明过」的服务开放属性访问，
 * 其余名字（哪怕容器里根本没有这个服务）一读就抛
 * `cannot get property "<name>" without inject`；ctx.get/effect/on 是白名单动词。
 * 0.1.0 就是因为在 apply 里读了未声明的 ctx.styles / ctx.locale 而把整个
 * web boot 拖挂的，所以这里必须一致，否则这类缺陷会静默通过。
 * @param options.declared - 覆盖声明列表（默认取最近一次 loadBundle 读到的 inject）。
 * @param options.strictInject - 传 false 可关闭门禁（只用于验证门禁本身的用例）。
 */
function fakeCtx(options = {}) {
  const registrations = [];
  const styles = [];
  const localeRegistrations = [];
  const slotInjectCalls = [];
  const selectCalls = [];
  const inspectRegistrations = [];
  let inspectDisposals = 0;
  const declared = new Set(options.declared ?? LAST_INJECT ?? []);
  const strict = options.strictInject !== false;
  const accesses = [];

  const services = {
    slots: {
      inject(key, callback) {
        slotInjectCalls.push(key);
        callback();
        return () => {};
      },
      register(options_, component) {
        registrations.push({ options: options_, component });
        return () => {};
      },
    },
    sessions: { subagentAddress: () => undefined },
    remote: {
      get session() {
        accesses.push("remote.session");
        if (strict && !declared.has("remote.session")) throw new Error('cannot get property "remote.session" without inject');
        return {};
      },
    },
    modelDirectories: {
      directoryFor: () => {
        // The real resolver reads the calling plugin's remote.session only when
        // constructing a directory. Other pickers can hide a missing dependency.
        if (options.coldDirectory) void ctx.remote.session;
        return ({
        store: {
          subscribe: () => () => {},
          getSnapshot: () => SNAPSHOT,
        },
        load: () => Promise.resolve(SNAPSHOT),
        select: (selection) => { selectCalls.push(selection); return Promise.resolve({ ok: true }); },
        });
      },
    },
    locale: {
      register: (ns, dict) => { localeRegistrations.push([ns, dict]); return () => {}; },
      bind: options.localeBind ?? (() => (key) => key),
    },
    cordisInspect: {
      register(registration) {
        inspectRegistrations.push(registration);
        return () => { inspectDisposals += 1; };
      },
    },
  };

  if (options.withInspect === false) delete services.cordisInspect;
  // SlotCore 读接口（标签槽位 conversation.input.model.label 用）：labelApi:false 模拟没有读接口的宿主。
  const labelSubscribers = [];
  if (options.labelApi !== false) {
    services.slots.entriesOfSlot = (key) => {
      if (options.labelEntriesThrow) throw new Error(`slot "${key}" is not declared`);
      return key === "conversation.input.model.label" ? options.labelEntries ?? [] : [];
    };
    services.slots.subscribe = (_key, fn) => {
      labelSubscribers.push(fn);
      return () => {
        const at = labelSubscribers.indexOf(fn);
        if (at >= 0) labelSubscribers.splice(at, 1);
      };
    };
    services.slots.getVersion = () => options.labelVersion ?? 0;
  }

  const ctx = new Proxy({}, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "then") return undefined;
      if (prop === "get") return (name) => services[name];
      if (prop === "effect") {
        return (callback) => {
          const dispose = callback();
          return typeof dispose === "function" ? dispose : () => {};
        };
      }
      if (prop === "on") return () => () => {};
      accesses.push(prop);
      if (Object.prototype.hasOwnProperty.call(services, prop) && (!strict || declared.has(prop))) return services[prop];
      throw new Error(`cannot get property "${prop}" without inject`);
    },
    set() {
      throw new Error("ctx is read-only");
    },
  });

  return {
    ctx,
    registrations,
    styles,
    localeRegistrations,
    slotInjectCalls,
    selectCalls,
    inspectRegistrations,
    inspectDisposals: () => inspectDisposals,
    declared,
    accesses,
    labelSubscribers,
  };
}

/** 收集渲染树里的 className（渲染器会真的展开函数组件）。 */
function classNames(tree, out = []) {
  if (tree === null || tree === undefined) return out;
  if (Array.isArray(tree)) {
    for (const item of tree) classNames(item, out);
    return out;
  }
  if (typeof tree !== "object") return out;
  if (typeof tree.props.className === "string") out.push(tree.props.className);
  classNames(tree.children, out);
  return out;
}

/** 收集带 data-depth 的行，返回 [{depth, className}]。 */
function depthRows(tree, out = []) {
  if (tree === null || tree === undefined) return out;
  if (Array.isArray(tree)) {
    for (const item of tree) depthRows(item, out);
    return out;
  }
  if (typeof tree !== "object") return out;
  if (tree.props["data-depth"] !== undefined) out.push({ depth: String(tree.props["data-depth"]), className: tree.props.className });
  depthRows(tree.children, out);
  return out;
}

test("apply() registers the model seat at priority -20, with id/locale", () => {
  const { exports, document: fakeDocument } = loadBundle(CLIENT);
  const { ctx, registrations, slotInjectCalls, localeRegistrations, accesses } = fakeCtx();
  exports.apply(ctx);

  assert.deepEqual(slotInjectCalls, ["conversation.input.model", "settings.general.item"]);
  assert.equal(registrations.length, 2);
  assert.equal(registrations[0].options.name, "conversation.input.model");
  assert.equal(registrations[0].options.id, "dsh-model-navigator");
  assert.equal(registrations[0].options.priority, -20);
  assert.equal(registrations[0].options.locale, "model-navigator");
  assert.equal(typeof registrations[0].component, "function");

  // 模型入口只占用 single 槽位，不在 right 槽位增加第二个按钮。
  assert.ok(
    registrations.every((entry) => entry.options.name !== "conversation.input.right"),
    "must not register a second composer entry",
  );

  // 设置行：General 页面里的一项，自带文案与写入路径
  const settings = registrations[1];
  assert.equal(settings.options.name, "settings.general.item");
  assert.equal(settings.options.id, "dsh-model-navigator");
  assert.equal(settings.options.order, 40);
  assert.equal(settings.options.locale, "model-navigator");
  assert.equal(typeof settings.component, "function");
  // 样式：自己插一个 <style data-plugin="dsh-model-navigator">（该版本没有 ctx.styles 服务）
  assert.equal(fakeDocument.appended.length, 1, "styles must be inserted exactly once");
  const styleTag = fakeDocument.appended[0];
  assert.equal(styleTag.tagName, "STYLE");
  assert.equal(styleTag.getAttribute("data-plugin"), "dsh-model-navigator", "宿主按 data-plugin 记账/清理");
  const css = styleTextOf(fakeDocument);
  assert.ok(css.includes(".dsmn_trigger{"), "样式必须真的写进标签里");
  assert.ok(css.includes("--dsw-alias-"), "styles must use theme aliases");
  assert.ok(!css.includes("!important"), "styles must not fight other plugins");
  assert.equal(localeRegistrations.length, 1);
  assert.equal(localeRegistrations[0][0], "model-navigator");

  // 门禁回归：apply 期间访问过的每个属性都必须在 inject 里声明（或属于白名单动词）
  const verbs = new Set(["effect", "on", "get", "provide"]);
  for (const name of accesses) {
    assert.ok(
      verbs.has(name) || exports.inject.includes(name),
      `apply 读了未声明的 ctx.${name}；真实客户端 ctx 会抛 "cannot get property ... without inject" 并拖挂整个 web boot`,
    );
  }
  assert.ok(exports.inject.includes("locale"), "locale 必须声明：apply 与组件都要用它");

  // 卸载路径：effect 的清理函数必须把标签移除
  assert.equal(fakeDocument.removed.length, 0);
  styleTag.remove();
  assert.equal(fakeDocument.appended.length, 0, "dispose 后不应留下样式标签");
});

test("客户端 ctx 门禁自检：未声明的服务名必须抛错，且 apply 不会把异常抛给宿主", () => {
  const { exports } = loadBundle(CLIENT);

  // 1) 门禁本身：即便某个服务真实存在，没声明也读不到
  const strict = fakeCtx({ declared: ["slots"], strictInject: true });
  assert.throws(() => strict.ctx.locale, /cannot get property "locale" without inject/);

  // 2) 关掉门禁后再把插件用到的服务也拿掉，apply 仍然不能抛（否则整个 boot 会失败）
  const bare = fakeCtx({ declared: [], strictInject: false });
  assert.doesNotThrow(() => exports.apply(bare.ctx));
});

test("诊断 provider：ModelNavigatorDiag.probe 注册、只读、结果可 JSON 过线", () => {
  const harness = makeHarness();
  const { exports, document: fakeDocument } = loadBundle(CLIENT, harness);
  const { ctx, inspectRegistrations, slotInjectCalls } = fakeCtx();
  exports.apply(ctx);

  assert.deepEqual(slotInjectCalls, ["conversation.input.model", "settings.general.item"]);
  assert.equal(inspectRegistrations.length, 1, "必须注册一个客户端 inspect provider");
  const provider = inspectRegistrations[0];
  assert.equal(provider.manifest.id, "ModelNavigatorDiag");
  assert.equal(typeof provider.manifest.description, "string");
  assert.deepEqual(plain(provider.manifest.methods.map((method) => method.name)), ["probe"]);
  // schema 形状对齐官方内置 provider（EMPTY_INPUT / ANY_OUTPUT）
  assert.deepEqual(plain(provider.manifest.methods[0].inputSchema), {
    type: "object",
    properties: {},
    additionalProperties: false,
  });
  assert.equal(typeof provider.manifest.methods[0].outputSchema.description, "string");

  // 造一小段输入框右下角的 DOM（探针就靠它证明「那一排到底有没有我们」）
  const trailing = fakeDocument.createElement("div");
  trailing.setAttribute("class", "row");
  const standard = fakeDocument.createElement("div");
  standard.setAttribute("class", "standardControls");
  standard.innerHTML = '<button class="dsmn_trigger">模型导航器</button>';
  const ours = fakeDocument.createElement("div");
  ours.setAttribute("class", "dsmn_root");
  const workbuddy = fakeDocument.createElement("div");
  workbuddy.setAttribute("class", "workbuddy-probe");
  standard.appendChild(ours);
  standard.appendChild(workbuddy);
  trailing.appendChild(standard);
  const trigger = fakeDocument.createElement("button");
  trigger.setAttribute("class", "dsmn_trigger");
  const styleTag = fakeDocument.createElement("style");
  styleTag.setAttribute("data-plugin", "dsh-model-navigator");
  styleTag.textContent = ".dsmn-root{}";
  fakeDocument.head.appendChild(styleTag);
  for (const node of [trailing, standard, ours, workbuddy, trigger]) fakeDocument.attach(node);

  const result = provider.query("probe", null, {});
  assert.equal(result.dom.ok, true, "有 document 时必须给出现场 DOM 摘要");
  assert.equal(result.dom.standardControls.className, "standardControls");
  assert.equal(result.dom.standardControlsChildren.length, 2);
  assert.equal(result.dom.triggerCount, 1);
  assert.equal(result.dom.rootCount, 1);
  assert.equal(result.dom.trailing.className, "row");
  assert.ok(result.dom.stylePlugins.includes("dsh-model-navigator"));
  assert.equal(result.diag.plugin, "dsh-model-navigator");
  assert.equal(result.diag.composer.injectCalls, 0, "本用例没有渲染入口，计数必须是 0");
  assert.ok(Array.isArray(result.diag.errors));

  // 只读：再查一次结果相同，且必须能被 JSON 序列化（inspect 只走 JSON 通道）
  assert.deepEqual(plain(provider.query("probe", null, {})), plain(result));
  assert.ok(JSON.parse(JSON.stringify(result)).dom.ok);
});

test("cordisInspect 服务缺失时插件照常激活，只在诊断里记一笔", () => {
  const harness = makeHarness();
  const { exports, window } = loadBundle(CLIENT, harness);
  const { ctx, registrations, inspectRegistrations } = fakeCtx({ withInspect: false });
  assert.doesNotThrow(() => exports.apply(ctx));
  assert.equal(registrations.length, 2, "缺诊断服务不能影响正常注册");
  assert.equal(inspectRegistrations.length, 0);
  const diag = window.__DSMN_DIAG__;
  assert.ok(diag, "window.__DSMN_DIAG__ 必须留给用户自证");
  assert.match(String(diag.inspect.error), /unavailable/);
  assert.equal(diag.inspect.registered, false);
});

test("inject(sessionId) returns an identity-stable face", () => {
  const { exports } = loadBundle(CLIENT);
  const { ctx, registrations } = fakeCtx();
  exports.apply(ctx);
  const options = registrations[0].options;

  const first = options.inject("session-1");
  const second = options.inject("session-1");
  assert.equal(first, second, "face must be cached per session (renderer caches by binding identity)");
  assert.notEqual(first, options.inject("session-2"));

  assert.equal(first.sessionId, "session-1");
  assert.equal(first.available, true);
  assert.equal(typeof first.load, "function");
  assert.equal(typeof first.select, "function");
  assert.equal(typeof first.t, "function");
  assert.equal(typeof first.store.getPreferences, "function");
  assert.equal(typeof first.directory.getSnapshot, "function");
});

test("first picker can resolve a cold directory without a Codex or WorkBuddy consumer", () => {
  const { exports, render } = loadBundle(CLIENT);
  const { ctx, registrations } = fakeCtx({ coldDirectory: true });
  exports.apply(ctx);
  const registration = registrations[0];
  const face = registration.options.inject("cold-session");
  assert.equal(face.available, true, String(face.lastError));
  assert.equal(face.reason, null);
  let tree = render(registration.component(face));
  const trigger = findElement(tree, n => n.props.className === "dsmn_trigger");
  assert.equal(trigger.props.disabled, false);
  trigger.props.onClick();
  tree = render(registration.component(face));
  assert.ok(findElement(tree, n => n.props.role === "menu"));
});

test("a cached directory can mask missing wire dependencies but a cold one cannot", () => {
  const { exports } = loadBundle(CLIENT);
  const declared = exports.inject.filter(name => name !== "remote" && name !== "remote.session");
  const warm = fakeCtx({ declared });
  exports.apply(warm.ctx);
  assert.equal(warm.registrations[0].options.inject("warm").available, true);
  const cold = fakeCtx({ declared, coldDirectory: true });
  exports.apply(cold.ctx);
  assert.equal(cold.registrations[0].options.inject("cold").available, false);
});

test("inject() degrades to unavailable when the session is a subagent address", () => {
  const { exports } = loadBundle(CLIENT);
  const { ctx, registrations } = fakeCtx();
  ctx.sessions.subagentAddress = () => "subagent:1";
  exports.apply(ctx);
  const options = registrations[0].options;

  const face = options.inject("session-9");
  assert.equal(face.available, false);
  assert.equal(face.directory, null, "must not touch modelDirectories for an addressed subagent");
  assert.equal(options.inject("session-9"), face);
});

test("子会话不占位（reason=subagent-session → null），但必须在 DIAG 里留痕", () => {
  const harness = makeHarness();
  const { exports, render, window } = loadBundle(CLIENT, harness);
  const { ctx, registrations } = fakeCtx();
  ctx.sessions.subagentAddress = () => "subagent:1";
  exports.apply(ctx);

  const face = registrations[0].options.inject("session-9");
  assert.equal(face.reason, "subagent-session");
  const tree = render(registrations[0].component({ ...face, t: (key) => key, locked: false }));
  assert.equal(tree, null, "子会话不渲染任何东西");
  assert.equal(window.__DSMN_DIAG__.composer.subagentSkips, 1, "静默也要留痕，便于事后定位");
});

test("触发器标题显示宿主的模型名（宿主目录字段是 name，不是 originalName）", () => {
  const { exports, render } = loadBundle(CLIENT);
  const { ctx, registrations } = fakeCtx();
  exports.apply(ctx);
  const face = registrations[0].options.inject("session-1");
  const tree = render(registrations[0].component({ ...face, t: (key) => key, locked: false }));

  const label = findElement(tree, (node) => node.props.className === "dsmn_triggerLabel");
  assert.ok(label, "触发器标题必须存在");
  // 回归点：0.1.1/0.1.2 早期只读 alias/originalName，而宿主目录里模型对象就是
  // { id, name, reasoning } —— 标题取到 undefined，渲染成空字符串，
  // 入口只剩一个空药丸，用户报告「看不到入口」。
  assert.equal(textOf(label), "DeepSeek Flash", "触发器必须显示宿主给的模型名");
  const trigger = findElement(tree, (node) => node.props.className === "dsmn_trigger");
  assert.match(textOf(trigger), /^DeepSeek Flash/);
  assert.match(textOf(trigger), /低/, "档位文案来自宿主元数据（defaultEffort=low → 低）");
});

test("触发器标题兼容只给 modelName 的宿主目录对象", () => {
  const { exports, render } = loadBundle(CLIENT);
  const { ctx, registrations } = fakeCtx();
  const base = ctx.modelDirectories.directoryFor;
  const alt = {
    ...SNAPSHOT,
    groups: [
      {
        id: "deepseek-account",
        label: "DeepSeek",
        models: [{ id: "deepseek-flash", modelName: "Flash 别名", reasoning: { efforts: [{ id: "low", name: "低" }] } }],
      },
    ],
  };
  ctx.modelDirectories.directoryFor = (sessionId) => {
    const resolved = base(sessionId);
    return { ...resolved, store: { subscribe: () => () => {}, getSnapshot: () => alt } };
  };
  exports.apply(ctx);
  const face = registrations[0].options.inject("session-1");
  const tree = render(registrations[0].component({ ...face, t: (key) => key, locked: false }));
  const label = findElement(tree, (node) => node.props.className === "dsmn_triggerLabel");
  assert.equal(textOf(label), "Flash 别名");
});

test("inject() 解析失败时渲染可见占位并可重试（0.1.1 曾静默 return null）", () => {
  const harness = makeHarness();
  const { exports, render } = loadBundle(CLIENT, harness);
  const { ctx, registrations } = fakeCtx();
  const realDirectoryFor = ctx.modelDirectories.directoryFor;
  ctx.modelDirectories.directoryFor = () => { throw new Error("session resolved no binding"); };
  exports.apply(ctx);
  const options = registrations[0].options;

  const face = options.inject("session-3");
  assert.equal(face.available, false);
  assert.equal(face.directory, null);
  assert.equal(face.reason, "directory-unavailable");

  // 回归点：0.1.1 在这里返回 null → 入口永久静默消失（且没有任何日志）。
  const pending = render(registrations[0].component({ ...face, t: (key) => key, locked: false }));
  assert.ok(pending, "解析失败也必须渲染出可见的东西");
  assert.equal(pending.props.className, "dsmn_root");
  const placeholder = findElement(pending, (node) => node.props.className === "dsmn_trigger");
  assert.ok(placeholder, "占位药丸必须存在");
  assert.equal(placeholder.props["aria-disabled"], "true");
  assert.notEqual(placeholder.props.disabled, true, "占位必须可点：点一下就是一次手动重试");
  assert.match(String(placeholder.props.title), /directory-unavailable/);
  assert.match(String(placeholder.props.title), /session resolved no binding/);

  // 目录稍后就绪：点占位重试 → 同一个 face 原地补齐 → 下一次渲染就是真正的入口
  ctx.modelDirectories.directoryFor = realDirectoryFor;
  placeholder.props.onClick();
  assert.equal(face.available, true);
  const ready = render(registrations[0].component({ ...face, t: (key) => key, locked: false }));
  const real = findElement(ready, (node) => node.props.className === "dsmn_trigger");
  assert.ok(real, "解析成功后必须渲染真正的触发器");
  assert.notEqual(real.props["aria-disabled"], "true");
  assert.notEqual(real.props.disabled, true);
});

test("0.1.6 回归：重试成功后组件用 live 状态恢复，旧 props 快照也不再渲染占位（0.1.5 曾无限重试）", () => {
  // 0.1.5 的缺陷：resolve() 只补齐 face 对象本身，组件收到的 props 是宿主 inject 时
  // 拍下的旧快照；setTick 重放旧 props → 永远渲染占位 → effect 里的 setTimeout(retry)
  // 无限循环（真实页面累计 27927 渲染 / 27867 占位）。0.1.6 起重试成功后把 face 的
  // 最新值写进组件 state（props.resolve.__dsmn_face），旧 props 也能渲染出真正入口。
  const harness = makeHarness();
  const { exports, render } = loadBundle(CLIENT, harness);
  const { ctx, registrations } = fakeCtx();
  const realDirectoryFor = ctx.modelDirectories.directoryFor;
  ctx.modelDirectories.directoryFor = () => { throw new Error("session resolved no binding"); };
  exports.apply(ctx);
  const options = registrations[0].options;

  const face = options.inject("session-3");
  assert.equal(face.available, false);
  const pending = render(registrations[0].component({ ...face, t: (key) => key, locked: false }));
  const placeholder = findElement(pending, (node) => node.props.className === "dsmn_trigger");
  assert.ok(placeholder, "占位药丸必须存在");

  // 目录就绪：点占位重试。注意组件 props 仍然是旧快照——这正是 0.1.5 的死循环入口。
  ctx.modelDirectories.directoryFor = realDirectoryFor;
  placeholder.props.onClick();
  assert.equal(face.available, true, "face 必须被原地补齐");

  // 关键回归点：构造一份「directory 仍为 null」的陈旧 props 重渲染，
  // 0.1.5 会渲染占位；0.1.6 借 live 状态渲染真正的入口。
  const staleProps = { ...face, t: (key) => key, locked: false, directory: null, available: false, reason: "directory-unavailable" };
  const after = render(registrations[0].component(staleProps));
  const real = findElement(after, (node) => node.props.className === "dsmn_trigger");
  assert.ok(real, "旧 props 快照下也必须渲染出触发器");
  assert.notEqual(String(real.props["aria-disabled"]), "true", "不得再是禁用占位——占位循环已被打破");
});

test("ModelNavigator renders a closed trigger without throwing", () => {
  const harness = makeHarness();
  const { exports, render } = loadBundle(CLIENT, harness);
  const { ctx, registrations } = fakeCtx();
  exports.apply(ctx);
  const face = registrations[0].options.inject("session-1");

  const tree = render(registrations[0].component({ ...face, t: (key) => key, locked: false }));
  assert.ok(tree, "component must render");
  assert.equal(tree.type, "div");
  assert.equal(tree.props.className, "dsmn_root");
  const names = classNames(tree);
  assert.ok(names.includes("dsmn_trigger"), "trigger must render");
  assert.ok(!names.includes("dsmn_menu"), "popover must stay closed");
});

/**
 * 测试用翻译器：默认回显 key，但把会影响「按文字定位供应商行」的词条换成可读文案。
 * `deepseek-account` 按官方行为走本地化词条（官方 MenuGroup 也是硬编码这一条）。
 */
const T = (key) =>
  key === "providerAccount" ? "DeepSeek 账户" : key === "familyOther" ? "其他" : key;

test("两级流程：root 的「模型」cell 点模型即切换；「思维强度」cell 原样提交 reasoningEffort", async () => {
  const f = navigatorFixture();
  let tree = f.open();
  assert.equal(paneOf(tree), "root", "当前选择可寻址时先进 root（与官方一致）");
  assert.deepEqual(collectElements(tree, n => typeof n.props["data-cell"] === "string").map(n => n.props["data-cell"]), ["model", "effort"]);
  assert.match(textOf(findElement(tree, n => n.props["data-cell"] === "model")), /DeepSeek Flash/);
  assert.match(textOf(findElement(tree, n => n.props["data-cell"] === "effort")), /低/, "未指定档位时显示模型默认档");

  findElement(tree, n => n.props["data-cell"] === "effort").props.onClick();
  tree = f.draw();
  assert.equal(paneOf(tree), "effort");
  const levels = collectElements(tree, n => n.props["data-depth"] === "4");
  assert.equal(levels.length, 2, "deepseek-flash 公布了 low/high 两档");
  assert.equal(levels[0].props["aria-checked"], "true", "勾选生效中的默认档");
  findElement(tree, n => n.props["data-depth"] === "4" && textOf(n).includes("高")).props.onClick();
  await flush();
  assert.deepEqual(plain(f.selectCalls), [{ provider: "deepseek-account", model: "deepseek-flash", reasoningEffort: "high" }], "提交必须携带真实档位");
  assert.equal(paneOf(f.draw()), null, "成功后关闭");

  f.chooseChat().props.onClick();
  await flush();
  assert.deepEqual(plain(f.selectCalls)[1], { provider: "deepseek-account", model: "deepseek-chat" }, "没有档位的模型点击即切换");
});

test("0.1.3 回归：供应商标题取宿主的 name；按厂商分桶；未识别的进「其他」；单家族平铺", () => {
  // 与 宿主 WorkBuddy 目录快照 同形：宿主的组显示名在 `name` 上，
  // 模型名里已经带上了计费与促销后缀（由 workbuddy 宿主自己拼好）。
  const WORKBUDDY = {
    current: { provider: "workbuddy", model: "hy4-preview" },
    routable: true,
    status: "ready",
    failures: [],
    groups: [
      {
        id: "workbuddy",
        name: "WorkBuddy",
        models: [
          { id: "hy4-preview", name: "Hy4 preview · x0.29 · 夜间免费" },
          { id: "hy3", name: "Hy3 · x0.00 · 限时免费" },
          { id: "glm-5.3", name: "GLM-5.3" },
          { id: "kimi-k3-1", name: "Kimi-K3.1" },
          { id: "minimax-m3", name: "MiniMax-M3" },
          { id: "space-bunny", name: "Space-Bunny" },
        ],
      },
      {
        id: "deepseek-account",
        name: "DeepSeek Account",
        models: [{ id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" }],
      },
    ],
  };
  const f = navigatorFixture({ directory: staticDirectory(WORKBUDDY) });
  f.expandProviders("deepseek-account");
  const tree = f.openModels();
  const groupTitle = (section) => textOf(findElement(findElement(section, n => String(n.props.className).includes("dsmn_menuGroupLabel")), n => n.props.className === "dsmn_groupLabelText"));

  // 缺陷 A：组显示名必须取 `name`（0.1.2 读不存在的 `label` → 回退到裸 id）
  const workbuddy = sectionOf(tree, "provider", "workbuddy");
  assert.ok(workbuddy, "两个供应商都要出现");
  assert.equal(groupTitle(workbuddy), "WorkBuddy", "供应商标题必须用宿主给的 group.name");

  // 官方对 deepseek-account 硬编码本地化词条，我们跟随
  const account = sectionOf(tree, "provider", "deepseek-account");
  assert.equal(groupTitle(account), "DeepSeek 账户");

  // 缺陷 B：家族标题必须是家族名；无法识别的进「其他」，绝不能拿模型 ID 当标题
  const families = collectElements(workbuddy, n => n.props["data-depth"] === "2")
    .map(n => textOf(findElement(n, c => c.props.className === "dsmn_groupLabelText")));
  for (const label of ["Hunyuan", "GLM", "Kimi", "MiniMax", "其他"]) {
    assert.ok(families.includes(label), `家族标题必须出现：${label}`);
  }
  assert.ok(!families.some(label => label.includes("hy4-preview")), "家族标题绝不能是模型 ID（0.1.2 的「hy4-preview 8 个模型」）");

  // 模型行显示宿主的 name（计费/促销后缀由宿主拼好），完整 ID 走 title
  const hy4 = findElement(workbuddy, n => n.props["data-depth"] === "3" && textOf(n).includes("Hy4 preview · x0.29 · 夜间免费"));
  assert.ok(hy4, "模型行必须原样显示宿主的 name");
  assert.equal(hy4.props.title, "Hy4 preview · x0.29 · 夜间免费 (hy4-preview)", "title 带上完整模型 ID");

  // 计划 §5.6：只有一个普通家族的供应商平铺，不出现家族标题
  assert.equal(collectElements(account, n => n.props["data-depth"] === "2").length, 0, "单家族供应商必须平铺");
  assert.equal(collectElements(account, n => n.props["data-depth"] === "3").length, 1, "deepseek-account 只应有一行模型");
});

test("S01：从模型行打开思维强度页后点菜单外部取消 → 0 次选择写入", async () => {
  const f = navigatorFixture();
  const tree = f.openModels();
  findElement(tree, n => n.props["data-action"] === "open-effort" && n.props["data-model-id"] === "deepseek-flash").props.onClick();
  assert.equal(collectElements(f.draw(), n => n.props["data-depth"] === "4").length, 2, "思维档位应已展开");
  // 新面板没有关闭按钮，官方靠 Esc/外点
  f.document.dispatch("pointerdown", { target: { nodeName: "BODY" } });
  await Promise.resolve();
  assert.equal(paneOf(f.draw()), null, "外部点击关闭菜单");
  assert.equal(f.selectCalls.length, 0, "取消不得写模型");
  assert.deepEqual(plain(f.props.directory.getSnapshot().current), { provider: "deepseek-account", model: "deepseek-flash" }, "取消不得改当前选择");
});

test("UI09/S01：Esc 与外部点击取消都不提交，并释放文档监听", async () => {
  const harness = makeHarness();
  const { exports, render, document: fakeDocument } = loadBundle(CLIENT, harness);
  const { ctx, registrations, selectCalls } = fakeCtx();
  exports.apply(ctx);
  const face = registrations[0].options.inject("session-1");
  const props = { ...face, t: (key) => key, locked: false };

  const closed = render(registrations[0].component(props));
  findElement(closed, (node) => node.props.className === "dsmn_trigger").props.onClick();
  let tree = render(registrations[0].component(props));
  assert.equal(fakeDocument.countOf("keydown"), 1, "打开后必须挂一次 keydown 监听");

  fakeDocument.dispatch("keydown", { key: "Escape" });
  await Promise.resolve();
  tree = render(registrations[0].component(props));
  assert.ok(!findElement(tree, (node) => node.props.className === "dsmn_menu"), "Esc 必须关闭菜单");
  assert.equal(selectCalls.length, 0, "Esc 不得提交模型");
  assert.equal(fakeDocument.countOf("keydown"), 0, "关闭后必须移除监听（不泄漏）");

  // 再次打开 → 外部 pointerdown 关闭
  findElement(tree, (node) => node.props.className === "dsmn_trigger").props.onClick();
  tree = render(registrations[0].component(props));
  assert.equal(fakeDocument.countOf("pointerdown"), 1);
  fakeDocument.dispatch("pointerdown", { target: { nodeName: "BODY" } });
  await Promise.resolve();
  tree = render(registrations[0].component(props));
  assert.ok(!findElement(tree, (node) => node.props.className === "dsmn_menu"), "外部点击必须关闭菜单");
  assert.equal(selectCalls.length, 0, "外部点击不得提交模型");
  assert.equal(fakeDocument.countOf("pointerdown"), 0, "关闭后必须移除监听（不泄漏）");
});

test("ModelNavigator returns null when the user disables the plugin", () => {
  const harness = makeHarness({
    useSyncExternalStore() {
      return {
        enabled: false,
        grouping: "channel-first",
        showSearch: true,
        providerPins: [],
        favorites: [],
        modelOverrides: [],
        rules: [],
        collapsedFamilies: {},
      };
    },
  });
  const { exports, render } = loadBundle(CLIENT, harness);
  const { ctx, registrations } = fakeCtx();
  exports.apply(ctx);
  const face = registrations[0].options.inject("session-1");
  assert.equal(render(registrations[0].component({ ...face, t: (key) => key })), null);
});

test("ModelNavigator tolerates a null DIRECTORY snapshot (load not finished)", () => {
  const harness = makeHarness();
  const { exports, render } = loadBundle(CLIENT, harness);
  const { ctx, registrations } = fakeCtx();
  ctx.modelDirectories.directoryFor = () => ({
    store: { subscribe: () => () => {}, getSnapshot: () => null },
    load: () => Promise.resolve(null),
    select: () => Promise.resolve({ ok: true }),
  });
  exports.apply(ctx);
  const face = registrations[0].options.inject("session-1");
  const props = { ...face, t: (key) => key };

  const closed = render(registrations[0].component(props));
  assert.ok(closed, "must still render a trigger while the catalog loads");
  const trigger = findElement(closed, (node) => node.props.className === "dsmn_trigger");
  assert.ok(trigger, "trigger must render with a null snapshot");
  trigger.props.onClick();

  const opened = render(registrations[0].component(props));
  const notes = findElement(opened, (node) => node.props.className === "dsmn_status");
  assert.ok(notes, "must show a loading note instead of crashing");
  assert.equal(textOf(notes), "loading");
  assert.equal(depthRows(opened).length, 0, "must not invent rows without a snapshot");
});

/** 把一棵元素树里的文本拼起来，用于按文案找行。 */
function textOf(tree, out = []) {
  if (tree === null || tree === undefined || typeof tree === "boolean") return out.join("");
  if (Array.isArray(tree)) {
    for (const item of tree) textOf(item, out);
    return out.join("");
  }
  if (typeof tree !== "object") return out.push(String(tree)), out.join("");
  for (const child of tree.children === undefined ? [] : tree.children) textOf(child, out);
  return out.join("");
}

/** 在渲染树里找第一个满足条件的元素。 */
function findElement(tree, predicate) {
  if (tree === null || tree === undefined) return null;
  if (Array.isArray(tree)) {
    for (const item of tree) {
      const hit = findElement(item, predicate);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (typeof tree !== "object") return null;
  if (predicate(tree)) return tree;
  return findElement(tree.children, predicate);
}


test("偏好写入路径对单个对象展开也安全（__merge 两参回归）", () => {
  const { exports } = loadBundle(CLIENT);
  const { ctx, registrations } = fakeCtx();
  exports.apply(ctx);
  const face = registrations[0].options.inject("session-1");

  face.store.rememberSelection({ provider: "deepseek-account", model: "deepseek-flash" });
  assert.equal(face.store.getPreferences().lastProviderId, "deepseek-account");
  assert.equal(face.store.getPreferences().lastModelByProvider["deepseek-account"], "deepseek-flash");

  face.store.rememberSelection({ provider: "vendor-b", model: "qwen3-max" });
  assert.deepEqual(
    JSON.parse(JSON.stringify(face.store.getPreferences().lastModelByProvider)),
    { "deepseek-account": "deepseek-flash", "vendor-b": "qwen3-max" },
    "逐键合并而不是覆盖",
  );

  face.store.patch({ collapsedFamilies: { "vendor-b\u0000qwen": true } });
  face.store.patch({ collapsedFamilies: { "vendor-b\u0000gpt": true } });
  assert.deepEqual(
    JSON.parse(JSON.stringify(face.store.getPreferences().collapsedFamilies)),
    { "vendor-b\u0000qwen": true, "vendor-b\u0000gpt": true },
  );

});

test("内联 core 的对象展开路径在产物里照常工作（0.1.x __merge 回归）", () => {
  const { window } = loadBundle(PROBE);
  const core = window.__DSH_MODEL_NAVIGATOR_CORE__;
  assert.ok(core, "__core must be exposed on window for probe builds");

  // 这些路径内部会产出 `{ ...x }` 形式的单展开。
  assert.equal(core.patchPreferences(null, { enabled: false }).enabled, false);
  assert.equal(core.normalizePreferences(undefined).schemaVersion, 1);
  const draft = core.createDraft("s", null, 0);
  assert.ok(core.resolveDraft(draft, null, { connectionGeneration: 0 }));
});

/** 收集所有满足条件的元素（findElement 只返回第一个）。 */
function collectElements(tree, predicate, out = []) {
  if (tree === null || tree === undefined) return out;
  if (Array.isArray(tree)) {
    for (const item of tree) collectElements(item, predicate, out);
    return out;
  }
  if (typeof tree !== "object") return out;
  if (predicate(tree)) out.push(tree);
  collectElements(tree.children, predicate, out);
  return out;
}

test("设置行渲染出自带文案与控件，并可切换开关/分组/搜索", () => {
  const harness = makeHarness();
  const { exports, render } = loadBundle(CLIENT, harness);
  const { ctx, registrations } = fakeCtx();
  exports.apply(ctx);

  const settings = registrations[1];
  const face = settings.options.inject();
  assert.equal(settings.options.inject(), face, "设置 face 必须身份稳定");

  // fakeCtx 的 locale.bind 是恒等函数（t("x") === "x"），这里换成可读词条以断言「文案由插件自带」。
  const words = {
    title: "模型导航器",
    settingsHint: "三级模型选择器",
    settingsEnabled: "在输入框显示导航器",
    settingsGrouping: "模型排列",
    groupingOff: "宿主顺序",
    groupingChannel: "按家族分组",
    groupingFamily: "家族固定顺序",
    settingsShowSearch: "显示搜索框",
    settingsStorage: "偏好存储",
    storageLocal: "偏好：本机浏览器存储",
    storageMemory: "偏好：仅本次运行有效",
    settingsOn: "开",
    settingsOff: "关",
  };
  const t = (key) => (words[key] === undefined ? key : words[key]);

  const tree = render(settings.component({ ...face, t }));
  const names = classNames(tree);
  assert.ok(names.includes("dsmn-setting"), "设置行必须渲染自己的容器");
  assert.ok(textOf(tree).includes("模型导航器"), "标题由插件自带（不依赖设置面板投影 label）");
  assert.ok(textOf(tree).includes("按家族分组"), "分组选项必须可见");
  // 测试环境没有 localStorage → 内存层，必须如实显示而不是假装持久化
  assert.ok(textOf(tree).includes("偏好：仅本次运行有效"), "持久化层级必须可见");
  assert.equal(face.store.getTier(), "memory");

  // 开关：第一个 role=switch 控制 enabled
  const switches = collectElements(tree, (node) => node.props.role === "switch");
  assert.equal(switches.length, 2, "启用开关 + 搜索开关");
  assert.equal(switches[0].props["aria-checked"], "true", "默认启用");
  switches[0].props.onClick();
  assert.equal(face.store.getPreferences().enabled, false, "关闭后写入偏好");
  switches[1].props.onClick();
  assert.equal(face.store.getPreferences().showSearch, false);

  // 分组：三个按钮，点击写入 grouping
  const choices = collectElements(tree, (node) => node.props.className === "dsmn-choice");
  assert.equal(choices.length, 3);
  choices[2].props.onClick();
  assert.equal(face.store.getPreferences().grouping, "family-first");

  // 关闭 enabled 后，composer 触发器整段不渲染（不占位）
  const composer = registrations[0];
  const composerFace = composer.options.inject("session-1");
  const closed = render(composer.component({ ...composerFace, t: (key) => key }));
  assert.equal(closed, null, "enabled=false 时导航器完全不渲染");
});

/* ================================================================== *
 * 0.1.4：触发器以「宿主公布的当前选择」为准（用户截图：我们的药丸显示
 * Kimi-K3，旁边原生药丸显示 DeepSeek-V41-Flash），以及家族折叠的回归。
 * ================================================================== */

const TWO_PROVIDER_SNAPSHOT = () => ({
  current: { provider: "workbuddy", model: "hy4-preview" },
  routable: true,
  status: "ready",
  failures: [],
  groups: [
    {
      id: "workbuddy",
      name: "WorkBuddy",
      models: [
        { id: "hy4-preview", name: "Hy4 preview · x0.29 · 夜间免费" },
        { id: "glm-5.3", name: "GLM-5.3" },
        { id: "kimi-k3-1", name: "Kimi-K3.1" },
        { id: "minimax-m3", name: "MiniMax-M3" },
      ],
    },
    {
      id: "deepseek-account",
      name: "DeepSeek Account",
      models: [{ id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" }],
    },
  ],
});

test("0.1.4 回归：触发器显示宿主当前选择；不可寻址时显示自己的 ID 并标注", () => {
  const harness = makeHarness();
  const { exports, render, window } = loadBundle(CLIENT, harness);
  const { ctx, registrations } = fakeCtx();
  exports.apply(ctx);
  const face = registrations[0].options.inject("session-1");

  const snapshot = TWO_PROVIDER_SNAPSHOT();
  snapshot.current = { provider: "workbuddy", model: "ghost-model" };
  const directory = { subscribe: () => () => {}, getSnapshot: () => snapshot };
  const props = { ...face, directory, t: (key) => key, locked: false };

  const label = () => {
    const trigger = findElement(
      render(registrations[0].component(props)),
      (node) => node.props.className === "dsmn_triggerLabel",
    );
    assert.ok(trigger, "触发器标题必须渲染");
    return textOf(trigger);
  };

  // 宿主当前模型不在目录里：草稿解析会退到目录第一个模型（Hy4 preview），
  // 触发器不得跟着显示别人的名字。
  assert.equal(label(), "ghost-model");
  assert.ok(!label().includes("Hy4"), "绝不能显示回退选中的别的模型");

  // 打开面板：标注「当前模型不在本目录中」，目录里的行照常可选；菜单必须内联渲染
  // （测试环境没有 react-dom → CAN_PORTAL=false，走回退路径）。
  const closed = render(registrations[0].component(props));
  findElement(closed, (node) => node.props.className === "dsmn_trigger").props.onClick();
  const opened = render(registrations[0].component(props));
  assert.ok(
    findElement(opened, (node) => textOf(node) === "currentOutsideghost-model"),
    "面板必须标注当前模型不在本目录中",
  );
  assert.ok(
    findElement(opened, (node) => node.props["data-section"] === "provider" && node.props["data-provider-id"] === "workbuddy"),
    "目录里的供应商照常可选",
  );
  assert.ok(
    findElement(opened, (node) => String(node.props.className).includes("dsmn_menu")),
    "拿不到 react-dom 时必须退回内联渲染",
  );

  // 宿主当前模型在目录里：显示目录里的名字，且不再有额外标注
  snapshot.current = { provider: "deepseek-account", model: "deepseek-v4-pro" };
  assert.equal(label(), "DeepSeek-V4-Pro");
  const opened2 = render(registrations[0].component(props));
  assert.equal(
    findElement(opened2, (node) => String(node.props.className).includes("dsmn_status") && textOf(node).startsWith("currentOutside")),
    null,
    "可寻址时不得出现「不在目录中」的标注",
  );

  // 诊断字段：区分「我们显示错了」与「别的入口没刷新」
  const diag = window.__DSMN_DIAG__.selection;
  assert.ok(diag, "window.__DSMN_DIAG__.selection 必须留下现场");
  assert.equal(diag.current.model, "deepseek-v4-pro");
  assert.equal(diag.trigger.label, "DeepSeek-V4-Pro");
  assert.equal(diag.trigger.addressable, true);
  assert.equal(typeof diag.resolved.fromDraft, "boolean", "resolved 是否来自草稿必须是布尔现场");
});

test("0.1.5：家族默认折叠，只默认展开当前选择所在的那一族（显式状态优先）", () => {
  // TWO_PROVIDER_SNAPSHOT 的当前选择是 workbuddy/hy4-preview → 当前家族是 Hunyuan。
  const f = navigatorFixture({ directory: staticDirectory(TWO_PROVIDER_SNAPSHOT()), t: (key) => key });
  let tree = f.openModels();

  const section = () => sectionOf(tree, "provider", "workbuddy");
  const headers = () => collectElements(section(), (node) => String(node.props.className).includes("dsmn_groupToggle"));
  const stateOf = (label) => {
    const hit = headers().find((node) => textOf(node).includes(label));
    return hit === undefined ? null : hit.props["aria-expanded"];
  };
  const modelsVisible = () => collectElements(section(), (node) => node.props["data-depth"] === "3").length;

  // 用户反馈：一点开就是全展开的，看着繁杂。现在默认只有「当前那一族」开着。
  assert.equal(stateOf("Hunyuan"), "true", "当前选择所在家族默认展开");
  for (const label of ["GLM", "Kimi", "MiniMax"]) {
    assert.equal(stateOf(label), "false", `默认折叠：${label}`);
  }
  assert.equal(modelsVisible(), 1, "默认只渲染已展开家族的模型行（当前家族 Hunyuan 只有 hy4-preview 一个）");

  // 显式折叠「当前家族」：用户说了算，默认展开必须让位
  headers().find((node) => textOf(node).includes("Hunyuan")).props.onClick();
  assert.equal(f.face.store.getPreferences().collapsedFamilies["workbuddy\u0000hunyuan"], true, "显式折叠写 true");
  tree = f.draw();
  assert.equal(stateOf("Hunyuan"), "false", "显式折叠后即便它是当前家族也收起");
  assert.equal(modelsVisible(), 0, "全部折叠时一行模型都不渲染");

  // 显式展开一个「非当前家族」
  headers().find((node) => textOf(node).includes("Kimi")).props.onClick();
  assert.equal(f.face.store.getPreferences().collapsedFamilies["workbuddy\u0000kimi"], false, "显式展开写 false");
  tree = f.draw();
  assert.equal(stateOf("Kimi"), "true", "显式展开后该家族打开");
  assert.equal(modelsVisible(), 1, "只多出 Kimi 家族的模型行");
  assert.ok(
    findElement(section(), (node) => node.props["data-depth"] === "3" && textOf(node).includes("Kimi-K3.1")),
    "展开的家族必须能看到模型行",
  );
});

test("0.1.4 回归：家族折叠写入偏好 collapsedFamilies，可折叠可再展开", () => {
  const f = navigatorFixture({ directory: staticDirectory(TWO_PROVIDER_SNAPSHOT()), t: (key) => key });
  let tree = f.openModels();

  const headers = () => collectElements(tree, (node) => String(node.props.className).includes("dsmn_groupToggle"));
  const kimiHeader = () => headers().find((node) => textOf(node).includes("Kimi"));
  assert.ok(headers().length >= 2, "多家族时每个家族一个折叠头");
  assert.ok(kimiHeader(), "必须找到 Kimi 家族的折叠头");
  // Kimi 不是当前家族（当前是 Hunyuan）→ 默认折叠
  assert.equal(kimiHeader().props["aria-expanded"], "false", "默认折叠");
  assert.equal(findElement(tree, (node) => textOf(node).includes("Kimi-K3.1")), null, "默认折叠时该家族的模型行不可见");

  kimiHeader().props.onClick();
  // 注意：store 跑在 vm realm 里，跨 realm 的 deepStrictEqual 会因原型不同而失败，
  // 这里按 key/value 断言（与其它偏好断言一致）。
  const expanded = f.face.store.getPreferences().collapsedFamilies;
  assert.deepEqual(Object.keys(expanded), ["workbuddy\u0000kimi"], "只记下这一族的折叠状态");
  assert.equal(expanded["workbuddy\u0000kimi"], false, "显式展开写 false 进偏好（逐键合并）");
  tree = f.draw();
  assert.equal(kimiHeader().props["aria-expanded"], "true", "展开后 aria-expanded=true");
  assert.ok(findElement(tree, (node) => textOf(node).includes("Kimi-K3.1")), "展开后家族里的模型行必须可见");

  kimiHeader().props.onClick();
  assert.equal(f.face.store.getPreferences().collapsedFamilies["workbuddy\u0000kimi"], true, "再点一次必须写回显式折叠");
  tree = f.draw();
  assert.equal(kimiHeader().props["aria-expanded"], "false", "折叠后 aria-expanded=false");
  assert.equal(findElement(tree, (node) => textOf(node).includes("Kimi-K3.1")), null, "折叠后该家族的模型行必须隐藏");
});

test("0.1.4 回归：拿到 react-dom 时浮层必须 createPortal 挂到 document.body", () => {
  const harness = makeHarness();
  const portalTargets = [];
  // 真实页面里 document.body 一定存在；测试环境补上，让 CAN_PORTAL 成立。
  harness.document.body = { tagName: "BODY" };
  harness.ReactDOM = {
    createPortal(node, target) {
      portalTargets.push(target);
      // 返回一个可被迷你渲染器识别的「porta 标记节点」，children 必须是数组。
      return { type: "dsmn-portal-marker", props: { children: [node], "data-portal": "1" } };
    },
  };
  const { exports, render, window } = loadBundle(CLIENT, harness);
  const { ctx, registrations, inspectRegistrations } = fakeCtx();
  exports.apply(ctx);
  const face = registrations[0].options.inject("session-1");
  const snapshot = TWO_PROVIDER_SNAPSHOT();
  const directory = { subscribe: () => () => {}, getSnapshot: () => snapshot };
  const props = { ...face, directory, t: (key) => key, locked: false };

  const trigger = findElement(render(registrations[0].component(props)), (node) => node.props.className === "dsmn_trigger");
  assert.ok(trigger, "触发器必须渲染");
  trigger.props.onClick();
  const opened = render(registrations[0].component(props));

  assert.equal(portalTargets.length, 1, "打开面板必须走一次 createPortal");
  assert.equal(portalTargets[0], harness.document.body, "portal 目标必须是 document.body");
  const marker = findElement(opened, (node) => node.type === "dsmn-portal-marker");
  assert.ok(marker, "面板必须作为 portal 标记节点渲染，而不是内联在槽位里");
  assert.ok(
    findElement(marker, (node) => String(node.props.className).includes("dsmn_menu")),
    "portal 里仍要有真正的面板节点",
  );
  assert.equal(window.__DSMN_DIAG__.dom.portalAvailable, true, "现场诊断必须记下 portal 可用");
  assert.equal(window.__DSMN_DIAG__.dom.mode, "portal", "现场诊断必须记下实际走的渲染路径");
  // 现场诊断对象本身也必须经过只读 inspect provider 暴露出去：宿主侧只能看到 probe 的返回值。
  const provider = inspectRegistrations[0];
  assert.equal(provider.manifest.id, "ModelNavigatorDiag");
  const probed = provider.query("probe", null, {});
  assert.equal(probed.diag.dom.mode, "portal", "probe 的返回里必须带上浮层渲染路径");
  assert.equal(probed.diag.dom.portalAvailable, true, "probe 的返回里必须带上 portal 可用性");
  assert.equal("panelAncestorSlot" in probed.diag.dom, true, "probe 的返回里必须带上面板父亲节点现场");
});

test("0.1.4 回归：拿不到 react-dom 时现场诊断记下 inline 回退", () => {
  const harness = makeHarness();
  const { exports, render, window } = loadBundle(CLIENT, harness);
  const { ctx, registrations } = fakeCtx();
  exports.apply(ctx);
  const face = registrations[0].options.inject("session-1");
  const snapshot = TWO_PROVIDER_SNAPSHOT();
  const directory = { subscribe: () => () => {}, getSnapshot: () => snapshot };
  const props = { ...face, directory, t: (key) => key, locked: false };
  findElement(render(registrations[0].component(props)), (node) => node.props.className === "dsmn_trigger").props.onClick();
  render(registrations[0].component(props));
  assert.equal(window.__DSMN_DIAG__.dom.portalAvailable, false, "没有 react-dom 时必须记为不可用");
  assert.equal(window.__DSMN_DIAG__.dom.mode, "inline", "回退路径必须能在现场诊断里看出来");
  assert.equal("panelAncestorSlot" in window.__DSMN_DIAG__.dom, true, "面板父亲节点的现场字段必须存在");
});

test("0.1.4 回归：平台提供官方 atoms 时面板走 MenuSurface，而不是退回 div", () => {
  const harness = makeHarness();
  harness.Primitives = {
    MenuSurface(props) {
      return harness.React.createElement("div", { ...props, "data-atom": "MenuSurface" }, props.children);
    },
  };
  const f = navigatorFixture({ directory: staticDirectory(TWO_PROVIDER_SNAPSHOT()), t: (key) => key }, harness);
  const opened = f.open();
  const atom = findElement(opened, (node) => node.props["data-atom"] === "MenuSurface");
  assert.ok(atom, "有官方 MenuSurface 时必须复用它（否则官方主题/无障碍行为会与原生面板不一致）");
  assert.equal(atom.props.role, "menu", "官方原子必须收到面板语义");
  assert.ok(findElement(atom, (node) => node.props["data-cell"] === "model"), "官方原子里仍要渲染出 root 的 cell");
});


function navigatorFixture(overrides = {}, harness = makeHarness(), ctxOptions = {}) {
  const bundle = loadBundle(CLIENT, harness);
  const context = fakeCtx(ctxOptions);
  bundle.exports.apply(context.ctx);
  const registration = context.registrations[0];
  const face = registration.options.inject("session-regression");
  const props = { ...face, t: T, locked: false, ...overrides };
  const draw = () => bundle.render(registration.component(props));
  const trigger = () => findElement(draw(), n => n.props.className === "dsmn_trigger");
  const open = () => { trigger().props.onClick(); return draw(); };
  /** 打开并进入模型页：当前选择可寻址时先到 root，再点「模型」cell 下钻（官方两级结构）。 */
  const openModels = () => {
    let tree = draw();
    if (paneOf(tree) === null) tree = open();
    if (paneOf(tree) === "root") findElement(tree, n => n.props["data-cell"] === "model").props.onClick();
    return draw();
  };
  const chooseChat = () => findElement(openModels(), n => n.props["data-depth"] === "3" && textOf(n).includes("DeepSeek Chat"));
  /** 供应商默认只展开当前选择所在的那一个；需要别的供应商的行时显式展开（与用户点标题一致，写进偏好）。 */
  const expandProviders = (...ids) => face.store.patch({ collapsedProviders: Object.fromEntries(ids.map(id => [id, false])) });
  /** 「不可用」分组默认折叠；展开（写进偏好，与点标题一致）后返回该分组。 */
  const openUnavailable = () => { face.store.patch({ showUnavailable: true }); return sectionOf(openModels(), "unavailable"); };
  return { ...bundle, ...context, harness, registration, face, props, draw, trigger, open, openModels, chooseChat, expandProviders, openUnavailable };
}

/** 等几轮微任务（select 的 Promise 结算 + focusLater）。 */
async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

/** 当前打开的是哪一页（root / model / effort）；菜单关闭时为 null。 */
function paneOf(tree) {
  const menu = findElement(tree, n => n.props.className === "dsmn_menu");
  return menu === null ? null : menu.props["data-pane"];
}

/** 模型页里的分组：favorites / recent / provider（可按 providerId 限定）/ search。 */
function sectionOf(tree, kind, providerId) {
  return findElement(tree, n => n.props["data-section"] === kind && (providerId === undefined || n.props["data-provider-id"] === providerId));
}

/** 带 preventDefault/stopPropagation 的键盘事件替身。 */
function keyEvent(key, target = null, extra = {}) {
  return { key, target, preventDefault() {}, stopPropagation() {}, ...extra };
}

/** 固定快照的目录替身。 */
function staticDirectory(snapshot) {
  return { subscribe: () => () => {}, getSnapshot: () => snapshot };
}

/** 在快照上再加一个供应商，让模型总数超过搜索框门槛（官方：> 4 个才显示搜索）。不改动原快照。 */
function searchable(snapshot = SNAPSHOT) {
  return {
  ...snapshot,
  groups: [
    ...snapshot.groups,
    { id: "vendor-c", label: "Vendor C", models: [{ id: "glm-5", name: "GLM 5" }, { id: "kimi-k3", name: "Kimi K3" }, { id: "minimax-m3", name: "MiniMax M3" }] },
  ],
  };
}

/** 按顺序记录被 focus 的假节点（标签可能重名，断言时比对象身份）。 */
const focused = [];

/** 模拟真实 React 在提交阶段回填 ref：callback ref 收到一个可聚焦的假节点。 */
function attachFocusRefs(tree, log) {
  const nodes = [];
  collectElements(tree, (n) => typeof n.props.ref === "function").forEach((element, index) => {
    const node = { label: "item-" + index, focus() { log.push(node.label); focused.push(node); } };
    element.props.ref(node);
    nodes.push({ element, node });
  });
  return nodes;
}

/** 给触发器、浮层与搜索框装上假 DOM，然后触发一次定位，让浮层进入「已定位」状态。 */
function placeMenu(f, tree, log) {
  findElement(tree, n => n.props.className === "dsmn_trigger").props.ref.current = {
    getBoundingClientRect: () => ({ left: 500, right: 600, top: 600, bottom: 630 }),
    focus() { log.push("trigger"); },
  };
  findElement(tree, n => n.props.className === "dsmn_menu").props.ref.current = { offsetWidth: 300, offsetHeight: 200 };
  const input = findElement(tree, n => n.props.role === "searchbox");
  if (input !== null) input.props.ref.current = { label: "search", value: "", focus() { log.push("search"); } };
  f.window.dispatch("resize");
}

test("owner locked state reaches the trigger and prevents submission", () => {
  let calls = 0;
  const f = navigatorFixture({ locked: true, select: () => { calls++; } });
  assert.equal(f.trigger().props.disabled, true);
  const chat = f.chooseChat();
  chat.props.onClick();
  assert.equal(calls, 0);
});

test("pending selection is submitted once even for two immediate clicks", async () => {
  let finish;
  let calls = 0;
  const f = navigatorFixture({ select: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const chat = f.chooseChat();
  chat.props.onClick();
  chat.props.onClick();
  assert.equal(calls, 1, "rapid clicks must not issue two RPCs");
  finish({ ok: true });
  await Promise.resolve();
  assert.equal(findElement(f.draw(), n => String(n.props.className).includes("dsmn_menu")), null);
});

test("a synchronous negative outcome keeps the menu open and does not remember success", () => {
  const f = navigatorFixture({ select: () => ({ ok: false, error: { code: "blocked", message: "Busy" } }) });
  f.chooseChat().props.onClick();
  const tree = f.draw();
  assert.ok(findElement(tree, n => String(n.props.className).includes("dsmn_menu")));
  assert.ok(findElement(tree, n => n.props.className === "dsmn_error" && textOf(n).includes("Busy")));
  assert.equal(f.face.store.getPreferences().lastProviderId, undefined);
});

test("successful recovery stops automatic retries with retained stale props", () => {
  const harness = makeHarness();
  const timers = [];
  harness.setTimeout = fn => { timers.push(fn); return timers.length; };
  harness.clearTimeout = () => {};
  const { exports, render } = loadBundle(CLIENT, harness);
  const { ctx, registrations } = fakeCtx();
  const real = ctx.modelDirectories.directoryFor;
  ctx.modelDirectories.directoryFor = () => { throw Error("pending"); };
  exports.apply(ctx);
  const face = registrations[0].options.inject("session-recovery");
  const stale = { ...face, t: T };
  const draw = () => render(registrations[0].component(stale));
  draw();
  ctx.modelDirectories.directoryFor = real;
  timers.shift()();
  draw();
  assert.equal(timers.length, 0, "resolved live state must stop scheduling retries");
  draw();
  assert.equal(timers.length, 0);
});

test("catalog failure waits for an explicit retry rather than retrying on every render", () => {
  let loads = 0;
  const f = navigatorFixture({
    directory: { subscribe: () => () => {}, getSnapshot: () => ({ ...SNAPSHOT, status: "error", error: "offline" }) },
    load: () => { loads++; }
  });
  f.draw();
  assert.equal(loads, 0);
  const tree = f.open();
  assert.equal(loads, 1, "opening explicitly retries once");
  assert.ok(findElement(tree, n => n.props["data-action"] === "retry-catalog"));
});

test("model-page search finds models across providers and opens the hit", () => {
  const f = navigatorFixture({ directory: staticDirectory(searchable()) });
  assert.equal(findElement(f.open(), n => n.props.role === "searchbox"), null, "root 只有两个 cell，与官方一致不放搜索框");
  const input = findElement(f.openModels(), n => n.props.role === "searchbox");
  assert.ok(input, "模型页顶部是全局搜索框");
  input.props.onChange({ target: { value: "qwen" } });
  const tree = f.draw();
  const hits = sectionOf(tree, "search", "vendor-b");
  assert.ok(hits, "命中按供应商分组");
  assert.equal(sectionOf(tree, "provider"), null, "搜索时不再渲染常规分组");
  const hit = findElement(hits, n => n.props["data-depth"] === "3" && textOf(n).includes("Qwen"));
  assert.ok(hit);
  assert.equal(hit.props["data-highlighted"], "", "第一条命中自动高亮（Enter 即选）");
  hit.props.onClick();
  assert.equal(paneOf(f.draw()), "effort", "命中的模型有多档可选：先选思维强度");
  assert.equal(f.selectCalls.length, 0);
});

test("loading with no host current does not present the first catalog model as active", () => {
  const snapshot = { ...SNAPSHOT, current: null, status: "loading" };
  const f = navigatorFixture({ directory: { subscribe: () => () => {}, getSnapshot: () => snapshot } });
  const label = findElement(f.draw(), n => n.props.className === "dsmn_triggerLabel");
  assert.equal(textOf(label), "loading");
});

test("disabling unregisters the model seat; reenabling registers it exactly once", () => {
  const { exports } = loadBundle(CLIENT);
  const context = fakeCtx();
  const active = new Set();
  const original = context.ctx.slots.register;
  context.ctx.slots.register = (options, component) => {
    const token = { options };
    active.add(token);
    original(options, component);
    return () => active.delete(token);
  };
  exports.apply(context.ctx);
  const store = context.registrations[0].options.inject("s").store;
  const modelSeats = () => Array.from(active).filter(e => e.options.name === "conversation.input.model").length;
  assert.equal(modelSeats(), 1);
  store.patch({ enabled: false });
  assert.equal(modelSeats(), 0, "native entry must become the winner immediately");
  store.patch({ enabled: true });
  store.patch({ showSearch: false });
  assert.equal(modelSeats(), 1, "unrelated preferences must not duplicate registrations");
});

test("recreated session binding resolves a fresh directory for the same session ID", () => {
  const { exports } = loadBundle(CLIENT);
  const { ctx, registrations } = fakeCtx();
  let resident = { id: "first" };
  const snapshots = new Map();
  snapshots.set(resident, { ...SNAPSHOT, current: { provider: "vendor-b", model: "qwen3-max" } });
  ctx.sessions.binding = () => resident;
  ctx.modelDirectories.directoryFor = () => ({
    store: { subscribe: () => () => {}, getSnapshot: () => snapshots.get(resident) },
    load: () => Promise.resolve(), select: () => Promise.resolve({ ok: true })
  });
  exports.apply(ctx);
  const inject = registrations[0].options.inject;
  const first = inject("same-id");
  resident = { id: "replacement" };
  snapshots.set(resident, SNAPSHOT);
  const second = inject("same-id");
  assert.notEqual(first, second, "a cached disposed directory must not survive a new binding");
  assert.equal(second.directory.getSnapshot().current.model, "deepseek-flash");
});

test("connection generation change releases pending selection and ignores the old response", async () => {
  const operations = [];
  const f = navigatorFixture({ select: () => new Promise(resolve => operations.push(resolve)) });
  const chat = f.chooseChat();
  chat.props.onClick();
  f.face.draftStore.resetGeneration();
  f.draw();
  chat.props.onClick();
  assert.equal(operations.length, 2, "a replacement connection must accept a new selection");
  operations[0]({ ok: true });
  await Promise.resolve();
  assert.equal(f.face.store.getPreferences().lastProviderId, undefined);
  operations[1]({ ok: true });
  await Promise.resolve();
  assert.equal(f.face.store.getPreferences().lastModelByProvider["deepseek-account"], "deepseek-chat");
});

test("host-order mode renders every model without hiding interleaved families", () => {
  const snapshot = {
    ...SNAPSHOT,
    groups: [{ id: "mixed", name: "Mixed", models: [
      { id: "gpt-5", name: "GPT 5" },
      { id: "claude-sonnet", name: "Claude Sonnet" },
      { id: "gpt-4o", name: "GPT 4o" }
    ] }],
    current: { provider: "mixed", model: "gpt-5" }
  };
  const f = navigatorFixture({ directory: { subscribe: () => () => {}, getSnapshot: () => snapshot } });
  f.face.store.patch({ grouping: "off" });
  f.openModels();
  const models = [];
  const collect = node => {
    if (Array.isArray(node)) { node.forEach(collect); return; }
    if (!node || typeof node !== "object") return;
    if (node.props["data-depth"] === "3") models.push(textOf(findElement(node, child => child.props.className === "dsmn_modelName")));
    collect(node.children);
  };
  collect(f.draw());
  assert.deepEqual(models, ["GPT 5", "Claude Sonnet", "GPT 4o"]);
});

test("favorite action does not switch a model and pins it to a favorites group at the top", () => {
  const f = navigatorFixture();
  let tree = f.openModels();
  assert.equal(sectionOf(tree, "favorites"), null, "没有收藏时不显示空分组");
  const star = findElement(sectionOf(tree, "provider", "deepseek-account"), n => n.props["data-action"] === "favorite-model" && n.props["data-model-id"] === "deepseek-chat");
  assert.ok(star, "each model needs a favorite action");
  assert.equal(star.props["aria-pressed"], "false");
  assert.equal(star.props.tabIndex, -1, "星标不进 Tab 序列");
  star.props.onClick();
  assert.equal(f.selectCalls.length, 0);
  assert.deepEqual(plain(f.face.store.getPreferences().favorites), ['["deepseek-account","deepseek-chat"]']);

  tree = f.draw();
  assert.equal(collectElements(tree, n => typeof n.props["data-section"] === "string")[0].props["data-section"], "favorites", "收藏分组在最上面");
  const favorites = sectionOf(tree, "favorites");
  const row = findElement(favorites, n => n.props["data-depth"] === "3");
  assert.match(textOf(row), /DeepSeek Chat/);
  assert.match(textOf(row), /DeepSeek 账户 · deepseek-chat/, "收藏里的行带供应商与模型 ID，便于区分重名");
  const pin = findElement(favorites, n => n.props["data-action"] === "favorite-model");
  assert.equal(pin.props["aria-pressed"], "true");
  pin.props.onClick();
  assert.deepEqual(plain(f.face.store.getPreferences().favorites), []);
  assert.equal(sectionOf(f.draw(), "favorites"), null);
});

test("global results disambiguate identical model names with their providers and IDs", () => {
  const snapshot = {
    ...SNAPSHOT,
    groups: [
      { id: "p-a", name: "Provider A", models: [{ id: "model-a", name: "Same Model" }] },
      { id: "p-b", name: "Provider B", models: [{ id: "model-b", name: "Same Model" }] }
    ]
  };
  const f = navigatorFixture({ directory: staticDirectory(searchable(snapshot)) });
  const input = findElement(f.open(), n => n.props.role === "searchbox");
  input.props.onChange({ target: { value: "same" } });
  const tree = f.draw();
  const groupOf = (id) => findElement(tree, n => n.props["data-section"] === "search" && n.props["data-provider-id"] === id);
  assert.match(textOf(findElement(groupOf("p-a"), n => n.props.className === "dsmn_menuGroupLabel")), /Provider A/);
  assert.match(textOf(findElement(groupOf("p-b"), n => n.props.className === "dsmn_menuGroupLabel")), /Provider B/);
  assert.match(textOf(findElement(groupOf("p-a"), n => n.props["data-depth"] === "3")), /model-a/);
  assert.match(textOf(findElement(groupOf("p-b"), n => n.props["data-depth"] === "3")), /model-b/);
});


test("model seat diagnostics distinguish registration from rendering", () => {
  const { exports, window } = loadBundle(CLIENT);
  const { ctx, registrations } = fakeCtx();
  exports.apply(ctx);
  const seat = window.__DSMN_DIAG__.seat;
  assert.ok(seat);
  assert.equal(seat.priority, -20);
  assert.equal(seat.registered, true);
  assert.equal(seat.enabled, true);
  const store = registrations[0].options.inject("s").store;
  store.patch({ enabled: false });
  assert.equal(seat.registered, false);
  assert.equal(seat.enabled, false);
  store.patch({ enabled: true });
  assert.equal(seat.registered, true);
  assert.equal(seat.error, null);
});


test("a favorited current model stays checked in favorites and can be removed there", () => {
  const f = navigatorFixture();
  const key = JSON.stringify([SNAPSHOT.current.provider, SNAPSHOT.current.model]);
  f.face.store.patch({ favorites: [key] });
  const favorites = sectionOf(f.openModels(), "favorites");
  assert.ok(favorites);
  assert.ok(findElement(favorites, n => n.props.role === "menuitemradio" && n.props["aria-checked"] === "true"), "current must not be deduplicated out of favorites");
  findElement(favorites, n => n.props["data-action"] === "favorite-model").props.onClick();
  assert.equal(f.selectCalls.length, 0);
  assert.deepEqual(plain(f.face.store.getPreferences().favorites), []);
  assert.equal(sectionOf(f.draw(), "favorites"), null);
});

test("recent group skips favorites, shows at most five models, in MRU order", () => {
  const models = Array.from({ length: 8 }, (_, i) => ({ id: "m" + i, name: "Model " + i }));
  const snapshot = { ...SNAPSHOT, groups: [{ id: "p", name: "Provider", models }], current: { provider: "p", model: "m0" } };
  const f = navigatorFixture({ directory: staticDirectory(snapshot) });
  const key = (id) => JSON.stringify(["p", id]);
  f.face.store.patch({ favorites: [key("m1")], recentModels: ["m1", "m2", "m3", "m4", "m5", "m6", "m7"].map(key) });
  const recent = sectionOf(f.openModels(), "recent");
  assert.ok(recent);
  assert.deepEqual(
    collectElements(recent, n => n.props.className === "dsmn_modelName").map(n => textOf(n)),
    ["Model 2", "Model 3", "Model 4", "Model 5", "Model 6"],
  );
  assert.equal(f.selectCalls.length, 0, "rendering recents must never select a model");
});

test("favorites group includes more than eight models", () => {
  const models = Array.from({ length: 12 }, (_, i) => ({ id: "m" + i, name: "Model " + i }));
  const snapshot = { ...SNAPSHOT, groups: [{ id: "p", name: "Provider", models }], current: { provider: "p", model: "m0" } };
  const f = navigatorFixture({ directory: staticDirectory(snapshot) });
  f.face.store.patch({ favorites: models.map(m => JSON.stringify(["p", m.id])) });
  assert.equal(collectElements(sectionOf(f.openModels(), "favorites"), n => n.props.role === "menuitemradio").length, 12);
});

test("a pointerdown inside the portaled menu is not treated as an outside click", () => {
  const f = navigatorFixture();
  const tree = f.open();
  const inside = {};
  findElement(tree, n => n.props.className === "dsmn_menu").props.ref.current = { contains: target => target === inside };
  f.document.dispatch("pointerdown", { target: inside });
  assert.equal(paneOf(f.draw()), "root");
  f.document.dispatch("pointerdown", { target: {} });
  assert.equal(paneOf(f.draw()), null);
});

test("picker omits preference storage details while settings retain them", () => {
  const f = navigatorFixture();
  assert.equal(findElement(f.openModels(), n => String(n.props.className).includes("dsmn-footer")), null);
  const settings = f.registrations.find(r => r.options.name === "settings.general.item");
  assert.ok(textOf(f.render(settings.component(settings.options.inject()))).includes("storageMemory"));
});

test("0.4.0：模型行的 › 打开该模型的思维强度页，选档位后提交完整选择", async () => {
  const f = navigatorFixture();
  f.expandProviders("vendor-b");
  const tree = f.openModels();
  assert.equal(findElement(tree, n => n.props["data-action"] === "open-effort" && n.props["data-model-id"] === "deepseek-chat"), null, "没有档位的模型不显示 ›");
  findElement(tree, n => n.props["data-action"] === "open-effort" && n.props["data-model-id"] === "qwen3-max").props.onClick();
  const effort = f.draw();
  assert.equal(paneOf(effort), "effort");
  assert.match(textOf(findElement(effort, n => n.props.className === "dsmn_cell dsmn_cellBack")), /Qwen3 Max/, "返回行标出目标模型");
  const levels = collectElements(effort, n => n.props["data-depth"] === "4");
  assert.deepEqual(levels.map(n => textOf(findElement(n, c => c.props.className === "dsmn_modelName"))), ["providerDefault", "Low"]);
  assert.equal(levels[0].props["aria-checked"], "true", "没有默认档时勾「供应商默认」");
  assert.equal(f.selectCalls.length, 0, "打开思维强度页不提交");
  levels[1].props.onClick();
  await flush();
  assert.deepEqual(plain(f.selectCalls), [{ provider: "vendor-b", model: "qwen3-max", reasoningEffort: "low" }]);
  assert.equal(paneOf(f.draw()), null, "successful selection closes the picker");
});

test("0.4.0：点当前模型 / 当前档位不发起选择", () => {
  const f = navigatorFixture();
  const flash = findElement(f.openModels(), n => n.props["data-depth"] === "3" && textOf(n).includes("DeepSeek Flash"));
  assert.equal(flash.props["aria-checked"], "true");
  flash.props.onClick();
  let tree = f.draw();
  assert.equal(paneOf(tree), "effort", "当前模型有多档可选时同样进思维强度页");
  findElement(tree, n => n.props["data-depth"] === "4" && n.props["aria-checked"] === "true").props.onClick();
  tree = f.draw();
  assert.equal(paneOf(tree), null, "点当前档位只关闭菜单");
  assert.equal(findElement(tree, n => n.props.className === "dsmn_trigger").props["data-selection-focus"], "");

  findElement(f.open(), n => n.props["data-cell"] === "effort").props.onClick();
  findElement(f.draw(), n => n.props["data-depth"] === "4" && n.props["aria-checked"] === "true").props.onClick();
  assert.equal(paneOf(f.draw()), null);
  assert.equal(f.selectCalls.length, 0);

  const chat = navigatorFixture({ directory: staticDirectory({ ...SNAPSHOT, current: { provider: "deepseek-account", model: "deepseek-chat" } }) });
  chat.chooseChat().props.onClick();
  assert.equal(paneOf(chat.draw()), null, "当前模型没有档位：只关闭菜单");
  assert.equal(chat.selectCalls.length, 0);
});

test("0.4.0：点有多档可选的模型先进思维强度页，确认才提交，返回不切换", async () => {
  const f = navigatorFixture();
  f.expandProviders("vendor-b");
  const qwen = () => findElement(f.openModels(), n => n.props["data-depth"] === "3" && textOf(n).includes("Qwen3 Max"));
  qwen().props.onClick();
  let tree = f.draw();
  assert.equal(paneOf(tree), "effort");
  assert.match(textOf(findElement(tree, n => n.props.className === "dsmn_cell dsmn_cellBack")), /Qwen3 Max/);
  assert.equal(f.selectCalls.length, 0, "只进入页面，不替用户决定档位");

  findElement(tree, n => n.props.className === "dsmn_cell dsmn_cellBack").props.onClick();
  assert.equal(paneOf(f.draw()), "model", "返回模型页");
  assert.equal(f.selectCalls.length, 0, "返回不切换模型");

  qwen().props.onClick();
  findElement(f.draw(), n => n.props["data-depth"] === "4" && textOf(n).includes("Low")).props.onClick();
  await flush();
  assert.deepEqual(plain(f.selectCalls), [{ provider: "vendor-b", model: "qwen3-max", reasoningEffort: "low" }]);
  assert.equal(paneOf(f.draw()), null);
});

test("0.4.0：只有一种档位的模型不必确认，点击即切换", async () => {
  const single = { id: "deepseek-one", name: "DeepSeek One", reasoning: { efforts: [{ id: "only", name: "Only" }], defaultEffort: "only" } };
  const [first, second] = SNAPSHOT.groups;
  const f = navigatorFixture({ directory: staticDirectory({ ...SNAPSHOT, groups: [{ ...first, models: [...first.models, single] }, second] }) });
  findElement(f.openModels(), n => n.props["data-depth"] === "3" && textOf(n).includes("DeepSeek One")).props.onClick();
  await flush();
  assert.deepEqual(plain(f.selectCalls), [{ provider: "deepseek-account", model: "deepseek-one" }]);
});

test("0.4.0：会话锁定时点模型不进思维强度页", () => {
  const f = navigatorFixture();
  f.expandProviders("vendor-b");
  f.openModels();
  f.props.locked = true;
  findElement(f.draw(), n => n.props["data-depth"] === "3" && textOf(n).includes("Qwen3 Max")).props.onClick();
  assert.equal(paneOf(f.draw()), "model");
  assert.equal(f.selectCalls.length, 0);
});

test("0.4.0：思维强度按模型记住，切到别的模型后再回来预选上次的档位", async () => {
  const f = navigatorFixture();
  f.expandProviders("vendor-b");
  const key = JSON.stringify(["vendor-b", "qwen3-max"]);
  const memory = () => f.face.store.getPreferences().effortByModel;
  const openQwen = () => { findElement(f.openModels(), n => n.props["data-depth"] === "3" && textOf(n).includes("Qwen3 Max")).props.onClick(); return f.draw(); };
  const checked = (tree) => textOf(findElement(tree, n => n.props["data-depth"] === "4" && n.props["aria-checked"] === "true"));
  const level = (tree, label) => findElement(tree, n => n.props["data-depth"] === "4" && textOf(n).includes(label));

  let tree = openQwen();
  assert.match(checked(tree), /providerDefault/, "没记过：模型默认");
  level(tree, "Low").props.onClick();
  await flush();
  assert.equal(memory()[key], "low");

  f.chooseChat().props.onClick();
  await flush();
  assert.equal(memory()[key], "low", "切到别的模型不影响这条记录");

  tree = openQwen();
  assert.match(checked(tree), /Low/, "切回来预选上次的档位");
  level(tree, "providerDefault").props.onClick();
  await flush();
  assert.deepEqual(plain(f.selectCalls).at(-1), { provider: "vendor-b", model: "qwen3-max" });
  assert.equal(key in memory(), false, "选回默认档后删除记录");
});

test("0.4.0：宿主报告的当前档位也会记下，切走再切回不丢（从 DeepSeek 切回 GPT 的场景）", async () => {
  const snapshot = { ...SNAPSHOT, current: { provider: "deepseek-account", model: "deepseek-flash", reasoningEffort: "high" } };
  const f = navigatorFixture({ directory: staticDirectory(snapshot) });
  f.chooseChat().props.onClick();
  await flush();
  snapshot.current = { provider: "deepseek-account", model: "deepseek-chat" };

  findElement(f.openModels(), n => n.props["data-depth"] === "3" && textOf(n).includes("DeepSeek Flash")).props.onClick();
  const high = findElement(f.draw(), n => n.props["data-depth"] === "4" && n.props["aria-checked"] === "true");
  assert.match(textOf(high), /高/, "预选切走前的档位，而不是模型默认的「低」");
  high.props.onClick();
  await flush();
  assert.deepEqual(plain(f.selectCalls)[1], { provider: "deepseek-account", model: "deepseek-flash", reasoningEffort: "high" });
});

test("0.4.0：记住的档位已被撤掉时退回模型默认档，不提示档位不可用", async () => {
  const f = navigatorFixture();
  f.expandProviders("vendor-b");
  f.face.store.patch({ effortByModel: { [JSON.stringify(["vendor-b", "qwen3-max"])]: "retired" } });
  findElement(f.openModels(), n => n.props["data-depth"] === "3" && textOf(n).includes("Qwen3 Max")).props.onClick();
  const tree = f.draw();
  assert.equal(findElement(tree, n => n.props.className === "dsmn_status" && textOf(n).includes("effortUnavailable")), null);
  const checked = findElement(tree, n => n.props["data-depth"] === "4" && n.props["aria-checked"] === "true");
  assert.match(textOf(checked), /providerDefault/);
  checked.props.onClick();
  await flush();
  assert.deepEqual(plain(f.selectCalls), [{ provider: "vendor-b", model: "qwen3-max" }], "过期记录不会被提交");
});

test("0.4.0：提交中触发器 aria-busy 并以 StateDot 代替箭头，正在提交的行显示进度点", async () => {
  let finish;
  const f = navigatorFixture({ select: () => new Promise(resolve => { finish = resolve; }) });
  f.chooseChat().props.onClick();
  const tree = f.draw();
  const trigger = findElement(tree, n => n.props.className === "dsmn_trigger");
  assert.equal(trigger.props["aria-busy"], "true");
  assert.notEqual(trigger.props.disabled, true, "与官方一致：提交中触发器仍可点，只有锁定/不可用才禁用");
  assert.ok(findElement(trigger, n => n.props.className === "dsmn_stateDot"));
  assert.equal(findElement(trigger, n => String(n.props.className).startsWith("dsmn_chevron")), null);
  const chat = findElement(tree, n => n.props["data-depth"] === "3" && textOf(n).includes("DeepSeek Chat"));
  assert.ok(findElement(chat, n => n.props.className === "dsmn_stateDot"), "正在提交的行显示进度点");
  assert.equal(chat.props.disabled, true, "提交中整片行置灰（官方 busy）");
  assert.ok(findElement(tree, n => n.props.className === "dsmn_status" && textOf(n) === "selecting"));
  finish({ ok: true });
  await flush();
  assert.equal(paneOf(f.draw()), null);
});

test("0.4.0：键盘 → 打开思维强度、← 返回，Esc 逐层退出（清空搜索 → 返回 → 关闭并还焦点）", async () => {
  const f = navigatorFixture({ directory: staticDirectory(searchable()) });
  const log = [];
  let tree = f.open();
  findElement(tree, n => n.props.className === "dsmn_trigger").props.ref.current = { focus() { log.push("trigger"); } };
  const press = (key, target) => findElement(tree, n => n.props.className === "dsmn_root").props.onKeyDown(keyEvent(key, target));

  findElement(tree, n => n.props["data-cell"] === "model").props.onClick();
  tree = f.draw();
  const search = { value: "", focus() { log.push("search"); } };
  findElement(tree, n => n.props.role === "searchbox").props.ref.current = search;
  findElement(tree, n => n.props.role === "searchbox").props.onChange({ target: { value: "deepseek" } });
  tree = f.draw();

  press("Escape", search);
  tree = f.draw();
  assert.equal(paneOf(tree), "model", "第一下 Esc 只清空搜索");
  assert.equal(findElement(tree, n => n.props.role === "searchbox").props.value, "");
  assert.equal(findElement(tree, n => n.props["data-depth"] === "3" && n.props["data-highlighted"] === "").props["aria-checked"], "true", "清空搜索后高亮回到当前模型");

  press("ArrowRight", search);
  tree = f.draw();
  assert.equal(paneOf(tree), "effort", "搜索框光标在末尾时 → 打开高亮模型的思维强度");
  assert.match(textOf(findElement(tree, n => n.props.className === "dsmn_cell dsmn_cellBack")), /DeepSeek Flash/);

  press("ArrowLeft", null);
  tree = f.draw();
  assert.equal(paneOf(tree), "model", "← 回到来时的模型页");

  press("Escape", null);
  tree = f.draw();
  assert.equal(paneOf(tree), "root", "没有查询时 Esc 返回 root");

  press("Escape", null);
  tree = f.draw();
  assert.equal(paneOf(tree), null, "root 层 Esc 关闭");
  await flush();
  assert.equal(log[log.length - 1], "trigger", "关闭后焦点回到触发器");
  assert.equal(f.selectCalls.length, 0);
});

test("unavailable favorites remain visible and individually removable", () => {
  const f = navigatorFixture();
  const missing = JSON.stringify(["removed-provider", "step-5-preview"]);
  const present = JSON.stringify([SNAPSHOT.current.provider, SNAPSHOT.current.model]);
  f.face.store.patch({ favorites: [missing, present] });
  const favorites = sectionOf(f.openModels(), "favorites");
  assert.equal(findElement(favorites, n => n.props["data-unavailable-model"] !== undefined), null, "失效收藏移出收藏分组");
  const row = findElement(f.openUnavailable(), n => n.props["data-unavailable-model"] === missing);
  assert.ok(row, "unavailable favorites stay reachable in the Unavailable section");
  assert.match(textOf(row), /step-5-preview/);
  assert.equal(findElement(row, n => n.props.role === "menuitemradio").props.disabled, true);
  findElement(row, n => n.props["data-action"] === "favorite-model").props.onClick();
  assert.deepEqual(plain(f.face.store.getPreferences().favorites), [present]);
  assert.equal(f.selectCalls.length, 0);
});

test("malformed saved favorites can be removed without breaking the menu", () => {
  const f = navigatorFixture();
  f.face.store.patch({ favorites: ["legacy-key", '{"bad":true}'] });
  let unavailable = f.openUnavailable();
  assert.equal(sectionOf(f.draw(), "favorites"), null, "只有失效收藏时不显示空的收藏分组");
  assert.equal(collectElements(unavailable, n => n.props["data-unavailable-model"] !== undefined).length, 2);
  findElement(unavailable, n => n.props["data-action"] === "favorite-model").props.onClick();
  unavailable = sectionOf(f.draw(), "unavailable");
  findElement(unavailable, n => n.props["data-action"] === "favorite-model").props.onClick();
  assert.deepEqual(plain(f.face.store.getPreferences().favorites), []);
  assert.equal(sectionOf(f.draw(), "favorites"), null);
  assert.equal(sectionOf(f.draw(), "unavailable"), null, "清空后不可用分组随之消失");
});

test("temporarily unavailable favorites return when their model reappears", () => {
  let snapshot = { ...SNAPSHOT, groups: [] };
  const f = navigatorFixture({ directory: { subscribe: () => () => {}, getSnapshot: () => snapshot } });
  const key = JSON.stringify([SNAPSHOT.current.provider, SNAPSHOT.current.model]);
  f.face.store.patch({ favorites: [key] });
  assert.ok(findElement(f.openUnavailable(), n => n.props["data-unavailable-model"] === key));
  snapshot = SNAPSHOT;
  const favorites = sectionOf(f.draw(), "favorites");
  assert.equal(findElement(favorites, n => n.props["data-unavailable-model"] !== undefined), null);
  assert.equal(findElement(favorites, n => n.props.role === "menuitemradio").props.disabled, false);
  assert.equal(sectionOf(f.draw(), "unavailable"), null);
  assert.deepEqual(plain(f.face.store.getPreferences().favorites), [key]);
});

test("unavailable recent models can be removed without changing favorites", () => {
  const f = navigatorFixture();
  const key = JSON.stringify(["gone", "old-model"]);
  const favorite = JSON.stringify(["deepseek-account", "deepseek-chat"]);
  f.face.store.patch({ favorites: [favorite], recentModels: [key], lastProviderId: "gone", lastModelByProvider: { gone: "old-model" } });
  assert.equal(sectionOf(f.openModels(), "recent"), null, "失效最近使用不留在最近使用分组");
  const unavailable = f.openUnavailable();
  assert.match(textOf(unavailable), /old-model/);
  findElement(unavailable, n => n.props["data-action"] === "remove-recent").props.onClick();
  assert.deepEqual(plain(f.face.store.getPreferences().recentModels), []);
  assert.deepEqual(plain(f.face.store.getPreferences().lastModelByProvider), {});
  assert.equal(f.face.store.getPreferences().lastProviderId, undefined);
  assert.deepEqual(plain(f.face.store.getPreferences().favorites), [favorite]);
});

test("removing a provider while the model page is open keeps the remaining providers", () => {
  let snapshot = SNAPSHOT;
  const f = navigatorFixture({ directory: { subscribe: () => () => {}, getSnapshot: () => snapshot } });
  f.openModels();
  snapshot = { ...SNAPSHOT, groups: SNAPSHOT.groups.filter(g => g.id !== SNAPSHOT.current.provider) };
  const tree = f.draw();
  assert.equal(paneOf(tree), "model");
  assert.equal(sectionOf(tree, "provider", "deepseek-account"), null);
  assert.ok(sectionOf(tree, "provider", "vendor-b"));
  assert.ok(findElement(tree, n => n.props.className === "dsmn_status" && textOf(n).includes("currentOutside")), "当前模型随供应商消失，必须标注");
  assert.equal(f.selectCalls.length, 0);
});

test("removing the model during effort selection returns to available models", () => {
  let snapshot = SNAPSHOT;
  const f = navigatorFixture({ directory: { subscribe: () => () => {}, getSnapshot: () => snapshot } });
  findElement(f.open(), n => n.props["data-cell"] === "effort").props.onClick();
  assert.ok(findElement(f.draw(), n => n.props["data-depth"] === "4"));
  snapshot = { ...SNAPSHOT, groups: SNAPSHOT.groups.map(g => ({ ...g, models: g.models.filter(m => m.id !== SNAPSHOT.current.model) })) };
  f.draw();
  const tree = f.draw();
  assert.equal(findElement(tree, n => n.props["data-depth"] === "4"), null);
  assert.equal(paneOf(tree), "model");
  assert.ok(findElement(tree, n => n.props["data-depth"] === "3" && textOf(n).includes("DeepSeek Chat")));
  assert.ok(findElement(tree, n => n.props.className === "dsmn_error" && textOf(n) === "modelUnavailable"));
  assert.equal(f.selectCalls.length, 0);
});

test("old model buttons cannot submit a deleted model before a new render", () => {
  let snapshot = SNAPSHOT;
  const f = navigatorFixture({ directory: { subscribe: () => () => {}, getSnapshot: () => snapshot } });
  const stale = f.chooseChat();
  snapshot = { ...SNAPSHOT, groups: [] };
  stale.props.onClick();
  assert.equal(f.selectCalls.length, 0, "read the live directory at click time");
  assert.match(textOf(f.draw()), /modelUnavailable/);
});

test("old effort buttons cannot submit a removed reasoning level", () => {
  let snapshot = SNAPSHOT;
  const f = navigatorFixture({ directory: { subscribe: () => () => {}, getSnapshot: () => snapshot } });
  findElement(f.open(), n => n.props["data-cell"] === "effort").props.onClick();
  const high = findElement(f.draw(), n => n.props["data-depth"] === "4" && textOf(n).includes("高"));
  snapshot = { ...SNAPSHOT, groups: SNAPSHOT.groups.map(g => ({ ...g, models: g.models.map(m => m.reasoning ? { ...m, reasoning: { ...m.reasoning, efforts: [{ id: "low", name: "低" }] } } : m) })) };
  high.props.onClick();
  assert.equal(f.selectCalls.length, 0);
  assert.match(textOf(f.draw()), /effortUnavailable/);
});

test("loading an empty catalog does not announce that the current model disappeared", () => {
  const f = navigatorFixture({ directory: { subscribe: () => () => {}, getSnapshot: () => ({ ...SNAPSHOT, status: "loading", groups: [] }) } });
  const tree = f.open();
  assert.equal(findElement(tree, n => n.props.className === "dsmn_status" && textOf(n).includes("currentOutside")), null);
  assert.match(textOf(tree), /loading/);
});

test("a missing current model can refresh or switch without pretending to select a default", () => {
  let loads = 0;
  const snapshot = searchable({ ...SNAPSHOT, current: { provider: "gone", model: "step-5-preview", reasoningEffort: "high" } });
  const f = navigatorFixture({ directory: staticDirectory(snapshot), load: () => { loads++; } });
  const tree = f.open();
  assert.equal(f.trigger().props.title, "step-5-preview");
  const refresh = findElement(tree, n => n.props["data-action"] === "refresh-catalog");
  assert.ok(refresh);
  refresh.props.onClick();
  assert.equal(loads, 2);
  const search = findElement(f.draw(), n => n.props.role === "searchbox");
  search.props.onChange({ target: { value: "deepseek-chat" } });
  findElement(f.draw(), n => n.props["data-depth"] === "3" && textOf(n).includes("DeepSeek Chat")).props.onClick();
  assert.deepEqual(plain(f.selectCalls), [{ provider: "deepseek-account", model: "deepseek-chat" }]);
});

test("a model removed during submission is not remembered as an available recent choice", async () => {
  let snapshot = SNAPSHOT;
  let finish;
  const f = navigatorFixture({ directory: { subscribe: () => () => {}, getSnapshot: () => snapshot }, select: () => new Promise(resolve => { finish = resolve; }) });
  f.chooseChat().props.onClick();
  snapshot = { ...SNAPSHOT, groups: [] };
  finish({ ok: true });
  await flush();
  assert.equal(f.face.store.getPreferences().lastProviderId, undefined);
  const tree = f.draw();
  assert.equal(paneOf(tree), "model", "keep recovery navigation open");
  assert.ok(findElement(tree, n => n.props.className === "dsmn_error" && textOf(n) === "modelUnavailable"));
});

test("a missing current model retains the host reasoning effort in the trigger", () => {
  const snapshot = { ...SNAPSHOT, current: { provider: "gone", model: "removed", reasoningEffort: "high" } };
  const f = navigatorFixture({ directory: { subscribe: () => () => {}, getSnapshot: () => snapshot } });
  assert.match(textOf(f.trigger()), /high/);
});

test("temporary loading preserves the effort page until the model returns", () => {
  let snapshot = SNAPSHOT;
  const f = navigatorFixture({ directory: { subscribe: () => () => {}, getSnapshot: () => snapshot } });
  findElement(f.open(), n => n.props["data-cell"] === "effort").props.onClick();
  f.draw();
  snapshot = { ...SNAPSHOT, status: "loading", groups: [] };
  f.draw();
  const loading = f.draw();
  assert.equal(paneOf(loading), "effort", "目录只是暂时在加载时不退出思维强度页");
  assert.equal(findElement(loading, n => n.props["data-depth"] === "4"), null);
  snapshot = SNAPSHOT;
  assert.ok(findElement(f.draw(), n => n.props["data-depth"] === "4"));
  assert.equal(f.selectCalls.length, 0);
});

test("an empty ready catalog without a current model still offers explicit refresh", () => {
  const snapshot = { ...SNAPSHOT, current: null, groups: [] };
  const f = navigatorFixture({ directory: { subscribe: () => () => {}, getSnapshot: () => snapshot } });
  assert.ok(findElement(f.open(), n => n.props["data-action"] === "refresh-catalog"));
});

test("an open provider with no remaining models shows a useful empty state", () => {
  let snapshot = SNAPSHOT;
  const f = navigatorFixture({ directory: { subscribe: () => () => {}, getSnapshot: () => snapshot } });
  f.chooseChat();
  snapshot = { ...SNAPSHOT, groups: SNAPSHOT.groups.map(g => ({ ...g, models: [] })) };
  const tree = f.draw();
  assert.match(textOf(tree), /emptyCatalog/);
  assert.equal(f.selectCalls.length, 0);
});

test("removing an old recent entry does not erase a newer selection for the provider", () => {
  const f = navigatorFixture();
  f.face.store.patch({ recentModels: [JSON.stringify(["gone", "old-model"])], lastProviderId: "gone", lastModelByProvider: { gone: "old-model" } });
  const remove = findElement(f.openUnavailable(), n => n.props["data-action"] === "remove-recent");
  f.face.store.rememberSelection({ provider: "gone", model: "new-model" });
  remove.props.onClick();
  assert.equal(f.face.store.getPreferences().lastModelByProvider.gone, "new-model");
  assert.deepEqual(plain(f.face.store.getPreferences().recentModels), [JSON.stringify(["gone", "new-model"])]);
});

test("0.3.3 回归：最近使用按真实先后排序，同一供应商可留多条，且有上限", () => {
  const f = navigatorFixture();
  const key = (p, m) => JSON.stringify([p, m]);
  for (const [p, m] of [["a", "a1"], ["b", "b1"], ["c", "c1"], ["a", "a2"], ["b", "b1"]]) {
    f.face.store.rememberSelection({ provider: p, model: m });
  }
  // 0.3.2 每个供应商只记一条、顺序取对象键序，这里会得到 b1, a2, c1 且丢掉 a1
  assert.deepEqual(plain(f.face.store.getPreferences().recentModels),
    [key("b", "b1"), key("a", "a2"), key("c", "c1"), key("a", "a1")]);
  for (let i = 0; i < 12; i += 1) f.face.store.rememberSelection({ provider: "x", model: "m" + i });
  const recent = plain(f.face.store.getPreferences().recentModels);
  assert.equal(recent.length, 8);
  assert.equal(recent[0], key("x", "m11"));
});

test("0.3.3 回归：最近使用分组按 MRU 顺序渲染", () => {
  const f = navigatorFixture();
  f.face.store.rememberSelection({ provider: "deepseek-account", model: "deepseek-chat" });
  f.face.store.rememberSelection({ provider: "deepseek-account", model: "deepseek-flash" });
  const names = collectElements(sectionOf(f.openModels(), "recent"), n => n.props.className === "dsmn_modelName").map(n => textOf(n));
  assert.deepEqual(names, ["DeepSeek Flash", "DeepSeek Chat"]);
});

test("0.3.3 回归：搜索清除按钮有自己的无障碍名称，不再借用「返回」", () => {
  const f = navigatorFixture({ directory: staticDirectory(searchable()) });
  f.openModels();
  findElement(f.draw(), n => n.props.role === "searchbox").props.onChange({ target: { value: "chat" } });
  const clear = findElement(f.draw(), n => n.props.className === "dsmn_searchClear");
  assert.equal(clear.props["aria-label"], T("searchClear"));
  assert.notEqual(clear.props["aria-label"], T("back"));
  clear.props.onClick();
  assert.equal(findElement(f.draw(), n => n.props.className === "dsmn_searchClear"), null);
});

test("0.4.0：浮层与官方一致右对齐触发器、出现在上方 8px，四周 12px 夹紧；缩放/滚动重算，关闭后释放监听", () => {
  const f = navigatorFixture();
  f.window.innerWidth = 1200;
  f.window.innerHeight = 800;
  let rect = { left: 300, right: 400, top: 600, bottom: 630 };
  const tree = f.open();
  const menuStyle = () => findElement(f.draw(), n => n.props.className === "dsmn_menu").props.style;
  assert.equal(menuStyle().visibility, "hidden", "定位前用 visibility:hidden 测量");
  findElement(tree, n => n.props.className === "dsmn_trigger").props.ref.current = { getBoundingClientRect: () => rect };
  findElement(tree, n => n.props.className === "dsmn_menu").props.ref.current = { offsetWidth: 300, offsetHeight: 200 };
  f.window.dispatch("resize");
  assert.deepEqual(plain(menuStyle()), { left: 100, top: 392 }, "x = right - width，y = top - 8 - height");
  rect = { left: 1200, right: 1300, top: 150, bottom: 180 };
  f.window.dispatch("scroll");
  assert.deepEqual(plain(menuStyle()), { left: 888, top: 12 }, "右边与上边各留 12px");
  const unchanged = menuStyle();
  f.window.dispatch("scroll");
  assert.equal(menuStyle(), unchanged, "位置不变时不产生新的 style 对象");
  f.trigger().props.onClick();
  f.draw();
  assert.equal((f.window.listeners.get("resize") || []).length, 0, "关闭后必须移除 resize 监听");
  assert.equal((f.window.listeners.get("scroll") || []).length, 0, "关闭后必须移除 scroll 监听");
});

/* ================================================================== *
 * 0.3.3：搜索门槛、折叠家族不构造行、键盘焦点
 * ================================================================== */

test("0.3.3：搜索框与官方一致，目录不超过 4 个模型时不显示", () => {
  const few = navigatorFixture();
  assert.equal(findElement(few.openModels(), n => n.props.role === "searchbox"), null, "3 个模型不显示搜索");
  const four = { ...SNAPSHOT, groups: [...SNAPSHOT.groups, { id: "vendor-c", label: "Vendor C", models: [{ id: "glm-5", name: "GLM 5" }] }] };
  assert.equal(findElement(navigatorFixture({ directory: staticDirectory(four) }).openModels(), n => n.props.role === "searchbox"), null, "恰好 4 个也不显示");
  const many = navigatorFixture({ directory: staticDirectory(searchable()) });
  assert.ok(findElement(many.openModels(), n => n.props.role === "searchbox"), "超过 4 个显示搜索");
  many.face.store.patch({ showSearch: false });
  assert.equal(findElement(many.draw(), n => n.props.role === "searchbox"), null, "用户关闭后不显示");
});

test("0.4.0：供应商分组可折叠，默认只展开当前选择所在的供应商，状态写进偏好", () => {
  const f = navigatorFixture();
  let tree = f.openModels();
  const vendor = () => sectionOf(tree, "provider", "vendor-b");
  const toggleOf = (section) => findElement(section, n => String(n.props.className).includes("dsmn_providerToggle"));
  assert.equal(toggleOf(sectionOf(tree, "provider", "deepseek-account")).props["aria-expanded"], "true", "当前供应商默认展开");
  assert.equal(toggleOf(vendor()).props["aria-expanded"], "false", "其他供应商默认折叠");
  assert.equal(vendor().props["data-collapsed"], "true");
  assert.equal(textOf(findElement(toggleOf(vendor()), n => n.props.className === "dsmn_groupCount")), "1", "折叠时标题显示模型数");
  assert.equal(collectElements(vendor(), n => n.props["data-depth"] === "3").length, 0, "折叠的供应商不构造模型行");
  assert.equal(toggleOf(vendor()).props.tabIndex, -1, "与家族折叠一致，不进 Tab 序列");

  toggleOf(vendor()).props.onClick();
  tree = f.draw();
  assert.equal(toggleOf(vendor()).props["aria-expanded"], "true");
  assert.ok(findElement(vendor(), n => n.props["data-depth"] === "3" && textOf(n).includes("Qwen3 Max")), "展开后列出模型");
  assert.deepEqual(plain(f.face.store.getPreferences().collapsedProviders), { "vendor-b": false });
  assert.equal(f.selectCalls.length, 0, "折叠/展开不发起选择");

  toggleOf(sectionOf(tree, "provider", "deepseek-account")).props.onClick();
  tree = f.draw();
  assert.equal(collectElements(sectionOf(tree, "provider", "deepseek-account"), n => n.props["data-depth"] === "3").length, 0, "当前供应商也可以显式折叠");
  assert.equal(paneOf(tree), "model", "折叠不关闭菜单");

  const input = navigatorFixture({ directory: staticDirectory(searchable()) });
  input.openModels();
  findElement(input.draw(), n => n.props.role === "searchbox").props.onChange({ target: { value: "qwen" } });
  assert.ok(findElement(sectionOf(input.draw(), "search", "vendor-b"), n => n.props["data-depth"] === "3"), "搜索不受折叠影响");
});

test("0.4.0：只有一个供应商时不显示供应商折叠按钮", () => {
  const snapshot = { ...SNAPSHOT, groups: [SNAPSHOT.groups[0]] };
  const tree = navigatorFixture({ directory: staticDirectory(snapshot) }).openModels();
  assert.equal(findElement(tree, n => String(n.props.className).includes("dsmn_providerToggle")), null);
  assert.equal(collectElements(sectionOf(tree, "provider", "deepseek-account"), n => n.props["data-depth"] === "3").length, 2);
});

test("0.3.3：折叠的家族不构造模型行", () => {
  const f = navigatorFixture({ directory: staticDirectory(TWO_PROVIDER_SNAPSHOT()) });
  const tree = f.openModels();
  const rowsIn = (t) => collectElements(sectionOf(t, "provider", "workbuddy"), n => n.props["data-depth"] === "3").length;
  const expanded = rowsIn(tree);
  const toggles = collectElements(sectionOf(tree, "provider", "workbuddy"), n => n.props["aria-expanded"] === "true" && n.props["data-depth"] === "2");
  assert.ok(toggles.length > 0, "当前家族默认展开");
  for (const toggle of toggles) toggle.props.onClick();
  assert.ok(expanded > 0);
  assert.equal(rowsIn(f.draw()), 0, "全部折叠后不应再有模型行（哪怕是隐藏的）");
});

test("0.3.3：星标与 › 不进方向键序列，↓ 在模型之间移动", () => {
  const f = navigatorFixture();
  f.expandProviders("vendor-b");
  const tree = f.openModels();
  const log = [];
  const nodes = attachFocusRefs(tree, log);
  assert.equal(nodes.filter(entry => entry.element.props["data-action"] !== undefined).length, 0, "星标与 › 不挂导航 ref");
  const models = nodes.filter(entry => entry.element.props["data-depth"] === "3");
  assert.equal(models.length, 3);
  const root = findElement(tree, n => n.props.className === "dsmn_root");
  root.props.onKeyDown(keyEvent("ArrowDown", models[0].node));
  assert.equal(focused[focused.length - 1], models[1].node, "↓ 落到下一个模型行而不是第一行的星标");
});

test("0.4.0：焦点等定位完成；不可寻址时打开直接进模型页并聚焦搜索框；↑/↓ 只移动高亮，Enter 选择", () => {
  const f = navigatorFixture({ directory: staticDirectory(searchable({ ...SNAPSHOT, current: null })) });
  f.expandProviders("deepseek-account", "vendor-b");
  const log = [];
  let tree = f.open();
  assert.equal(paneOf(tree), "model", "没有当前选择时与官方一样直接进模型页");
  assert.deepEqual(log, [], "浮层定位前是 visibility:hidden，不能提前 focus");
  placeMenu(f, tree, log);
  tree = f.draw();
  assert.deepEqual(log, ["search"], "定位完成后聚焦搜索框");

  const search = findElement(tree, n => n.props.role === "searchbox").props.ref.current;
  const press = (key) => findElement(tree, n => n.props.className === "dsmn_root").props.onKeyDown(keyEvent(key, search));
  const rows = () => collectElements(tree, n => n.props["data-depth"] === "3");
  assert.equal(rows()[0].props["data-highlighted"], "", "没有当前模型时高亮第一行");

  press("ArrowDown");
  tree = f.draw();
  assert.equal(log[log.length - 1], "search", "焦点留在搜索框（与官方 activedescendant 模式一致）");
  assert.equal(rows()[1].props["data-highlighted"], "");
  assert.equal(findElement(tree, n => n.props.role === "searchbox").props["aria-activedescendant"], rows()[1].props.id);

  press("ArrowUp");
  tree = f.draw();
  press("ArrowUp");
  tree = f.draw();
  const last = rows()[rows().length - 1];
  assert.equal(last.props["data-highlighted"], "", "↑ 从第一行回绕到最后一行");

  press("Enter");
  assert.equal(paneOf(f.draw()), "effort", "Enter 选中高亮的模型：有多档可选时先进思维强度页");
  assert.equal(f.selectCalls.length, 0);
});

test("0.3.3：根层按 Esc 关闭后焦点回到触发器", async () => {
  const f = navigatorFixture();
  f.open();
  const log = [];
  findElement(f.draw(), n => n.props.className === "dsmn_trigger").props.ref.current = { focus() { log.push("trigger"); } };
  findElement(f.draw(), n => n.props.className === "dsmn_root").props.onKeyDown(keyEvent("Escape", null));
  assert.equal(paneOf(f.draw()), null);
  await flush();
  assert.deepEqual(log, ["trigger"]);
});

/* ================================================================== *
 * 0.4.0：conversation.input.model.label 标签槽位
 * 官方 ModelSelect 声明这个子槽位，其他插件（如「1017」角标）往里注册标签组件。
 * 我们替换了官方入口，所以自己读 SlotCore 的胜出项并按官方 props 顺序渲染。
 * ================================================================== */

function labelEntry(component, extra = {}) {
  return {
    component,
    locale: "label-1017",
    registrant: "label-1017",
    inject: (sessionId) => ({ sessionId, badgeText: "1017", hooks: { useBadge() {} }, keyedHooks: {} }),
    ...extra,
  };
}

test("0.4.0：标签槽位的注册项在触发器、根层 cell 与模型行里渲染，props 与官方渲染器同形", () => {
  const seen = [];
  const harness = makeHarness();
  const Badge = (p) => { seen.push(p); return harness.React.createElement("b", { className: "badge-1017" }, p.badgeText); };
  const f = navigatorFixture({}, harness, { labelEntries: [labelEntry(Badge)], localeBind: (ns) => (key) => ns + ":" + key });
  f.expandProviders("vendor-b");

  const triggerLabel = findElement(f.trigger(), n => n.props.className === "dsmn_label");
  assert.equal(triggerLabel.props["data-provider-id"], "deepseek-account");
  assert.equal(triggerLabel.props["data-model-id"], "deepseek-flash");
  assert.ok(findElement(triggerLabel, n => n.props.className === "badge-1017"), "触发器上的模型名换成标签组件");
  const onTrigger = seen.find(p => p.placement === "trigger");
  assert.equal(onTrigger.selected, true);
  assert.equal(onTrigger.sessionId, "session-regression");
  assert.equal(onTrigger.provider.id, "deepseek-account");
  assert.equal(onTrigger.provider.name, "DeepSeek 账户");
  assert.equal(onTrigger.model.id, "deepseek-flash");
  assert.equal(onTrigger.model.name, "DeepSeek Flash");
  assert.ok(onTrigger.model.reasoning, "传宿主原始 model，标签插件可按任意字段判断");
  assert.equal(onTrigger.badgeText, "1017", "entry.inject(sessionId) 的结果并入 props");
  assert.equal("hooks" in onTrigger, false, "宿主 hooks 源无法绑定，必须丢掉");
  assert.equal("keyedHooks" in onTrigger, false);
  assert.equal(onTrigger.t("x"), "label-1017:x", "t 按标签项自己的 locale 命名空间绑定");

  const root = f.open();
  assert.ok(findElement(findElement(root, n => n.props["data-cell"] === "model"), n => n.props.className === "badge-1017"));
  assert.ok(seen.some(p => p.placement === "menu" && p.selected === true));

  const rows = collectElements(f.openModels(), n => n.props["data-depth"] === "3");
  assert.equal(rows.length, 3);
  for (const row of rows) assert.ok(findElement(row, n => n.props.className === "badge-1017"), "每个模型行都渲染标签");
  const chat = seen.find(p => p.placement === "option" && p.model.id === "deepseek-chat");
  assert.equal(chat.selected, false);
  assert.equal(chat.provider.id, "deepseek-account");

  const diag = f.window.__DSMN_DIAG__.label;
  assert.equal(diag.api, true);
  assert.equal(diag.entry, "label-1017");
  assert.ok(diag.renders > 0);
  assert.equal(diag.errors, 0);
});

test("0.4.0：标签组件抛错时退回纯文本模型名，并记进 DIAG.label", () => {
  const f = navigatorFixture({}, makeHarness(), { labelEntries: [labelEntry(() => { throw new Error("badge boom"); })] });
  f.expandProviders("vendor-b");
  const label = findElement(f.trigger(), n => n.props.className === "dsmn_label");
  assert.equal(textOf(label), "DeepSeek Flash");
  const diag = f.window.__DSMN_DIAG__.label;
  assert.ok(diag.errors >= 1);
  assert.ok(diag.fallbacks >= 1);
  assert.equal(diag.lastError, "badge boom");
  assert.equal(collectElements(f.openModels(), n => n.props["data-depth"] === "3").length, 3, "一个标签出错不能拖垮菜单");
});

test("0.4.0：宿主没有 SlotCore 读接口、或读取抛错时照常显示纯文本模型名", () => {
  const none = navigatorFixture({}, makeHarness(), { labelApi: false });
  assert.equal(textOf(findElement(none.trigger(), n => n.props.className === "dsmn_label")), "DeepSeek Flash");
  assert.equal(none.window.__DSMN_DIAG__.label.api, false);
  assert.equal(none.window.__DSMN_DIAG__.label.entry, null);

  const throwing = navigatorFixture({}, makeHarness(), { labelEntriesThrow: true });
  throwing.expandProviders("vendor-b");
  const rows = collectElements(throwing.openModels(), n => n.props["data-depth"] === "3");
  assert.equal(rows.length, 3);
  assert.ok(rows.some(row => textOf(row).includes("DeepSeek Flash")));
  assert.equal(throwing.window.__DSMN_DIAG__.label.api, true);
  assert.equal(throwing.window.__DSMN_DIAG__.label.entry, null);
});

test("0.4.0：标签槽位版本变化后，下一次渲染带上新注册的标签", () => {
  const harness = makeHarness();
  const entries = [];
  const ctxOptions = { labelEntries: entries, labelVersion: 0 };
  const f = navigatorFixture({}, harness, ctxOptions);
  assert.equal(findElement(f.trigger(), n => n.props.className === "badge-1017"), null);
  entries.push(labelEntry(() => harness.React.createElement("b", { className: "badge-1017" }, "1017")));
  ctxOptions.labelVersion = 1;
  for (const fn of f.labelSubscribers.slice()) fn();
  assert.ok(findElement(f.trigger(), n => n.props.className === "badge-1017"));
});

/* ================================================================== *
 * 宿主 0.2.1-rc.1 的 ModelDirectory 快照语义
 * ================================================================== */

test("0.2.1：后台刷新保留 groups（status=loading）时模型照常可选，并显示「刷新中」", async () => {
  const snapshot = { ...SNAPSHOT, status: "loading", routable: null };
  const f = navigatorFixture({ directory: { subscribe: () => () => {}, getSnapshot: () => snapshot } });
  const chat = f.chooseChat();
  assert.ok(findElement(f.draw(), n => n.props.className === "dsmn_status" && textOf(n) === "refreshing"));
  assert.notEqual(chat.props.disabled, true, "刷新期间不能把整片模型置灰");
  chat.props.onClick();
  assert.deepEqual(plain(f.selectCalls), [{ provider: "deepseek-account", model: "deepseek-chat" }]);
  await Promise.resolve();
  assert.equal(f.face.store.getPreferences().lastModelByProvider["deepseek-account"], "deepseek-chat");
});

test("0.2.1：刷新失败保留 groups（status=error）时仍可选择，并给出重试", () => {
  const snapshot = { ...SNAPSHOT, status: "error", error: "network: offline" };
  const f = navigatorFixture({ directory: { subscribe: () => () => {}, getSnapshot: () => snapshot } });
  const chat = f.chooseChat();
  assert.ok(findElement(f.draw(), n => n.props["data-action"] === "retry-catalog"));
  assert.notEqual(chat.props.disabled, true, "保留的 groups 仍然可选");
  chat.props.onClick();
  assert.equal(f.selectCalls.length, 1);
});

test("0.2.1：加载失败的供应商以警告行列出（不可选），可重试，账户名走本地化", () => {
  let loads = 0;
  const snapshot = { ...SNAPSHOT, failures: [
    { id: "openai", name: "OpenAI", message: "401 Unauthorized" },
    { id: "deepseek-account", name: "deepseek-account", message: "signed out" },
  ] };
  const f = navigatorFixture({ directory: { subscribe: () => () => {}, getSnapshot: () => snapshot }, load: () => { loads++; } });
  assert.equal(collectElements(f.openModels(), n => n.props.className === "dsmn_warning").length, 0, "失败供应商默认收在折叠的不可用分组里");
  const rows = collectElements(f.openUnavailable(), n => n.props.className === "dsmn_warning");
  assert.deepEqual(rows.map(n => n.props["data-failed-provider"]), ["openai", "deepseek-account"]);
  assert.match(textOf(rows[0]), /OpenAI.*groupLoadFailed.*401 Unauthorized/);
  assert.match(textOf(rows[1]), /DeepSeek 账户/);
  assert.equal(findElement(rows[0], n => n.props.role === "menuitemradio"), null, "失败行不可选");
  const before = loads;
  findElement(rows[0], n => n.props["data-action"] === "retry-provider").props.onClick();
  assert.equal(loads, before + 1);
});

test("0.4.0：失效收藏/最近使用与失败供应商归入底部默认折叠的「不可用」分组", () => {
  const key = (p, m) => JSON.stringify([p, m]);
  const snapshot = { ...SNAPSHOT, failures: [{ id: "openai", name: "OpenAI", message: "401" }] };
  const f = navigatorFixture({ directory: staticDirectory(snapshot) });
  f.face.store.patch({
    favorites: [key("gone", "a"), key("deepseek-account", "deepseek-chat")],
    recentModels: [key("gone", "b"), key("deepseek-account", "deepseek-flash")],
  });
  const tree = f.openModels();
  const sections = collectElements(tree, n => n.props["data-section"] !== undefined).map(n => n.props["data-section"]);
  assert.equal(sections[sections.length - 1], "unavailable", "位于模型页最底部");
  const section = sectionOf(tree, "unavailable");
  assert.equal(section.props["data-collapsed"], "true");
  const toggle = findElement(section, n => n.props["data-action"] === "toggle-unavailable");
  assert.equal(toggle.props["aria-expanded"], "false");
  assert.equal(textOf(findElement(toggle, n => n.props.className === "dsmn_groupCount")), "3", "计数含 2 条失效记录 + 1 个失败供应商");
  assert.equal(findElement(section, n => n.props["data-unavailable-model"] !== undefined), null, "折叠时不构造行");
  assert.equal(findElement(tree, n => n.props["data-unavailable-model"] !== undefined), null, "其他分组里也不出现失效行");
  // 可用的收藏/最近使用照常显示
  assert.match(textOf(sectionOf(tree, "favorites")), /DeepSeek Chat/);
  assert.match(textOf(sectionOf(tree, "recent")), /deepseek-flash|Flash/);
  toggle.props.onClick();
  assert.equal(f.face.store.getPreferences().showUnavailable, true, "展开状态写进偏好");
  const opened = sectionOf(f.draw(), "unavailable");
  assert.equal(paneOf(f.draw()), "model", "展开不关闭菜单");
  assert.equal(f.selectCalls.length, 0);
  assert.equal(collectElements(opened, n => n.props["data-unavailable-model"] !== undefined).length, 2);
  assert.equal(collectElements(opened, n => n.props["data-failed-provider"] !== undefined).length, 1);
  findElement(opened, n => n.props["data-action"] === "toggle-unavailable").props.onClick();
  assert.equal(f.face.store.getPreferences().showUnavailable, false);
});

test("0.4.0：没有不可用项时不显示「不可用」分组；搜索时也不显示", () => {
  const f = navigatorFixture({ directory: staticDirectory(searchable()) });
  assert.equal(sectionOf(f.openModels(), "unavailable"), null);
  f.face.store.patch({ favorites: [JSON.stringify(["gone", "a"])] });
  assert.ok(sectionOf(f.draw(), "unavailable"));
  findElement(f.draw(), n => n.props.role === "searchbox").props.onChange({ target: { value: "chat" } });
  assert.equal(sectionOf(f.draw(), "unavailable"), null);
});

test("0.4.0：失效最近使用不占「最近使用」的 5 个名额；目录加载中失效项留在原位", () => {
  const key = (p, m) => JSON.stringify([p, m]);
  const extra = { id: "vendor-c", name: "Vendor C", models: [1, 2, 3, 4, 5].map(i => ({ id: "c" + i, name: "C" + i })) };
  const big = { ...SNAPSHOT, groups: [...SNAPSHOT.groups, extra] };
  const f = navigatorFixture({ directory: staticDirectory(big) });
  f.face.store.patch({ recentModels: [key("gone", "x"), key("gone", "y"), ...[1, 2, 3, 4, 5].map(i => key("vendor-c", "c" + i))] });
  const recent = sectionOf(f.openModels(), "recent");
  assert.equal(collectElements(recent, n => n.props.role === "menuitemradio").length, 5);
  assert.equal(findElement(recent, n => n.props["data-unavailable-model"] !== undefined), null);

  const loading = navigatorFixture({ directory: staticDirectory({ ...SNAPSHOT, groups: [], status: "loading" }) });
  loading.face.store.patch({ favorites: [key("gone", "a")] });
  const tree = loading.openModels();
  assert.equal(sectionOf(tree, "unavailable"), null, "加载中无法判断是否失效");
  assert.ok(findElement(sectionOf(tree, "favorites"), n => n.props["data-unavailable-model"] === key("gone", "a")));
});

test("0.4.0：所有供应商都加载失败时仍显示空目录与刷新，失败项在「不可用」分组", () => {
  const f = navigatorFixture({ directory: staticDirectory({ ...SNAPSHOT, groups: [], failures: [{ id: "openai", name: "OpenAI", message: "401" }] }) });
  const tree = f.openModels();
  assert.ok(findElement(tree, n => n.props.className === "dsmn_empty" && textOf(n).includes("emptyCatalog")));
  assert.ok(findElement(tree, n => n.props["data-action"] === "refresh-catalog"));
  assert.ok(sectionOf(tree, "unavailable"));
});

/** 取某个选择器的声明（样式表压缩成一行，取第一条完全匹配的规则）。 */
function cssRule(css, selector) {
  const start = css.indexOf(`${selector}{`);
  assert.notEqual(start, -1, `缺少样式规则 ${selector}`);
  return css.slice(start + selector.length + 1, css.indexOf("}", start));
}

const cssNumber = (body, property) => Number(new RegExp(`(?:^|;)${property}:(\\d+)`).exec(body)?.[1]);

test("0.4.0 层级：供应商、模型、家族、分区标题的字号逐级递减，颜色互不相同", () => {
  const css = styleTextOf(navigatorFixture({ directory: staticDirectory(SNAPSHOT) }).document);
  const provider = cssRule(css, ".dsmn_providerToggle");
  const family = cssRule(css, ".dsmn_groupToggle");
  const section = cssRule(css, ".dsmn_menuGroupLabel");
  assert.deepEqual(
    [provider, cssRule(css, ".dsmn_modelName"), family, section].map((body) => cssNumber(body, "font-size")),
    [14, 13, 12, 11],
  );
  assert.deepEqual([provider, family].map((body) => cssNumber(body, "font-weight")), [600, 500]);
  assert.match(provider, /color:var\(--dsw-alias-label-primary\)/);
  assert.match(family, /color:var\(--dsw-alias-label-tertiary\)/);
  assert.match(section, /color:var\(--dsw-alias-label-caption\)/);
});

test("0.4.0 层级：「不可用」不是供应商，用分区标题的字阶并与上方分隔", () => {
  const css = styleTextOf(navigatorFixture({ directory: staticDirectory(SNAPSHOT) }).document);
  const toggle = cssRule(css, ".dsmn_section[data-section=unavailable] .dsmn_providerToggle");
  assert.equal(cssNumber(toggle, "font-size"), 11);
  assert.match(toggle, /color:var\(--dsw-alias-label-caption\)/);
  assert.match(css, /\.dsmn_section\+\.dsmn_section\[data-section=unavailable\]\{[^}]*border-top:1px solid/);
  assert.match(css, /\.dsmn_section\[data-section=recent\]\+\.dsmn_section\[data-section=provider\]/, "收藏/最近与供应商树之间也有分隔");
});

test("0.4.0 层级：半透明菜单上标题不吸顶，官方 MenuGroup 存在时也用自己的标题", () => {
  const harness = makeHarness();
  let officialGroups = 0;
  let stickyObservers = 0;
  harness.Primitives = {
    MenuGroup(props) {
      officialGroups += 1;
      return harness.React.createElement("div", {}, props.children);
    },
    observeStickyMenuGroups() {
      stickyObservers += 1;
      return () => {};
    },
  };
  const f = navigatorFixture({ directory: staticDirectory(searchable()), t: (key) => key }, harness);
  f.face.store.patch({ favorites: [JSON.stringify(["vendor-b", "qwen3-max"])] });
  const label = findElement(sectionOf(f.openModels(), "favorites"), n => n.props.className === "dsmn_menuGroupLabel");
  assert.equal(textOf(label), "favorites");
  assert.equal(officialGroups, 0);
  assert.equal(stickyObservers, 0);
  assert.ok(!styleTextOf(f.document).includes("position:sticky"), "吸顶后滚过的行会透出来和标题重叠");
});

test("0.4.0 层级：缩进由行前实际的标题层数决定", () => {
  const tree = TWO_PROVIDER_SNAPSHOT();
  const rows = (section) => collectElements(section, n => String(n.props.className).startsWith("dsmn_modelRow"));
  const families = (section) => collectElements(section, n => n.props["data-depth"] === "2");
  const indents = (nodes) => [...new Set(nodes.map(n => n.props["data-indent"]))];

  // 多供应商 + 多家族：家族 1 级，模型 2 级；单家族供应商的模型直接挂在供应商下
  const nested = navigatorFixture({ directory: staticDirectory(tree) });
  const opened = sectionOf(nested.openModels(), "provider", "workbuddy");
  assert.deepEqual(indents(families(opened)), ["1"]);
  assert.deepEqual(indents(rows(opened)), ["2"]);
  nested.expandProviders("deepseek-account");
  const single = sectionOf(nested.draw(), "provider", "deepseek-account");
  assert.equal(families(single).length, 0);
  assert.deepEqual(indents(rows(single)), ["1"]);

  // 单供应商没有供应商标题：整棵树上移一级
  const oneProvider = sectionOf(
    navigatorFixture({ directory: staticDirectory({ ...tree, groups: [tree.groups[0]] }) }).openModels(),
    "provider", "workbuddy",
  );
  assert.deepEqual(indents(families(oneProvider)), [undefined]);
  assert.deepEqual(indents(rows(oneProvider)), ["1"]);

  // 单供应商 + 单家族：没有任何折叠标题，不缩进
  const plainList = sectionOf(
    navigatorFixture({ directory: staticDirectory({ ...SNAPSHOT, groups: [SNAPSHOT.groups[0]] }) }).openModels(),
    "provider", "deepseek-account",
  );
  assert.deepEqual(indents(rows(plainList)), [undefined]);

  // 收藏不属于树，不缩进
  const f = navigatorFixture({ directory: staticDirectory(tree) });
  f.face.store.patch({ favorites: [JSON.stringify(["workbuddy", "glm-5.3"])] });
  assert.deepEqual(indents(rows(sectionOf(f.openModels(), "favorites"))), [undefined]);
});

test("0.4.0 层级：当前模型折叠时由蓝点标出所在分组，展开时由模型行标出", () => {
  const f = navigatorFixture({ directory: staticDirectory(TWO_PROVIDER_SNAPSHOT()) });
  const mark = (node) => findElement(node, n => n.props.className === "dsmn_currentMark");
  const section = () => sectionOf(f.draw(), "provider", "workbuddy");
  const provider = () => findElement(section(), n => n.props["data-depth"] === "1");
  const family = () => findElement(section(), n => n.props["data-depth"] === "2" && n.props["aria-current"] === "true");

  f.openModels();
  assert.equal(mark(section()), null, "路径完全展开时不再重复标记");
  assert.match(textOf(findElement(section(), n => n.props["data-current"] === "true")), /Hy4 preview/);
  assert.equal(provider().props["aria-current"], "true");

  family().props.onClick();
  assert.equal(findElement(section(), n => n.props["data-current"] === "true"), null, "折叠后模型行不再构造");
  assert.ok(mark(family()), "家族折叠：蓝点落在家族上");
  assert.equal(mark(provider()), null);

  provider().props.onClick();
  assert.ok(mark(provider()), "供应商折叠：蓝点落在供应商上");
  f.expandProviders("deepseek-account");
  assert.equal(mark(sectionOf(f.draw(), "provider", "deepseek-account")), null, "其他供应商不带蓝点");
});

test("0.4.0 层级：收起供应商时连带收回家族，重新展开只见家族标题", () => {
  const f = navigatorFixture({ directory: staticDirectory(TWO_PROVIDER_SNAPSHOT()) });
  const section = () => sectionOf(f.draw(), "provider", "workbuddy");
  const provider = () => findElement(section(), n => n.props["data-depth"] === "1");
  const families = () => collectElements(section(), n => n.props["data-depth"] === "2");
  const family = (label) => families().find(n => textOf(n).includes(label));
  const rows = () => collectElements(section(), n => n.props["data-depth"] === "3");
  const otherProvider = "deepseek-account\u0000deepseek";
  f.face.store.patch({ collapsedFamilies: { [otherProvider]: false } });

  f.openModels();
  family("Kimi").props.onClick();
  assert.ok(rows().some(n => textOf(n).includes("Kimi-K3.1")), "手动展开的家族");
  assert.ok(rows().some(n => textOf(n).includes("Hy4 preview")), "默认展开的当前家族");

  provider().props.onClick();
  assert.equal(provider().props["aria-expanded"], "false");
  provider().props.onClick();
  assert.equal(provider().props["aria-expanded"], "true");
  assert.ok(families().length > 1);
  assert.ok(families().every(n => n.props["aria-expanded"] === "false"), "家族全部收回，包括当前家族");
  assert.equal(rows().length, 0, "模型行也不再构造");
  assert.ok(findElement(families().find(n => n.props["aria-current"] === "true"), n => n.props.className === "dsmn_currentMark"), "蓝点标出当前模型所在的家族");
  assert.equal(f.face.store.getPreferences().collapsedFamilies[otherProvider], false, "其他供应商的展开状态不受影响");

  family("Kimi").props.onClick();
  assert.ok(rows().some(n => textOf(n).includes("Kimi-K3.1")), "收回后仍可逐个展开");
  assert.equal(f.selectCalls.length, 0);
});

test("0.4.0 层级：折叠箭头始终是同一个节点，由样式旋转", () => {
  const f = navigatorFixture({ directory: staticDirectory(TWO_PROVIDER_SNAPSHOT()) });
  const glyphs = (tree) => collectElements(tree, n => n.props.className === "dsmn_groupChevron").map((n) => textOf(n));
  const all = glyphs(f.openModels());
  assert.ok(all.length > 2);
  assert.deepEqual([...new Set(all)], ["›"], "展开和折叠用同一个图标");
  assert.match(styleTextOf(f.document), /\.dsmn_providerToggle\[aria-expanded=true\] \.dsmn_groupChevron[^{]*\{transform:rotate\(90deg\)/);
  assert.match(styleTextOf(f.document), /prefers-reduced-motion:reduce\)\{\.dsmn_groupChevron\{transition:none/);
});

test("0.4.0 层级：高亮覆盖整行（含星标与 ›），星标列对齐", () => {
  const f = navigatorFixture({ directory: staticDirectory(TWO_PROVIDER_SNAPSHOT()) });
  const rows = collectElements(f.openModels(), n => n.props["data-active"] === "true");
  assert.equal(rows.length, 1);
  assert.match(textOf(rows[0]), /Hy4 preview/);
  const css = styleTextOf(f.document);
  assert.match(cssRule(css, ".dsmn_modelRow[data-active=true]"), /interactive-bg-hover/);
  assert.match(css, /\.dsmn_modelRow\[data-active=true\] \.dsmn_pin/, "键盘高亮时也显示星标");
  assert.match(cssRule(css, ".dsmn_pin:last-child"), /margin-right:26px/, "没有 › 的行要给它留位");
});

test("0.4.0 层级：显示名与 ID 只差大小写时不重复一行，完整 ID 留在 title", () => {
  const snapshot = {
    ...SNAPSHOT,
    current: { provider: "p", model: "gpt-5.4" },
    groups: [{ id: "p", label: "P", models: [{ id: "gpt-5.4", name: "GPT-5.4" }, { id: "remote/gpt-6", name: "GPT-6" }] }],
  };
  const tree = navigatorFixture({ directory: staticDirectory(snapshot) }).openModels();
  const row = (name) => findElement(tree, n => n.props["data-depth"] === "3" && textOf(n).includes(name));
  const meta = (node) => findElement(node, n => n.props.className === "dsmn_modelMeta");
  assert.equal(meta(row("GPT-5.4")), null);
  assert.match(row("GPT-5.4").props.title, /gpt-5\.4/);
  assert.equal(textOf(meta(row("GPT-6"))), "remote/gpt-6", "ID 与名称不同时照常显示");
});

test("0.4.0 层级：模型页定宽，搜索框铺满整行", () => {
  const css = styleTextOf(navigatorFixture({ directory: staticDirectory(SNAPSHOT) }).document);
  assert.match(css, /\.dsmn_menu\[data-pane=model\]\{width:min\(400px,100vw - 32px\)\}/, "菜单靠右定位，内容宽度一变就会在光标下横移");
  const search = cssRule(css, ".dsmn_searchRow .dsmn_search");
  assert.match(search, /box-sizing:border-box/);
  assert.match(search, /width:100%/);
});

test("0.4.0 层级：只有供应商加载失败才点亮「不可用」计数；抽屉里的行缩进一级", () => {
  const key = JSON.stringify(["gone", "a"]);
  const toggleOf = (f) => findElement(sectionOf(f.draw(), "unavailable"), n => n.props["data-action"] === "toggle-unavailable");

  const stale = navigatorFixture({ directory: staticDirectory(SNAPSHOT) });
  stale.face.store.patch({ favorites: [key] });
  stale.openModels();
  assert.equal(toggleOf(stale).props["data-has-failure"], undefined, "失效收藏只是过期记录，不算故障");

  const failed = navigatorFixture({ directory: staticDirectory({ ...SNAPSHOT, failures: [{ id: "openai", name: "OpenAI", message: "401" }] }) });
  failed.face.store.patch({ favorites: [key], showUnavailable: true });
  failed.openModels();
  assert.equal(toggleOf(failed).props["data-has-failure"], "true");
  const row = findElement(sectionOf(failed.draw(), "unavailable"), n => n.props["data-unavailable-model"] === key);
  assert.equal(row.props["data-indent"], "1");
});

test("0.4.0 层级：子级不重复分组标题已说明的信息", () => {
  const f = navigatorFixture({ directory: staticDirectory(searchable(SNAPSHOT)) });
  const input = findElement(f.openModels(), n => n.props.role === "searchbox");
  input.props.onChange({ target: { value: "deepseek-chat" } });
  const group = findElement(f.draw(), n => n.props["data-section"] === "search");
  const heading = textOf(findElement(group, n => n.props.className === "dsmn_menuGroupLabel"));
  for (const meta of collectElements(group, n => n.props.className === "dsmn_modelMeta")) {
    assert.ok(!textOf(meta).includes(heading), "搜索结果的行里不再写一遍供应商");
  }

  const known = JSON.stringify([SNAPSHOT.current.provider, "retired-model"]);
  const malformed = "not-a-key";
  const stale = navigatorFixture({ directory: staticDirectory(SNAPSHOT) });
  stale.face.store.patch({ favorites: [known, malformed] });
  const drawer = stale.openUnavailable();
  const metaOf = (key) => findElement(findElement(drawer, n => n.props["data-unavailable-model"] === key), n => n.props.className === "dsmn_modelMeta");
  assert.equal(textOf(metaOf(known)), "DeepSeek 账户", "抽屉里的行只留供应商");
  assert.equal(metaOf(malformed), null, "解析不出供应商时不留空的第二行");
});

test("0.2.1：宿主 routable=false 时以宿主为准标注「当前选择不在目录中」", () => {
  const snapshot = { ...SNAPSHOT, routable: false };
  const f = navigatorFixture({ directory: { subscribe: () => () => {}, getSnapshot: () => snapshot } });
  assert.ok(findElement(f.open(), n => n.props.className === "dsmn_status" && textOf(n).includes("currentOutside")));
  const routable = navigatorFixture();
  assert.equal(findElement(routable.open(), n => n.props.className === "dsmn_status" && textOf(n).includes("currentOutside")), null);
});

test("0.2.1：选择失败把目录置为 error 时，只报「选择失败」，不误报目录加载失败，且可直接重选", async () => {
  let snapshot = SNAPSHOT;
  let calls = 0;
  const f = navigatorFixture({
    directory: { subscribe: () => () => {}, getSnapshot: () => snapshot },
    select: () => {
      calls++;
      // 复刻 0.2.1 ModelDirectory.select 的失败路径：store 进 error，再返回 { ok:false }
      snapshot = { ...SNAPSHOT, status: "error", pending: null, error: "session/writer-held: held by another writer" };
      return Promise.resolve({ ok: false, error: { code: "session/writer-held", message: "held by another writer" } });
    },
  });
  f.chooseChat().props.onClick();
  await Promise.resolve();
  await Promise.resolve();
  const tree = f.draw();
  assert.ok(findElement(tree, n => n.props.className === "dsmn_error" && textOf(n) === "sessionInUse"));
  assert.equal(findElement(tree, n => n.props["data-action"] === "retry-catalog"), null);
  const chat = findElement(tree, n => n.props["data-depth"] === "3" && textOf(n).includes("DeepSeek Chat"));
  assert.notEqual(chat.props.disabled, true);
  chat.props.onClick();
  assert.equal(calls, 2, "失败后无需等目录事件即可再次提交");
});
