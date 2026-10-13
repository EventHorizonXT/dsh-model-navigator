/**
 * 选择草稿与提交语义（纯逻辑，无宿主依赖）。
 *
 * 硬约束（开发计划 §8.3）：
 *   - 原子提交：只构造一次选择对象；不先切模型再切档位。
 *   - 「供应商默认」提交时必须省略 reasoningEffort（不能传 "default" / "" / null）。
 *   - 模型名里的 "medium"（如 gpt-oss-120b-medium）是完整模型 ID 的一部分，不剥离、不推断为档位。
 */

/** 宿主公布默认档位；选项 key 用于 React 列表稳定性。 */
export const PROVIDER_DEFAULT_KEY = "provider-default";

/** 从当前 selection 取出稳定的草稿基础键。 */
export function baseSelectionKeyOf(current) {
  if (current === null || current === undefined) return "";
  return JSON.stringify([current.provider ?? null, current.model ?? null, current.reasoningEffort ?? null]);
}

export function createDraft(sessionId, current, connectionGeneration = 0) {
  return {
    sessionId,
    connectionGeneration,
    baseSelectionKey: baseSelectionKeyOf(current),
    providerId: current?.provider,
    modelId: current?.model,
    effortId: current?.reasoningEffort
  };
}

/** 草稿是否仍适用于当前 selection（宿主在别处改了模型就作废）。 */
export function draftMatches(draft, current, connectionGeneration) {
  if (draft === null || draft === undefined) return false;
  if (draft.connectionGeneration !== connectionGeneration) return false;
  return draft.baseSelectionKey === baseSelectionKeyOf(current);
}

/** 选中项的稳定键：provider 与 model 必须同时相等。 */
export function draftKeyOf(draft) {
  return JSON.stringify([draft?.providerId ?? null, draft?.modelId ?? null]);
}

/**
 * 在草稿、当前选择、目录默认之间解析「现在该显示哪个供应商 / 模型 / 档位」。
 * 优先级：草稿（仍有效）> 当前选择（在目录中仍可寻址）> 目录默认 > 第一个可选。
 */
const EMPTY_CATALOG_OPTIONS = {};

export function resolveDraft(draft, state, catalogOptions = EMPTY_CATALOG_OPTIONS) {
  const stateValue = state === null || state === undefined ? {} : state;
  const groups = Array.isArray(stateValue.groups) ? stateValue.groups : [];
  const generation = catalogOptions.connectionGeneration === undefined
    ? (draft === null || draft === undefined || draft.connectionGeneration === undefined ? 0 : draft.connectionGeneration)
    : catalogOptions.connectionGeneration;
  const valid = draftMatches(draft, stateValue.current, generation);
  const findGroup = function (id) {
    return groups.find(function (group) { return group.id === id; });
  };
  const findModel = function (groupId, modelId) {
    const group = findGroup(groupId);
    if (group === undefined || !Array.isArray(group.models)) return undefined;
    return group.models.find(function (model) { return model.id === modelId; });
  };

  let providerId;
  let modelId;
  const stateCurrent = stateValue.current === undefined ? null : stateValue.current;
  if (valid && typeof draft.providerId === "string" && findModel(draft.providerId, draft.modelId) !== undefined) {
    providerId = draft.providerId;
    modelId = draft.modelId;
  } else if (stateCurrent !== null && typeof stateCurrent.provider === "string" && findModel(stateCurrent.provider, stateCurrent.model) !== undefined) {
    providerId = stateCurrent.provider;
    modelId = stateCurrent.model;
  } else if (stateValue.default !== undefined && stateValue.default !== null && typeof stateValue.default.provider === "string" && findModel(stateValue.default.provider, stateValue.default.model) !== undefined) {
    providerId = stateValue.default.provider;
    modelId = stateValue.default.model;
  } else if (groups.length > 0 && Array.isArray(groups[0].models) && groups[0].models.length > 0) {
    providerId = groups[0].id;
    modelId = groups[0].models[0].id;
  }

  const group = providerId === undefined ? undefined : findGroup(providerId);
  const model = providerId === undefined ? undefined : findModel(providerId, modelId);
  const reasoning = model === undefined ? undefined : model.reasoning;

  let effortId;
  if (valid && providerId === draft.providerId && modelId === draft.modelId) effortId = draft.effortId;
  else if (stateCurrent !== null && stateCurrent.provider === providerId && stateCurrent.model === modelId) {
    effortId = stateCurrent.reasoningEffort === undefined ? (reasoning === undefined ? undefined : reasoning.defaultEffort) : stateCurrent.reasoningEffort;
  } else effortId = reasoning === undefined ? undefined : reasoning.defaultEffort;
  // 草稿里的「供应商默认」= 显式不带 effort 键。当宿主公布了 defaultEffort 时，
  // 第三级没有「供应商默认」这一项（选项全部来自宿主元数据），undefined 就不可表达了：
  // 此时显示 defaultEffort，避免触发器空着档位、列表里一行也不打勾。
  // 只影响显示：草稿里的 undefined 依旧是「提交时不带 reasoningEffort 键」。
  if (effortId === undefined && reasoning !== undefined && reasoning.defaultEffort !== undefined) effortId = reasoning.defaultEffort;

  const groupLabel = group === undefined || group.label === undefined ? providerId : group.label;
  return { providerId, modelId, providerLabel: groupLabel, model, reasoning, effortId, fromDraft: valid && providerId === draft.providerId && modelId === draft.modelId };
}

/**
 * 第三级选项。宿主未公布 defaultEffort 时补一个显式的「供应商默认」项（提交时不带 effort）。
 * 无 reasoning 元数据 → 返回空数组，界面应隐藏整个第三级。
 * @returns {Array<{key, effort: string|undefined, label, isDefault: boolean}>}
 */
export function effortChoices(reasoning, providerDefaultLabel) {
  if (reasoning === null || reasoning === undefined) return [];
  const efforts = Array.isArray(reasoning.efforts) ? reasoning.efforts : [];
  const out = [];
  if (reasoning.defaultEffort === undefined) {
    out.push({ key: PROVIDER_DEFAULT_KEY, effort: undefined, label: providerDefaultLabel, isDefault: true });
  }
  for (let i = 0; i < efforts.length; i += 1) {
    const effort = efforts[i];
    out.push({
      key: "effort:" + effort.id,
      effort: effort.id,
      label: typeof effort.name === "string" && effort.name.length > 0 ? effort.name : effort.id,
      isDefault: reasoning.defaultEffort === effort.id
    });
  }
  return out;
}

/**
 * 构造唯一一次提交对象。reasoningEffort 为 undefined 时整个键省略。
 * @returns {{provider, model, reasoningEffort?}}
 */
export function buildSelection(providerId, modelId, effortId) {
  if (typeof providerId !== "string" || providerId.length === 0) throw new Error("model-navigator: providerId is required");
  if (typeof modelId !== "string" || modelId.length === 0) throw new Error("model-navigator: modelId is required");
  if (effortId === undefined || effortId === null || effortId === PROVIDER_DEFAULT_KEY || effortId === "") {
    return { provider: providerId, model: modelId };
  }
  return { provider: providerId, model: modelId, reasoningEffort: effortId };
}

/** 提交后的乐观草稿：成功后 selection 会成为新的 current。 */
export function draftAfterCommit(draft, selection) {
  return {
    ...draft,
    providerId: selection.provider,
    modelId: selection.model,
    effortId: selection.reasoningEffort,
    baseSelectionKey: baseSelectionKeyOf(selection)
  };
}
