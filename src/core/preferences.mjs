/**
 * 偏好 schema 与规范化（纯逻辑，无宿主依赖）。
 *
 * 只写本插件自己的键；不重建、不整体覆盖宿主设置文档。
 * schemaVersion 用于将来迁移；无法识别的值一律回退到默认值而不是抛错（避免启动失败）。
 */

export const PREFERENCES_SCHEMA_VERSION = 1;

/** 设置命名空间（宿主若提供插件自有设置通道则用它做隔离作用域）。 */
export const PREFERENCES_NAMESPACE = "dsh-model-navigator";

export const GROUPING_MODES = ["off", "channel-first", "family-first"];

export const DEFAULT_PREFERENCES = Object.freeze({
  schemaVersion: PREFERENCES_SCHEMA_VERSION,
  enabled: true,
  grouping: "channel-first",
  showSearch: true,
  providerDefaultEffort: true,
  providerPins: [],
  groupOrder: [],
  favorites: [],
  modelOverrides: [],
  rules: [],
  collapsedFamilies: {},
  lastProviderId: undefined,
  lastModelByProvider: {}
});

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (typeof item !== "string" || item.length === 0 || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function normalizeOverride(value) {
  if (value === null || typeof value !== "object") return undefined;
  if (typeof value.providerId !== "string" || typeof value.modelId !== "string") return undefined;
  const out = { providerId: value.providerId, modelId: value.modelId };
  if (typeof value.groupId === "string" && value.groupId.length > 0) out.groupId = value.groupId;
  if (typeof value.label === "string" && value.label.length > 0) out.label = value.label;
  // 只按精确 (providerId, modelId) 匹配的条目不构成有效覆盖：既没有分组也没有别名时视为无操作项
  if (out.groupId === undefined && out.label === undefined) return undefined;
  return out;
}

function normalizeRule(value) {
  if (value === null || typeof value !== "object") return undefined;
  if (typeof value.pattern !== "string" || value.pattern.length === 0) return undefined;
  if (typeof value.familyId !== "string" || value.familyId.length === 0) return undefined;
  return { pattern: value.pattern, familyId: value.familyId };
}

function normalizeCollapse(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  const keys = Object.keys(value);
  // 两个方向都要留：`true` = 用户显式折叠，`false` = 用户显式展开。
  // 只留 `true` 的话，「默认折叠、用户手动展开」这件事在下次读偏好时会被忘掉。
  for (let i = 0; i < keys.length; i += 1) {
    const entry = value[keys[i]];
    if (entry === true || entry === false) out[keys[i]] = entry;
  }
  return out;
}

function normalizeLastModel(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    const modelId = value[keys[i]];
    if (typeof modelId === "string" && modelId.length > 0) out[keys[i]] = modelId;
  }
  return out;
}

export function createDefaultPreferences() {
  return JSON.parse(JSON.stringify(DEFAULT_PREFERENCES));
}

/**
 * 把任意输入规范化为合法偏好；未知/损坏字段回退默认值。
 * 向后兼容：schemaVersion 缺失或更小都按当前结构读取。
 */
export function normalizePreferences(input) {
  const base = createDefaultPreferences();
  if (input === null || typeof input !== "object" || Array.isArray(input)) return base;
  const out = { ...base };

  out.schemaVersion = PREFERENCES_SCHEMA_VERSION;
  if (typeof input.enabled === "boolean") out.enabled = input.enabled;
  if (GROUPING_MODES.includes(input.grouping)) out.grouping = input.grouping;
  if (typeof input.showSearch === "boolean") out.showSearch = input.showSearch;
  if (typeof input.providerDefaultEffort === "boolean") out.providerDefaultEffort = input.providerDefaultEffort;
  out.providerPins = stringArray(input.providerPins);
  out.groupOrder = stringArray(input.groupOrder);
  out.favorites = stringArray(input.favorites);
  out.modelOverrides = Array.isArray(input.modelOverrides) ? input.modelOverrides.map(normalizeOverride).filter(Boolean) : [];
  out.rules = Array.isArray(input.rules) ? input.rules.map(normalizeRule).filter(Boolean) : [];
  out.collapsedFamilies = normalizeCollapse(input.collapsedFamilies);
  out.lastModelByProvider = normalizeLastModel(input.lastModelByProvider);
  if (typeof input.lastProviderId === "string" && input.lastProviderId.length > 0) out.lastProviderId = input.lastProviderId;
  else delete out.lastProviderId;
  if (out.providerDefaultEffort === false) out.providerDefaultEffort = false;
  return out;
}

/** 家族折叠键：`providerId\u0000familyId`（NUL 分隔，避免两段里本身带分隔符时产生歧义）。 */
export function familyCollapseKey(providerId, familyId) {
  return String(providerId) + "\u0000" + String(familyId);
}

/**
 * 某个家族当前是否折叠（计划 §4.5「默认只展开当前组」）。
 * - 偏好里显式记过的值优先：`true` = 折叠，`false` = 展开；
 * - 没记过时**默认折叠**，只有当前选择所在的那一族默认展开——
 *   否则一点开供应商就是满屏模型行。
 */
export function familyCollapsed(map, key, isCurrentFamily) {
  const explicit = map === null || map === undefined ? undefined : map[key];
  if (explicit === true) return true;
  if (explicit === false) return false;
  return isCurrentFamily !== true;
}

/** 浅层补丁：数组整体替换；collapsedFamilies / lastModelByProvider 逐键合并。 */
export function patchPreferences(current, patch) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return normalizePreferences(current);
  const merged = { ...current };
  const keys = Object.keys(patch);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const value = patch[key];
    if (value === undefined) continue;
    if (key === "collapsedFamilies" || key === "lastModelByProvider") {
      const currentEntry = current === null || current === undefined ? undefined : current[key];
      merged[key] = { ...(currentEntry === undefined || currentEntry === null ? {} : currentEntry), ...(value === null || value === undefined ? {} : value) };
      continue;
    }
    merged[key] = value;
  }
  return normalizePreferences(merged);
}

/** 仅在真正变化时返回新对象，便于 store 去抖。 */
export function preferencesEqual(left, right) {
  return JSON.stringify(normalizePreferences(left)) === JSON.stringify(normalizePreferences(right));
}
