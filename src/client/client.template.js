/**
 * dsh-model-navigator 客户端半边（模板）。
 *
 * 本文件不直接发布：tools/build-client.mjs 会把 /*__CORE_EMBED__*​/ 处替换成
 * src/core/*.mjs 的纯逻辑（去掉 export 后内联成 __core），并把版本号写进 DIAG，产出 lib/client.js。
 * 因此这里只写「宿主 I/O + slot 注册 + React 组件 + 样式 + 词条」，不重复实现纯逻辑。
 *
 * 硬约束：
 *   - 注册 conversation.input.model（priority -20）与 settings.general.item；
 *     替换官方(0)和 codex-subscription(-10) 入口，关闭增强时注销座位。
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
    // 与官方 ModelSelect 一致：目录里超过这么多个模型才显示搜索框
    var SEARCH_MIN_MODELS = 4;

    /* ================================================================== *
     * 词条
     * ================================================================== */

    var DICT = {
      zh: {
        title: "模型导航器",
        triggerAria: "模型",
        menuModel: "模型",
        menuAria: "模型与思维强度",
        effortOpen: "调整思维强度",
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
        searchClear: "清除搜索",
        close: "关闭",
        loading: "加载中…",
        refreshing: "正在刷新模型列表…",
        groupLoadFailed: " 加载失败：",
        retry: "重试加载",
        favorites: "收藏夹",
        favoritesEmpty: "还没有收藏，点击模型旁的星标即可添加。",
        favoritesUnavailable: "收藏的模型当前不在目录中。",
        recentEmpty: "还没有最近使用的模型。",
        currentSelection: "当前模型",
        recent: "最近使用",
        favoriteAdd: "收藏模型",
        favoriteRemove: "取消收藏",
        recentRemove: "移除记录",
        modelUnavailable: "该模型已不在目录中，请选择其他模型或刷新目录。",
        effortUnavailable: "该思维强度已不可用，请重新选择。",
        unavailableGroup: "不可用",
        refresh: "刷新目录",
        selecting: "切换中…",
        unavailable: "当前会话不可切换模型",
        loadFailed: "模型目录加载失败：",
        selectFailed: "切换失败：",
        sessionInUse: "该会话正忙，请稍后再试。",
        currentOutside: "当前选择不在模型目录中，请选择其他模型：",
        emptyCatalog: "没有可用的模型。",
        storageLocal: "偏好：本机浏览器存储",
        storageMemory: "偏好：仅本次运行有效",
        settingsHint: "增强版两级模型选择器：模型 → 思维强度。与官方选择器同样的结构和键盘操作，另有全局搜索、收藏、最近使用、按供应商与家族分组，并显示其他插件提供的模型标签。关闭后恢复原生入口。",
        settingsEnabled: "替换原生模型选择器",
        settingsGrouping: "模型排列",
        groupingOff: "宿主顺序",
        groupingChannel: "按家族分组",
        groupingFamily: "家族固定顺序",
        settingsShowSearch: "模型较多时显示搜索框",
        settingsStorage: "偏好存储",
        settingsOn: "开",
        settingsOff: "关",
        settingsCollapse: "收起",
        settingsExpand: "展开"
      },
      en: {
        title: "Model Navigator",
        triggerAria: "Model",
        menuModel: "Model",
        menuAria: "Model and reasoning effort",
        effortOpen: "Adjust reasoning effort",
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
        searchClear: "Clear search",
        close: "Close",
        loading: "Loading…",
        refreshing: "Refreshing model list…",
        groupLoadFailed: " failed to load: ",
        retry: "Retry loading",
        favorites: "Favorites",
        favoritesEmpty: "No favorites yet. Use the star beside a model to add it.",
        favoritesUnavailable: "Your favorite models are not in the current catalog.",
        recentEmpty: "No recent models yet.",
        currentSelection: "Current model",
        recent: "Recently used",
        favoriteAdd: "Favorite model",
        favoriteRemove: "Remove favorite",
        recentRemove: "Remove from recent",
        modelUnavailable: "This model is no longer in the catalog. Choose another model or refresh.",
        effortUnavailable: "This reasoning level is no longer available. Choose again.",
        unavailableGroup: "Unavailable",
        refresh: "Refresh catalog",
        selecting: "Switching…",
        unavailable: "This session cannot switch models",
        loadFailed: "Failed to load the model catalog: ",
        selectFailed: "Switch failed: ",
        sessionInUse: "This session is busy, try again shortly.",
        currentOutside: "Current selection is not in the model catalog. Choose another model: ",
        emptyCatalog: "No models available.",
        storageLocal: "Preferences: this browser",
        storageMemory: "Preferences: this run only",
        settingsHint: "Enhanced two-level model picker: model → reasoning effort. Same structure and keyboard behaviour as the official picker, plus global search, favorites, recent models, provider and family groups, and model labels contributed by other plugins. Turn it off to restore the native entry.",
        settingsEnabled: "Replace the native model picker",
        settingsGrouping: "Model layout",
        groupingOff: "Host order",
        groupingChannel: "Group by family",
        groupingFamily: "Fixed family order",
        settingsShowSearch: "Show a search box when there are many models",
        settingsStorage: "Preference storage",
        settingsOn: "On",
        settingsOff: "Off",
        settingsCollapse: "Collapse",
        settingsExpand: "Expand"
      }
    };

    /* ================================================================== *
     * 偏好存储：localStorage → 内存
     * 宿主（0.2.1）没有插件自有的设置通道；拿不到 localStorage 时只在本次运行内有效。
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

    function createPreferencesStore() {
      var storage = null;
      try {
        storage = typeof localStorage === "undefined" ? null : localStorage;
      } catch (error) {
        storage = null;
      }
      var backend = storage === null ? memoryBackend() : browserBackend(storage);

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

      return {
        getTier: function () { return backend.tier; },
        getState: function () { return backend.state; },
        getPreferences: function () { return current; },
        subscribe: function (listener) {
          listeners.add(listener);
          return function () { listeners.delete(listener); };
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
          var efforts = {};
          // 没带档位 = 这次选的是默认档：删掉旧记录，下次回到模型默认
          efforts[__core.stableKeyOf({ providerId: selection.provider, modelId: selection.model })] =
            typeof selection.reasoningEffort === "string" ? selection.reasoningEffort : null;
          current = __core.patchPreferences(current, {
            lastProviderId: selection.provider,
            lastModelByProvider: map,
            effortByModel: efforts,
            recentModels: __core.rememberRecent(current.recentModels, selection.provider, selection.model)
          });
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
          entry = { draft: null };
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

    // 前半段 dsmn_ 规则逐条复制自官方 @deepseek-ai/dsh-client-ui-model-selection 0.2.0-rc.2 的
    // ModelSelect CSS 模块（仅把 cl2Rlq_ 前缀换成 dsmn_），保证与官方面板同款排版/悬停/圆角/令牌；
    // 例外是搜索框（官方规则作用在包裹层上，这里样式直接落在 input 本身）。
    // 从 .dsmn_cellBack 起是本插件自有的规则（树形层级、收藏/最近、标签、设置行）。
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
      ".dsmn_menu{z-index:1100;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:max-content;min-width:min(240px,100vw - 32px);max-width:min(420px,100vw - 32px);max-height:min(360px,100vh - 96px);background:var(--dsw-menu-surface-fill,var(--dsw-alias-bg-layer-2));backdrop-filter:var(--dsw-menu-backdrop-filter);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex-direction:column;padding:4px;display:flex;position:fixed;overflow:hidden}",
      ".dsmn_status,.dsmn_empty{color:var(--dsw-alias-label-tertiary);padding:8px;font-size:12px;line-height:18px}",
      ".dsmn_error,.dsmn_warning{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:3px;padding:6px 7px;font-size:11px;line-height:16px;display:flex}",
      ".dsmn_warning{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label)}",
      ".dsmn_retry{color:inherit;font:inherit;cursor:pointer;background:0 0;border:none;flex:none;padding:0;font-weight:600}",
      ".dsmn_searchRow{flex-shrink:0;margin:2px 0 4px;position:relative}",
      ".dsmn_searchRow .dsmn_search{box-sizing:border-box;width:100%;height:30px;padding:0 6px;display:block;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover);border:1px solid #0000;outline:none;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px}",
      ".dsmn_searchRow .dsmn_searchWithQuery{padding-right:34px}",
      ".dsmn_searchClear{corner-shape:round;width:24px;height:24px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:50%;justify-content:center;align-items:center;padding:0;display:inline-flex;position:absolute;top:50%;right:4px;transform:translateY(-50%)}",
      ".dsmn_searchClear:hover,.dsmn_searchClear:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}",
      ".dsmn_searchRow .dsmn_search:focus{border-color:var(--dsw-alias-border-l2)}",
      ".dsmn_searchRow .dsmn_search::placeholder{color:var(--dsw-alias-label-caption)}",
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
      ".dsmn_cellBack .dsmn_cellChevron{margin-right:2px;}",
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
      // 模型页是一棵可折叠的树：字号、字重、颜色、缩进线四路同时变化，层级才一眼可辨。
      // 字阶：供应商 14/600 > 模型 13/400 > 家族 12/500 > 分区标题 11/600。
      // 几何：每级 14px，缩进线落在列表左缘 14px、28px；文字落在 26px、40px，与上一级的文字对齐。
      // 颜色只表达状态：蓝色 = 当前模型所在路径，琥珀色 = 有供应商加载失败。
      ".dsmn_menu[data-pane=model]{width:min(400px,100vw - 32px)}",
      ".dsmn_groupToggle{display:flex;align-items:center;gap:6px;width:100%;min-height:26px;box-sizing:border-box;padding:0 7px 0 8px;background:0 0;border:none;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;font-weight:500;line-height:18px;cursor:pointer;text-align:left;border-radius:var(--dsw-radius-sm);}",
      ".dsmn_groupToggle:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);}",
      ".dsmn_groupToggle[data-indent='1']{position:relative;width:calc(100% - 20px);margin-left:20px;padding-left:2px;}",
      ".dsmn_groupChevron{display:inline-flex;align-items:center;justify-content:center;flex:none;width:12px;height:12px;color:var(--dsw-alias-label-caption);transition:transform .12s;}",
      ".dsmn_providerToggle[aria-expanded=true] .dsmn_groupChevron,.dsmn_groupToggle[aria-expanded=true] .dsmn_groupChevron{transform:rotate(90deg);}",
      ".dsmn_groupLabelText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".dsmn_groupCount{flex:none;margin-left:auto;padding-left:8px;color:var(--dsw-alias-label-caption);font-size:11px;font-weight:400;font-variant-numeric:tabular-nums;}",
      ".dsmn_currentMark{flex:none;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-business-primary);}",
      ".dsmn_modelRow{display:flex;align-items:center;min-width:0;border-radius:var(--dsw-radius-md);}",
      ".dsmn_modelRow>.dsmn_option{min-width:0;min-height:30px;padding-top:3px;padding-bottom:3px;flex:1;}",
      ".dsmn_modelRow[data-active=true]{background:var(--dsw-alias-interactive-bg-hover);}",
      ".dsmn_modelRow>.dsmn_option:focus-visible,.dsmn_modelRow>.dsmn_optionActive:not(:disabled){background:0 0;}",
      ".dsmn_modelRow[data-current=true] .dsmn_modelName{font-weight:500;}",
      ".dsmn_modelRow[data-indent]{position:relative;}",
      ".dsmn_modelRow[data-indent='1']{margin-left:20px;}",
      ".dsmn_modelRow[data-indent='2']{margin-left:34px;}",
      ".dsmn_modelRow[data-indent]>.dsmn_option{padding-left:6px;}",
      ".dsmn_groupToggle[data-indent]::before,.dsmn_modelRow[data-indent]::before{content:'';position:absolute;top:0;bottom:0;left:-6px;box-sizing:border-box;border-left:1px solid var(--dsw-alias-border-l1);pointer-events:none;}",
      ".dsmn_modelRow[data-indent='2']::before{left:-20px;width:15px;border-right:1px solid var(--dsw-alias-border-l1);}",
      ".dsmn_modelRow[data-indent='1'][data-current=true]::before{border-left:2px solid var(--dsw-alias-state-business-primary);}",
      ".dsmn_modelRow[data-indent='2'][data-current=true]::before{border-right:2px solid var(--dsw-alias-state-business-primary);}",
      ".dsmn_modelMeta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".dsmn_pin,.dsmn_effortOpen{background:transparent;border:0;color:var(--dsw-alias-label-caption);width:26px;height:26px;padding:0;cursor:pointer;flex:none;border-radius:var(--dsw-radius-sm);display:inline-flex;align-items:center;justify-content:center;font-size:13px;}",
      ".dsmn_pin{visibility:hidden}",
      ".dsmn_pin:last-child{margin-right:26px}",
      ".dsmn_modelRow:hover .dsmn_pin,.dsmn_modelRow:focus-within .dsmn_pin,.dsmn_modelRow[data-active=true] .dsmn_pin,.dsmn_pin[aria-pressed=true],.dsmn_pinVisible{visibility:visible}",
      ".dsmn_pin:hover,.dsmn_pin:focus-visible,.dsmn_effortOpen:hover:not(:disabled),.dsmn_effortOpen:focus-visible{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);outline:none}",
      ".dsmn_pin[aria-pressed=true]{color:var(--dsw-alias-label-tertiary);}",
      ".dsmn_effortOpen:disabled{cursor:default;opacity:.5}",
      ".dsmn_label{min-width:0;display:inline-flex;align-items:center;gap:4px;max-width:100%;overflow:hidden;text-overflow:ellipsis}",
      ".dsmn_stateDot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-state-business-primary);animation:dsmn_pulse 1s ease-in-out infinite}",
      "@keyframes dsmn_pulse{0%,100%{opacity:.35}50%{opacity:1}}",
      ".dsmn_section+.dsmn_section{margin-top:2px}",
      // 分隔线只出现在三个区域的交界：快捷入口（收藏、最近）、供应商树、「不可用」
      ".dsmn_section[data-section=favorites]+.dsmn_section[data-section=provider],.dsmn_section[data-section=recent]+.dsmn_section[data-section=provider],.dsmn_section+.dsmn_section[data-section=unavailable]{margin-top:5px;padding-top:4px;border-top:1px solid var(--dsw-alias-border-l1)}",
      // 标题不吸顶：菜单是半透明的，吸顶后滚过的行会透出来和标题重叠，叠加的底色还会形成色带
      ".dsmn_menuGroupLabel{padding:8px 7px 3px;font-size:11px;font-weight:600;line-height:16px;color:var(--dsw-alias-label-caption)}",
      ".dsmn_providerToggle{display:flex;align-items:center;gap:5px;width:100%;min-height:30px;box-sizing:border-box;padding:0 7px;background:0 0;border:none;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;font-weight:600;line-height:20px;text-align:left;cursor:pointer}",
      ".dsmn_providerToggle:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".dsmn_providerToggle .dsmn_groupChevron{width:14px;height:14px;color:var(--dsw-alias-label-tertiary)}",
      // 「不可用」不是供应商：和分区标题同一字阶，放在底部分隔线之下
      ".dsmn_section[data-section=unavailable] .dsmn_providerToggle{min-height:24px;color:var(--dsw-alias-label-caption);font-size:11px;font-weight:500;line-height:16px}",
      ".dsmn_section[data-section=unavailable] .dsmn_providerToggle:hover{color:var(--dsw-alias-label-secondary)}",
      ".dsmn_section[data-section=unavailable] .dsmn_providerToggle .dsmn_groupChevron{color:var(--dsw-alias-label-caption)}",
      ".dsmn_providerToggle[data-has-failure=true] .dsmn_groupCount{color:var(--dsw-alias-state-warn-label)}",
      ".dsmn_section[data-section=unavailable] .dsmn_warning{margin:2px 0 2px 20px}",
      ".dsmn_missingModel .dsmn_option{cursor:default}",
      ".dsmn_missingModel .dsmn_modelName{color:var(--dsw-alias-label-tertiary)}",
      "@media (prefers-reduced-motion:reduce){.dsmn_groupChevron{transition:none}}"
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

    /* ============================================================== *
     * 模型标签槽位：conversation.input.model.label
     * 官方 ModelSelect 声明了这个子槽位（single / session / inline），其他插件
     * （例如给特定模型加角标的插件）往里注册标签组件。我们替换了官方入口，
     * 不能再声明一次（重复声明会抛），也拿不到只发给声明者的 renderSlot，
     * 所以直接读 SlotCore 的胜出项，按宿主渲染器的 props 顺序自己渲染：
     *   entry.inject(sessionId) 的结果 → owner props（provider/model/placement/selected）→ t。
     * 宿主独有的 hooks 无法复刻；标签组件出错时由边界退回纯文本模型名，并记进 DIAG.label。
     * ============================================================== */
    var LABEL_SLOT = "conversation.input.model.label";
    var IDENTITY_T = function (key) { return key; };
    var labelFaces = new WeakMap();

    function recordLabelError(error) {
      try {
        DIAG.label.errors += 1;
        DIAG.label.lastError = describeError(error);
      } catch (ignored) {
        /* 诊断不能反噬渲染 */
      }
    }

    // 官方渲染器每个标签外面都有 SlotErrorBoundary；这里用 React.Component 造一个等价边界。
    // 取不到 Component 的环境（只在离线替身里出现）就不包边界，错误交给外层宿主边界。
    var LabelBoundary = null;
    if (typeof React.Component === "function") {
      LabelBoundary = function DsmnLabelBoundary(props) {
        React.Component.call(this, props);
        this.state = { failed: false };
      };
      LabelBoundary.prototype = Object.create(React.Component.prototype);
      LabelBoundary.prototype.constructor = LabelBoundary;
      LabelBoundary.getDerivedStateFromError = function () { return { failed: true }; };
      LabelBoundary.prototype.componentDidCatch = function (error) { recordLabelError(error); };
      LabelBoundary.prototype.render = function () {
        if (this.state !== null && this.state !== undefined && this.state.failed === true) {
          DIAG.label.fallbacks += 1;
          return this.props.fallback;
        }
        return this.props.children;
      };
    }

    /** 标签项自己的 inject 结果：与宿主一样按 (entry × sessionId) 缓存，hooks 源无法绑定，直接丢掉。 */
    function labelFaceOf(entry, sessionId) {
      if (typeof entry.inject !== "function") return null;
      var bySession = labelFaces.get(entry);
      if (bySession === undefined) {
        bySession = new Map();
        labelFaces.set(entry, bySession);
      }
      if (bySession.has(sessionId)) return bySession.get(sessionId);
      var face = null;
      try {
        var raw = entry.inject(sessionId);
        if (raw !== null && typeof raw === "object") {
          face = {};
          var keys = Object.keys(raw);
          for (var i = 0; i < keys.length; i += 1) {
            if (keys[i] !== "hooks" && keys[i] !== "keyedHooks") face[keys[i]] = raw[keys[i]];
          }
        }
      } catch (error) {
        recordLabelError(error);
        face = null;
      }
      bySession.set(sessionId, face);
      return face;
    }

    /** 订阅标签槽位，返回当前胜出项（没有 SlotCore 读接口或没有注册项时为 null）。 */
    function useLabelEntry(labels) {
      var slots = labels === null || labels === undefined ? null : labels.slots;
      var usable = slots !== null && slots !== undefined && typeof slots.entriesOfSlot === "function";
      var tickRef = React.useRef(0);
      var subscribe = React.useCallback(
        function (onChange) {
          if (!usable || typeof slots.subscribe !== "function") return NOOP;
          try {
            var off = slots.subscribe(LABEL_SLOT, function () {
              tickRef.current += 1;
              onChange();
            });
            return typeof off === "function" ? off : NOOP;
          } catch (error) {
            recordLabelError(error);
            return NOOP;
          }
        },
        [slots, usable]
      );
      var read = React.useCallback(
        function () {
          if (!usable) return 0;
          if (typeof slots.getVersion !== "function") return tickRef.current;
          try {
            var version = slots.getVersion(LABEL_SLOT);
            return typeof version === "number" ? version : tickRef.current;
          } catch (error) {
            return tickRef.current;
          }
        },
        [slots, usable]
      );
      var version = React.useSyncExternalStore(subscribe, read, read);
      var entry = React.useMemo(
        function () {
          if (!usable) return null;
          try {
            var list = slots.entriesOfSlot(LABEL_SLOT);
            if (!Array.isArray(list) || list.length === 0) return null;
            var first = list[0];
            if (first === null || first === undefined) return null;
            var comp = first.component;
            return typeof comp === "function" || (typeof comp === "object" && comp !== null) ? first : null;
          } catch (error) {
            // 官方入口没装时子槽位未声明，entriesOfSlot 可能抛：当作没有标签项
            return null;
          }
        },
        [slots, usable, version]
      );
      DIAG.label.api = usable;
      DIAG.label.entry = entry === null ? null : labelEntryId(entry);
      return { entry: entry, version: version };
    }

    function labelEntryId(entry) {
      var options = entry.options;
      if (options !== null && options !== undefined && typeof options.id === "string") return options.id;
      if (typeof entry.registrant === "string") return entry.registrant;
      return "anonymous";
    }

    /** 宿主原始模型对象索引（标签组件按官方契约拿到的是宿主的 model，不是本插件的显示对象）。 */
    function rawModelIndex(snapshot) {
      var index = new Map();
      var groups = snapshot !== null && snapshot !== undefined && Array.isArray(snapshot.groups) ? snapshot.groups : [];
      for (var g = 0; g < groups.length; g += 1) {
        var models = Array.isArray(groups[g].models) ? groups[g].models : [];
        for (var m = 0; m < models.length; m += 1) index.set(JSON.stringify([groups[g].id, models[m].id]), models[m]);
      }
      return index;
    }

    /* ============================================================== *
     * 模型选择器（0.4.0）：官方 ModelSelect 的「两级」结构 + 增强
     *   root   ：「模型」「思维强度」两个 cell（与官方一致）
     *   model  ：搜索框 + 收藏 / 最近使用 / 按供应商分组（家族可折叠）；点模型即切换
     *   effort ：思维强度；从 root 的 cell 或模型行右侧的 › 进入
     * 定位、键盘、焦点、busy 语义逐条对照官方 ModelSelect。
     * ============================================================== */
    var MEASURE_STYLE = { left: 0, top: 0, visibility: "hidden" };
    var MENU_MARGIN = 12;
    var RECENT_VISIBLE = 5;
    var useLayout = typeof React.useLayoutEffect === "function" ? React.useLayoutEffect : React.useEffect;

    function focusNode(node) {
      if (node !== null && node !== undefined && typeof node.focus === "function") node.focus();
    }

    /** 关闭后把焦点还给触发器：官方用 queueMicrotask；沙箱里未必有，Promise 微任务等价。 */
    function focusLater(ref) {
      try {
        Promise.resolve().then(function () { focusNode(ref.current); });
      } catch (error) {
        focusNode(ref.current);
      }
    }

    function stopEvent(event) {
      if (event === null || event === undefined) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      if (typeof event.stopPropagation === "function") event.stopPropagation();
    }

    function caretAtEnd(input) {
      if (input === null || input === undefined) return true;
      var value = typeof input.value === "string" ? input.value : "";
      if (typeof input.selectionStart !== "number") return true;
      return input.selectionStart === value.length && input.selectionEnd === input.selectionStart;
    }

    function containsNode(container, node) {
      return container !== null && container !== undefined && typeof container.contains === "function" && container.contains(node);
    }

    function stateDot() {
      return uiNode("StateDot", { state: "ongoing" }, h("span", { className: "dsmn_stateDot", "aria-hidden": "true" }));
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

      var label = useLabelEntry(props.labels);
      var labelEntry = label.entry;

      var openState = React.useState(false);
      var open = openState[0];
      var setOpen = openState[1];
      var paneState = React.useState("root");
      var pane = paneState[0];
      var setPane = paneState[1];
      var queryState = React.useState("");
      var query = queryState[0];
      var setQuery = queryState[1];
      var highlightState = React.useState(null);
      var highlighted = highlightState[0];
      var setHighlighted = highlightState[1];
      // 思维强度页的目标模型（stableKey）与入口（root 的 cell / 模型行的 ›），决定「返回」回到哪一层
      var effortTargetState = React.useState(null);
      var effortTarget = effortTargetState[0];
      var setEffortTarget = effortTargetState[1];
      var effortFromState = React.useState("root");
      var effortFrom = effortFromState[0];
      var setEffortFrom = effortFromState[1];
      var noticeState = React.useState(null);
      var notice = noticeState[0];
      var setNotice = noticeState[1];
      var positionState = React.useState(null);
      var position = positionState[0];
      var setPosition = positionState[1];
      var selectionFocusState = React.useState(false);
      var selectionFocus = selectionFocusState[0];
      var setSelectionFocus = selectionFocusState[1];
      var pendingState = React.useState(null);
      var pendingSelection = pendingState[0];
      var setPendingSelection = pendingState[1];
      var toastState = React.useState(null);
      var toast = toastState[0];
      var setToast = toastState[1];
      var submittingState = React.useState(false);
      var submitting = submittingState[0];
      var setSubmitting = submittingState[1];

      var rootRef = React.useRef(null);
      var triggerRef = React.useRef(null);
      var searchRef = React.useRef(null);
      var popoverRef = React.useRef(null);
      var groupsRef = React.useRef(null);
      var itemRefs = React.useRef([]);
      var modelRefs = React.useRef([]);
      var checkedAtRef = React.useRef(-1);
      var paneFocus = React.useRef(null);
      var toastSeq = React.useRef(0);
      var selectionRef = React.useRef(null);
      // 宿主 0.2.1 的 select 失败会把整个目录置为 status=error、error="code: message"；
      // 记下本次选择产生的那条，免得面板把「选择失败」再报成「目录加载失败」
      var selectErrorRef = React.useRef(null);
      var mountedRef = React.useRef(true);
      React.useEffect(function () {
        mountedRef.current = true;
        return function () { mountedRef.current = false; selectionRef.current = null; };
      }, []);

      var menuId = (typeof React.useId === "function" ? React.useId() : "dsmn-" + String(sessionId)) + "-menu";
      var baseId = menuId.slice(0, -5);

      var current = snapshot === null || snapshot === undefined || snapshot.current === undefined ? null : snapshot.current;
      var status = snapshot === null || snapshot === undefined || snapshot.status === undefined ? "idle" : snapshot.status;
      var hostPending = snapshot !== null && snapshot !== undefined && snapshot.pending !== null && snapshot.pending !== undefined ? snapshot.pending : null;
      var generation = draftStore.getGeneration();
      React.useEffect(function () {
        selectionRef.current = null;
        setSubmitting(false);
        setPendingSelection(null);
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
      var rawModels = React.useMemo(function () { return rawModelIndex(snapshot); }, [snapshot]);

      var visibleProviders = React.useMemo(
        function () {
          return preferences.grouping === "off" ? catalog.providers : __core.orderProviders(catalog.providers, preferences.providerPins);
        },
        [catalog, preferences.grouping, pinsKey]
      );

      // 宿主 0.2.1 起后台刷新（改设置/凭据/适配器）与刷新失败都会保留上一份 groups，
      // 只把 status 置为 loading / error；官方入口在此期间照常可选。
      var hasGroups = snapshot !== null && snapshot !== undefined && Array.isArray(snapshot.groups) && snapshot.groups.length > 0;
      var catalogReady = status === "ready" || status === "selecting" || (hasGroups && (status === "loading" || status === "error"));
      var refreshing = status === "loading" && hasGroups;
      var failures = snapshot !== null && snapshot !== undefined && Array.isArray(snapshot.failures) ? snapshot.failures : [];
      var catalogError = status === "error" && !(selectErrorRef.current !== null && snapshot.error === selectErrorRef.current);
      // 与官方一致：选择进行中触发器仍可点（aria-busy），只有锁定/不可用才禁用
      var busy = submitting || status === "selecting" || hostPending !== null;
      var pendingNow = hostPending !== null ? hostPending : pendingSelection;

      var lookupDisplay = function (providerId, modelId) {
        if (providerId === undefined || providerId === null || modelId === undefined || modelId === null) return undefined;
        return catalog.modelOf.get(JSON.stringify([providerId, modelId]));
      };
      // 触发器显示「宿主公布的当前选择」：不可寻址时显示当前选择自己的 ID，绝不显示别人的名字。
      var hostCurrent = current;
      var triggerProviderId = hostCurrent !== null ? hostCurrent.provider : undefined;
      var triggerModelId = hostCurrent !== null ? hostCurrent.model : undefined;
      var triggerDisplay = lookupDisplay(triggerProviderId, triggerModelId);
      // 0.2.1 起宿主直接给出 routable；显式 false 时以宿主为准，其余情况沿用本地查表
      var currentAddressable = hostCurrent === null || (snapshot.routable !== false && triggerDisplay !== undefined);
      // 官方 currentChoice：当前选择在目录里且可寻址才算；没有时打开直接进模型页
      var currentChoice = hostCurrent !== null && currentAddressable ? triggerDisplay : undefined;
      var triggerLabel = triggerDisplay !== undefined
        ? __core.modelDisplayName(triggerDisplay, triggerModelId)
        : triggerModelId;
      if (hostCurrent === null) triggerLabel = status === "idle" || status === "loading" ? t("loading") : t("title");
      else if (triggerLabel === undefined || triggerLabel === null || triggerLabel === "") triggerLabel = triggerModelId;

      var currentReasoning = triggerDisplay === undefined ? undefined : triggerDisplay.reasoning;
      var currentChoices = currentChoice === undefined ? [] : __core.effortChoices(currentReasoning, t("providerDefault"));
      // 官方 effectiveEffort：宿主当前档位，缺省时取模型默认档（都没有 = 供应商默认）
      var effectiveEffort = hostCurrent === null ? undefined
        : hostCurrent.reasoningEffort !== undefined ? hostCurrent.reasoningEffort
        : currentReasoning === undefined || currentReasoning === null ? undefined : currentReasoning.defaultEffort;
      var triggerEffortId = hostCurrent !== null ? effectiveEffort : resolved.effortId;
      var currentEffortLabel = snapshot !== null && snapshot !== undefined && typeof snapshot.retainedEffort === "string" ? snapshot.retainedEffort : null;
      if (currentReasoning !== undefined && currentReasoning !== null) {
        var triggerChoices = __core.effortChoices(currentReasoning, t("providerDefault"));
        for (var tc = 0; tc < triggerChoices.length; tc += 1) {
          if (triggerChoices[tc].effort === triggerEffortId) {
            currentEffortLabel = triggerChoices[tc].label;
            break;
          }
        }
      }
      if (currentEffortLabel === null && triggerEffortId !== undefined) currentEffortLabel = triggerEffortId;

      var modelTotal = 0;
      for (var mt = 0; mt < catalog.providers.length; mt += 1) modelTotal += catalog.providers[mt].models.length;
      var showSearch = preferences.showSearch && modelTotal > SEARCH_MIN_MODELS && pane === "model";
      var trimmed = showSearch ? query.trim() : "";
      // 每次悬停/定位都会重渲染；只有目录或查询变化时才重算全局搜索
      var hits = React.useMemo(
        function () { return trimmed.length === 0 ? null : __core.searchModels(visibleProviders, trimmed); },
        [visibleProviders, trimmed]
      );

      var effortModel = effortTarget === null ? undefined : catalog.modelOf.get(effortTarget);
      var effortList = effortModel === undefined ? [] : __core.effortChoices(effortModel.reasoning, t("providerDefault"));

      // 思维强度页的目标模型被移除 / 档位被撤：退回上一层并说明原因；
      // 目录只是暂时在加载（没有 groups）时保留当前页，等模型回来。
      React.useEffect(function () {
        if (!open || pane !== "effort" || !catalogReady) return;
        if (effortModel === undefined || effortList.length === 0) {
          setPane(effortFrom === "model" || currentChoice === undefined ? "model" : "root");
          setEffortTarget(null);
          setNotice(t(effortModel === undefined ? "modelUnavailable" : "effortUnavailable"));
        }
      }, [open, pane, effortTarget, snapshot, catalogReady]);

      // 档位也可能在插件之外改变（/model、其他窗口）：宿主报告的当前档位同样记下，切走再切回时不丢
      var hostEffort = hostCurrent === null ? undefined : hostCurrent.reasoningEffort;
      var hostEffortKey = hostCurrent === null ? null : __core.stableKeyOf({ providerId: hostCurrent.provider, modelId: hostCurrent.model });
      React.useEffect(function () {
        if (hostEffortKey === null || typeof hostEffort !== "string" || hostEffort === "") return;
        if (store.getPreferences().effortByModel[hostEffortKey] === hostEffort) return;
        var entry = {};
        entry[hostEffortKey] = hostEffort;
        store.patch({ effortByModel: entry });
      }, [hostEffortKey, hostEffort]);

      // Re-read the directory at event time: an old rendered button can outlive its model.
      function liveModel(providerId, modelId) {
        if (!mountedRef.current) return undefined;
        var latest;
        try { latest = readDirectory(); }
        catch (error) { setNotice(t("loadFailed") + messageOf(error)); return undefined; }
        if (latest === null || latest === undefined) {
          setNotice(t("loading"));
          return undefined;
        }
        if (latest.status === "selecting") return undefined;
        var groups = Array.isArray(latest.groups) ? latest.groups : [];
        for (var gi = 0; gi < groups.length; gi += 1) {
          if (groups[gi].id !== providerId || !Array.isArray(groups[gi].models)) continue;
          for (var mi = 0; mi < groups[gi].models.length; mi += 1) {
            if (groups[gi].models[mi].id === modelId) return groups[gi].models[mi];
          }
        }
        // 只有在保留的 groups 里也找不到时，才按状态区分「还在加载」与「真的没了」
        if (latest.status === "idle" || latest.status === "loading") {
          setNotice(t("loading"));
          return undefined;
        }
        if (latest.status === "error") return undefined;
        setNotice(t("modelUnavailable"));
        return undefined;
      }

      // 目录首次装载 + 失败后重试
      React.useEffect(
        function () {
          if (!available) return;
          if (status !== "idle") return;
          if (props.load === undefined || props.load === null) return;
          props.load();
        },
        [available, status, sessionId]
      );

      // 打开时刷新一次目录（官方 show() 里的 reload）
      React.useEffect(
        function () {
          if (!open) return;
          if (available && props.load !== undefined && props.load !== null) props.load();
        },
        [open]
      );

      // 浮层定位（与官方一致）：右边缘对齐触发器、出现在上方 8px，四周留 12px 夹紧；
      // 窗口缩放 / 祖先滚动 / 浮层自身尺寸变化时重算。位置没变时保留旧对象，避免无谓重渲染。
      useLayout(
        function () {
          if (!available || !open) {
            setPosition(null);
            return undefined;
          }
          function placeMenu() {
            var trigger = triggerRef.current;
            if (trigger === null || trigger === undefined || typeof trigger.getBoundingClientRect !== "function") return;
            var rect = trigger.getBoundingClientRect();
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
            var width = popover !== null && popover !== undefined && typeof popover.offsetWidth === "number" ? popover.offsetWidth : 0;
            var height = popover !== null && popover !== undefined && typeof popover.offsetHeight === "number" ? popover.offsetHeight : 0;
            var viewportWidth = typeof window.innerWidth === "number" ? window.innerWidth : 0;
            var viewportHeight = typeof window.innerHeight === "number" ? window.innerHeight : 0;
            var x = rect.right - width;
            var y = rect.top - 8 - height;
            if (width > 0 && viewportWidth > 0) x = Math.min(Math.max(x, MENU_MARGIN), viewportWidth - width - MENU_MARGIN);
            if (height > 0 && viewportHeight > 0) y = Math.min(Math.max(y, MENU_MARGIN), viewportHeight - height - MENU_MARGIN);
            setPosition(function (prev) {
              return prev !== null && prev !== undefined && prev.left === x && prev.top === y ? prev : { left: x, top: y };
            });
          }
          placeMenu();
          if (typeof window.addEventListener === "function") {
            window.addEventListener("scroll", placeMenu, true);
            window.addEventListener("resize", placeMenu);
          }
          var observer = null;
          try {
            if (typeof ResizeObserver !== "undefined" && popoverRef.current !== null && popoverRef.current !== undefined) {
              observer = new ResizeObserver(placeMenu);
              observer.observe(popoverRef.current);
            }
          } catch (error) {
            observer = null;
          }
          return function () {
            if (observer !== null) observer.disconnect();
            if (typeof window.removeEventListener === "function") {
              window.removeEventListener("scroll", placeMenu, true);
              window.removeEventListener("resize", placeMenu);
            }
          };
        },
        [available, open, pane, snapshot, query, notice, effortTarget]
      );

      // 外部点击 / 菜单外的 Esc 关闭。菜单内的 Esc 由根节点 onKeyDown 按层级消化
      // （清空搜索 → 返回上一层 → 关闭），这里的捕获监听只处理焦点不在菜单里的情况。
      React.useEffect(
        function () {
          if (!open) return undefined;
          var onPointerDown = function (event) {
            if (containsNode(rootRef.current, event.target) || containsNode(popoverRef.current, event.target)) return;
            setOpen(false);
            setPane("root");
          };
          var onKeyDown = function (event) {
            if (event.key !== "Escape") return;
            if (containsNode(rootRef.current, event.target) || containsNode(popoverRef.current, event.target)) return;
            setOpen(false);
            setPane("root");
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

      // 打开 / 换页后的焦点（对照官方）：下钻进模型页聚焦搜索框，否则聚焦已勾选的行；
      // 返回根层时聚焦来时的 cell。首次打开时浮层在定位前是 visibility:hidden，
      // focus() 会被忽略，所以要等 placed。
      var placed = position !== null;
      React.useEffect(
        function () {
          if (!open || !placed) return;
          var intent = paneFocus.current;
          if (intent === null) return;
          paneFocus.current = null;
          if (intent === "drill") {
            if (pane === "model" && showSearch && searchRef.current !== null && searchRef.current !== undefined) {
              focusNode(searchRef.current);
              return;
            }
            var checked = checkedAtRef.current >= 0 ? itemRefs.current[checkedAtRef.current] : null;
            if (checked !== null && checked !== undefined && checked.disabled !== true) { focusNode(checked); return; }
            for (var fi = 0; fi < itemRefs.current.length; fi += 1) {
              var item = itemRefs.current[fi];
              if (item !== null && item !== undefined && item.disabled !== true) { focusNode(item); return; }
            }
            focusNode(triggerRef.current);
            return;
          }
          var cell = itemRefs.current[intent === "effort" ? 1 : 0];
          focusNode(cell !== null && cell !== undefined && cell.disabled !== true ? cell : triggerRef.current);
        },
        [open, pane, placed, showSearch]
      );

      if (preferences.enabled === false) return null;

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

      /* ---------------- 动作 ---------------- */

      function close(restoreFocus) {
        setOpen(false);
        setPane("root");
        setQuery("");
        setHighlighted(null);
        setEffortTarget(null);
        if (restoreFocus) focusLater(triggerRef);
      }
      function closeAfterSelection() {
        setSelectionFocus(true);
        close(true);
      }
      function show() {
        setSelectionFocus(false);
        setQuery("");
        setHighlighted(null);
        setNotice(null);
        setEffortTarget(null);
        paneFocus.current = currentChoice === undefined ? "drill" : "root";
        setPane(currentChoice === undefined ? "model" : "root");
        setOpen(true);
      }
      function drill(next) {
        setQuery("");
        setHighlighted(null);
        paneFocus.current = "drill";
        setPane(next);
      }
      function openEffort(model, from) {
        setEffortTarget(model.stableKey === undefined ? __core.stableKeyOf(model.ref) : model.stableKey);
        setEffortFrom(from);
        drill("effort");
      }
      function canBack() {
        if (pane === "effort") return effortFrom === "model" || currentChoice !== undefined;
        return pane === "model" && currentChoice !== undefined;
      }
      function back() {
        if (pane === "effort" && (effortFrom === "model" || currentChoice === undefined)) {
          setEffortTarget(null);
          drill("model");
          return;
        }
        paneFocus.current = pane === "effort" ? "effort" : "root";
        setQuery("");
        setHighlighted(null);
        setEffortTarget(null);
        setPane("root");
      }
      function changeQuery(next) {
        setQuery(next);
        // 有查询时第一条命中即高亮（Enter 即选）；清空查询后回到当前模型
        setHighlighted(next === "" ? null : 0);
      }
      function showToast(text) {
        if (uiComponent("Toast") === null) return;
        toastSeq.current += 1;
        setToast({ seq: toastSeq.current, text: text });
      }

      function commit(providerId, modelId, effortId) {
        if (!available || locked || status === "selecting" || hostPending !== null || selectionRef.current !== null) return;
        if (props.select === undefined || props.select === null) return;
        var selection;
        try { selection = __core.buildSelection(providerId, modelId, effortId); }
        catch (error) { setNotice(messageOf(error)); return; }
        var latestModel = liveModel(providerId, modelId);
        if (latestModel === undefined) return;
        if (selection.reasoningEffort !== undefined) {
          var latestEfforts = __core.effortChoices(latestModel.reasoning, t("providerDefault"));
          if (!latestEfforts.some(function (choice) { return choice.effort === selection.reasoningEffort; })) {
            setNotice(t("effortUnavailable"));
            return;
          }
        }
        var operation = { sessionId: sessionId, generation: draftStore.getGeneration() };
        selectionRef.current = operation;
        selectErrorRef.current = null;
        setSubmitting(true);
        setPendingSelection(selection);
        setNotice(null);
        var active = function () {
          return mountedRef.current && selectionRef.current === operation
            && operation.generation === draftStore.getGeneration();
        };
        var settle = function (outcome, error) {
          if (!active()) return;
          selectionRef.current = null;
          setSubmitting(false);
          setPendingSelection(null);
          if (error !== undefined || outcome === false || (outcome !== null && outcome !== undefined && outcome.ok === false)) {
            var failure = error !== undefined ? error : outcome === false ? t("unavailable") : outcome.error;
            var code = failure !== null && failure !== undefined ? failure.code : undefined;
            if (typeof code === "string") selectErrorRef.current = code + ": " + messageOf(failure);
            var text = code === "session/writer-held" || messageOf(failure).indexOf("session/writer-held") >= 0
              ? t("sessionInUse") : t("selectFailed") + messageOf(failure);
            setNotice(text);
            showToast(text);
            return;
          }
          if (liveModel(providerId, modelId) === undefined) return;
          draftStore.commit(sessionId, selection);
          store.rememberSelection(selection);
          closeAfterSelection();
        };
        try {
          var result = props.select(selection);
          if (result !== null && result !== undefined && typeof result.then === "function") {
            result.then(function (value) { settle(value); }, function (error) { settle(undefined, error); });
          } else settle(result);
        } catch (error) { settle(undefined, error); }
      }

      /**
       * 点模型行：有多种档位可选时先进思维强度页（预选上次的档位），确认后才提交；
       * 没有档位或只有一种选择时不必确认：已是当前模型就只关闭，否则直接切换。
       */
      function chooseModel(model) {
        if (__core.effortChoices(model.reasoning, t("providerDefault")).length > 1) {
          if (!rowsDisabled) openEffort(model, "model");
          return;
        }
        if (current !== null && current.provider === model.ref.providerId && current.model === model.ref.modelId) {
          closeAfterSelection();
          return;
        }
        commit(model.ref.providerId, model.ref.modelId, undefined);
      }
      function chooseEffort(model, choice) {
        var isCurrent = current !== null && current.provider === model.ref.providerId && current.model === model.ref.modelId;
        if (isCurrent && effectiveEffort === choice.effort) {
          closeAfterSelection();
          return;
        }
        commit(model.ref.providerId, model.ref.modelId, choice.effort);
      }
      function toggleFavorite(key) {
        var latest = store.getPreferences().favorites;
        var next = latest.filter(function (entry) { return entry !== key; });
        if (latest.indexOf(key) === -1) next.push(key);
        store.patch({ favorites: next });
      }
      function hasEfforts(model) {
        return model !== undefined && model !== null && __core.effortChoices(model.reasoning, t("providerDefault")).length > 0;
      }
      function reload() {
        if (props.load !== undefined && props.load !== null) props.load();
      }

      /* ---------------- 渲染辅助 ---------------- */

      function providerFace(providerId) {
        var provider = catalog.providerOf.get(providerId);
        return { id: providerId, name: provider === undefined ? String(providerId) : providerLabelOf(provider, t) };
      }

      /** 与官方 renderModelLabel 同形：<span data-provider-id data-model-id>{标签槽位 | 模型名}</span>。 */
      function renderLabel(display, placement, selected) {
        var name = __core.modelDisplayName(display, display.ref.modelId);
        var content = name;
        if (labelEntry !== null) {
          var raw = rawModels.get(display.stableKey);
          var model = {};
          if (raw !== undefined && raw !== null) {
            var rawKeys = Object.keys(raw);
            for (var rk = 0; rk < rawKeys.length; rk += 1) model[rawKeys[rk]] = raw[rawKeys[rk]];
          }
          model.id = display.ref.modelId;
          // 官方契约传宿主原始 model（name 即宿主名），标签插件按它判断；宿主只给 modelName 等字段时补上显示名
          if (typeof model.name !== "string" || model.name.length === 0) model.name = display.originalName;
          var labelProps = {};
          var face = labelFaceOf(labelEntry, sessionId);
          if (face !== null) {
            var faceKeys = Object.keys(face);
            for (var fk = 0; fk < faceKeys.length; fk += 1) labelProps[faceKeys[fk]] = face[faceKeys[fk]];
          }
          labelProps.provider = providerFace(display.ref.providerId);
          labelProps.model = model;
          labelProps.placement = placement;
          labelProps.selected = selected;
          labelProps.sessionId = sessionId;
          labelProps.t = props.labels !== null && props.labels !== undefined && typeof props.labels.bind === "function"
            ? props.labels.bind(labelEntry.locale) : IDENTITY_T;
          DIAG.label.renders += 1;
          var node = h(labelEntry.component, labelProps);
          content = LabelBoundary === null ? node
            : h(LabelBoundary, { key: "label-" + String(label.version) + "-" + String(sessionId), fallback: name }, node);
        }
        return h("span", { className: "dsmn_label", "data-provider-id": display.ref.providerId, "data-model-id": display.ref.modelId }, content);
      }

      itemRefs.current = [];
      modelRefs.current = [];
      checkedAtRef.current = -1;
      var itemIndex = 0;
      var itemRef = function (selected) {
        var at = itemIndex;
        itemIndex += 1;
        if (selected === true && checkedAtRef.current === -1) checkedAtRef.current = at;
        return function (node) { itemRefs.current[at] = node; };
      };
      var visibleModels = [];
      var currentVisibleIndex = -1;
      // 模型页的行要先登记，才能算出高亮下标；这里先按渲染顺序收集，再统一生成元素
      function registerModel(model) {
        var index = visibleModels.length;
        visibleModels.push(model);
        if (currentVisibleIndex === -1 && current !== null && current.provider === model.ref.providerId && current.model === model.ref.modelId) currentVisibleIndex = index;
        return index;
      }

      var rowsDisabled = locked || busy || !catalogReady;

      function modelRow(entry, activeIndex) {
        var model = entry.model;
        var key = model.stableKey;
        var index = entry.index;
        var selected = current !== null && current.provider === model.ref.providerId && current.model === model.ref.modelId;
        var pendingHere = pendingNow !== null && pendingNow.provider === model.ref.providerId && pendingNow.model === model.ref.modelId;
        var name = __core.modelDisplayName(model, model.ref.modelId);
        var provider = providerFace(model.ref.providerId);
        // 显示名与 ID 只差大小写时不重复一行（完整 ID 仍在 title 里，也仍可搜索）
        var idNote = name.toLowerCase() === model.ref.modelId.toLowerCase() ? "" : model.ref.modelId;
        var detail = entry.withProvider ? provider.name + (idNote === "" ? "" : " · " + idNote) : idNote;
        var favorite = preferences.favorites.indexOf(key) !== -1;
        var efforts = hasEfforts(model);
        var active = index === activeIndex;
        var registerRef = itemRef(selected);
        return h("div", {
          key: entry.section + "-" + key, className: "dsmn_modelRow",
          "data-indent": entry.indent > 0 ? String(entry.indent) : undefined,
          "data-current": selected ? "true" : undefined,
          "data-active": active ? "true" : undefined
        },
          h("button", {
            ref: function (node) { registerRef(node); modelRefs.current[index] = node; },
            type: "button",
            role: "menuitemradio",
            "aria-checked": selected ? "true" : "false",
            id: baseId + "-model-" + index,
            tabIndex: showSearch ? -1 : 0,
            "data-depth": "3",
            "data-highlighted": active ? "" : undefined,
            className: "dsmn_option dsmn_modelOption" + (selected ? " dsmn_selected" : "") + (active ? " dsmn_optionActive" : ""),
            title: modelRowTitle(name, model.ref.modelId),
            disabled: rowsDisabled,
            onFocus: function () { setHighlighted(index); },
            onMouseMove: busy || active ? undefined : function () {
              if (showSearch) setHighlighted(index);
              else focusNode(modelRefs.current[index]);
            },
            onClick: function () { chooseModel(model); }
          },
            h("span", { className: "dsmn_optionCopy" },
              h("span", { className: "dsmn_modelName" }, renderLabel(model, "option", selected)),
              detail === "" ? null : h("span", { className: "dsmn_modelMeta" }, detail)),
            h("span", { className: "dsmn_check" }, pendingHere ? stateDot() : selected ? uiNode("IconCheckOutlineRegular", {}, "✓") : null)
          ),
          // 收藏与思维强度按钮不进 Tab / 方向键序列（与官方行一样只在模型之间移动），→ 键可打开思维强度
          h("button", {
            type: "button", className: "dsmn_pin", tabIndex: -1,
            "data-action": "favorite-model", "data-model-id": model.ref.modelId,
            "aria-label": t(favorite ? "favoriteRemove" : "favoriteAdd") + " · " + name,
            "aria-pressed": favorite ? "true" : "false",
            title: t(favorite ? "favoriteRemove" : "favoriteAdd"),
            onClick: function () { toggleFavorite(key); }
          }, favorite ? "★" : "☆"),
          efforts ? h("button", {
            type: "button", className: "dsmn_effortOpen", tabIndex: -1,
            "data-action": "open-effort", "data-model-id": model.ref.modelId,
            "aria-label": t("effortOpen") + " · " + name,
            title: t("effortOpen"),
            disabled: rowsDisabled,
            onClick: function () { openEffort(model, "model"); }
          }, uiNode("IconChevronRightOutlineRegular", { className: "dsmn_cellChevron" }, h("span", { className: "dsmn_cellChevron" }, "›"))) : null
        );
      }

      /** 收藏 / 最近里已不在目录中的条目：置灰、不可选，但能单独移除。 */
      function missingRow(section, key, indent) {
        var identity = null;
        try {
          var parsed = JSON.parse(key);
          if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === "string" && typeof parsed[1] === "string") identity = parsed;
        } catch (ignored) { /* Older or malformed preference keys must still be removable. */ }
        var name = identity === null ? key : identity[1];
        var providerName = identity === null ? "" : providerFace(identity[0]).name;
        // 「不可用」抽屉的标题已说明状态，行里只留供应商；目录未就绪的条目还在原分组，要说明正在加载
        var detail = catalogReady ? providerName : (providerName === "" ? "" : providerName + " · ") + t("loading");
        var isFavorite = section === "favorites";
        return h("div", { key: section + "-" + key, className: "dsmn_modelRow dsmn_missingModel", "data-unavailable-model": key, "data-indent": indent > 0 ? String(indent) : undefined },
          h("button", { type: "button", role: "menuitemradio", "aria-checked": "false", disabled: true, tabIndex: -1, className: "dsmn_option", title: name },
            h("span", { className: "dsmn_optionCopy" }, h("span", { className: "dsmn_modelName" }, name),
              detail === "" ? null : h("span", { className: "dsmn_modelMeta" }, detail))),
          h("button", {
            type: "button", className: "dsmn_pin dsmn_pinVisible",
            "data-action": isFavorite ? "favorite-model" : "remove-recent",
            "data-model-id": identity === null ? undefined : identity[1],
            "aria-label": t(isFavorite ? "favoriteRemove" : "recentRemove") + " · " + name,
            title: t(isFavorite ? "favoriteRemove" : "recentRemove"),
            onClick: function () {
              var latest = store.getPreferences();
              if (isFavorite) {
                store.patch({ favorites: latest.favorites.filter(function (entry) { return entry !== key; }) });
                return;
              }
              var removal = { recentModels: latest.recentModels.filter(function (entry) { return entry !== key; }) };
              // 旧字段也同步清掉（降级回旧版时不会把刚删的条目迁回来）；只清与本条完全一致的那一项
              if (identity !== null && latest.lastModelByProvider[identity[0]] === identity[1]) {
                removal.lastModelByProvider = {};
                removal.lastModelByProvider[identity[0]] = null;
                removal.lastProviderId = latest.lastProviderId === identity[0] ? null : latest.lastProviderId;
              }
              store.patch(removal);
            }
          }, isFavorite ? "★" : "×")
        );
      }

      /**
       * 分区（收藏、最近、搜索结果）的标题由本插件渲染，不用官方 MenuGroup：
       * 它的吸顶标题在半透明菜单上会和滚过的行重叠，样式也无法并入树形层级。
       */
      function menuGroup(key, title, children, extra) {
        var attrs = { key: key, className: "dsmn_section" };
        if (extra !== undefined) {
          var extraKeys = Object.keys(extra);
          for (var ek = 0; ek < extraKeys.length; ek += 1) attrs[extraKeys[ek]] = extra[extraKeys[ek]];
        }
        return h("div", attrs,
          h("div", { className: "dsmn_menuGroup", role: "group", "aria-label": title },
            h("div", { className: "dsmn_menuGroupLabel", "aria-hidden": "true" }, title),
            children));
      }

      /* ---------------- 模型页的条目规划（先登记顺序，再生成元素） ---------------- */

      var plan = [];
      if (pane === "model") {
        if (hits !== null) {
          var hitGroups = [];
          var hitGroupOf = new Map();
          for (var hi = 0; hi < hits.length; hi += 1) {
            var hitModel = catalog.modelOf.get(JSON.stringify([hits[hi].ref.providerId, hits[hi].ref.modelId]));
            if (hitModel === undefined) continue;
            var bucket = hitGroupOf.get(hitModel.ref.providerId);
            if (bucket === undefined) {
              bucket = { providerId: hitModel.ref.providerId, entries: [] };
              hitGroupOf.set(hitModel.ref.providerId, bucket);
              hitGroups.push(bucket);
            }
            bucket.entries.push({ section: "hit", model: hitModel, withProvider: false, index: registerModel(hitModel) });
          }
          for (var hg = 0; hg < hitGroups.length; hg += 1) {
            plan.push({ kind: "group", key: "hit-" + hitGroups[hg].providerId, title: providerFace(hitGroups[hg].providerId).name,
              extra: { "data-section": "search", "data-provider-id": hitGroups[hg].providerId }, entries: hitGroups[hg].entries });
          }
        } else {
          var favoriteEntries = [];
          var favoriteSeen = new Set();
          // 目录就绪后仍找不到的收藏/最近条目集中到底部默认折叠的「不可用」分组；加载中保持原位（显示「加载中」）
          var unavailableEntries = [];
          for (var fv = 0; fv < preferences.favorites.length; fv += 1) {
            var favoriteKey = preferences.favorites[fv];
            if (favoriteSeen.has(favoriteKey)) continue;
            favoriteSeen.add(favoriteKey);
            var favoriteModel = catalog.modelOf.get(favoriteKey);
            if (favoriteModel === undefined) (catalogReady ? unavailableEntries : favoriteEntries).push({ section: "favorites", missing: favoriteKey });
            else favoriteEntries.push({ section: "favorites", model: favoriteModel, withProvider: true, index: registerModel(favoriteModel) });
          }
          if (favoriteEntries.length > 0) plan.push({ kind: "group", key: "favorites", title: t("favorites"), extra: { "data-section": "favorites" }, entries: favoriteEntries });

          var recentEntries = [];
          for (var rc = 0; rc < preferences.recentModels.length && recentEntries.length < RECENT_VISIBLE; rc += 1) {
            var recentKey = preferences.recentModels[rc];
            if (favoriteSeen.has(recentKey)) continue;
            favoriteSeen.add(recentKey);
            var recentModel = catalog.modelOf.get(recentKey);
            if (recentModel === undefined && catalogReady) {
              // 失效记录不占「最近使用」的 5 个名额
              unavailableEntries.push({ section: "recent", missing: recentKey });
              continue;
            }
            recentEntries.push(recentModel === undefined
              ? { section: "recent", missing: recentKey }
              : { section: "recent", model: recentModel, withProvider: true, index: registerModel(recentModel) });
          }
          if (recentEntries.length > 0) plan.push({ kind: "group", key: "recent", title: t("recent"), extra: { "data-section": "recent" }, entries: recentEntries });

          var collapseMap = preferences.collapsedFamilies === undefined || preferences.collapsedFamilies === null ? {} : preferences.collapsedFamilies;
          var providerCollapseMap = preferences.collapsedProviders === undefined || preferences.collapsedProviders === null ? {} : preferences.collapsedProviders;
          // 只有一个供应商时没有可折叠的意义，直接展开
          var flatProviders = visibleProviders.length <= 1;
          for (var vp = 0; vp < visibleProviders.length; vp += 1) {
            var provider = visibleProviders[vp];
            if (provider.models.length === 0) continue;
            // 供应商折叠：默认只展开当前选择所在的供应商，其余只显示名称与模型数；显式状态写进偏好 collapsedProviders
            var providerHoldsCurrent = current !== null && current.provider === provider.id;
            var providerIsCollapsed = !flatProviders
              && __core.providerCollapsed(providerCollapseMap, provider.id, providerHoldsCurrent);
            var providerGroup = { kind: "group", key: "provider-" + provider.id, title: providerLabelOf(provider, t),
              extra: { "data-section": "provider", "data-provider-id": provider.id }, entries: [],
              toggle: flatProviders ? null : { providerId: provider.id, collapsed: providerIsCollapsed, count: provider.models.length, current: providerHoldsCurrent } };
            plan.push(providerGroup);
            // 折叠的供应商不构造家族与模型行
            if (providerIsCollapsed) continue;
            var providerEntries = providerGroup.entries;
            var buckets = [];
            // Host-order mode is deliberately flat: regrouping interleaved families
            // would either reorder models or hide them behind another family's toggle.
            if (preferences.grouping === "off") buckets = [{ key: "host-order", label: "", models: provider.models }];
            else {
              var familyList = __core.familyRows(provider.models, { mode: preferences.grouping });
              for (var fl = 0; fl < familyList.length; fl += 1) {
                var familyRow = familyList[fl];
                if (familyRow.kind === "family") buckets.push({ key: familyRow.familyId, label: familyLabelOf(familyRow, t), models: [] });
                else buckets[buckets.length - 1].models.push(familyRow.model);
              }
            }
            var flatFamilies = buckets.length <= 1;
            // 树的深度：行前面实际有几级可折叠的标题，决定缩进和缩进线的条数
            var familyIndent = flatProviders ? 0 : 1;
            var modelIndent = familyIndent + (flatFamilies ? 0 : 1);
            // 家族折叠：默认折叠，只默认展开当前选择所在的那一族；显式状态写进偏好 collapsedFamilies
            var currentFamilyKey = null;
            if (current !== null && current.provider === provider.id) {
              for (var cf = 0; cf < buckets.length; cf += 1) {
                for (var cm = 0; cm < buckets[cf].models.length; cm += 1) {
                  if (buckets[cf].models[cm].ref.modelId === current.model) currentFamilyKey = __core.familyCollapseKey(provider.id, buckets[cf].key);
                }
              }
            }
            if (providerGroup.toggle !== null && !flatFamilies) providerGroup.toggle.currentFamilyKey = currentFamilyKey;
            for (var bk = 0; bk < buckets.length; bk += 1) {
              var familyBucket = buckets[bk];
              var collapseKey = __core.familyCollapseKey(provider.id, familyBucket.key);
              var isCollapsed = !flatFamilies && __core.familyCollapsed(collapseMap, collapseKey, collapseKey === currentFamilyKey);
              if (!flatFamilies) providerEntries.push({ section: "family", collapseKey: collapseKey, collapsed: isCollapsed, label: familyBucket.label, count: familyBucket.models.length, indent: familyIndent, current: collapseKey === currentFamilyKey });
              // 折叠的家族不构造模型行（大目录下每次重渲染都会省掉成百上千个元素）
              if (!isCollapsed) {
                for (var bm = 0; bm < familyBucket.models.length; bm += 1) {
                  providerEntries.push({ section: "p-" + provider.id, model: familyBucket.models[bm], withProvider: false, indent: modelIndent, index: registerModel(familyBucket.models[bm]) });
                }
              }
            }
          }

          for (var fi = 0; fi < failures.length; fi += 1) unavailableEntries.push({ section: "failure", failure: failures[fi], at: fi });
          if (unavailableEntries.length > 0) {
            var hideUnavailable = preferences.showUnavailable !== true;
            plan.push({ kind: "group", key: "unavailable", title: t("unavailableGroup"), extra: { "data-section": "unavailable" },
              entries: hideUnavailable ? [] : unavailableEntries,
              toggle: { kind: "unavailable", collapsed: hideUnavailable, count: unavailableEntries.length, hasFailure: failures.length > 0 } });
          }
        }
      }
      // 官方 activeModelIndex：未手动高亮时落在当前模型上，越界时夹到末尾
      var activeIndex = visibleModels.length === 0 ? -1
        : Math.min(highlighted === null ? Math.max(0, currentVisibleIndex) : highlighted, visibleModels.length - 1);

      /** 折叠箭头始终是同一个节点，展开时由样式旋转，折叠动作才有过渡。 */
      function foldChevron() {
        return uiNode("IconChevronRightOutlineRegular", { className: "dsmn_groupChevron" }, h("span", { className: "dsmn_groupChevron" }, "›"));
      }

      /** 当前模型被折叠起来时，蓝点标出它在哪一组里；展开后由模型行自己的蓝色竖条表达。 */
      function currentMark(holdsCurrent, collapsed) {
        return holdsCurrent && collapsed ? h("span", { className: "dsmn_currentMark", "aria-hidden": "true" }) : null;
      }

      /** 可折叠的供应商分组：标题本身就是折叠按钮。 */
      function providerGroupNode(group, children) {
        var toggle = group.toggle;
        var attrs = { key: group.key, className: "dsmn_section" };
        var extraKeys = Object.keys(group.extra);
        for (var ek = 0; ek < extraKeys.length; ek += 1) attrs[extraKeys[ek]] = group.extra[extraKeys[ek]];
        attrs["data-collapsed"] = toggle.collapsed ? "true" : "false";
        var isUnavailable = toggle.kind === "unavailable";
        return h("div", attrs,
          h("div", { className: "dsmn_menuGroup", role: "group", "aria-label": group.title },
            h("button", {
              type: "button",
              tabIndex: -1,
              className: "dsmn_menuGroupLabel dsmn_providerToggle",
              "data-depth": "1",
              "data-provider-id": isUnavailable ? undefined : toggle.providerId,
              "data-action": isUnavailable ? "toggle-unavailable" : undefined,
              "data-has-failure": toggle.hasFailure === true ? "true" : undefined,
              "aria-current": toggle.current === true ? "true" : undefined,
              "aria-expanded": toggle.collapsed ? "false" : "true",
              title: group.title,
              onClick: function () {
                if (isUnavailable) {
                  store.patch({ showUnavailable: toggle.collapsed });
                  return;
                }
                var patch = {};
                patch[toggle.providerId] = !toggle.collapsed;
                store.patch({
                  collapsedProviders: patch,
                  // 收起时连带收回家族，重新展开只看到家族标题
                  collapsedFamilies: toggle.collapsed ? undefined
                    : __core.foldProviderFamilies(store.getPreferences().collapsedFamilies, toggle.providerId, toggle.currentFamilyKey)
                });
              }
            },
              foldChevron(),
              h("span", { className: "dsmn_groupLabelText" }, group.title),
              currentMark(toggle.current === true, toggle.collapsed),
              h("span", { className: "dsmn_groupCount" }, String(toggle.count))
            ),
            children));
      }

      function familyToggle(entry) {
        return h("button", {
          key: "g-" + entry.collapseKey,
          type: "button",
          tabIndex: -1,
          className: "dsmn_groupToggle",
          "data-depth": "2",
          "data-indent": entry.indent > 0 ? String(entry.indent) : undefined,
          "aria-current": entry.current ? "true" : undefined,
          "aria-expanded": entry.collapsed ? "false" : "true",
          onClick: function () {
            var latest = store.getPreferences().collapsedFamilies;
            var next = {};
            var keys = latest === undefined || latest === null ? [] : Object.keys(latest);
            for (var ki = 0; ki < keys.length; ki += 1) next[keys[ki]] = latest[keys[ki]];
            next[entry.collapseKey] = !entry.collapsed;
            store.patch({ collapsedFamilies: next });
          }
        },
          foldChevron(),
          h("span", { className: "dsmn_groupLabelText" }, entry.label),
          currentMark(entry.current, entry.collapsed),
          h("span", { className: "dsmn_groupCount" }, String(entry.count))
        );
      }

      /* ---------------- 各页内容 ---------------- */

      var body = [];
      var effortValue = currentEffortLabel === null ? "" : currentEffortLabel;
      if (pane === "root") {
        body.push(h("button", {
          key: "cell-model", ref: itemRef(false), type: "button", role: "menuitem", className: "dsmn_cell", "data-cell": "model",
          onClick: function () { drill("model"); }
        },
          h("span", { className: "dsmn_cellLabel" }, t("menuModel")),
          h("span", { className: "dsmn_cellValue" }, currentChoice === undefined ? triggerLabel : renderLabel(currentChoice, "menu", true)),
          uiNode("IconChevronRightOutlineRegular", { className: "dsmn_cellChevron" }, h("span", { className: "dsmn_cellChevron" }, "›"))
        ));
        if (currentChoice !== undefined && currentChoices.length > 0) {
          body.push(h("button", {
            key: "cell-effort", ref: itemRef(false), type: "button", role: "menuitem", className: "dsmn_cell", "data-cell": "effort",
            onClick: function () { openEffort(currentChoice, "root"); }
          },
            h("span", { className: "dsmn_cellLabel" }, t("effortsTitle")),
            h("span", { className: "dsmn_cellValue" }, effortValue),
            uiNode("IconChevronRightOutlineRegular", { className: "dsmn_cellChevron" }, h("span", { className: "dsmn_cellChevron" }, "›"))
          ));
        }
      } else if (pane === "model") {
        if (showSearch) {
          body.push(h("div", { key: "search", className: "dsmn_searchRow" },
            h("input", {
              ref: searchRef,
              className: "dsmn_search" + (query !== "" ? " dsmn_searchWithQuery" : ""),
              type: "text",
              role: "searchbox",
              value: query,
              placeholder: t("searchPlaceholder"),
              "aria-label": t("searchPlaceholder"),
              "aria-controls": baseId + "-models",
              "aria-activedescendant": activeIndex < 0 ? undefined : baseId + "-model-" + activeIndex,
              readOnly: busy,
              onChange: function (event) { changeQuery(event.target.value); }
            }),
            query !== ""
              ? h("button", { key: "clear", type: "button", className: "dsmn_searchClear", "aria-label": t("searchClear"), title: t("searchClear"), disabled: busy,
                  onClick: function () { changeQuery(""); focusNode(searchRef.current); } }, uiNode("IconCloseFillRegular", {}, "✕"))
              : null
          ));
        }
        function failureRow(failure, index) {
          var failedName = failure === null || failure === undefined ? "" : failure.id === "deepseek-account" ? t("providerAccount")
            : typeof failure.name === "string" && failure.name.length > 0 ? failure.name : String(failure.id);
          return h("div", { key: "failure-" + (failure === null || failure === undefined ? index : failure.id), className: "dsmn_warning", role: "status",
            "data-failed-provider": failure === null || failure === undefined ? undefined : failure.id },
            h("span", {}, failedName + t("groupLoadFailed") + messageOf(failure === null || failure === undefined ? undefined : failure.message)),
            h("button", { type: "button", "data-action": "retry-provider", className: "dsmn_retry", disabled: busy, onClick: reload }, t("retry")));
        }
        var groupNodes = plan.map(function (group) {
          var children = group.entries.map(function (entry) {
            if (entry.section === "family") return familyToggle(entry);
            if (entry.section === "failure") return failureRow(entry.failure, entry.at);
            if (entry.missing !== undefined) return missingRow(entry.section, entry.missing, group.key === "unavailable" ? 1 : 0);
            return modelRow(entry, activeIndex);
          });
          return group.toggle !== undefined && group.toggle !== null ? providerGroupNode(group, children) : menuGroup(group.key, group.title, children, group.extra);
        });
        body.push(h("div", {
          key: "groups", ref: groupsRef, id: baseId + "-models", className: "dsmn_groups scrollable", role: "menu",
          "aria-label": t("menuModel"), hidden: groupNodes.length === 0 ? true : undefined
        }, groupNodes));
        // 「不可用」分组不算可选内容：只剩它时照常显示空目录与刷新
        var modelGroupCount = plan.filter(function (group) { return group.key !== "unavailable"; }).length;
        if (modelGroupCount === 0 || (hits !== null && hits.length === 0)) {
          var emptyKey = !catalogReady ? "loading" : hits !== null ? "searchEmpty" : "emptyCatalog";
          body.push(h("div", { key: "empty", className: "dsmn_empty", role: "status" },
            t(emptyKey),
            catalogReady && hits === null ? h("button", { type: "button", "data-action": "refresh-catalog", className: "dsmn_retry", onClick: reload }, t("refresh")) : null));
        }
      } else {
        var effortName = effortModel === undefined ? t("effortsTitle") : __core.modelDisplayName(effortModel, effortModel.ref.modelId);
        body.push(h("button", {
          key: "back-effort", ref: itemRef(false), type: "button", role: "menuitem", className: "dsmn_cell dsmn_cellBack",
          "aria-label": t("back") + " · " + effortName,
          onClick: back
        },
          uiNode("IconChevronLeftOutlineRegular", { className: "dsmn_cellChevron" }, h("span", { className: "dsmn_cellChevron" }, "‹")),
          h("span", { className: "dsmn_cellLabel" }, effortName),
          h("span", { className: "dsmn_cellValue" }, t("effortsTitle"))
        ));
        var effortIsCurrent = effortModel !== undefined && current !== null && current.provider === effortModel.ref.providerId && current.model === effortModel.ref.modelId;
        var effortChecked = effortIsCurrent ? effectiveEffort
          : effortModel === undefined ? undefined : __core.preferredEffort(effortModel.reasoning, preferences.effortByModel[effortTarget]);
        if (effortList.length === 0) {
          body.push(h("div", { key: "no-efforts", className: "dsmn_empty" }, t(catalogReady ? "noEfforts" : "loading")));
        } else {
          effortList.forEach(function (choice) {
            var selected = effortChecked === choice.effort;
            var pendingHere = pendingNow !== null && pendingNow.provider === effortModel.ref.providerId && pendingNow.model === effortModel.ref.modelId
              && pendingNow.reasoningEffort === choice.effort;
            body.push(h("button", {
              key: "e-" + choice.key, ref: itemRef(selected), type: "button", role: "menuitemradio", "aria-checked": selected ? "true" : "false",
              "data-depth": "4",
              className: "dsmn_option" + (selected ? " dsmn_selected" : ""),
              title: choice.label,
              disabled: rowsDisabled,
              onClick: function () { chooseEffort(effortModel, choice); }
            },
              h("span", { className: "dsmn_optionCopy" }, h("span", { className: "dsmn_modelName" }, choice.label)),
              h("span", { className: "dsmn_check" }, pendingHere ? stateDot() : selected ? uiNode("IconCheckOutlineRegular", {}, "✓") : null)
            ));
          });
        }
      }

      /* ---------------- 键盘（对照官方 onRootKeyDown） ---------------- */

      function liveItems() {
        var list = [];
        for (var li = 0; li < itemRefs.current.length; li += 1) {
          var node = itemRefs.current[li];
          if (node !== null && node !== undefined && node.disabled !== true) list.push(node);
        }
        return list;
      }

      function onRootKeyDown(event) {
        if (event === null || event === undefined) return;
        var nativeEvent = event.nativeEvent;
        if (event.isComposing === true || (nativeEvent !== null && nativeEvent !== undefined && nativeEvent.isComposing === true)) return;
        if (!open) return;
        var key = event.key;
        var target = event.target;
        var search = searchRef.current;
        var inSearch = search !== null && search !== undefined && target === search;
        if (key === "Escape") {
          // Esc 层级：清空搜索 → 返回上一层 → 关闭并把焦点还给触发器
          stopEvent(event);
          if (pane === "model" && query !== "") changeQuery("");
          else if (canBack()) back();
          else close(true);
          return;
        }
        if (pane === "model" && showSearch && (key === "ArrowDown" || key === "ArrowUp")) {
          if (typeof event.preventDefault === "function") event.preventDefault();
          if (!busy && visibleModels.length > 0) {
            setHighlighted((activeIndex + (key === "ArrowDown" ? 1 : -1) + visibleModels.length) % visibleModels.length);
            focusNode(search);
          }
          return;
        }
        if (pane === "model" && showSearch && inSearch && (key === "Enter" || (key === "Tab" && !event.shiftKey))) {
          if (key === "Tab" && visibleModels.length === 0) return;
          if (typeof event.preventDefault === "function") event.preventDefault();
          var highlightedModel = visibleModels[activeIndex];
          if (!busy && highlightedModel !== undefined) chooseModel(highlightedModel);
          return;
        }
        if (key === "ArrowRight") {
          if (inSearch && !caretAtEnd(target)) return;
          if (pane === "model") {
            var at = modelRefs.current.indexOf(target);
            var model = inSearch ? visibleModels[activeIndex] : at >= 0 ? visibleModels[at] : undefined;
            if (model !== undefined && hasEfforts(model) && !rowsDisabled) {
              if (typeof event.preventDefault === "function") event.preventDefault();
              openEffort(model, "model");
            }
            return;
          }
          if (pane === "root" && liveItems().indexOf(target) >= 0 && typeof target.click === "function") {
            if (typeof event.preventDefault === "function") event.preventDefault();
            target.click();
          }
          return;
        }
        if (key === "ArrowLeft") {
          if (inSearch && query !== "") return;
          if (pane !== "root" && canBack()) {
            if (typeof event.preventDefault === "function") event.preventDefault();
            back();
          }
          return;
        }
        if (key === "Tab") {
          if (event.shiftKey) {
            if (typeof event.preventDefault === "function") event.preventDefault();
            if (canBack()) back();
            else close(true);
            return;
          }
          var rows = liveItems();
          if (rows.indexOf(target) >= 0 && typeof target.click === "function") {
            if (typeof event.preventDefault === "function") event.preventDefault();
            target.click();
            return;
          }
          if (target !== triggerRef.current) return;
          if (typeof event.preventDefault === "function") event.preventDefault();
          if (pane === "model" && showSearch) {
            setHighlighted(null);
            focusNode(search);
            return;
          }
          var checked = checkedAtRef.current >= 0 ? itemRefs.current[checkedAtRef.current] : null;
          focusNode(checked !== null && checked !== undefined && checked.disabled !== true ? checked : rows[0]);
          return;
        }
        if (key === "ArrowDown" || key === "ArrowUp") {
          if (typeof event.preventDefault === "function") event.preventDefault();
          var list = liveItems();
          if (list.length === 0) return;
          var from = list.indexOf(target);
          var step = key === "ArrowDown" ? 1 : -1;
          focusNode(list[from === -1 ? (step > 0 ? 0 : list.length - 1) : (from + step + list.length) % list.length]);
        }
      }

      /* ---------------- 触发器与浮层 ---------------- */

      var triggerAria = hostCurrent === null
        ? triggerLabel
        : t("triggerAria") + "：" + triggerLabel + (currentEffortLabel === null ? "" : "，" + currentEffortLabel);
      var triggerNode = h(
        "button",
        {
          type: "button",
          ref: triggerRef,
          className: "dsmn_trigger",
          title: triggerLabel,
          "aria-label": triggerAria,
          "aria-haspopup": "menu",
          "aria-expanded": open ? "true" : "false",
          "aria-controls": open ? menuId : undefined,
          "aria-busy": busy ? "true" : undefined,
          "data-selection-focus": selectionFocus ? "" : undefined,
          disabled: locked || !available,
          onBlur: function () { setSelectionFocus(false); },
          onClick: function () {
            if (open) close(true);
            else show();
          }
        },
        uiNode("IconDataOutlineRegular", { className: "dsmn_triggerIcon", size: 16 }),
        h("span", { className: "dsmn_triggerLabel" }, currentChoice === undefined ? triggerLabel : renderLabel(currentChoice, "trigger", true)),
        currentEffortLabel !== null ? h("span", { className: "dsmn_triggerEffort" }, currentEffortLabel) : null,
        busy
          ? stateDot()
          : uiNode("IconChevronDownOutlineRegular", { className: "dsmn_chevron" + (open ? " dsmn_chevronOpen" : "") }, h("span", { className: "dsmn_chevron" }, open ? "▴" : "▾"))
      );

      var menuNode = !open || !available
        ? null
        : h(
            uiComponent("MenuSurface") === null ? "div" : uiComponent("MenuSurface"),
            {
              ref: popoverRef,
              id: menuId,
              className: "dsmn_menu",
              "data-pane": pane,
              role: pane === "model" ? "group" : "menu",
              "aria-label": t("menuAria"),
              "aria-busy": status === "loading" || busy ? "true" : undefined,
              style: position === null ? MEASURE_STYLE : position
            },
            notice !== null ? h("div", { key: "notice", className: "dsmn_error", role: "alert" }, notice) : null,
            currentAddressable || !catalogReady ? null : h("div", { key: "outside", className: "dsmn_status", role: "status" },
              h("span", {}, t("currentOutside") + (triggerLabel === undefined || triggerLabel === null ? "" : triggerLabel)),
              h("button", { type: "button", "data-action": "refresh-catalog", className: "dsmn_retry", disabled: busy, onClick: reload }, t("refresh"))),
            catalogError ? h("div", { key: "error", className: "dsmn_error" }, t("loadFailed") + messageOf(snapshot.error),
              h("button", { type: "button", "data-action": "retry-catalog", className: "dsmn_retry", onClick: reload }, t("retry"))) : null,
            busy ? h("div", { key: "selecting", className: "dsmn_status", role: "status" }, t("selecting")) : null,
            status === "idle" || status === "loading" ? h("div", { key: "loading", className: "dsmn_status", role: "status" }, t(refreshing ? "refreshing" : "loading")) : null,
            body
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

      var Toast = uiComponent("Toast");
      var toastNode = toast === null || Toast === null ? null : h(Toast, {
        key: "toast-" + toast.seq,
        text: toast.text,
        icon: uiNode("IconWarningOutlineRegular", {}),
        anchor: rootRef.current !== null && rootRef.current !== undefined && typeof rootRef.current.closest === "function"
          ? rootRef.current.closest("[data-composer-card]") : null,
        onDone: function () { setToast(null); }
      });

      return h(
        "div",
        {
          className: "dsmn_root",
          ref: rootRef,
          onKeyDown: onRootKeyDown,
          onBlur: function (event) {
            var next = event === null || event === undefined ? null : event.relatedTarget;
            if (!open || next === null || next === undefined) return;
            if (containsNode(rootRef.current, next) || containsNode(popoverRef.current, next)) return;
            close(false);
          },
          onMouseDown: function (event) {
            var target = event === null || event === undefined ? null : event.target;
            if (target !== null && target !== undefined && typeof target.closest === "function" && target.closest("button") !== null
              && typeof event.preventDefault === "function") event.preventDefault();
          }
        },
        triggerNode,
        menuNode,
        toastNode
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
      var tierNote = tier === "local" ? t("storageLocal") : t("storageMemory");

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
    // boot 审计失败（一个插件失败 = 页面起不来）。也要声明服务方法间接读取的依赖：
    // ModelDirectoryResolver 在冷创建目录时，以调用者 ctx 读取 remote.session。
    // 若别的选择器已经创建目录，这条路径会被缓存跳过，掩盖缺少声明的问题。
    var inject = ["slots", "sessions", "modelDirectories", "locale", "remote", "remote.session"];

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
      version: /*__VERSION__*/"dev",
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
      catalog: { providers: [], modelCount: 0 },
      // conversation.input.model.label：是否读得到 SlotCore、当前胜出项、渲染与回退次数
      label: { api: null, entry: null, renders: 0, fallbacks: 0, errors: 0, lastError: null }
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
            select: face.select,
            labels: face.labels
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
        select: props.select !== undefined && props.select !== null ? props.select : live === null ? null : live.select,
        labels: props.labels !== undefined && props.labels !== null ? props.labels : live === null ? null : live.labels
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
        label: {
          api: DIAG.label.api,
          entry: DIAG.label.entry,
          renders: DIAG.label.renders,
          fallbacks: DIAG.label.fallbacks,
          errors: DIAG.label.errors,
          lastError: DIAG.label.lastError
        },
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
      var store = createPreferencesStore();
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

        // 标签槽位（conversation.input.model.label）的读取面：所有会话共用。
        // bind(ns) 给标签项一个按它自己 locale 命名空间绑定的 t（宿主渲染器的 kit.t 同义），
        // 取不到时退回原样返回 key。
        var labelBinds = new Map();
        var labels = {
          slots: ctx.slots,
          bind: function (ns) {
            if (typeof ns !== "string" || ns.length === 0) return function (key) { return key; };
            var cached = labelBinds.get(ns);
            if (cached !== undefined) return cached;
            try {
              var locale = ctx.locale;
              var bound = locale !== null && locale !== undefined && typeof locale.bind === "function" ? locale.bind(ns) : null;
              if (typeof bound === "function") {
                labelBinds.set(ns, bound);
                return bound;
              }
            } catch (error) {
              /* 退回 key */
            }
            return function (key) { return key; };
          }
        };

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
            labels: labels,
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
