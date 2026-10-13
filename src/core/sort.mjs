/**
 * 排序与展示模型构造（纯逻辑，无宿主依赖）。
 *
 * 所有排序都是稳定的；没有显式偏好时严格保持宿主给出的原始顺序。
 * 分组只影响显示，不改变提交用的 providerId / modelId。
 */

/** 官方对供应商的默认偏好顺序：账户 → 官方 → 其余。 */
export const PROVIDER_ORDER_PREFERENCE = ["deepseek-account", "deepseek-official"];

/** 供应商级排序（稳定）。pins 优先，其次官方偏好顺序，其余保持原序。 */
const NO_PINS = [];

export function orderProviders(providers, pins = NO_PINS) {
  const pinRank = new Map();
  const pinList = Array.isArray(pins) ? pins : [];
  for (let i = 0; i < pinList.length; i += 1) if (!pinRank.has(pinList[i])) pinRank.set(pinList[i], i);
  const preferred = new Map(PROVIDER_ORDER_PREFERENCE.map((id, index) => [id, index]));
  return providers
    .map((provider, index) => ({
      provider,
      index,
      rank: pinRank.has(provider.id)
        ? pinRank.get(provider.id)
        : preferred.has(provider.id)
          ? pinRank.size + preferred.get(provider.id)
          : Number.MAX_SAFE_INTEGER
    }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((row) => row.provider);
}

/** 数值感知的字符串比较（不依赖宿主语言环境，结果可预测）。 */
export function naturalCompare(left, right) {
  const a = String(left === undefined || left === null ? "" : left);
  const b = String(right === undefined || right === null ? "" : right);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(j);
    const da = ca >= 48 && ca <= 57;
    const db = cb >= 48 && cb <= 57;
    if (da && db) {
      let ai = i;
      let bj = j;
      while (ai < a.length && a.charCodeAt(ai) >= 48 && a.charCodeAt(ai) <= 57) ai += 1;
      while (bj < b.length && b.charCodeAt(bj) >= 48 && b.charCodeAt(bj) <= 57) bj += 1;
      const na = Number(a.slice(i, ai));
      const nb = Number(b.slice(j, bj));
      if (na !== nb) return na < nb ? -1 : 1;
      if (ai - i !== bj - j) return ai - i < bj - j ? -1 : 1;
      i = ai;
      j = bj;
      continue;
    }
    const la = String.fromCharCode(ca).toLowerCase();
    const lb = String.fromCharCode(cb).toLowerCase();
    if (la !== lb) return la < lb ? -1 : 1;
    i += 1;
    j += 1;
  }
  if (a.length - i !== b.length - j) return a.length - i < b.length - j ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * 取宿主目录里模型对象的显示名。
 *
 * 真实目录（`modelDirectories` 的 `directoryFor(...).store` 快照）里模型对象就是
 * `{ id, name, reasoning }`——官方 `ui-model-selection` 也是读 `model.name`
 * （`children: model.name`）。早期版本这里只认 `originalName`，于是原始模型上取到
 * `undefined`，触发器标题渲染成空字符串：入口看起来「不见了」。这里按字段名依次回退，
 * 只用于显示；身份仍然只用 `providerId`/`modelId`（计划硬要求第 3 条）。
 *
 * @param model - 宿主目录里的原始模型对象（或已规范化的显示对象）。
 * @param fallback - 所有候选都为空时返回的值（通常是 modelId）。
 * @returns {string} 非空显示名，或 fallback。
 */
/**
 * 取宿主目录里供应商（group）的显示名。
 *
 * 宿主目录的 group 对象是 `{ id, name, models }`——官方 `ui-model-selection`
 * 渲染菜单组标题用的就是 `group.name`（只在 `id === "deepseek-account"` 时换成
 * 本地化词条）。早期版本读的是不存在的 `group.label`，于是回退到 `group.id`，
 * 界面上出现 `WORKBUDDY` 这种原始 ID 大写形态。
 *
 * @param group - 宿主目录里的 group 对象
 * @param fallback - 所有候选都为空时返回的值（通常是 group.id）
 * @returns {string} 非空显示名，或 fallback
 */
export function providerDisplayName(group, fallback) {
  if (group === null || group === undefined) return fallback;
  const candidates = [group.name, group.displayName, group.label, group.title, group.id];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return fallback;
}

export function modelDisplayName(model, fallback) {
  if (model === null || model === undefined) return fallback;
  const candidates = [model.alias, model.name, model.originalName, model.displayName, model.modelName, model.id];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return fallback;
}

/**
 * 组内排序：收藏置前 → 名称自然排序 → 原始名称 → 真实模型 ID → 原目录位置。
 * 只影响显示顺序，stableKey 与提交内容不变。
 */
export function sortModelsForDisplay(models) {
  const rows = [];
  for (let i = 0; i < models.length; i += 1) rows.push({ model: models[i], index: i });
  rows.sort((left, right) => {
    const lf = left.model.favorite === true ? 0 : 1;
    const rf = right.model.favorite === true ? 0 : 1;
    if (lf !== rf) return lf - rf;
    const lname = left.model.alias !== undefined ? left.model.alias : left.model.originalName;
    const rname = right.model.alias !== undefined ? right.model.alias : right.model.originalName;
    const byName = naturalCompare(lname, rname);
    if (byName !== 0) return byName;
    const byOriginal = naturalCompare(left.model.originalName, right.model.originalName);
    if (byOriginal !== 0) return byOriginal;
    const byId = naturalCompare(left.model.ref.modelId, right.model.ref.modelId);
    if (byId !== 0) return byId;
    return left.index - right.index;
  });
  return rows.map((row) => row.model);
}

/** familyRows 的默认选项（模块级常量，避免在参数默认值里写字面量对象）。 */
const NO_OPTIONS = {};

/**
 * 把某个供应商下的模型展开为「家族标题 + 模型行」的列表。
 *
 * 每个家族只出现一个标题，标题后紧跟该家族的全部模型（不会交错到别的家族下面，
 * 折叠状态因此始终对应真正可见的行）。
 * - mode "family-first"：家族标题按内置家族顺序（gpt→claude→…→其他）排列。
 * - 其余模式：家族标题按首次出现位置排列。
 * - mode "off"：**整体**保持宿主原始顺序（官方原顺序）——既不做组内自然排序，
 *   也不做家族归并重排；交错家族间的模型顺序与宿主目录逐行一致，家族标题
 *   在每个家族的**首个**成员处插入一次（不做归并，绝不把后面的模型搬前面）。
 * @returns {Array<{kind:"family", familyId, label, count} | {kind:"model", model, familyId, label}>}
 */
export function familyRows(models, options = NO_OPTIONS) {
  const mode = typeof options.mode === "string" ? options.mode : "channel-first";
  if (mode === "off") {
    // "off" = 不整理：宿主顺序逐行保留，只在每个家族首次出现处放一个标题。
    const rows = [];
    const seen = new Set();
    for (let i = 0; i < models.length; i += 1) {
      const model = models[i];
      if (!seen.has(model.familyId)) {
        seen.add(model.familyId);
        rows.push({ kind: "family", familyId: model.familyId, label: model.familyLabel, count: 1 });
      } else {
        for (let r = rows.length - 1; r >= 0; r -= 1) {
          if (rows[r].kind === "family" && rows[r].familyId === model.familyId) {
            rows[r].count += 1;
            break;
          }
        }
      }
      rows.push({ kind: "model", model, familyId: model.familyId, label: model.familyLabel });
    }
    return rows;
  }

  const families = [];
  const bucketOf = new Map();
  for (let i = 0; i < models.length; i += 1) {
    const model = models[i];
    let bucket = bucketOf.get(model.familyId);
    if (bucket === undefined) {
      bucket = {
        familyId: model.familyId,
        label: model.familyLabel,
        order: model.familyOrder,
        first: i,
        models: []
      };
      bucketOf.set(model.familyId, bucket);
      families.push(bucket);
    }
    bucket.models.push(model);
  }

  const ordered = mode === "family-first"
    ? families.slice().sort((left, right) => left.order - right.order || left.first - right.first)
    : families;

  const rows = [];
  for (let f = 0; f < ordered.length; f += 1) {
    const family = ordered[f];
    rows.push({ kind: "family", familyId: family.familyId, label: family.label, count: family.models.length });
    const list = mode === "off" ? family.models : sortModelsForDisplay(family.models);
    for (let m = 0; m < list.length; m += 1) {
      rows.push({ kind: "model", model: list[m], familyId: family.familyId, label: family.label });
    }
  }
  return rows;
}

/** 家族出现顺序（按首次出现），用于「按家族重排」模式与统计。 */
export function familyOrder(models) {
  const seen = new Set();
  const out = [];
  for (let i = 0; i < models.length; i += 1) {
    const model = models[i];
    if (seen.has(model.familyId)) continue;
    seen.add(model.familyId);
    out.push({ familyId: model.familyId, label: model.familyLabel, order: model.familyOrder });
  }
  return out;
}

/**
 * 把宿主 origin 结构（{groups:[{id,label,models:[{id,name,reasoning}]}]}）转成
 * 本插件内部使用的规范化模型列表；这一步不做去重、不改名。
 * @param origin - directory.store.getSnapshot()
 * @param options - { classify, overrides, rules, favorites }
 * @returns {{providers: Array, providerOf: Map, modelOf: Map}}
 */
export function buildCatalog(origin, options) {
  const classify = options.classify;
  const favoriteKeys = new Set(options.favorites ?? []);
  const providers = [];
  const providerOf = new Map();
  const modelOf = new Map();
  const groups = Array.isArray(origin?.groups) ? origin.groups : [];

  for (let g = 0; g < groups.length; g += 1) {
    const group = groups[g];
    const provider = {
      id: group.id,
      label: providerDisplayName(group, group.id),
      models: []
    };
    const models = Array.isArray(group.models) ? group.models : [];
    for (let m = 0; m < models.length; m += 1) {
      const model = models[m];
      const ref = { providerId: group.id, modelId: model.id };
      const classification = classify({ ref, originalName: modelDisplayName(model, model.id) });
      const display = {
        ref,
        stableKey: JSON.stringify([ref.providerId, ref.modelId]),
        providerId: group.id,
        providerLabel: provider.label,
        originalName: modelDisplayName(model, model.id),
        alias: classification.alias,
        originalIndex: provider.models.length,
        familyId: classification.familyId,
        familyLabel: classification.label,
        familyOrder: classification.order,
        familySource: classification.source,
        reasoning: model.reasoning,
        favorite: favoriteKeys.has(JSON.stringify([ref.providerId, ref.modelId]))
      };
      provider.models.push(display);
      modelOf.set(display.stableKey, display);
    }
    providers.push(provider);
    providerOf.set(provider.id, provider);
  }

  return { providers, providerOf, modelOf };
}
