/**
 * 模型身份（纯逻辑，无宿主依赖）。
 *
 * 唯一键必须保留 provider 与 model 的原始字符串：不做去前缀、不折叠大小写、
 * 不裁量后缀。同名模型来自不同供应商时必须能同时存在。
 */

/** 稳定唯一键：JSON 元组，避免把 id 拼成 "provider/model" 再拆回来。 */
export function stableKeyOf(ref) {
  return JSON.stringify([ref.providerId, ref.modelId]);
}

/** 判断两个引用是否指向同一个「供应商 + 模型」组合。 */
export function sameRef(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) return false;
  return left.providerId === right.providerId && left.modelId === right.modelId;
}

/** 从一个 selection（{provider, model, reasoningEffort?}）构造引用。 */
export function refOfSelection(selection) {
  if (selection === null || selection === undefined) return null;
  return { providerId: selection.provider, modelId: selection.model };
}

/**
 * 以真实 (providerId, modelId) 去重，保留首次出现的顺序。
 * 不按显示名去重；同名不同供应商的两个模型都会保留。
 */
export function dedupeByRef(items) {
  const seen = new Set();
  const out = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const key = stableKeyOf(item.ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * 稳定排序：仅在显式提供 pin 顺序时重排，其余保持宿主给出的原始顺序。
 * @param items - 待排序条目
 * @param pinOrder - providerId 数组，越靠前越优先
 */
export function applyPins(items, pinOrder) {
  const identity = (entry, index) => ({ item: entry, index });
  if (!Array.isArray(pinOrder) || pinOrder.length === 0) {
    return items
      .map(identity)
      .sort((left, right) => left.index - right.index)
      .map((row) => row.item);
  }
  const rank = new Map();
  const order = Array.isArray(pinOrder) ? pinOrder : [];
  for (let i = 0; i < order.length; i += 1) if (!rank.has(order[i])) rank.set(order[i], i);
  return items
    .map((item, index) => ({ item, index, rank: rank.get(item.providerId) }))
    .sort((left, right) => {
      const leftRank = left.rank === undefined ? Number.MAX_SAFE_INTEGER : left.rank;
      const rightRank = right.rank === undefined ? Number.MAX_SAFE_INTEGER : right.rank;
      return leftRank - rightRank || left.index - right.index;
    })
    .map((row) => row.item);
}
