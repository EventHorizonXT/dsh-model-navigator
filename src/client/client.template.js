/**
 * dsh-model-navigator 客户端半边（模板）。
 *
 * 本文件不直接发布：tools/build-client.mjs 会把 /*__CORE_EMBED__*​/ 处替换成
 * 由 src/core/*.mjs 生成的 ES5 纯逻辑（__core），产出 lib/client.js。
 * 因此这里只写「宿主 I/O + slot 注册 + React 组件 + 样式 + 词条」，不重复实现纯逻辑。
 *
 * 硬约束：
 *   - 注册 conversation.input.model（priority -5）与 settings.general.item；
 *     替换官方 mf(0)，保留 codex-subscription(-10) 的优先级，关闭增强时注销座位。
 *   - Harness Client 包一律「可选 require + 等价回退」：react / react-dom（createPortal，
 *     取不到就内联渲染）/ @deepseek-ai/dsh-client-ui-primitives（取不到就用原生元素）。
 *   - 样式只用 --dsw-alias-* 主题令牌；面板类名沿用官方 ui-model-selection 的 dsmn_ 前缀，
 *     设置页控件用 dsmn- 前缀。
 *   - 激活绝不外抛：客户端 boot 是全有或全无，遇到宿主差异只能降级 + reportFailure。
 */
window.__ModuleLoader__.load({
  id: "dsh-model-navigator",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var h = React.createElement;
    var NS = "model-navigator";

    // 浮层用官方同款 createPortal 挂到 document.body：面板若内联渲染在
    // conversation.input.right 槽里，祖先的 transform/filter/contain 会让 position:fixed
    // 相对该祖先定位（错位或被裁）。react-dom 若不在平台 seed 模块表里，退回内联渲染，
    // 激活与测试不受影响。
    var ReactDOM = null;
    try {
      ReactDOM = require("react-dom");
    } catch (error) {
      ReactDOM = null;
    }
    var CAN_PORTAL = false;
    try {
      CAN_PORTAL = ReactDOM !== null && typeof ReactDOM.createPortal === "function"
        && typeof document !== "undefined" && document !== null
        && document.body !== undefined && document.body !== null;
    } catch (error) {
      CAN_PORTAL = false;
    }

    /*__CORE_EMBED__*/

    var PREFERENCES_KEY = __core.PREFERENCES_NAMESPACE + ":preferences:v" + __core.PREFERENCES_SCHEMA_VERSION;
    var NOOP = function () {};

    /* ================================================================== *
     * 词条
     * ================================================================== */

    var DICT = {
      zh: {
        title: "模型导航器",
        triggerAria: "打开三级模型选择器（供应商 → 模型 → 思维强度）",
        stepProvider: "选择供应商",
        searchPlaceholder: "搜索供应商 / 模型 / 模型 ID",
        searchEmpty: "没有匹配的供应商或模型。",
        providerDefault: "供应商默认",
        effortDefault: "默认",
        effortsTitle: "思维强度",
        noEfforts: "当前模型未提供推理等级。",
        modelCount: "个模型",
        familyOther: "其他",
        providerAccount: "DeepSeek 账户",
        back: "返回",
        close: "关闭",
        loading: "加载中…",
        retry: "重试加载",
        favorites: "收藏",
        currentSelection: "当前模型",
        recent: "最近使用",
        favoriteAdd: "收藏模型",
        favoriteRemove: "取消收藏",
        selecting: "切换中…",
        unavailable: "当前会话不可切换模型",
        loadFailed: "模型目录加载失败：",
        selectFailed: "切换失败：",
        sessionInUse: "该会话正忙，请稍后再试。",
        currentOutside: "当前模型不在本目录中（仍在使用）：",
        emptyCatalog: "没有可用的模型。",
        storageHost: "偏好：插件设置命名空间",
        storageLocal: "偏好：本机浏览器存储",
        storageMemory: "偏好：仅本次运行有效",
        storageUnavailable: "偏好：宿主持久化不可用",
        settingsHint: "三级模型选择器：供应商 → 模型（家族分组）→ 思维强度。替换官方通用模型按钮；共享宿主会话状态，支持搜索、收藏和最近使用。关闭后恢复原生入口。",
        settingsEnabled: "替换原生模型选择器",
        settingsGrouping: "供应商顺序",
        groupingOff: "宿主顺序",
        groupingChannel: "渠道优先",
        groupingFamily: "家族优先",
        settingsShowSearch: "模型较多时显示搜索框",
        settingsStorage: "偏好存储",
        settingsOn: "开",
        settingsOff: "关",
        settingsCollapse: "收起",
        settingsExpand: "展开"
      },
      en: {
        title: "Model Navigator",
        triggerAria: "Open the three-level model selector (provider → model → effort)",
        stepProvider: "Choose a provider",
        searchPlaceholder: "Search provider / model / model id",
        searchEmpty: "No provider or model matches.",
        providerDefault: "Provider default",
        effortDefault: "default",
        effortsTitle: "Reasoning effort",
        noEfforts: "This model exposes no reasoning levels.",
        modelCount: "models",
        familyOther: "Other",
        providerAccount: "DeepSeek Account",
        back: "Back",
        close: "Close",
        loading: "Loading…",
        retry: "Retry loading",
        favorites: "Favorites",
        currentSelection: "Current model",
        recent: "Recently used",
        favoriteAdd: "Favorite model",
        favoriteRemove: "Remove favorite",
        selecting: "Switching…",
        unavailable: "This session cannot switch models",
        loadFailed: "Failed to load the model catalog: ",
        selectFailed: "Switch failed: ",
        sessionInUse: "This session is busy, try again shortly.",
        currentOutside: "Current model is not in this catalog (still active): ",
        emptyCatalog: "No models available.",
        storageHost: "Preferences: plugin settings namespace",
        storageLocal: "Preferences: this browser",
        storageMemory: "Preferences: this run only",
        storageUnavailable: "Preferences: host persistence unavailable",
        settingsHint: "Three-level model picker: provider → model (family groups) → reasoning effort. Replaces the native model button using the shared session directory, with search, favorites and recent models. Turn it off to restore the native entry.",
        settingsEnabled: "Replace the native model picker",
        settingsGrouping: "Provider order",
        groupingOff: "Host order",
        groupingChannel: "Channel first",
        groupingFamily: "Family first",
        settingsShowSearch: "Show a search box when there are many models",
        settingsStorage: "Preference storage",
        settingsOn: "On",
        settingsOff: "Off",
        settingsCollapse: "Collapse",
        settingsExpand: "Expand"
      }
    };

    /* ================================================================== *
     * 偏好存储：宿主 settingsScope → localStorage → 内存
     * ================================================================== */

    function memoryBackend() {
      var value = null;
      return {
        tier: "memory",
        state: "memory",
        read: function () { return value; },
        write: function (next) { value = next; }
      };
    }

    function browserBackend(storage) {
      return {
        tier: "local",
        state: "memory",
        read: function () {
          try {
            var raw = storage.getItem(PREFERENCES_KEY);
            return raw === null ? null : JSON.parse(raw);
          } catch (error) {
            return null;
          }
        },
        write: function (next) {
          try {
            storage.setItem(PREFERENCES_KEY, JSON.stringify(next));
            return true;
          } catch (error) {
            return false;
          }
        }
      };
    }

    function createPreferencesStore(settingsScope) {
      var backend = null;
      var scope = null;

      if (settingsScope !== null && settingsScope !== undefined && typeof settingsScope.bind === "function") {
        try {
          var bound = settingsScope.bind({ namespace: __core.PREFERENCES_NAMESPACE });
          if (bound !== null && bound !== undefined && typeof bound.getSnapshot === "function") {
            scope = bound;
            backend = {
              tier: "host",
              state: "memory",
              read: function () {
                var raw = scope.getSnapshot();
                return raw === null || raw === undefined || typeof raw !== "object" ? null : raw;
              },
              write: function (next) {
                if (typeof scope.set !== "function") return false;
                var ok = true;
                var keys = Object.keys(next);
                for (var i = 0; i < keys.length; i += 1) {
                  try {
                    scope.set(keys[i], next[keys[i]]);
                  } catch (error) {
                    ok = false;
                  }
                }
                return ok;
              }
            };
          }
        } catch (error) {
          scope = null;
          backend = null;
        }
      }

      if (backend === null) {
        var storage = null;
        try {
          storage = typeof localStorage === "undefined" ? null : localStorage;
        } catch (error) {
          storage = null;
        }
        backend = storage === null ? memoryBackend() : browserBackend(storage);
      }

      var current = __core.normalizePreferences(backend.read());
      var listeners = new Set();

      function notify() {
        listeners.forEach(function (listener) {
          try {
            listener();
          } catch (error) {
            /* 订阅者异常不影响其他订阅者 */
          }
        });
      }

      function persist() {
        var ok = backend.write(current);
        backend.state = ok ? "persisted" : "memory";
      }

      var unsubscribeScope = NOOP;
      if (scope !== null && typeof scope.subscribe === "function") {
        try {
          var off = scope.subscribe(function () {
            current = __core.normalizePreferences(backend.read());
            notify();
          });
          if (typeof off === "function") unsubscribeScope = off;
        } catch (error) {
          unsubscribeScope = NOOP;
        }
      }

      return {
        getTier: function () { return backend.tier; },
        getState: function () { return backend.state; },
        getPreferences: function () { return current; },
        subscribe: function (listener) {
          listeners.add(listener);
          return function () { listeners.delete(listener); };
        },
        dispose: function () {
          try {
            unsubscribeScope();
          } catch (error) {
            /* 忽略 */
          }
        },
        setPreferences: function (value) {
          current = __core.normalizePreferences(value);
          persist();
          notify();
          return current;
        },
        patch: function (patch) {
          current = __core.patchPreferences(current, patch);
          persist();
          notify();
          return current;
        },
        rememberSelection: function (selection) {
          if (selection === null || selection === undefined) return;
          if (typeof selection.provider !== "string" || typeof selection.model !== "string") return;
          var map = {};
          map[selection.provider] = selection.model;
          current = __core.patchPreferences(current, { lastProviderId: selection.provider, lastModelByProvider: map });
          persist();
          notify();
        }
      };
    }

    /* ================================================================== *
     * 草稿（每个会话一份；连接换代即清空）
     * ================================================================== */

    function createDraftStore() {
      var generation = 0;
      var drafts = new Map();
      var version = 0;
      var listeners = new Set();

      function notify() {
        version += 1;
        listeners.forEach(function (listener) {
          try {
            listener();
          } catch (error) {
            /* 忽略 */
          }
        });
      }

      function entryOf(sessionId) {
        var entry = drafts.get(sessionId);
        if (entry === undefined) {
          entry = { draft: null, seed: null };
          drafts.set(sessionId, entry);
        }
        return entry;
      }

      return {
        getGeneration: function () { return generation; },
        getVersion: function () { return version; },
        subscribe: function (listener) {
          listeners.add(listener);
          return function () { listeners.delete(listener); };
        },
        getSeed: function (sessionId) {
          return entryOf(sessionId).seed;
        },
        seed: function (sessionId, selection) {
          entryOf(sessionId).seed = selection;
        },
        ensureDraft: function (sessionId, current) {
          var entry = entryOf(sessionId);
          if (entry.draft === null || !__core.draftMatches(entry.draft, current, generation)) {
            entry.draft = __core.createDraft(sessionId, current, generation);
          }
          return entry.draft;
        },
        commit: function (sessionId, selection) {
          var entry = entryOf(sessionId);
          entry.draft = __core.createDraft(sessionId, selection, generation);
          entry.seed = null;
          notify();
        },
        resetGeneration: function () {
          generation += 1;
          drafts.clear();
          notify();
        }
      };
    }

    /* ================================================================== *
     * 样式（只用主题令牌）
     * ================================================================== */

    var CSS = [
      ".dsmn_root{min-width:0;position:relative}",
      ".dsmn_trigger{border-radius:var(--dsw-radius-sm);min-width:0;max-width:min(360px,45cqw);height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:400;line-height:20px;display:flex}",
      ".dsmn_trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
      ".dsmn_trigger:focus-visible:not([data-selection-focus]){box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}",
      ".dsmn_trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}",
      ".dsmn_triggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}",
      ".dsmn_triggerEffort{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-caption);flex-shrink:1000;overflow:hidden}",
      ".dsmn_triggerIcon{display:var(--dsh-composer-model-icon-display,none);flex:none}",
      ".dsmn_triggerLabel,.dsmn_triggerEffort{display:var(--dsh-composer-model-text-display,block)}",
      ".dsmn_chevron{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s}",
      ".dsmn_chevronOpen{transform:rotate(180deg)}",
      ".dsmn_menu{z-index:1100;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:max-content;min-width:min(240px,100vw - 32px);max-width:min(420px,100vw - 32px);max-height:min(360px,100vh - 96px);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border:0;flex-direction:column;padding:4px;display:flex;position:fixed;overflow:hidden}",
      ".dsmn_menu{background:var(--dsw-menu-surface-fill,var(--dsw-alias-bg-layer-2));backdrop-filter:var(--dsw-menu-backdrop-filter);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);box-shadow:var(--dsw-elevation-prominent);padding:4px;}",
      ".dsmn_status,.dsmn_empty{color:var(--dsw-alias-label-tertiary);padding:8px;font-size:12px;line-height:18px}",
      ".dsmn_error,.dsmn_warning{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:3px;padding:6px 7px;font-size:11px;line-height:16px;display:flex}",
      ".dsmn_warning{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label)}",
      ".dsmn_retry{color:inherit;font:inherit;cursor:pointer;background:0 0;border:none;flex:none;padding:0;font-weight:600}",
      ".dsmn_searchRow{flex-shrink:0;margin:2px 0 3px;position:relative}",
      ".dsmn_searchRow .dsmn_search{border-radius:var(--dsw-radius-md);background:0 0;border:0 solid #0000;height:auto;padding:5px 7px;display:flex}",
      ".dsmn_searchRow .dsmn_searchWithQuery{padding-right:34px}",
      ".dsmn_searchClear{corner-shape:round;width:24px;height:24px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:50%;justify-content:center;align-items:center;padding:0;display:inline-flex;position:absolute;top:50%;right:4px;transform:translateY(-50%)}",
      ".dsmn_searchClear:hover,.dsmn_searchClear:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}",
      ".dsmn_searchRow .dsmn_search:focus-within{border-color:#0000}",
      ".dsmn_searchRow .dsmn_search input{padding:0;font-size:12px;line-height:normal}",
      ".dsmn_searchRow .dsmn_search input::placeholder{color:var(--dsw-alias-label-caption)}",
      ".dsmn_groups{min-height:0;overflow-y:auto}",
      ".dsmn_option{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:auto;min-width:100%;min-height:34px;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:6px;padding:5px 7px;display:flex}",
      ".dsmn_option:not(.dsmn_modelOption):hover:not(:disabled),.dsmn_option:focus-visible,.dsmn_optionActive:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
      ".dsmn_selected{background:0 0}",
      ".dsmn_option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}",
      ".dsmn_optionCopy{flex-direction:column;flex:1;min-width:0;display:flex}",
      ".dsmn_modelName{color:inherit;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:400;line-height:18px;overflow:hidden}",
      ".dsmn_check{color:var(--dsw-alias-label-primary);flex:0 0 14px;place-items:center;display:grid}",
      ".dsmn_check svg{width:14px;height:14px}",
      ".dsmn_cell{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:auto;min-width:100%;height:34px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;background:0 0;border:none;outline:none;align-items:center;gap:6px;padding:0 8px;font-size:13px;line-height:20px;display:flex}",
      ".dsmn_cell:hover,.dsmn_cell:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}",
      ".dsmn_cellLabel{white-space:nowrap;flex:none}",
      ".dsmn_cellValue{text-overflow:ellipsis;white-space:nowrap;text-align:right;min-width:0;color:var(--dsw-alias-label-tertiary);flex:auto;overflow:hidden}",
      ".dsmn_cellChevron{width:12px;height:12px;color:var(--dsw-alias-menu-icon);flex:none}",
    /* ===== 以下规则逐条复制自官方 @deepseek-ai/dsh-client-ui-model-selection 0.2.0-rc.2 的
     * ModelSelect CSS 模块（仅把 cl2Rlq_ 前缀换成 dsmn_），以保证与官方面板同款排版/悬停/圆角/令牌。 ===== */
      ".dsmn-trigger[disabled]{opacity:.5;cursor:default;}",
      ".dsmn_groupLabel{padding:6px 7px 2px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary);}",
      ".dsmn_cellBack .dsmn_cellChevron{margin-right:2px;}",
      ".dsmn-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary);}",
      ".dsmn-setting{display:flex;flex-direction:column;gap:8px;padding:10px 0;}",
      ".dsmn-setting-head{display:flex;align-items:flex-start;gap:12px;}",
      ".dsmn-setting-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}",
      ".dsmn-setting-title{font-size:13px;color:var(--dsw-alias-label-primary);}",
      ".dsmn-setting-hint{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);}",
      ".dsmn-setting-body{display:flex;flex-direction:column;gap:6px;padding-left:0;}",
      ".dsmn-setting-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary);}",
      ".dsmn-setting-value{color:var(--dsw-alias-label-primary);}",
      ".dsmn-switch{position:relative;flex:0 0 auto;width:34px;height:20px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);cursor:pointer;padding:0;transition:background .15s ease;}",
      ".dsmn-switch[aria-checked='true']{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);}",
      ".dsmn-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}",
      ".dsmn-switch-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform .15s ease;}",
      ".dsmn-switch[aria-checked='true'] .dsmn-switch-knob{transform:translateX(14px);background:var(--dsw-alias-bg-base);}",
      ".dsmn-choices{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);}",
      ".dsmn-choice{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:3px 10px;border-radius:6px;cursor:pointer;}",
      ".dsmn-choice:hover{color:var(--dsw-alias-label-primary);}",
      ".dsmn-choice[data-active='true']{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}",
      ".dsmn-choice:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}",
      ".dsmn_groupToggle{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;padding:6px 8px 4px;background:0 0;border:none;color:var(--dsw-alias-label-caption);font:inherit;font-size:11px;font-weight:600;letter-spacing:.02em;cursor:pointer;text-align:left;border-radius:var(--dsw-radius-sm);}",
      ".dsmn_groupToggle:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);}",
      ".dsmn_groupChevron{flex:none;color:var(--dsw-alias-label-caption);}",
      ".dsmn_groupLabelText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".dsmn_groupCount{margin-left:auto;color:var(--dsw-alias-label-caption);font-weight:400;}",
      ".dsmn_modelRow{display:flex;align-items:center;min-width:0;}",
      ".dsmn_modelRow>.dsmn_option{min-width:0;flex:1;}",
      ".dsmn_modelMeta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".dsmn_favorite{background:transparent;border:0;color:var(--dsw-alias-label-caption);padding:7px;cursor:pointer;flex:none;border-radius:var(--dsw-radius-sm);}",
      ".dsmn_favorite:hover,.dsmn_favorite:focus-visible{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}",
      ".dsmn_favorite[aria-pressed=true]{color:var(--dsw-alias-state-business-primary);}",
      ".dsmn_shortcutTitle{padding:5px 8px;color:var(--dsw-alias-label-caption);font-size:11px;}",
      ".dsmn_retry{color:inherit;background:transparent;border:0;font:inherit;cursor:pointer;}"
    ].join("");

    /* ================================================================== *
     * 组件
     * ================================================================== */

    function shorten(label, max) {
      var text = String(label === undefined || label === null ? "" : label);
      if (text.length <= max) return text;
      return text.slice(0, max - 1) + "…";
    }

    function messageOf(error) {
      if (error === null || error === undefined) return "";
      if (typeof error === "string") return error;
      if (typeof error.message === "string") return error.message;
      return String(error);
    }

    /**
     * 供应商标题：官方 `ui-model-selection` 只在 `deepseek-account` 上用本地化词条，
     * 其余用宿主目录给的 `name`（本插件在 `buildCatalog` 里已经解析成 `provider.label`）。
     */
    function providerLabelOf(provider, t) {
      if (provider === null || provider === undefined) return "";
      if (provider.id === "deepseek-account") return t("providerAccount");
      if (typeof provider.label === "string" && provider.label.length > 0) return provider.label;
      return String(provider.id);
    }

    /**
     * 家族标题：兜底家族（`other`）永远显示本地化的「其他」，不拿模型 ID 冒充家族名。
     */
    function familyLabelOf(row, t) {
      if (row === null || row === undefined) return t("familyOther");
      if (row.familyId === __core.FALLBACK_FAMILY_ID) return t("familyOther");
      if (typeof row.label === "string" && row.label.length > 0) return row.label;
      return t("familyOther");
    }

    /** 模型行的悬浮说明：完整模型 ID 始终可访问（计划 §4.5），显示名相同时不重复。 */
    function modelRowTitle(displayName, modelId) {
      if (displayName === modelId) return String(modelId);
      return displayName + " (" + modelId + ")";
    }

    /* ============================================================== *
     * 呈现层：优先复用官方 @deepseek-ai/dsh-client-ui-primitives
     * （官方 ModelSelect 用的就是这套 atoms + 图标），取不到时退回
     * 等价的原生元素，保证离线测试/旧宿主仍能渲染。
     * ============================================================== */
    var UI = null;
    try {
      UI = require("@deepseek-ai/dsh-client-ui-primitives");
    } catch (error) {
      UI = null;
    }

    function uiComponent(name) {
      if (UI === null || UI === undefined) return null;
      var Comp = UI[name];
      if (typeof Comp === "function") return Comp;
      if (typeof Comp === "object" && Comp !== null) return Comp;
      return null;
    }

    /** 官方原子组件；缺失时返回 fallback（默认 null）。 */
    function uiNode(name, props, fallback) {
      var Comp = uiComponent(name);
      if (Comp === null) return fallback === undefined ? null : fallback;
      return h(Comp, props);
    }

    function ModelNavigator(props) {
      var t = props.t;
      var store = props.store;
      var draftStore = props.draftStore;
      var directory = props.directory;
      var sessionId = props.sessionId;
      var locked = props.locked === true;
      var available = props.available === true;

      var subscribeDirectory = React.useCallback(
        function (onChange) { return typeof directory.subscribe === "function" ? directory.subscribe(onChange) : NOOP; },
        [directory]
      );
      var readDirectory = React.useCallback(
        function () { return typeof directory.getSnapshot === "function" ? directory.getSnapshot() : null; },
        [directory]
      );
      var snapshot = React.useSyncExternalStore(subscribeDirectory, readDirectory, readDirectory);

      var subscribeStore = React.useCallback(function (onChange) { return store.subscribe(onChange); }, [store]);
      var readStore = React.useCallback(function () { return store.getPreferences(); }, [store]);
      var preferences = React.useSyncExternalStore(subscribeStore, readStore, readStore);

      var subscribeDraft = React.useCallback(function (onChange) { return draftStore.subscribe(onChange); }, [draftStore]);
      var readDraft = React.useCallback(function () { return draftStore.getVersion(); }, [draftStore]);
      var draftVersion = React.useSyncExternalStore(subscribeDraft, readDraft, readDraft);

      var openState = React.useState(false);
      var open = openState[0];
      var setOpen = openState[1];
      var queryState = React.useState("");
      var query = queryState[0];
      var setQuery = queryState[1];
      var providerState = React.useState(null);
      var openProvider = providerState[0];
      var setOpenProvider = providerState[1];
      var modelState = React.useState(null);
      var openModel = modelState[0];
      var setOpenModel = modelState[1];
      var noticeState = React.useState(null);
      var notice = noticeState[0];
      var setNotice = noticeState[1];
      var positionState = React.useState(null);
      var position = positionState[0];
      var setPosition = positionState[1];

      var rootRef = React.useRef(null);
      var popoverRef = React.useRef(null);
      var selectionRef = React.useRef(null);
      var mountedRef = React.useRef(true);
      var submittingState = React.useState(false);
      var submitting = submittingState[0];
      var setSubmitting = submittingState[1];
      React.useEffect(function () {
        mountedRef.current = true;
        return function () { mountedRef.current = false; selectionRef.current = null; };
      }, []);
      // 官方 ModelSelect 是「root → model → effort」的浮层面板切换；这里沿用同一套
      // 面板状态机：providers（供应商）→ models（模型，家族分组）→ effort（思维强度）。
      var paneState = React.useState("providers");
      var pane = paneState[0];
      var setPane = paneState[1];
      var itemRefs = React.useRef([]);

      var current = snapshot === null || snapshot === undefined || snapshot.current === undefined ? null : snapshot.current;
      var status = snapshot === null || snapshot === undefined || snapshot.status === undefined ? "idle" : snapshot.status;
      var generation = draftStore.getGeneration();
      React.useEffect(function () {
        selectionRef.current = null;
        setSubmitting(false);
        setOpen(false);
        setNotice(null);
      }, [sessionId, generation]);
      var currentKey = current === null ? null : [current.provider, current.model, current.reasoningEffort === undefined ? null : current.reasoningEffort].join("\u0000");

      var draft = React.useMemo(
        function () { return draftStore.ensureDraft(sessionId, current); },
        [sessionId, draftVersion, currentKey, generation]
      );
      var resolved = React.useMemo(
        function () { return __core.resolveDraft(draft, snapshot, { connectionGeneration: generation }); },
        [draft, snapshot, generation]
      );

      var overridesKey = JSON.stringify(preferences.modelOverrides);
      var rulesKey = JSON.stringify(preferences.rules);
      var favoritesKey = JSON.stringify(preferences.favorites);
      var pinsKey = JSON.stringify(preferences.providerPins);

      var catalog = React.useMemo(
        function () {
          var next = __core.buildCatalog(snapshot, {
            classify: function (input) {
              return __core.classifyModel({
                ref: input.ref,
                originalName: input.originalName,
                overrides: preferences.modelOverrides,
                rules: preferences.rules,
                mode: preferences.grouping
              });
            },
            favorites: preferences.favorites
          });
          try {
            DIAG.catalog = summarizeCatalog(next);
          } catch (ignored) {
            /* 诊断不能反噬渲染 */
          }
          return next;
        },
        [snapshot, overridesKey, rulesKey, favoritesKey, preferences.grouping]
      );

      var visibleProviders = React.useMemo(
        function () {
          return preferences.grouping === "off" ? catalog.providers : __core.orderProviders(catalog.providers, preferences.providerPins);
        },
        [catalog, preferences.grouping, pinsKey]
      );

      // 目录首次装载 + 失败后重试
      React.useEffect(
        function () {
          if (!available) return;
          if (status !== "idle") return;
          if (props.load === undefined) return;
          props.load();
        },
        [available, status, sessionId]
      );

      // 打开时装载目录、定位到当前选择
      React.useEffect(
        function () {
          if (!open) return;
          if (available && props.load !== undefined) props.load();
          var nextDraft = draftStore.ensureDraft(sessionId, current);
          var nextResolved = __core.resolveDraft(nextDraft, snapshot, { connectionGeneration: generation });
          setOpenProvider(nextResolved.providerId === undefined ? null : nextResolved.providerId);
          setOpenModel(nextResolved.modelId === undefined ? null : JSON.stringify([nextResolved.providerId, nextResolved.modelId]));
          setNotice(null);
        },
        [open]
      );

      // 浮层定位：优先上方，空间不足翻转到下方
      React.useEffect(
        function () {
          if (!open) return;
          var anchor = rootRef.current;
          if (anchor === null || typeof anchor.getBoundingClientRect !== "function") return;
          var rect = anchor.getBoundingClientRect();
          var popover = popoverRef.current;
          // 只记录，不改行为：现场确认浮层真正的 DOM 父亲是谁。
          // 走 createPortal 时应为 body；若为槽位节点则说明祖先 transform 仍可能裁掉面板。
          if (popover !== null && popover !== undefined) {
            var panelParent = popover.parentNode;
            var parentSlot = panelParent !== null && panelParent !== undefined && typeof panelParent.getAttribute === "function" ? panelParent.getAttribute("data-slot") : null;
            if (panelParent === null || panelParent === undefined) DIAG.dom.panelAncestorSlot = "detached";
            else if (panelParent === document.body) DIAG.dom.panelAncestorSlot = "body";
            else DIAG.dom.panelAncestorSlot = String(panelParent.tagName === undefined ? "?" : panelParent.tagName).toLowerCase() + (parentSlot === null ? "" : "[data-slot=" + parentSlot + "]");
          }
          var measured = popover === null || typeof popover.getBoundingClientRect !== "function" ? null : popover.getBoundingClientRect();
          var height = measured === null || measured.height === 0 ? 320 : measured.height;
          var width = measured === null || measured.width === 0 ? 300 : measured.width;
          var roomAbove = rect.top - 12;
          var roomBelow = window.innerHeight - rect.bottom - 12;
          var openUp = roomAbove >= Math.min(height, 260) || roomAbove > roomBelow;
          var left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
          if (openUp) setPosition({ left: left, bottom: Math.max(8, window.innerHeight - rect.top + 6) });
          else setPosition({ left: left, top: Math.max(8, Math.min(window.innerHeight - 16, rect.bottom + 6)) });
        },
        [open, snapshot, query, openProvider, openModel, notice]
      );

      // 外部点击 / Esc 关闭。
      // Escape 层级（0.1.6 起）：菜单内部处理器（清空搜索 → 面板返回上级）先吃掉
      // 自己那一层；这里的 document 捕获监听只在「Esc 没被菜单消化」时才关整个菜单。
      // 0.1.5 及以前捕获监听无条件 setOpen(false)，模型层按 Esc 直接整层关闭，
      // 返回上级的 onMenuKeyDown 根本没机会执行。
      React.useEffect(
        function () {
          if (!open) return undefined;
          var onPointerDown = function (event) {
            var root = rootRef.current;
            if (root !== null && typeof root.contains === "function" && root.contains(event.target)) return;
            var menu = popoverRef.current;
            if (menu !== null && menu !== undefined && typeof menu.contains === "function" && menu.contains(event.target)) return;
            setOpen(false);
          };
          var onKeyDown = function (event) {
            if (event.key !== "Escape") return;
            var menu = popoverRef.current;
            if (menu !== null && menu !== undefined && typeof menu.contains === "function" && menu.contains(event.target)) {
              // 目标在浮层里：菜单自己的 onKeyDown（stopPropagation）负责消化，
              // 但捕获监听先于它运行，所以这里不能关——置位后由冒泡阶段决定去留。
              return;
            }
            var root = rootRef.current;
            if (root !== null && typeof root.contains === "function" && root.contains(event.target)) return;
            setOpen(false);
          };
          document.addEventListener("pointerdown", onPointerDown, true);
          document.addEventListener("keydown", onKeyDown, true);
          return function () {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown, true);
          };
        },
        [open]
      );

      var commit = React.useCallback(
        function (providerId, modelId, effortId) {
          if (!available || locked || submitting || status === "selecting" || selectionRef.current !== null || props.select === undefined) return;
          var selection;
          try { selection = __core.buildSelection(providerId, modelId, effortId); }
          catch (error) { setNotice(messageOf(error)); return; }
          var operation = { sessionId: sessionId, generation: draftStore.getGeneration() };
          selectionRef.current = operation;
          setSubmitting(true);
          setNotice(null);
          var active = function () {
            return mountedRef.current && selectionRef.current === operation
              && operation.generation === draftStore.getGeneration();
          };
          var settle = function (outcome, error) {
            if (!active()) return;
            selectionRef.current = null;
            setSubmitting(false);
            if (error !== undefined || outcome === false || (outcome !== null && outcome !== undefined && outcome.ok === false)) {
              var failure = error !== undefined ? error : outcome === false ? t("unavailable") : outcome.error;
              var code = failure !== null && failure !== undefined ? failure.code : undefined;
              setNotice(code === "session/writer-held" || messageOf(failure).indexOf("session/writer-held") >= 0
                ? t("sessionInUse") : t("selectFailed") + messageOf(failure));
              return;
            }
            draftStore.commit(sessionId, selection);
            store.rememberSelection(selection);
            setOpen(false);
          };
          try {
            var result = props.select(selection);
            if (result !== null && result !== undefined && typeof result.then === "function") {
              result.then(function (value) { settle(value); }, function (error) { settle(undefined, error); });
            } else settle(result);
          } catch (error) { settle(undefined, error); }
        },
        [available, locked, submitting, status, props.select, sessionId, store, draftStore, t]
      );

      if (preferences.enabled === false) return null;

      var lookupDisplay = function (providerId, modelId) {
        if (providerId === undefined || providerId === null || modelId === undefined || modelId === null) return undefined;
        if (catalog.modelOf === undefined || catalog.modelOf === null) return undefined;
        return catalog.modelOf.get(JSON.stringify([providerId, modelId]));
      };
      // 触发器显示「宿主公布的当前选择」。resolveDraft 在宿主当前模型不在本目录里时会退到
      // 目录默认或第一个模型——那样触发器会显示成另一个模型，与原生入口并存时看起来像切错了
      // （用户截图：我们的药丸显示 Kimi-K3，原生药丸显示 DeepSeek-V41-Flash）。0.1.4 起：
      // 不可寻址时显示当前选择自己的 ID，绝不显示别人的名字，并在面板里标注。
      var hostCurrent = snapshot === null || snapshot === undefined || snapshot.current === undefined ? null : snapshot.current;
      var triggerProviderId = hostCurrent !== null ? hostCurrent.provider : undefined;
      var triggerModelId = hostCurrent !== null ? hostCurrent.model : undefined;
      var triggerDisplay = lookupDisplay(triggerProviderId, triggerModelId);
      var triggerModel = triggerDisplay !== undefined
        ? triggerDisplay
        : undefined;
      var currentAddressable = hostCurrent === null || triggerDisplay !== undefined;
      var triggerLabel = triggerDisplay !== undefined && triggerDisplay !== null
        ? (triggerDisplay.alias !== undefined && triggerDisplay.alias !== null && triggerDisplay.alias !== ""
            ? triggerDisplay.alias
            : triggerDisplay.originalName)
        : __core.modelDisplayName(triggerModel, triggerModelId);
      if (hostCurrent === null) triggerLabel = status === "idle" || status === "loading" ? t("loading") : t("title");
      else if (triggerLabel === undefined || triggerLabel === null || triggerLabel === "") triggerLabel = triggerModelId;

      var currentReasoning = triggerModel === undefined || triggerModel === null ? undefined : triggerModel.reasoning;
      var triggerEffortId = hostCurrent !== null
        ? (hostCurrent.reasoningEffort !== undefined
            ? hostCurrent.reasoningEffort
            : (currentReasoning === undefined || currentReasoning === null ? undefined : currentReasoning.defaultEffort))
        : resolved.effortId;
      var currentEffortLabel = snapshot !== null && snapshot !== undefined && typeof snapshot.retainedEffort === "string" ? snapshot.retainedEffort : null;
      if (triggerEffortId !== undefined && currentReasoning !== undefined && currentReasoning !== null) {
        var triggerChoices = __core.effortChoices(currentReasoning, t("providerDefault"));
        for (var tc = 0; tc < triggerChoices.length; tc += 1) {
          if (triggerChoices[tc].effort === triggerEffortId) {
            currentEffortLabel = triggerChoices[tc].label;
            break;
          }
        }
        if (currentEffortLabel === null) currentEffortLabel = triggerEffortId;
      }

      // 诊断：把「宿主当前选择 / 触发器实际显示 / 草稿解析结果」一并记下，
      // 用来区分「我们显示错了」与「别的入口没刷新」。
      DIAG.selection = {
        current: hostCurrent === null ? null : {
          provider: hostCurrent.provider,
          model: hostCurrent.model,
          reasoningEffort: hostCurrent.reasoningEffort === undefined ? null : hostCurrent.reasoningEffort
        },
        trigger: {
          providerId: triggerProviderId === undefined ? null : triggerProviderId,
          modelId: triggerModelId === undefined ? null : triggerModelId,
          label: triggerLabel,
          effortId: triggerEffortId === undefined ? null : triggerEffortId,
          addressable: currentAddressable
        },
        resolved: {
          providerId: resolved.providerId === undefined ? null : resolved.providerId,
          modelId: resolved.modelId === undefined ? null : resolved.modelId,
          effortId: resolved.effortId === undefined ? null : resolved.effortId,
          fromDraft: resolved.fromDraft === true
        }
      };

      var trimmed = query.trim();
      var hits = trimmed.length === 0 ? null : __core.searchModels(visibleProviders, trimmed);
      var shownProviders = trimmed.length === 0 ? visibleProviders : __core.filterProviders(visibleProviders, trimmed);
      var rows = [];
      var tier = store.getTier();
      var tierNote = tier === "host" ? t("storageHost") : tier === "local" ? t("storageLocal") : t("storageMemory");

      itemRefs.current = [];
      var itemIndex = 0;
      var itemRef = function () {
        var at = itemIndex;
        itemIndex += 1;
        return function (node) { itemRefs.current[at] = node; };
      };

      var activeProvider = null;
      for (var api = 0; api < visibleProviders.length; api += 1) {
        if (visibleProviders[api].id === openProvider) { activeProvider = visibleProviders[api]; break; }
      }
      var openModelDisplay = openModel === null || openModel === undefined || catalog.modelOf === undefined || catalog.modelOf === null
        ? undefined
        : catalog.modelOf.get(openModel);
      var activeChoices = openModelDisplay === undefined ? [] : __core.effortChoices(openModelDisplay.reasoning, t("providerDefault"));

      function providerValue(provider) {
        if (current === null || current.provider !== provider.id) return "";
        var display = catalog.modelOf === undefined || catalog.modelOf === null ? undefined : catalog.modelOf.get(JSON.stringify([current.provider, current.model]));
        return display === undefined || display === null ? String(current.model) : __core.modelDisplayName(display, current.model);
      }

      function backRow(label, key) {
        return h("button", {
          key: key, ref: itemRef(), type: "button", role: "menuitem", className: "dsmn_cell dsmn_cellBack",
          onClick: function () { setPane(pane === "effort" ? "models" : "providers"); }
        },
          uiNode("IconChevronLeftOutlineRegular", { className: "dsmn_cellChevron" }, h("span", { className: "dsmn_cellChevron" }, "‹")),
          h("span", { className: "dsmn_cellLabel" }, label),
          h("span", { className: "dsmn_cellValue" }, "")
        );
      }

      function optionRow(key, label, selected, onPick, depth, detail) {
        return h("button", {
          key: key, ref: itemRef(), type: "button", role: "menuitemradio", "aria-checked": selected ? "true" : "false",
          "data-depth": depth,
          className: "dsmn_option" + (selected ? " dsmn_selected" : ""),
          title: label,
          disabled: locked || submitting || status === "selecting",
          onClick: onPick
        },
          h("span", { className: "dsmn_optionCopy" }, h("span", { className: "dsmn_modelName" }, label),
            detail === undefined ? null : h("span", { className: "dsmn_modelMeta" }, detail)),
          h("span", { className: "dsmn_check" }, selected ? uiNode("IconCheckOutlineRegular", {}) : null)
        );
      }

      function modelOption(model, prefix) {
        var key = __core.stableKeyOf(model.ref);
        var selected = current !== null && current.provider === model.ref.providerId && current.model === model.ref.modelId;
        var provider = catalog.providerOf.get(model.ref.providerId);
        var detail = (provider === undefined ? model.ref.providerId : providerLabelOf(provider, t)) + " · " + model.ref.modelId;
        var favorite = preferences.favorites.indexOf(key) !== -1;
        return h("div", { key: prefix + key, className: "dsmn_modelRow" },
          optionRow(prefix + key, __core.modelDisplayName(model, model.ref.modelId), selected, function () {
            if (__core.effortChoices(model.reasoning, t("providerDefault")).length === 0) {
              commit(model.ref.providerId, model.ref.modelId, undefined);
              return;
            }
            setOpenProvider(model.ref.providerId);
            setOpenModel(key);
            setPane("effort");
          }, "3", detail),
          h("button", {
            type: "button", className: "dsmn_favorite", ref: itemRef(),
            "data-action": "favorite-model", "data-model-id": model.ref.modelId,
            "aria-label": t(favorite ? "favoriteRemove" : "favoriteAdd") + " · " + detail,
            "aria-pressed": favorite ? "true" : "false",
            title: t(favorite ? "favoriteRemove" : "favoriteAdd"),
            onClick: function () {
              var latest = store.getPreferences().favorites;
              var next = latest.filter(function (entry) { return entry !== key; });
              if (latest.indexOf(key) === -1) next.push(key);
              store.patch({ favorites: next });
            }
          }, favorite ? "★" : "☆")
        );
      }

      if (pane === "providers" && trimmed.length === 0) {
        var shortcutKeys = new Set();
        function shortcutSection(id, title, keys) {
          var entries = [];
          for (var si = 0; si < keys.length && entries.length < 8; si += 1) {
            var shortcut = catalog.modelOf.get(keys[si]);
            if (shortcut === undefined || shortcutKeys.has(keys[si])) continue;
            shortcutKeys.add(keys[si]);
            entries.push(modelOption(shortcut, id + "-"));
          }
          if (entries.length > 0) rows.push(h("div", { key: id, "data-section": id },
            h("div", { className: "dsmn_shortcutTitle" }, title), entries));
        }
        if (current !== null) shortcutSection("current", t("currentSelection"), [JSON.stringify([current.provider, current.model])]);
        shortcutSection("favorites", t("favorites"), preferences.favorites);
        var recentKeys = [];
        var lastProviders = Object.keys(preferences.lastModelByProvider);
        if (preferences.lastProviderId !== undefined) lastProviders.unshift(preferences.lastProviderId);
        for (var rp = 0; rp < lastProviders.length; rp += 1) recentKeys.push(JSON.stringify([lastProviders[rp], preferences.lastModelByProvider[lastProviders[rp]]]));
        shortcutSection("recent", t("recent"), recentKeys);
      }

        if (preferences.showSearch && pane !== "effort") {
          rows.push(h("div", { key: "search", className: "dsmn_searchRow" },
            h("input", {
              className: "dsmn_search" + (trimmed.length > 0 ? " dsmn_searchWithQuery" : ""),
              type: "text",
              role: "searchbox",
              value: query,
              placeholder: t("searchPlaceholder"),
              "aria-label": t("searchPlaceholder"),
              onChange: function (event) { setQuery(event.target.value); },
              onKeyDown: function (event) {
                if (event.key === "Escape" && query.length > 0) {
                  event.stopPropagation();
                  setQuery("");
                }
              }
            }),
            trimmed.length > 0
              ? h("button", { key: "clear", type: "button", className: "dsmn_searchClear", "aria-label": t("back"), onClick: function () { setQuery(""); } }, uiNode("IconCloseFillRegular", {}, "✕"))
              : null
          ));
        }

      if (pane === "providers") {
        for (var pi = 0; pi < shownProviders.length; pi += 1) {
          (function (provider) {
            var label = providerLabelOf(provider, t);
            rows.push(h("button", {
              key: "p-" + provider.id, ref: itemRef(), type: "button", role: "menuitem", className: "dsmn_cell", "data-depth": "1",
              title: label,
              onClick: function () {
                setOpenProvider(provider.id);
                setOpenModel(null);
                setQuery("");
                setPane("models");
              }
            },
              h("span", { className: "dsmn_cellLabel" }, label),
              h("span", { className: "dsmn_cellValue" }, providerValue(provider)),
              uiNode("IconChevronRightOutlineRegular", { className: "dsmn_cellChevron" }, h("span", { className: "dsmn_cellChevron" }, "›"))
            ));
          })(shownProviders[pi]);
        }
        if (shownProviders.length === 0) rows.push(h("div", { key: "empty-providers", className: "dsmn_empty" }, t("emptyCatalog")));
      }
      if (pane === "models") rows.push(backRow(activeProvider === null ? t("stepProvider") : providerLabelOf(activeProvider, t), "back"));
      if (pane !== "effort") {


        if (hits !== null) {
          if (hits.length === 0) rows.push(h("div", { key: "no-hit", className: "dsmn_empty" }, t("searchEmpty")));
          for (var hi = 0; hi < hits.length; hi += 1) {
            rows.push(modelOption(hits[hi], "hit-"));
          }
        } else if (pane === "models" && activeProvider !== null) {
          var familyList = __core.familyRows(activeProvider.models, { mode: preferences.grouping });
          var buckets = [];
          for (var fi = 0; fi < familyList.length; fi += 1) {
            var row = familyList[fi];
            if (row.kind === "family") {
              buckets.push({ key: row.familyId, label: familyLabelOf(row, t), models: [] });
            } else {
              buckets[buckets.length - 1].models.push(row.model);
            }
          }
          // Host-order mode is deliberately flat: regrouping interleaved families
          // would either reorder models or hide them behind another family's toggle.
          if (preferences.grouping === "off") buckets = [{ key: "host-order", label: "", models: activeProvider.models }];
          var flatFamilies = buckets.length <= 1;
          // 家族折叠（计划 §4.5）：官方 MenuGroup 的标签不可点，这里用等价样式的按钮实现，
          // 折叠状态写进偏好 collapsedFamilies（逐键合并、跨会话保留）。
          var collapseMap = preferences.collapsedFamilies === undefined || preferences.collapsedFamilies === null
            ? {}
            : preferences.collapsedFamilies;
          // 默认折叠，只默认展开「当前选择所在的那一族」：一点开供应商就铺满模型行太吵。
          var currentFamilyKey = null;
          if (current !== null && current !== undefined && current.provider === activeProvider.id) {
            for (var cf = 0; cf < buckets.length; cf += 1) {
              for (var cm = 0; cm < buckets[cf].models.length; cm += 1) {
                if (buckets[cf].models[cm].ref.modelId === current.model) {
                  currentFamilyKey = __core.familyCollapseKey(activeProvider.id, buckets[cf].key);
                }
              }
            }
          }
          for (var bi = 0; bi < buckets.length; bi += 1) {
            (function (bucket) {
              var collapseKey = __core.familyCollapseKey(activeProvider.id, bucket.key);
              var isCollapsed = !flatFamilies && __core.familyCollapsed(collapseMap, collapseKey, collapseKey === currentFamilyKey);
              var options = [];
              for (var mi = 0; mi < bucket.models.length; mi += 1) {
                options.push(modelOption(bucket.models[mi], "m-"));
              }
              if (flatFamilies) {
                for (var oi = 0; oi < options.length; oi += 1) rows.push(options[oi]);
              } else {
                rows.push(h("button", {
                  key: "g-" + bucket.key,
                  type: "button",
                  className: "dsmn_groupLabel dsmn_groupToggle",
                  "data-depth": "2",
                  "aria-expanded": isCollapsed ? "false" : "true",
                  onClick: function () {
                    var next = {};
                    var keys = Object.keys(collapseMap);
                    for (var ki = 0; ki < keys.length; ki += 1) next[keys[ki]] = collapseMap[keys[ki]];
                    next[collapseKey] = !isCollapsed;
                    store.patch({ collapsedFamilies: next });
                  }
                },
                  uiNode(isCollapsed ? "IconChevronRightOutlineRegular" : "IconChevronDownOutlineRegular", { className: "dsmn_groupChevron" }, h("span", { className: "dsmn_groupChevron" }, isCollapsed ? "›" : "⌄")),
                  h("span", { className: "dsmn_groupLabelText" }, bucket.label),
                  h("span", { className: "dsmn_groupCount" }, String(bucket.models.length))
                ));
                if (!isCollapsed) {
                  for (var oj = 0; oj < options.length; oj += 1) rows.push(options[oj]);
                }
              }
            })(buckets[bi]);
          }
        }
      } else {
        rows.push(backRow(openModelDisplay === undefined ? t("effortsTitle") : __core.modelDisplayName(openModelDisplay, openModelDisplay.ref.modelId), "back-effort"));
        var effortActive = openModelDisplay !== undefined && current !== null && current.provider === openModelDisplay.ref.providerId && current.model === openModelDisplay.ref.modelId
          ? resolved.effortId : openModelDisplay === undefined || openModelDisplay.reasoning === undefined ? undefined : openModelDisplay.reasoning.defaultEffort;
        if (openModel === null || activeChoices.length === 0) {
          rows.push(h("div", { key: "no-efforts", className: "dsmn_empty" }, t("noEfforts")));
        } else {
          for (var ei = 0; ei < activeChoices.length; ei += 1) {
            (function (choice) {
              rows.push(optionRow("e-" + choice.key, choice.label, effortActive === choice.effort, function () {
                var target = openModelDisplay.ref;
                commit(target.providerId, target.modelId, choice.effort);
              }, "4"));
            })(activeChoices[ei]);
          }
        }
      }

      function onMenuKeyDown(event) {
        if (event.key === "Escape") {
          // Escape 层级：清空搜索（输入框自己的 onKeyDown）→ 面板返回上级 → 关闭整层。
          // providers 层没有更深的层级可返回，这里负责真正的关闭；其余层 stopPropagation
          // 已经把事件拦在菜单内部（document 捕获监听见 661 行注释，不会抢先关闭）。
          if (pane !== "providers") {
            event.stopPropagation();
            setPane(pane === "effort" ? "models" : "providers");
            return;
          }
          setOpen(false);
          return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        var list = [];
        for (var li = 0; li < itemRefs.current.length; li += 1) {
          if (itemRefs.current[li] !== null && itemRefs.current[li] !== undefined) list.push(itemRefs.current[li]);
        }
        if (list.length === 0) return;
        var at = list.indexOf(event.target);
        var next = event.key === "ArrowDown" ? (at + 1) % list.length : (at <= 0 ? list.length - 1 : at - 1);
        if (typeof list[next].focus === "function") list[next].focus();
        event.preventDefault();
      }

      var triggerNode = h(
        "button",
        {
          type: "button",
          className: "dsmn_trigger",
          title: triggerLabel,
          "aria-label": t("triggerAria"),
          "aria-haspopup": "menu",
          "aria-expanded": open ? "true" : "false",
          disabled: locked || !available || submitting || status === "selecting",
          onClick: function () {
            if (!open) {
              setPane("providers");
              setQuery("");
            }
            setOpen(!open);
          }
        },
        uiNode("IconDataOutlineRegular", { className: "dsmn_triggerIcon", size: 16 }),
        h("span", { className: "dsmn_triggerLabel" }, shorten(triggerLabel === undefined || triggerLabel === null ? "" : triggerLabel, 24)),
        currentEffortLabel !== null ? h("span", { className: "dsmn_triggerEffort" }, currentEffortLabel) : null,
        uiNode("IconChevronDownOutlineRegular", { className: "dsmn_chevron" + (open ? " dsmn_chevronOpen" : "") }, h("span", { className: "dsmn_chevron" }, open ? "▴" : "▾"))
      );

      var menuNode = !open
        ? null
        : h(
            uiComponent("MenuSurface") === null ? "div" : uiComponent("MenuSurface"),
            {
              className: "dsmn_menu scrollable",
              ref: popoverRef,
              role: "menu",
              "aria-label": t("stepProvider"),
              style: position === null ? { left: 8, top: 8, visibility: "hidden" } : position
            },
            notice !== null ? h("div", { key: "notice", className: "dsmn_error" }, notice) : null,
            !available ? h("div", { key: "unavailable", className: "dsmn_status" }, t("unavailable")) : null,
            currentAddressable ? null : h("div", { key: "outside", className: "dsmn_status" }, t("currentOutside") + shorten(triggerLabel === undefined || triggerLabel === null ? "" : triggerLabel, 40)),
            status === "error" ? h("div", { key: "error", className: "dsmn_error" }, t("loadFailed") + messageOf(snapshot.error),
              h("button", { type: "button", "data-action": "retry-catalog", className: "dsmn_retry", onClick: function () { if (props.load !== undefined) props.load(); } }, t("retry"))) : null,
            submitting || status === "selecting" ? h("div", { key: "selecting", className: "dsmn_status", role: "status" }, t("selecting")) : null,
            (status === "idle" || status === "loading") && available ? h("div", { key: "loading", className: "dsmn_status" }, t("loading")) : null,
            h("div", { key: "items", className: "dsmn_groups" }, rows),
            h("div", { key: "footer", className: "dsmn-footer" }, h("span", null, tierNote))
          );
      if (menuNode !== null && CAN_PORTAL) {
        try {
          menuNode = ReactDOM.createPortal(menuNode, document.body);
          DIAG.dom.mode = "portal";
        } catch (error) {
          /* portal 失败：退回内联渲染，但要留下证据 */
          DIAG.dom.mode = "inline";
          DIAG.dom.portalError = describeError(error);
        }
      } else if (menuNode !== null) {
        DIAG.dom.mode = "inline";
      }

      return h(
        "div",
        { className: "dsmn_root", ref: rootRef, onKeyDown: onMenuKeyDown },
        triggerNode,
        menuNode
      );
    }

    /* ================================================================== *
     * 设置行：settings.general.item（自带文案、控件与写入路径）
     * ================================================================== */

    function SettingsRow(props) {
      var t = props.t;
      var store = props.store;

      var subscribe = React.useCallback(function (onChange) { return store.subscribe(onChange); }, [store]);
      var read = React.useCallback(function () { return store.getPreferences(); }, [store]);
      var preferences = React.useSyncExternalStore(subscribe, read, read);

      var enabled = preferences.enabled !== false;
      var grouping = preferences.grouping;
      var tier = store.getTier();
      var tierNote = tier === "host" ? t("storageHost") : tier === "local" ? t("storageLocal") : t("storageMemory");

      var modes = [
        { id: "off", label: t("groupingOff") },
        { id: "channel-first", label: t("groupingChannel") },
        { id: "family-first", label: t("groupingFamily") }
      ];

      return h(
        "div",
        { className: "dsmn-setting" },
        h(
          "div",
          { className: "dsmn-setting-head" },
          h(
            "div",
            { className: "dsmn-setting-copy" },
            h("span", { className: "dsmn-setting-title" }, t("title")),
            h("span", { className: "dsmn-setting-hint" }, t("settingsHint"))
          ),
          h(
            "button",
            {
              type: "button",
              className: "dsmn-switch",
              role: "switch",
              "aria-checked": enabled ? "true" : "false",
              "aria-label": t("settingsEnabled"),
              title: (enabled ? t("settingsOn") : t("settingsOff")) + " · " + t("settingsEnabled"),
              onClick: function () { store.patch({ enabled: !enabled }); }
            },
            h("span", { className: "dsmn-switch-knob", "aria-hidden": "true" })
          )
        ),
        h(
          "div",
          { className: "dsmn-setting-body" },
          h(
            "div",
            { className: "dsmn-setting-row" },
            h("span", { className: "dsmn-setting-value" }, t("settingsEnabled")),
            h("span", null, enabled ? t("settingsOn") : t("settingsOff"))
          ),
          h(
            "div",
            { className: "dsmn-setting-row" },
            h("span", { className: "dsmn-setting-value" }, t("settingsGrouping")),
            h(
              "span",
              { className: "dsmn-choices", role: "group", "aria-label": t("settingsGrouping") },
              modes.map(function (mode) {
                return h(
                  "button",
                  {
                    key: mode.id,
                    type: "button",
                    className: "dsmn-choice",
                    "data-active": grouping === mode.id ? "true" : undefined,
                    "aria-pressed": grouping === mode.id ? "true" : "false",
                    onClick: function () { store.patch({ grouping: mode.id }); }
                  },
                  mode.label
                );
              })
            )
          ),
          h(
            "div",
            { className: "dsmn-setting-row" },
            h("span", { className: "dsmn-setting-value" }, t("settingsShowSearch")),
            h(
              "button",
              {
                type: "button",
                className: "dsmn-switch",
                role: "switch",
                "aria-checked": preferences.showSearch ? "true" : "false",
                "aria-label": t("settingsShowSearch"),
                onClick: function () { store.patch({ showSearch: !preferences.showSearch }); }
              },
              h("span", { className: "dsmn-switch-knob", "aria-hidden": "true" })
            )
          ),
          h(
            "div",
            { className: "dsmn-setting-row" },
            h("span", { className: "dsmn-setting-value" }, t("settingsStorage")),
            h("span", null, tierNote)
          )
        )
      );
    }

    /* ================================================================== *
     * 插件入口
     * ================================================================== */

    // 客户端 ctx 对属性访问按 inject 声明门禁：未声明的名字读一下就会抛
    // `cannot get property "<name>" without inject`，而 apply 抛错会让整个 client
    // boot 审计失败（一个插件失败 = 页面起不来）。因此这里必须列出 apply 用到的每一个服务。
    var inject = ["slots", "sessions", "modelDirectories", "locale"];

    /* ==================================================================
     * 现场诊断（只读）
     * ------------------------------------------------------------------
     * 0.1.1 的教训：客户端半边「静默失败」几乎无法被外部观察 —— 页面能起来、
     * 没有 crash 报告、inspect 里注册也都在，但入口就是不出现。
     * 因此把激活/渲染过程的关键事实记在一个全局对象里，并通过客户端 inspect
     * provider（ModelNavigatorDiag.probe）交给宿主侧读取：
     *   cordis_inspect_query(platform: "client", provider: "ModelNavigatorDiag", method: "probe")
     * 这里只做记录与只读探查，绝不改变任何行为。
     * ================================================================== */
    var DIAG = {
      plugin: "dsh-model-navigator",
      version: "0.2.1",
      seat: { priority: -20, enabled: null, registered: false, error: null },
      errors: [],
      events: [],
      composer: { injectCalls: 0, renders: 0, resolveCalls: 0, resolved: 0, fallbacks: 0, subagentSkips: 0, lastReason: null, lastError: null },
      settings: { injectCalls: 0, renders: 0 },
      styles: { inserted: false, length: 0, error: null },
      locale: { registered: false, bound: false, error: null },
      inspect: { registered: false, providerId: null, error: null },
      // 浮层到底走没走到 createPortal 只能现场确认：react-dom 若不在 seed 模块表里，
      // CAN_PORTAL 会是 false 而静默退回内联渲染（面板就可能被祖先的 transform 裁掉）。
      dom: { portalAvailable: CAN_PORTAL, mode: "closed", portalError: null, panelAncestorSlot: null },
      catalog: { providers: [], modelCount: 0 }
    };

    /**
     * 把当前目录压成**有界**的只读摘要（供应商 → 家族计数 + 每族样本），
     * 供 `ModelNavigatorDiag.probe` 读取。0.1.2 的「hy4-preview 8 个模型」就是
     * 分类问题，当时没有任何现场数据可查，只能靠截图反推；有摘要后一眼可定位。
     */
    function summarizeCatalog(catalog) {
      var out = { providers: [], modelCount: 0 };
      try {
        var providers = catalog !== null && catalog !== undefined && Array.isArray(catalog.providers) ? catalog.providers : [];
        for (var i = 0; i < providers.length && i < 24; i += 1) {
          var provider = providers[i];
          var models = Array.isArray(provider.models) ? provider.models : [];
          var index = new Map();
          var families = [];
          for (var m = 0; m < models.length; m += 1) {
            var model = models[m];
            var key = String(model.familyId);
            var seat = index.get(key);
            if (seat === undefined) {
              seat = { id: key, label: model.familyLabel, count: 0, source: model.familySource, sample: [] };
              index.set(key, seat);
              families.push(seat);
            }
            seat.count += 1;
            if (seat.sample.length < 6) seat.sample.push(model.ref.modelId);
          }
          out.providers.push({ id: provider.id, label: provider.label, modelCount: models.length, families: families });
          out.modelCount += models.length;
        }
      } catch (error) {
        out.note = describeError(error);
      }
      return out;
    }

    /** 有界追加，避免长期运行时把诊断对象撑爆。 */
    function pushBounded(list, value, cap) {
      try {
        list.push(value);
        if (list.length > cap) list.splice(0, list.length - cap);
      } catch (ignored) {
        /* 诊断不能反噬 */
      }
    }

    function describeError(error) {
      if (error === null || error === undefined) return "unknown";
      try {
        if (typeof error === "string") return error;
        if (typeof error.message === "string" && error.message !== "") return error.message;
        return String(error);
      } catch (ignored) {
        return "unprintable";
      }
    }

    function recordEvent(name, detail) {
      pushBounded(DIAG.events, { name: name, detail: detail === undefined ? null : detail }, 24);
    }

    function recordError(scope, error) {
      pushBounded(DIAG.errors, { scope: scope, message: describeError(error) }, 24);
    }

    /** 兜底日志：客户端 console 由宿主打上包名标签，crash 报告会收集 error 级输出。 */
    function reportFailure(scope, error) {
      recordError(scope, error);
      try {
        if (typeof console !== "undefined" && console !== null && typeof console.error === "function") {
          console.error("[dsh-model-navigator] " + scope + " failed:", error);
        }
      } catch (ignored) {
        /* 日志失败也不能影响激活 */
      }
    }

    function safeGet(ctx, name) {
      try {
        if (typeof ctx.get !== "function") return null;
        var value = ctx.get(name);
        return value === undefined ? null : value;
      } catch (error) {
        return null;
      }
    }

    /**
     * 输入框右侧入口的兜底包装。
     *
     * 0.1.1 的缺陷：这里以前写的是 `if (props.directory == null) return null;` —— 一旦
     * `modelDirectories.directoryFor(sessionId)` 抛错（例如该 session 的 binding 还没建立），
     * 入口就永久消失：renderer 按 entry×binding 缓存 inject 的返回值，我们不再被调用；
     * 因为没抛错，renderer 的 SlotErrorBoundary 也不会记录任何东西。
     *
     * 现在的约定：**永远渲染出可见的东西**。目录还没解析出来时渲染一个禁用的占位药丸，
     * 并（1）挂载后自动重试一次，（2）点击可手动重试。占位本身也是诊断证据：
     * 只要它出现，就说明这个槽位在渲染、问题只在目录解析。
     */
    function ComposerEntry(props) {
      // 0.1.6 修复「恢复循环」：resolve() 改写的是 face 对象本身，而组件收到的 props
      // 是宿主 inject 时拍下的旧快照——resolve 成功后 setTick 只会重放旧 props，
      // 占位永远不消失（0.1.5 真实页面累计 27927 次渲染 / 27867 次占位）。
      // 现在把「解析成功的 face 值」放进 React state：重试成功时用 setLive 同步新值，
      // 下一次渲染直接读 state，不再依赖宿主重新 inject props。
      var state0 = React.useState(0);
      var tick = state0[0];
      var setTick = state0[1];
      var liveState = React.useState(null);
      var live = liveState[0];
      var setLive = liveState[1];
      DIAG.composer.renders += 1;

      var reason = props.reason === null || props.reason === undefined ? "directory-pending" : String(props.reason);
      var pending = props.directory === null || props.directory === undefined;
      // 子会话（subagent）本来就没有模型目录：不占位、渲染空，与原生模型座位的
      // 「available=false」语义一致。计数留在 DIAG 里，免得又变成静默消失。
      var subagentSkip = pending && reason === "subagent-session";

      /** 手动/自动重试共用的解析入口；成功时把补齐后的 face 值推进 state。 */
      var attemptResolve = function () {
        var ok = false;
        try {
          ok = typeof props.resolve === "function" ? props.resolve() === true : false;
        } catch (error) {
          reportFailure("composer retry", error);
          ok = false;
        }
        if (!ok) return false;
        // resolve() 成功意味着 face 已原地补齐；props 是旧快照，face 本体由 buildFace
        // 挂在 resolve.__dsmn_face 上（见 inject 注册处），从那里取最新值进 state。
        var face = typeof props.resolve === "function" ? props.resolve.__dsmn_face : null;
        if (face !== null && face !== undefined && face.directory !== null && face.directory !== undefined) {
          setLive({
            available: face.available === true,
            store: face.store,
            draftStore: face.draftStore,
            directory: face.directory,
            reason: face.reason,
            lastError: face.lastError,
            load: face.load,
            select: face.select
          });
        }
        setTick(function (value) { return value + 1; });
        return true;
      };

      // hook 必须无条件执行（Rules of Hooks）：分支只影响 effect 内部行为与返回值。
      React.useEffect(
        function () {
          if (subagentSkip || (live !== null && live.directory !== null && live.directory !== undefined)) return undefined;
          if (props.directory !== null && props.directory !== undefined) return undefined;
          var cancelled = false;
          var retry = function () {
            if (!cancelled) attemptResolve();
          };
          var timer = null;
          try {
            timer = setTimeout(retry, 0);
          } catch (error) {
            retry();
          }
          return function () {
            cancelled = true;
            try {
              if (timer !== null) clearTimeout(timer);
            } catch (error) {
              /* 忽略 */
            }
          };
        },
        [props.resolve, props.directory, subagentSkip, live]
      );

      if (subagentSkip) {
        DIAG.composer.subagentSkips += 1;
        return null;
      }

      // 渲染取值：props 优先（宿主重新 inject 会带来新对象），否则回退到本组件解析
      // 成功后缓存的 live 值——这就是「props 陈旧也能恢复」的关键。
      var view = {
        sessionId: props.sessionId,
        locked: props.locked === true,
        available: props.available === true || (live !== null && live.available === true),
        store: props.store !== undefined && props.store !== null ? props.store : live === null ? null : live.store,
        draftStore: props.draftStore !== undefined && props.draftStore !== null ? props.draftStore : live === null ? null : live.draftStore,
        t: props.t,
        directory: props.directory !== undefined && props.directory !== null ? props.directory : live === null ? null : live.directory,
        reason: props.reason,
        lastError: props.lastError,
        load: props.load !== undefined && props.load !== null ? props.load : live === null ? null : live.load,
        select: props.select !== undefined && props.select !== null ? props.select : live === null ? null : live.select
      };

      if (view.directory !== null && view.directory !== undefined) return h(ModelNavigator, view);

      DIAG.composer.fallbacks += 1;
      var t = typeof props.t === "function" ? props.t : null;
      var label = t === null ? "模型导航器" : t("triggerAria");
      var detail = props.lastError === null || props.lastError === undefined ? "" : " — " + String(props.lastError);
      return h(
        "div",
        { className: "dsmn_root" },
        h(
          "button",
          {
            type: "button",
            className: "dsmn_trigger",
            // 不用 disabled：占位药丸必须可点，点一下就是一次手动重试（disabled 会吞掉 click）。
            "aria-disabled": "true",
            title: label + "：" + reason + detail,
            "aria-label": label + "：" + reason + detail,
            onClick: attemptResolve
          },
          h("span", { className: "dsmn_triggerLabel" }, label),
          h("span", { className: "dsmn_chevron", "aria-hidden": "true" }, "▾")
        )
      );
    }

    function truncateText(value, cap) {
      if (typeof value !== "string") return null;
      return value.length <= cap ? value : value.slice(0, cap) + "…(" + String(value.length) + " chars)";
    }

    /** 一格的 DOM 摘要（只读）。 */
    function describeNode(node) {
      if (node === null || node === undefined) return null;
      var out = {
        tag: node.tagName === undefined ? null : String(node.tagName),
        className: typeof node.className === "string" ? truncateText(node.className, 300) : null,
        hidden: node.hidden === true,
        childCount: node.children === undefined || node.children === null ? 0 : node.children.length,
        text: truncateText(typeof node.textContent === "string" ? node.textContent : "", 200)
      };
      try {
        if (typeof node.getBoundingClientRect === "function") {
          var rect = node.getBoundingClientRect();
          out.rect = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
        }
      } catch (error) {
        out.rectError = describeError(error);
      }
      try {
        if (typeof window !== "undefined" && window !== null && typeof window.getComputedStyle === "function") {
          var style = window.getComputedStyle(node);
          if (style !== null && style !== undefined) {
            out.display = style.display === undefined ? null : String(style.display);
            out.visibility = style.visibility === undefined ? null : String(style.visibility);
            out.opacity = style.opacity === undefined ? null : String(style.opacity);
          }
        }
      } catch (error) {
        out.styleError = describeError(error);
      }
      return out;
    }

    /**
     * 现场摘要里的 HTML：图标 SVG 的 path 数据动辄数千字符，会把真正要看的结构与文案淹没
     * （0.1.4 实测：一次 probe 的返回里大半是 path）。这里把 SVG 折叠成 `<svg></svg>`，
     * 再限长，保留槽位结构、类名与文案。
     */
    function compactHtml(node) {
      if (node === null || node === undefined || typeof node.innerHTML !== "string") return null;
      return truncateText(node.innerHTML.replace(/<svg[\s\S]*?<\/svg>/g, "<svg></svg>"), 1500);
    }

    /**
     * 渲染现场快照：把「输入框右下那一排」的 DOM 事实回报给宿主。
     * 这让「注册在、但界面上没有」这类问题不再需要靠用户截图猜。
     */
    function probeDom() {
      var out = { ok: false, note: null };
      try {
        if (typeof document === "undefined" || document === null || typeof document.querySelectorAll !== "function") {
          out.note = "no document in this client half";
          return out;
        }
        var all = document.querySelectorAll("div");
        var standard = null;
        var i;
        for (i = 0; i < all.length; i += 1) {
          var node = all[i];
          var name = typeof node.className === "string" ? node.className : "";
          if (name.indexOf("standardControls") !== -1) {
            standard = node;
            break;
          }
        }
        out.ok = true;
        out.standardControls = describeNode(standard);
        out.standardControlsHtml = compactHtml(standard);
        out.standardControlsChildren = [];
        if (standard !== null && standard.children !== null && standard.children !== undefined) {
          for (i = 0; i < standard.children.length; i += 1) out.standardControlsChildren.push(describeNode(standard.children[i]));
        }
        var trailing = standard === null ? null : standard.parentElement;
        out.trailing = describeNode(trailing);
        out.trailingHtml = compactHtml(trailing);
        out.triggerCount = document.querySelectorAll(".dsmn_trigger").length;
        out.rootCount = document.querySelectorAll(".dsmn_root").length;
        var styles = document.querySelectorAll("style[data-plugin]");
        out.stylePluginCount = styles.length;
        out.stylePlugins = [];
        for (i = 0; i < styles.length; i += 1) {
          try {
            var pluginName = String(styles[i].getAttribute("data-plugin"));
            // 页面上有近百个插件样式表，全量返回只会把 composer 这一小块淹掉；只留自己的。
            if (pluginName.indexOf(NS) !== -1) out.stylePlugins.push(pluginName);
          } catch (error) {
            out.stylePlugins.push("?");
          }
        }
        out.buttons = [];
        var buttonCount = 0;
        var buttons = document.querySelectorAll("button");
        for (i = 0; i < buttons.length; i += 1) {
          // 只要输入框右下这一块里的按钮：侧边栏那几十个按钮与本次排查无关。
          if (trailing !== null && typeof trailing.contains === "function" && !trailing.contains(buttons[i])) continue;
          buttonCount += 1;
          if (buttonCount <= 12) out.buttons.push(describeNode(buttons[i]));
        }
        out.buttonCount = buttonCount;
      } catch (error) {
        out.note = describeError(error);
      }
      return out;
    }

    function snapshotDiag() {
      return {
        plugin: DIAG.plugin,
        version: DIAG.version,
        seat: { priority: DIAG.seat.priority, enabled: DIAG.seat.enabled, registered: DIAG.seat.registered, error: DIAG.seat.error },
        composer: {
          injectCalls: DIAG.composer.injectCalls,
          renders: DIAG.composer.renders,
          resolveCalls: DIAG.composer.resolveCalls,
          resolved: DIAG.composer.resolved,
          fallbacks: DIAG.composer.fallbacks,
          subagentSkips: DIAG.composer.subagentSkips,
          lastReason: DIAG.composer.lastReason,
          lastError: DIAG.composer.lastError
        },
        settings: { injectCalls: DIAG.settings.injectCalls, renders: DIAG.settings.renders },
        styles: { inserted: DIAG.styles.inserted, length: DIAG.styles.length, error: DIAG.styles.error },
        locale: { registered: DIAG.locale.registered, bound: DIAG.locale.bound, error: DIAG.locale.error },
        inspect: { registered: DIAG.inspect.registered, providerId: DIAG.inspect.providerId, error: DIAG.inspect.error },
        // 浮层实际走的是 createPortal 还是内联回退，只有现场能确认（见 DIAG.dom 注释）。
        dom: {
          portalAvailable: DIAG.dom.portalAvailable,
          mode: DIAG.dom.mode,
          portalError: DIAG.dom.portalError,
          panelAncestorSlot: DIAG.dom.panelAncestorSlot
        },
        catalog: DIAG.catalog,
        selection: DIAG.selection === undefined ? null : DIAG.selection,
        errors: DIAG.errors.slice(0),
        events: DIAG.events.slice(0)
      };
    }

    var DIAG_INPUT = { type: "object", properties: {}, additionalProperties: false };

    /** 只读 inspect provider：宿主按 platform=client / provider=ModelNavigatorDiag 查询。 */
    function buildDiagProvider() {
      return {
        manifest: {
          id: "ModelNavigatorDiag",
          description: "dsh-model-navigator live activation state, composer DOM landmarks, and recent errors.",
          methods: [
            {
              name: "probe",
              description: "Activation counters, recent errors, and the composer area's DOM landmarks.",
              inputSchema: DIAG_INPUT,
              outputSchema: { description: "JSON diagnostics owned by dsh-model-navigator." }
            }
          ]
        },
        query: function (method) {
          if (method !== "probe") throw new Error('unknown ModelNavigatorDiag inspect method "' + String(method) + '"');
          return { diag: snapshotDiag(), dom: probeDom() };
        }
      };
    }

    /**
     * 激活入口：任何异常都必须在这里被吃掉。
     *
     * 0.2.0-rc.2 的 client 半边激活是「全有或全无」：只要有一个 entry 的 fiber 不是 active，
     * 整个 web boot 就判定失败并退出（用户会看到页面起不来）。所以即使遇到没预料到的宿主差异，
     * 也只能降级 + 记日志，绝不能把异常抛出去。
     */
    function apply(ctx) {
      try {
        applyInner(ctx);
      } catch (error) {
        reportFailure("activate", error);
      }
    }

    function applyInner(ctx) {
      var store = createPreferencesStore(safeGet(ctx, "settingsScope"));
      var draftStore = createDraftStore();
      var t = function (key) {
        var value = DICT.zh[key];
        return value === undefined ? key : value;
      };

      // 用户/开发者可在 DevTools 里直接看现场：window.__DSMN_DIAG__
      try {
        if (typeof window !== "undefined" && window !== null) window.__DSMN_DIAG__ = DIAG;
      } catch (error) {
        /* 挂诊断对象失败不影响激活 */
      }

      // 样式：0.2.0-rc.2 的 client ctx 没有 styles 服务（读 ctx.styles 会因未声明而抛错），
      // 官方插件的做法是自己插一个 <style>：打上 data-plugin 供宿主按包名清理与 HMR 记账。
      ctx.effect(function () {
        if (typeof document === "undefined" || document === null) return function () {};
        var head = document.head;
        if (head === undefined || head === null || typeof head.appendChild !== "function") return function () {};
        if (typeof document.createElement !== "function") return function () {};
        var tag = null;
        try {
          tag = document.createElement("style");
          tag.setAttribute("data-plugin", "dsh-model-navigator");
          tag.textContent = CSS; // CSS 已经是拼好的字符串（[ … ].join("")）
          head.appendChild(tag);
          DIAG.styles.inserted = true;
          DIAG.styles.length = typeof CSS === "string" ? CSS.length : 0;
        } catch (error) {
          DIAG.styles.error = describeError(error);
          reportFailure("styles", error);
          return function () {};
        }
        return function () {
          try {
            if (tag !== null && typeof tag.remove === "function") tag.remove();
          } catch (error) {
            /* 卸载失败不影响其他清理 */
          }
        };
      }, "dsh-model-navigator:styles");

      ctx.effect(function () {
        // locale 已在 inject 中声明；仍然整体加护栏，避免宿主换实现时把 boot 拖死。
        var locale = null;
        try {
          locale = ctx.locale;
        } catch (error) {
          reportFailure("locale lookups", error);
          return function () {};
        }
        if (locale === null || locale === undefined || typeof locale.register !== "function") return function () {};
        var dispose = null;
        try {
          dispose = locale.register(NS, { zh: DICT.zh, en: DICT.en });
          DIAG.locale.registered = true;
        } catch (error) {
          DIAG.locale.error = describeError(error);
          reportFailure("locale registration", error);
        }
        try {
          if (typeof locale.bind === "function") {
            var bound = locale.bind(NS);
            if (typeof bound === "function") {
              t = bound;
              DIAG.locale.bound = true;
            }
          }
        } catch (error) {
          /* 取不到绑定函数就退回内建词条 */
        }
        return function () {
          try {
            if (typeof dispose === "function") dispose();
          } catch (error) {
            /* 忽略 */
          }
        };
      }, "dsh-model-navigator:locale");

      ctx.effect(function () {
        if (typeof ctx.on !== "function") return function () {};
        var off = null;
        try {
          off = ctx.on("connection/reset", function () { draftStore.resetGeneration(); });
        } catch (error) {
          reportFailure("connection listener", error);
        }
        return function () {
          try {
            if (typeof off === "function") off();
          } catch (error) {
            /* 忽略 */
          }
        };
      }, "dsh-model-navigator:connection-reset");

      try {
        ctx.slots.inject("conversation.input.model", function () {
        // face 必须按 sessionId 保持身份稳定（renderer 也按 entry×binding 缓存 inject 结果），
        // 但 **解析失败绝不能被永久缓存**：目录延迟就绪时，face.resolve() 允许原地补上，
        // 由 ComposerEntry 在挂载后/点击时重试。
        var faces = new Map();
        var bindingFaces = new WeakMap();

        function buildFace(sessionId) {
          var binding = null;
          var addressed = false;
          var face = {
            sessionId: sessionId,
            available: false,
            store: store,
            draftStore: draftStore,
            // t 在 locale effect 里会被重新绑定成宿主 locale.bind(NS) 的结果，
            // 捕获函数会让 composer 这一侧永远停在绑定前的内建词条 → 用转发读取。
            t: function (key) { return t(key); },
            directory: null,
            reason: "directory-pending",
            lastError: null,
            resolve: function () {
              if (binding !== null) return true;
              DIAG.composer.resolveCalls += 1;

              var address = null;
              try {
                address = ctx.sessions.subagentAddress(sessionId);
              } catch (error) {
                address = null;
              }
              addressed = address !== undefined && address !== null;
              if (addressed) {
                face.available = false;
                face.reason = "subagent-session";
                DIAG.composer.lastReason = face.reason;
                return false;
              }

              try {
                var resolved = ctx.modelDirectories.directoryFor(sessionId);
                binding = resolved;
                face.directory = resolved.store;
                face.available = true;
                face.reason = null;
                face.lastError = null;
                DIAG.composer.resolved += 1;
                DIAG.composer.lastReason = null;
                DIAG.composer.lastError = null;
                recordEvent("composer directory resolved", sessionId);
                try {
                  var seedSnapshot = resolved.store.getSnapshot();
                  if (seedSnapshot !== null && seedSnapshot !== undefined) draftStore.seed(sessionId, seedSnapshot.current);
                } catch (error) {
                  /* 播种失败不影响渲染 */
                }
                return true;
              } catch (error) {
                binding = null;
                face.available = false;
                face.directory = null;
                face.reason = "directory-unavailable";
                face.lastError = describeError(error);
                DIAG.composer.lastReason = face.reason;
                DIAG.composer.lastError = face.lastError;
                recordError("session directory", error);
                return false;
              }
            },
            load: function () {
              if (binding === null || addressed) return;
              try {
                var loading = binding.load();
                if (loading !== null && loading !== undefined && typeof loading.catch === "function") loading.catch(NOOP);
              } catch (error) {
                /* 失败由快照的 status=error 呈现 */
              }
            },
            select: function (selection) {
              if (binding === null || addressed) return Promise.resolve(false);
              try {
                return binding.select(selection);
              } catch (error) {
                return Promise.reject(error);
              }
            }
          };
          // 0.1.6：resolve 恢复成功后，组件要能把补齐后的 face 值推进 React state
          //（props 是宿主 inject 时的旧快照）。face 本体就挂在这里。
          face.resolve.__dsmn_face = face;
          return face;
        }

        var registerSeat = function () { return ctx.slots.register(
          {
            name: "conversation.input.model",
            id: "dsh-model-navigator",
            // Lowest priority wins. Codex subscription installs -10 for every root session.
            priority: -20,
            locale: NS,
            inject: function (sessionId) {
              DIAG.composer.injectCalls += 1;
              // The host scopes directories by binding identity, not session ID.
              // Restoring/recreating the same ID must not reuse a disposed directory.
              var owner = null;
              try { if (typeof ctx.sessions.binding === "function") owner = ctx.sessions.binding(sessionId); }
              catch (error) { owner = null; }
              var hasOwner = owner !== null && owner !== undefined && (typeof owner === "object" || typeof owner === "function");
              var cache = hasOwner ? bindingFaces : faces;
              var cacheKey = hasOwner ? owner : sessionId;
              var cached = cache.get(cacheKey);
              if (cached !== undefined) return cached;
              var face = buildFace(sessionId);
              // 先试一次：成功时行为与 0.1.1 完全相同（available=true、directory 已就绪）
              try {
                face.resolve();
              } catch (error) {
                reportFailure("composer resolve", error);
              }
              cache.set(cacheKey, face);
              return face;
            }
          },
          function (props) {
            return h(ComposerEntry, props);
          }
        ); };
        return ctx.effect(function () {
          var disposeSeat = null;
          var syncSeat = function () {
            DIAG.seat.enabled = store.getPreferences().enabled !== false;
            if (!DIAG.seat.enabled) {
              if (disposeSeat !== null) { disposeSeat(); disposeSeat = null; }
              DIAG.seat.registered = false;
            } else if (disposeSeat === null) {
              try {
                disposeSeat = registerSeat();
                DIAG.seat.registered = true;
                DIAG.seat.error = null;
              } catch (error) {
                DIAG.seat.registered = false;
                DIAG.seat.error = describeError(error);
                reportFailure("model seat registration", error);
              }
            }
          };
          syncSeat();
          var unsubscribe = store.subscribe(syncSeat);
          return function () {
            unsubscribe();
            if (disposeSeat !== null) disposeSeat();
            DIAG.seat.registered = false;
            faces.clear();
            bindingFaces = new WeakMap();
          };
        });
        });
      } catch (error) {
        reportFailure("composer registration", error);
      }

      // 设置行：General 里的「模型导航器」一项（list 槽位，replaceRisk none）。
      // 该槽位的 owner 不传任何 props、也不投影 label，所以文案与写入路径都由本 face 自带；
      // face 必须身份稳定（renderer 按 entry×binding 缓存 inject 的返回值），
      // 且 t 需要在 locale effect 里被重新绑定后仍指向最新函数，因此用转发函数读取。
      var settingsFace = {
        store: store,
        getTier: function () { return store.getTier(); },
        t: function (key) { return t(key); }
      };

      try {
        ctx.slots.inject("settings.general.item", function () {
          return ctx.slots.register(
            {
              name: "settings.general.item",
              id: "dsh-model-navigator",
              order: 40,
              locale: NS,
              inject: function () {
                DIAG.settings.injectCalls += 1;
                return settingsFace;
              }
            },
            function (props) {
              DIAG.settings.renders += 1;
              return h(SettingsRow, props);
            }
          );
        });
      } catch (error) {
        reportFailure("settings item registration", error);
      }

      // 现场诊断 provider：宿主侧用
      //   cordis_inspect_query(platform:"client", provider:"ModelNavigatorDiag", method:"probe")
      // 就能读到激活计数、最近错误，以及输入框右下那一排的真实 DOM（只读、无副作用）。
      // cordisInspect 是 cordis-client-runner 提供的 Client Service；用 ctx.get 读取，
      // 故意不写进 inject —— 万一该服务不存在，插件也必须照常激活，而不是整体不加载。
      try {
        var inspect = safeGet(ctx, "cordisInspect");
        if (inspect !== null && inspect !== undefined && typeof inspect.register === "function") {
          ctx.effect(function () {
            var dispose = inspect.register(buildDiagProvider());
            DIAG.inspect.registered = true;
            DIAG.inspect.providerId = "ModelNavigatorDiag";
            recordEvent("diag provider registered", "ModelNavigatorDiag");
            return function () {
              DIAG.inspect.registered = false;
              try {
                if (typeof dispose === "function") dispose();
              } catch (error) {
                /* 忽略 */
              }
            };
          }, "dsh-model-navigator:diag-provider");
        } else {
          DIAG.inspect.error = "cordisInspect service unavailable";
          recordEvent("diag provider skipped", DIAG.inspect.error);
        }
      } catch (error) {
        DIAG.inspect.error = describeError(error);
        reportFailure("diag inspect provider", error);
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
