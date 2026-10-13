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
    useLayoutEffect() {},
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

test("generated core keeps to ES5", () => {
  // 只检查生成器插入的 src/core 片段；window.__ModuleLoader__.load 包装层
  // 是模板自己写的（不受 toEs5 约束，运行环境原生支持现代语法）。
  const source = fs.readFileSync(CLIENT, "utf8");
  const start = source.indexOf("/* ==== src/core/identity.mjs");
  const end = source.indexOf("var __core = {");
  assert.ok(start > 0 && end > start, "generated core markers must be present");
  const generated = source.slice(start, end);
  assert.ok(!generated.includes("=>"), "no arrow functions in generated core");
  assert.ok(!generated.includes("??"), "no nullish coalescing in generated core");
  assert.ok(!generated.includes("?."), "no optional chaining in generated core");
  assert.ok(!generated.includes("`"), "no template literals in generated core");
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
      bind: () => (key) => key,
    },
    cordisInspect: {
      register(registration) {
        inspectRegistrations.push(registration);
        return () => { inspectDisposals += 1; };
      },
    },
  };

  if (options.withInspect === false) delete services.cordisInspect;

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
  assert.ok(css.includes(".dsmn-trigger"), "样式必须真的写进标签里");
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

test("inject(sessionId) returns an identity-stable face and seeds the draft", () => {
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

test("三级流程：供应商 → 家族 → 模型 → 思维强度，并原样提交 reasoningEffort", async () => {
  const harness = makeHarness();
  const { exports, render } = loadBundle(CLIENT, harness);
  const { ctx, registrations, selectCalls } = fakeCtx();
  exports.apply(ctx);
  const face = registrations[0].options.inject("session-1");
  const props = { ...face, t: T, locked: false };

  const closed = render(registrations[0].component(props));
  const trigger = findElement(closed, (node) => node.props.className === "dsmn_trigger");
  assert.ok(trigger, "trigger must exist in the closed state");
  trigger.props.onClick();

  // 第 1 级：供应商（官方 cell 行）
  let tree = render(registrations[0].component(props));
  assert.ok(findElement(tree, (node) => String(node.props.className).includes("dsmn_menu")), "menu must render when open");
  const deepseek = findElement(tree, (node) => node.props["data-depth"] === "1" && textOf(node).includes("DeepSeek"));
  assert.ok(deepseek, "供应商行必须可点");
  deepseek.props.onClick();

  // 第 2 级：模型（家族标题 + 行；宿主名在可见文案里）
  tree = render(registrations[0].component(props));
  const model = findElement(tree, (node) => node.props["data-depth"] === "3" && textOf(node).includes("DeepSeek Flash"));
  assert.ok(model, "模型行必须出现");
  model.props.onClick();

  // 第 3 级：思维强度（只能来自宿主公布的努力等级）
  tree = render(registrations[0].component(props));
  assert.equal(depthRows(tree).filter((row) => row.depth === "4").length, 2, "deepseek-flash 公布了 low/high 两档");
  const high = findElement(tree, (node) => node.props["data-depth"] === "4" && textOf(node).includes("高"));
  assert.ok(high, "档位文案必须来自 reasoning.efforts[].name");
  high.props.onClick();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    JSON.stringify(selectCalls),
    JSON.stringify([{ provider: "deepseek-account", model: "deepseek-flash", reasoningEffort: "high" }]),
    "提交必须携带真实档位，且不改名不折叠",
  );
});

test("0.1.3 回归：供应商标题取宿主的 name；按厂商分桶；未识别的进「其他」；单家族平铺", async () => {
  const harness = makeHarness();
  const { exports, render } = loadBundle(CLIENT, harness);
  const { ctx, registrations } = fakeCtx();
  exports.apply(ctx);
  const face = registrations[0].options.inject("session-1");

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
  const directory = { subscribe: () => () => {}, getSnapshot: () => WORKBUDDY };
  const props = { ...face, directory, t: T, locked: false };

  const closed = render(registrations[0].component(props));
  findElement(closed, (node) => node.props.className === "dsmn_trigger").props.onClick();

  let tree = render(registrations[0].component(props));
  assert.equal(depthRows(tree).filter((row) => row.depth === "1").length, 2, "两个供应商都要出现");

  // 缺陷 A：组显示名必须取 `name`（0.1.2 读不存在的 `label` → 回退到裸 id，再被 CSS 大写）
  const workbuddy = findElement(
    tree,
    (node) => node.props["data-depth"] === "1" && textOf(node).includes("WorkBuddy"),
  );
  assert.ok(workbuddy, "供应商标题必须用宿主给的 group.name");
  assert.ok(!textOf(workbuddy).includes("WORKBUDDY"), "不得被大写化");
  assert.ok(!/\bworkbuddy\b/.test(textOf(workbuddy)), "不得回退成裸 providerId");

  // 官方对 deepseek-account 硬编码本地化词条，我们跟随
  const account = findElement(
    tree,
    (node) => node.props["data-depth"] === "1" && textOf(node).includes("DeepSeek 账户"),
  );
  assert.ok(account, "deepseek-account 必须渲染本地化标题");

  workbuddy.props.onClick();
  tree = render(registrations[0].component(props));

  // 缺陷 B：家族标题必须是家族名；无法识别的进「其他」，绝不能拿模型 ID 当标题
  for (const label of ["Hunyuan", "GLM", "Kimi", "MiniMax", "其他"]) {
    assert.ok(
      findElement(tree, (node) => node.props["data-depth"] === "2" && textOf(node).includes(label)),
      `家族标题必须出现：${label}`,
    );
  }
  assert.equal(
    findElement(tree, (node) => node.props["data-depth"] === "2" && textOf(node).includes("hy4-preview")),
    null,
    "家族标题绝不能是模型 ID（0.1.2 的「hy4-preview 8 个模型」）",
  );

  // 模型行显示宿主的 name（计费/促销后缀由宿主拼好），完整 ID 走 title
  const hy4 = findElement(
    tree,
    (node) => node.props["data-depth"] === "3" && textOf(node).includes("Hy4 preview · x0.29 · 夜间免费"),
  );
  assert.ok(hy4, "模型行必须原样显示宿主的 name");
  assert.equal(hy4.props.title, "Hy4 preview · x0.29 · 夜间免费", "title 取宿主的 name（官方行为）");

  // 计划 §5.6：只有一个普通家族的供应商平铺，不出现家族标题
  account.props.onClick();
  tree = render(registrations[0].component(props));
  assert.equal(depthRows(tree).filter((row) => row.depth === "2").length, 0, "单家族供应商必须平铺");
  const flat = depthRows(tree).filter((row) => row.depth === "3");
  assert.equal(flat.length, 1, "deepseek-account 只应剩一行模型");
});

test("S01：点模型后取消思维菜单 → 0 次选择写入", async () => {
  const harness = makeHarness();
  const { exports, render, document: fakeDocument } = loadBundle(CLIENT, harness);
  const { ctx, registrations, selectCalls } = fakeCtx();
  exports.apply(ctx);
  const face = registrations[0].options.inject("session-1");
  const props = { ...face, t: T, locked: false };

  const closed = render(registrations[0].component(props));
  findElement(closed, (node) => node.props.className === "dsmn_trigger").props.onClick();

  let tree = render(registrations[0].component(props));
  findElement(tree, (node) => node.props["data-depth"] === "1" && textOf(node).includes("DeepSeek")).props.onClick();
  tree = render(registrations[0].component(props));
  findElement(tree, (node) => node.props["data-depth"] === "3" && textOf(node).includes("DeepSeek Flash")).props.onClick();

  // 第三级展开但用户点菜单外部：一次写入都不能发生（新面板没有关闭按钮，官方靠 Esc/外点）
  tree = render(registrations[0].component(props));
  assert.equal(depthRows(tree).filter((row) => row.depth === "4").length, 2, "思维档位应已展开");
  fakeDocument.dispatch("pointerdown", { target: { nodeName: "BODY" } });
  await Promise.resolve();
  assert.equal(selectCalls.length, 0, "取消不得写模型");
  assert.deepEqual(props.directory.getSnapshot().current, { provider: "deepseek-account", model: "deepseek-flash" }, "取消不得改当前选择");
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

test("内联 core 的单个对象展开不会缺参（__merge(base, extra) 回归）", () => {
  const { window } = loadBundle(PROBE);
  const core = window.__DSH_MODEL_NAVIGATOR_CORE__;
  assert.ok(core, "__core must be exposed on window for probe builds");

  // 这些路径内部会产出 `{ ...x }` 形式的单展开。
  assert.equal(core.patchPreferences(null, { enabled: false }).enabled, false);
  assert.equal(core.normalizePreferences(undefined).schemaVersion, 1);
  assert.equal(core.dedupeByRef([]).length, 0);
  const draft = core.createDraft("s", null, 0);
  assert.ok(core.resolveDraft(draft, null, { connectionGeneration: 0 }));
  assert.equal(core.applyPins([], []).length, 0);
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
    settingsGrouping: "供应商顺序",
    groupingOff: "宿主顺序",
    groupingChannel: "渠道优先",
    groupingFamily: "家族优先",
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
  assert.ok(textOf(tree).includes("渠道优先"), "分组选项必须可见");
  // 测试环境无 settingsScope 也无 localStorage → 内存层，必须如实显示而不是假装持久化
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
    findElement(opened, (node) => node.props["data-depth"] === "1" && textOf(node).includes("WorkBuddy")),
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
  const harness = makeHarness();
  const { exports, render } = loadBundle(CLIENT, harness);
  const { ctx, registrations } = fakeCtx();
  exports.apply(ctx);
  const face = registrations[0].options.inject("session-1");

  // TWO_PROVIDER_SNAPSHOT 的当前选择是 workbuddy/hy4-preview → 当前家族是 Hunyuan。
  const snapshot = TWO_PROVIDER_SNAPSHOT();
  const directory = { subscribe: () => () => {}, getSnapshot: () => snapshot };
  const props = { ...face, directory, t: (key) => key, locked: false };

  const closed = render(registrations[0].component(props));
  findElement(closed, (node) => node.props.className === "dsmn_trigger").props.onClick();
  let tree = render(registrations[0].component(props));
  findElement(tree, (node) => node.props["data-depth"] === "1" && textOf(node).includes("WorkBuddy")).props.onClick();
  tree = render(registrations[0].component(props));

  const headers = () => collectElements(tree, (node) => String(node.props.className).includes("dsmn_groupToggle"));
  const stateOf = (label) => {
    const hit = headers().find((node) => textOf(node).includes(label));
    return hit === undefined ? null : hit.props["aria-expanded"];
  };
  const modelsVisible = () => depthRows(tree).filter((row) => row.depth === "3").length;

  // 用户反馈：一点开就是全展开的，看着繁杂。现在默认只有「当前那一族」开着。
  assert.equal(stateOf("Hunyuan"), "true", "当前选择所在家族默认展开");
  for (const label of ["GLM", "Kimi", "MiniMax"]) {
    assert.equal(stateOf(label), "false", `默认折叠：${label}`);
  }
  assert.equal(modelsVisible(), 1, "默认只渲染已展开家族的模型行（当前家族 Hunyuan 只有 hy4-preview 一个）");

  // 显式折叠「当前家族」：用户说了算，默认展开必须让位
  headers().find((node) => textOf(node).includes("Hunyuan")).props.onClick();
  assert.equal(face.store.getPreferences().collapsedFamilies["workbuddy\u0000hunyuan"], true, "显式折叠写 true");
  tree = render(registrations[0].component(props));
  assert.equal(stateOf("Hunyuan"), "false", "显式折叠后即便它是当前家族也收起");
  assert.equal(modelsVisible(), 0, "全部折叠时一行模型都不渲染");

  // 显式展开一个「非当前家族」
  headers().find((node) => textOf(node).includes("Kimi")).props.onClick();
  assert.equal(face.store.getPreferences().collapsedFamilies["workbuddy\u0000kimi"], false, "显式展开写 false");
  tree = render(registrations[0].component(props));
  assert.equal(stateOf("Kimi"), "true", "显式展开后该家族打开");
  assert.equal(modelsVisible(), 1, "只多出 Kimi 家族的模型行");
  assert.ok(
    findElement(tree, (node) => node.props["data-depth"] === "3" && textOf(node).includes("Kimi-K3.1")),
    "展开的家族必须能看到模型行",
  );
});

test("0.1.4 回归：家族折叠写入偏好 collapsedFamilies，可折叠可再展开", () => {
  const harness = makeHarness();
  const { exports, render } = loadBundle(CLIENT, harness);
  const { ctx, registrations } = fakeCtx();
  exports.apply(ctx);
  const face = registrations[0].options.inject("session-1");

  const snapshot = TWO_PROVIDER_SNAPSHOT();
  const directory = { subscribe: () => () => {}, getSnapshot: () => snapshot };
  const props = { ...face, directory, t: (key) => key, locked: false };

  const closed = render(registrations[0].component(props));
  findElement(closed, (node) => node.props.className === "dsmn_trigger").props.onClick();
  let tree = render(registrations[0].component(props));

  // 进入 WorkBuddy 的模型面板
  const providerRow = findElement(
    tree,
    (node) => node.props["data-depth"] === "1" && textOf(node).includes("WorkBuddy"),
  );
  assert.ok(providerRow, "供应商行必须出现");
  providerRow.props.onClick();
  tree = render(registrations[0].component(props));

  const headers = () => collectElements(tree, (node) => String(node.props.className).includes("dsmn_groupToggle"));
  const kimiHeader = () => headers().find((node) => textOf(node).includes("Kimi"));
  assert.ok(headers().length >= 2, "多家族时每个家族一个折叠头");
  assert.ok(kimiHeader(), "必须找到 Kimi 家族的折叠头");
  // Kimi 不是当前家族（当前是 Hunyuan）→ 默认折叠
  assert.equal(kimiHeader().props["aria-expanded"], "false", "默认折叠");
  assert.equal(
    findElement(tree, (node) => textOf(node).includes("Kimi-K3.1")),
    null,
    "默认折叠时该家族的模型行不可见",
  );

  kimiHeader().props.onClick();
  // 注意：store 跑在 vm realm 里，跨 realm 的 deepStrictEqual 会因原型不同而失败，
  // 这里按 key/value 断言（与其它偏好断言一致）。
  const expanded = face.store.getPreferences().collapsedFamilies;
  assert.deepEqual(Object.keys(expanded), ["workbuddy\u0000kimi"], "只记下这一族的折叠状态");
  assert.equal(expanded["workbuddy\u0000kimi"], false, "显式展开写 false 进偏好（逐键合并）");
  tree = render(registrations[0].component(props));
  assert.equal(kimiHeader().props["aria-expanded"], "true", "展开后 aria-expanded=true");
  assert.ok(
    findElement(tree, (node) => textOf(node).includes("Kimi-K3.1")),
    "展开后家族里的模型行必须可见",
  );

  kimiHeader().props.onClick();
  assert.equal(
    face.store.getPreferences().collapsedFamilies["workbuddy\u0000kimi"],
    true,
    "再点一次必须写回显式折叠",
  );
  tree = render(registrations[0].component(props));
  assert.equal(kimiHeader().props["aria-expanded"], "false", "折叠后 aria-expanded=false");
  assert.equal(
    findElement(tree, (node) => textOf(node).includes("Kimi-K3.1")),
    null,
    "折叠后该家族的模型行必须隐藏",
  );
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
  const { exports, render } = loadBundle(CLIENT, harness);
  const { ctx, registrations } = fakeCtx();
  exports.apply(ctx);
  const face = registrations[0].options.inject("session-1");
  const snapshot = TWO_PROVIDER_SNAPSHOT();
  const directory = { subscribe: () => () => {}, getSnapshot: () => snapshot };
  const props = { ...face, directory, t: (key) => key, locked: false };
  findElement(render(registrations[0].component(props)), (node) => node.props.className === "dsmn_trigger").props.onClick();
  const opened = render(registrations[0].component(props));
  const atom = findElement(opened, (node) => node.props["data-atom"] === "MenuSurface");
  assert.ok(atom, "有官方 MenuSurface 时必须复用它（否则官方主题/无障碍行为会与原生面板不一致）");
  assert.equal(atom.props.role, "menu", "官方原子必须收到面板语义");
  assert.ok(
    findElement(atom, (node) => node.props["data-depth"] === "1"),
    "官方原子里仍要渲染出三级内容",
  );
});


function navigatorFixture(overrides = {}, harness = makeHarness()) {
  const bundle = loadBundle(CLIENT, harness);
  const context = fakeCtx();
  bundle.exports.apply(context.ctx);
  const registration = context.registrations[0];
  const face = registration.options.inject("session-regression");
  const props = { ...face, t: T, locked: false, ...overrides };
  const draw = () => bundle.render(registration.component(props));
  const trigger = () => findElement(draw(), n => n.props.className === "dsmn_trigger");
  const open = () => { trigger().props.onClick(); return draw(); };
  const chooseChat = () => {
    open();
    findElement(draw(), n => n.props["data-depth"] === "1" && textOf(n).includes("DeepSeek")).props.onClick();
    return findElement(draw(), n => n.props["data-depth"] === "3" && textOf(n).includes("DeepSeek Chat"));
  };
  return { ...bundle, ...context, harness, registration, face, props, draw, trigger, open, chooseChat };
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

test("first-level search finds models across providers before choosing one", () => {
  const f = navigatorFixture();
  let tree = f.open();
  const input = findElement(tree, n => n.props.role === "searchbox");
  assert.ok(input, "global search must be reachable directly from the root");
  input.props.onChange({ target: { value: "qwen" } });
  tree = f.draw();
  const hit = findElement(tree, n => n.props["data-depth"] === "3" && textOf(n).includes("Qwen"));
  assert.ok(hit);
  hit.props.onClick();
  tree = f.draw();
  assert.ok(findElement(tree, n => n.props["data-depth"] === "4"));
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
  f.open();
  findElement(f.draw(), n => n.props["data-depth"] === "1").props.onClick();
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

test("favorite action does not switch a model and exposes a persistent root shortcut", () => {
  const f = navigatorFixture();
  f.open();
  findElement(f.draw(), n => n.props["data-depth"] === "1" && textOf(n).includes("DeepSeek")).props.onClick();
  const star = findElement(f.draw(), n => n.props["data-action"] === "favorite-model" && n.props["data-model-id"] === "deepseek-chat");
  assert.ok(star, "each model needs a favorite action");
  star.props.onClick();
  assert.equal(f.selectCalls.length, 0);
  assert.deepEqual(plain(f.face.store.getPreferences().favorites), ['["deepseek-account","deepseek-chat"]']);
  findElement(f.draw(), n => n.props.className === "dsmn_cell dsmn_cellBack").props.onClick();
  const entry = findElement(f.draw(), n => n.props["data-action"] === "open-shortcuts" && n.props["data-kind"] === "favorites");
  assert.ok(entry, "favorites must have an explicit entry");
  entry.props.onClick({ currentTarget: null });
  const shortcut = findElement(f.draw(), n => n.props["data-shortcut-menu"] === "favorites");
  assert.ok(shortcut && textOf(shortcut).includes("DeepSeek Chat"));
});

test("global results disambiguate identical model names with their providers and IDs", () => {
  const snapshot = {
    ...SNAPSHOT,
    groups: [
      { id: "p-a", name: "Provider A", models: [{ id: "model-a", name: "Same Model" }] },
      { id: "p-b", name: "Provider B", models: [{ id: "model-b", name: "Same Model" }] }
    ]
  };
  const f = navigatorFixture({ directory: { subscribe: () => () => {}, getSnapshot: () => snapshot } });
  const input = findElement(f.open(), n => n.props.role === "searchbox");
  input.props.onChange({ target: { value: "same" } });
  const tree = f.draw();
  assert.ok(findElement(tree, n => n.props["data-depth"] === "3" && textOf(n).includes("Provider A") && textOf(n).includes("model-a")));
  assert.ok(findElement(tree, n => n.props["data-depth"] === "3" && textOf(n).includes("Provider B") && textOf(n).includes("model-b")));
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


function shortcutEntry(tree, kind) {
  return findElement(tree, n => n.props["data-action"] === "open-shortcuts" && n.props["data-kind"] === kind);
}
function shortcutMenu(tree, kind) {
  return findElement(tree, n => n.props["data-shortcut-menu"] === kind);
}

test("favorites entry is always visible, highlighted, and shows an empty state", () => {
  const f = navigatorFixture();
  const entry = shortcutEntry(f.open(), "favorites");
  assert.ok(entry, "zero favorites must not hide the entry");
  assert.match(entry.props.className, /dsmn_favoritesEntry/);
  assert.ok(textOf(entry).includes("0"));
  entry.props.onClick({ currentTarget: null });
  const menu = shortcutMenu(f.draw(), "favorites");
  assert.ok(menu && textOf(menu).includes("favoritesEmpty"));
});

test("a favorited current model remains in favorites and can be removed there", () => {
  const f = navigatorFixture();
  const key = JSON.stringify([SNAPSHOT.current.provider, SNAPSHOT.current.model]);
  f.face.store.patch({ favorites: [key] });
  const entry = shortcutEntry(f.open(), "favorites");
  assert.ok(entry && textOf(entry).includes("1"));
  entry.props.onClick({ currentTarget: null });
  let menu = shortcutMenu(f.draw(), "favorites");
  const selected = findElement(menu, n => n.props.role === "menuitemradio" && n.props["aria-checked"] === "true");
  assert.ok(selected, "current must not be deduplicated out of favorites");
  findElement(menu, n => n.props["data-action"] === "favorite-model").props.onClick();
  assert.equal(f.selectCalls.length, 0);
  assert.deepEqual(plain(f.face.store.getPreferences().favorites), []);
  assert.ok(textOf(shortcutMenu(f.draw(), "favorites")).includes("favoritesEmpty"));
});

test("recent selections appear in a hover submenu, including the favorited current model", () => {
  const f = navigatorFixture();
  const key = JSON.stringify([SNAPSHOT.current.provider, SNAPSHOT.current.model]);
  f.face.store.patch({ favorites: [key], lastProviderId: SNAPSHOT.current.provider,
    lastModelByProvider: { [SNAPSHOT.current.provider]: SNAPSHOT.current.model, openai: "gpt-test" } });
  const entry = shortcutEntry(f.open(), "recent");
  assert.ok(entry && !textOf(entry).includes("DeepSeek Flash"), "root must show one entry, not inline recent models");
  assert.equal(shortcutMenu(f.draw(), "recent"), null);
  entry.props.onMouseEnter({ currentTarget: null });
  const menu = shortcutMenu(f.draw(), "recent");
  assert.ok(menu && findElement(menu, n => n.props.role === "menuitemradio" && n.props["aria-checked"] === "true"));
  assert.equal(f.selectCalls.length, 0, "hovering must never select a model");
});

test("favorites submenu includes more than eight models", () => {
  const models = Array.from({ length: 12 }, (_, i) => ({ id: "m" + i, name: "Model " + i }));
  const snapshot = { ...SNAPSHOT, groups: [{ id: "p", name: "Provider", models }], current: { provider: "p", model: "m0" } };
  const f = navigatorFixture({ directory: { subscribe: () => () => {}, getSnapshot: () => snapshot } });
  f.face.store.patch({ favorites: models.map(m => JSON.stringify(["p", m.id])) });
  shortcutEntry(f.open(), "favorites").props.onClick({ currentTarget: null });
  assert.equal(collectElements(shortcutMenu(f.draw(), "favorites"), n => n.props.role === "menuitemradio").length, 12);
});

test("moving the pointer from shortcut entry into submenu cancels delayed closure", () => {
  const harness = makeHarness();
  const timers = new Map();
  let token = 0;
  harness.setTimeout = fn => { timers.set(++token, fn); return token; };
  harness.clearTimeout = id => timers.delete(id);
  const f = navigatorFixture({}, harness);
  let entry = shortcutEntry(f.open(), "recent");
  entry.props.onMouseEnter({ currentTarget: null });
  entry = shortcutEntry(f.draw(), "recent");
  entry.props.onMouseLeave();
  assert.equal(timers.size, 1);
  let menu = shortcutMenu(f.draw(), "recent");
  menu.props.onMouseEnter();
  assert.equal(timers.size, 0, "crossing the small gap must not close the submenu");
  menu.props.onMouseLeave();
  for (const fn of Array.from(timers.values())) fn();
  assert.equal(shortcutMenu(f.draw(), "recent"), null);
  assert.ok(shortcutEntry(f.draw(), "favorites"), "only the submenu closes");
});

test("a click inside the portaled submenu is not treated as an outside click", () => {
  const f = navigatorFixture();
  shortcutEntry(f.open(), "recent").props.onClick({ currentTarget: null });
  const inside = {};
  const menu = shortcutMenu(f.draw(), "recent");
  assert.ok(menu);
  menu.props.ref.current = { contains: target => target === inside };
  f.document.dispatch("pointerdown", { target: inside });
  assert.ok(shortcutMenu(f.draw(), "recent"));
  f.document.dispatch("pointerdown", { target: {} });
  assert.equal(shortcutMenu(f.draw(), "recent"), null);
  assert.equal(shortcutEntry(f.draw(), "favorites"), null);
});

test("shortcut keyboard navigation opens right and Escape closes only the submenu", () => {
  const f = navigatorFixture();
  const entry = shortcutEntry(f.open(), "favorites");
  assert.ok(entry);
  const event = key => ({ key, currentTarget: null, stopPropagation() {}, preventDefault() {} });
  entry.props.onKeyDown(event("ArrowRight"));
  const menu = shortcutMenu(f.draw(), "favorites");
  assert.ok(menu);
  menu.props.onKeyDown(event("Escape"));
  assert.equal(shortcutMenu(f.draw(), "favorites"), null);
  assert.ok(shortcutEntry(f.draw(), "favorites"));
});

test("picker omits preference storage details while settings retain them", () => {
  const f = navigatorFixture();
  assert.equal(findElement(f.open(), n => String(n.props.className).includes("dsmn-footer")), null);
  const settings = f.registrations.find(r => r.options.name === "settings.general.item");
  assert.ok(textOf(f.render(settings.component(settings.options.inject()))).includes("storageMemory"));
});

test("shortcut placement opens right, flips at the edge, and clamps tiny viewports", () => {
  const core = loadBundle(PROBE).window.__DSH_MODEL_NAVIGATOR_CORE__;
  assert.equal(typeof core.shortcutMenuPosition, "function");
  const normal = core.shortcutMenuPosition({ left: 100, right: 400, top: 120 }, { width: 300, height: 200 }, { width: 1100, height: 700 });
  assert.equal(normal.side, "right");
  assert.equal(normal.left, 406);
  const edge = core.shortcutMenuPosition({ left: 760, right: 1060, top: 620 }, { width: 300, height: 200 }, { width: 1100, height: 700 });
  assert.equal(edge.side, "left");
  assert.equal(edge.left, 454);
  assert.ok(edge.top + edge.maxHeight <= 692);
  const tiny = core.shortcutMenuPosition({ left: 2, right: 140, top: -5 }, { width: 320, height: 450 }, { width: 240, height: 180 });
  assert.ok(tiny.left >= 8 && tiny.top >= 8);
  assert.ok(tiny.left + tiny.width <= 232 && tiny.top + tiny.maxHeight <= 172);
});

test("shortcut placement measures full list content after a shorter submenu", () => {
  const f = navigatorFixture();
  f.window.innerWidth = 1100;
  f.window.innerHeight = 700;
  const tree = f.open();
  const rootMenu = findElement(tree, n => n.props.role === "menu");
  rootMenu.props.ref.current = { getBoundingClientRect: () => ({ left: 100, right: 400 }) };
  shortcutEntry(tree, "recent").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ top: 120 }) } });
  const menu = shortcutMenu(f.draw(), "recent");
  menu.props.ref.current = {
    getBoundingClientRect: () => ({ width: 300, height: 80 }), scrollHeight: 80,
    querySelector: () => ({ scrollHeight: 180, offsetTop: 25 }),
  };
  f.document.dispatch("scroll");
  assert.equal(shortcutMenu(f.draw(), "recent").props.style.maxHeight, 210,
    "previous constrained surface height must not truncate the new list");
});


test("favorite submenu selection opens effort and commits the complete selection", async () => {
  const f = navigatorFixture();
  f.face.store.patch({ favorites: [JSON.stringify([SNAPSHOT.current.provider, SNAPSHOT.current.model])] });
  shortcutEntry(f.open(), "favorites").props.onClick({ currentTarget: null });
  findElement(shortcutMenu(f.draw(), "favorites"), n => n.props.role === "menuitemradio").props.onClick();
  assert.equal(shortcutMenu(f.draw(), "favorites"), null);
  assert.equal(f.selectCalls.length, 0, "effort selection must precede submission");
  findElement(f.draw(), n => n.props["data-depth"] === "4" && textOf(n).includes("高")).props.onClick();
  await Promise.resolve();
  assert.deepEqual(plain(f.selectCalls), [{ provider: SNAPSHOT.current.provider, model: SNAPSHOT.current.model, reasoningEffort: "high" }]);
  assert.equal(shortcutEntry(f.draw(), "favorites"), null, "successful selection closes both surfaces");
});

test("closing the picker clears a pending shortcut hover timer", () => {
  const harness = makeHarness();
  const timers = new Map();
  let token = 0;
  harness.setTimeout = fn => { timers.set(++token, fn); return token; };
  harness.clearTimeout = id => timers.delete(id);
  const f = navigatorFixture({}, harness);
  const entry = shortcutEntry(f.open(), "recent");
  entry.props.onMouseEnter({ currentTarget: null });
  f.draw();
  entry.props.onMouseLeave();
  assert.equal(timers.size, 1);
  f.document.dispatch("pointerdown", { target: {} });
  f.draw();
  assert.equal(timers.size, 0);
  assert.equal(shortcutMenu(f.open(), "recent"), null, "reopening must not restore a stale hover submenu");
});
