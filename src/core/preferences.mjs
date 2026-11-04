/**
 * 偏好 schema 与规范化（纯逻辑，无宿主依赖）。
 *
 * 只写本插件自己的键；不重建、不整体覆盖宿主设置文档。
 * schemaVersion 用于将来迁移；无法识别的值一律回退到默认值而不是抛错（避免启动失败）。
 */

export const PREFERENCES_SCHEMA_VERSION = 1;

/** 偏好命名空间：客户端拼成 localStorage 键 `<namespace>:preferences:v<schema>`。 */
export const PREFERENCES_NAMESPACE = "dsh-model-navigator";

export const GROUPING_MODES = ["off", "channel-first", "family-first"];

/** 「最近使用」最多保留的条目数（跨供应商、按最近一次选择排序）。 */
export const RECENT_MODELS_LIMIT = 8;

export const DEFAULT_PREFERENCES = Object.freeze({
  schemaVersion: PREFERENCES_SCHEMA_VERSION,
  enabled: true,
  grouping: "channel-first",
  showSearch: true,
  // 「不可用」分组（失效的收藏/最近、加载失败的供应商）默认折叠
  showUnavailable: false,
  providerPins: [],
  favorites: [],
  modelOverrides: [],
  rules: [],
  collapsedFamilies: {},
  // 供应商折叠：providerId → true（折叠）/ false（展开）；没记过时只展开当前选择所在的供应商
  collapsedProviders: {},
  lastProviderId: undefined,
  lastModelByProvider: {},
  // 每个模型上次选的思维强度：`JSON.stringify([providerId, modelId])` → 档位 ID；选默认档时没有这一项
  effortByModel: {},
  // MRU：`JSON.stringify([providerId, modelId])`，最新在前；与 favorites 同一种键
  recentModels: []
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

function normalizeStringMap(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    const entry = value[keys[i]];
    if (typeof entry === "string" && entry.length > 0) out[keys[i]] = entry;
  }
  return out;
}

function recentKeyOf(providerId, modelId) {
  return JSON.stringify([providerId, modelId]);
}

/**
 * 0.3.2 及更早只记了「每个供应商最后一次的模型」+「最后一次的供应商」，
 * 没有跨供应商的先后顺序。迁移时只能确定最后一次的那条排第一，其余按原键序跟在后面。
 */
function migrateRecent(lastProviderId, lastModelByProvider) {
  const out = [];
  if (lastProviderId !== undefined && lastModelByProvider[lastProviderId] !== undefined) {
    out.push(recentKeyOf(lastProviderId, lastModelByProvider[lastProviderId]));
  }
  const providers = Object.keys(lastModelByProvider);
  for (let i = 0; i < providers.length && out.length < RECENT_MODELS_LIMIT; i += 1) {
    if (providers[i] === lastProviderId) continue;
    out.push(recentKeyOf(providers[i], lastModelByProvider[providers[i]]));
  }
  return out;
}

/** 把一次成功选择放到 MRU 最前面：去重、截断，返回新数组。 */
export function rememberRecent(list, providerId, modelId) {
  const key = recentKeyOf(providerId, modelId);
  const out = [key];
  const previous = Array.isArray(list) ? list : [];
  for (let i = 0; i < previous.length && out.length < RECENT_MODELS_LIMIT; i += 1) {
    if (previous[i] !== key) out.push(previous[i]);
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
  if (typeof input.showUnavailable === "boolean") out.showUnavailable = input.showUnavailable;
  out.providerPins = stringArray(input.providerPins);
  out.favorites = stringArray(input.favorites);
  out.modelOverrides = Array.isArray(input.modelOverrides) ? input.modelOverrides.map(normalizeOverride).filter(Boolean) : [];
  out.rules = Array.isArray(input.rules) ? input.rules.map(normalizeRule).filter(Boolean) : [];
  out.collapsedFamilies = normalizeCollapse(input.collapsedFamilies);
  out.collapsedProviders = normalizeCollapse(input.collapsedProviders);
  out.lastModelByProvider = normalizeStringMap(input.lastModelByProvider);
  out.effortByModel = normalizeStringMap(input.effortByModel);
  if (typeof input.lastProviderId === "string" && input.lastProviderId.length > 0) out.lastProviderId = input.lastProviderId;
  else delete out.lastProviderId;
  // 字段存在（哪怕是空数组）就以它为准：用户清空「最近」后不能被旧字段迁移回来
  out.recentModels = Array.isArray(input.recentModels)
    ? stringArray(input.recentModels).slice(0, RECENT_MODELS_LIMIT)
    : migrateRecent(out.lastProviderId, out.lastModelByProvider);
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

/** 供应商是否折叠：与家族同一套规则（显式状态优先，否则只展开当前选择所在的供应商）。 */
export function providerCollapsed(map, providerId, isCurrentProvider) {
  return familyCollapsed(map, String(providerId), isCurrentProvider);
}

/**
 * 收起供应商时一并收回它的家族，重新展开时只看到家族标题。
 * 清掉已记的家族状态即回到默认折叠；当前家族默认展开，要显式折叠才收得回来。
 * @returns 给 patchPreferences 的 collapsedFamilies 补丁（值为 null 表示删除这一键）
 */
export function foldProviderFamilies(map, providerId, currentFamilyKey) {
  const prefix = familyCollapseKey(providerId, "");
  const patch = {};
  const keys = map === null || map === undefined ? [] : Object.keys(map);
  for (let i = 0; i < keys.length; i += 1) {
    if (keys[i].startsWith(prefix)) patch[keys[i]] = null;
  }
  if (typeof currentFamilyKey === "string") patch[currentFamilyKey] = true;
  return patch;
}

/** 逐键合并的映射；值为 null 的键在规范化时被删除。 */
const MERGED_MAPS = ["collapsedFamilies", "collapsedProviders", "lastModelByProvider", "effortByModel"];

/** 浅层补丁：数组整体替换，MERGED_MAPS 逐键合并。 */
export function patchPreferences(current, patch) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return normalizePreferences(current);
  const merged = { ...current };
  const keys = Object.keys(patch);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const value = patch[key];
    if (value === undefined) continue;
    if (MERGED_MAPS.includes(key)) {
      const currentEntry = current === null || current === undefined ? undefined : current[key];
      merged[key] = { ...(currentEntry === undefined || currentEntry === null ? {} : currentEntry), ...(value === null || value === undefined ? {} : value) };
      continue;
    }
    merged[key] = value;
  }
  return normalizePreferences(merged);
}
