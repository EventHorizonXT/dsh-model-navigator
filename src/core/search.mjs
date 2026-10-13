/**
 * 搜索与匹配（纯逻辑，无宿主依赖）。
 *
 * 官方 /model 的搜索能力保持不变（由官方自己维护）；这里只为三级界面提供
 * 等价的本地过滤，并补充「按模型 ID / 别名」匹配。排序规则不依赖任何 Harness Client 包。
 */

function scoreOne(haystack, needle) {
  if (haystack === needle) return 0;
  if (haystack.startsWith(needle)) return 1;
  const at = haystack.indexOf(needle);
  if (at >= 0) return 2 + Math.min(at, 50) / 100;
  return Number.POSITIVE_INFINITY;
}

/**
 * 单条模型的匹配分（越小越靠前）；不匹配返回 Infinity。
 * 字段权重：显示名/别名 < 模型 ID < 供应商名。
 */
export function scoreModel(model, query) {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return 0;
  const candidates = [model.alias, model.originalName, model.modelId];
  const names = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const value = candidates[i];
    if (typeof value === "string" && value.length > 0) names.push(value.toLowerCase());
  }
  const provider = String(model.providerLabel ?? "").toLowerCase();

  let best = Number.POSITIVE_INFINITY;
  for (let n = 0; n < names.length; n += 1) best = Math.min(best, scoreOne(names[n], needle));
  if (Number.isFinite(best)) return best;
  return scoreOne(provider, needle) + 3;
}

/**
 * 对模型列表做搜索排序（稳定）。
 * @returns 命中项，按 (分数, 原始索引) 升序
 */
export function rankModels(models, query) {
  const scored = [];
  for (let i = 0; i < models.length; i += 1) {
    const score = scoreModel(models[i], query);
    if (!Number.isFinite(score)) continue;
    scored.push({ model: models[i], score, index: i });
  }
  scored.sort((left, right) => left.score - right.score || left.index - right.index);
  return scored.map((row) => row.model);
}

/**
 * 跨供应商搜索。空查询返回空数组（由调用方回退到浏览排序）。
 * 以真实 (providerId, modelId) 去重；命中项携带家族与来源供应商信息。
 */
const EMPTY_OPTIONS = {};

export function searchModels(providers, query, options = EMPTY_OPTIONS) {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const pool = [];
  for (let p = 0; p < providers.length; p += 1) {
    const provider = providers[p];
    for (let m = 0; m < provider.models.length; m += 1) {
      const model = provider.models[m];
      if (options.familyId !== undefined && options.familyId !== null && model.familyId !== options.familyId) continue;
      pool.push({ ...model, providerLabel: provider.label, providerId: provider.id, modelId: model.ref.modelId });
    }
  }
  const ranked = rankModels(pool, trimmed);
  const seen = new Set();
  const out = [];
  for (let i = 0; i < ranked.length; i += 1) {
    const model = ranked[i];
    // 以真实 (providerId, modelId) 去重，而不是以被改写过的展示字段去重
    const key = JSON.stringify([model.ref.providerId, model.ref.modelId]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(model);
  }
  return out;
}

/**
 * 供应商级搜索：供应商名或旗下任一模型命中。
 * 空查询返回全部（保持传入顺序）。
 */
export function filterProviders(providers, query) {
  const trimmed = query.trim();
  if (trimmed.length === 0) return providers;
  const needle = trimmed.toLowerCase();
  const out = [];
  for (let p = 0; p < providers.length; p += 1) {
    const provider = providers[p];
    const providerHit = provider.label.toLowerCase().includes(needle) || provider.id.toLowerCase().includes(needle);
    if (providerHit) {
      out.push(provider);
      continue;
    }
    let modelHit = false;
    for (let m = 0; m < provider.models.length; m += 1) {
      const model = provider.models[m];
      const probe = { ...model, providerLabel: provider.label, modelId: model.ref.modelId };
      if (Number.isFinite(scoreModel(probe, trimmed))) {
        modelHit = true;
        break;
      }
    }
    if (modelHit) out.push(provider);
  }
  return out;
}
