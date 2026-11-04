import test from "node:test";
import assert from "node:assert/strict";

import {
  PROVIDER_DEFAULT_KEY,
  baseSelectionKeyOf,
  buildSelection,
  createDraft,
  draftMatches,
  effortChoices,
  preferredEffort,
  resolveDraft
} from "../src/core/draft.mjs";

function state(overrides = {}) {
  return {
    current: { provider: "deepseek-account", model: "deepseek-v4-pro", reasoningEffort: "high" },
    groups: [
      {
        id: "deepseek-account",
        label: "DeepSeek",
        models: [
          { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", reasoning: { efforts: [{ id: "low", name: "低" }, { id: "high", name: "高" }], defaultEffort: "high" } },
          { id: "deepseek-flash", name: "DeepSeek Flash", reasoning: { efforts: [{ id: "low", name: "低" }] } }
        ]
      },
      { id: "xiaomi", label: "Xiaomi", models: [{ id: "mimo-v2.6-pro", name: "MiMo V2.6 Pro", reasoning: { efforts: [{ id: "low", name: "低" }, { id: "medium", name: "中" }, { id: "high", name: "高" }], defaultEffort: "medium" } }] }
    ],
    ...overrides
  };
}

test("buildSelection：供应商默认必须完全省略 reasoningEffort", () => {
  assert.deepEqual(buildSelection("p", "m"), { provider: "p", model: "m" });
  assert.deepEqual(buildSelection("p", "m", undefined), { provider: "p", model: "m" });
  assert.deepEqual(buildSelection("p", "m", null), { provider: "p", model: "m" });
  assert.deepEqual(buildSelection("p", "m", ""), { provider: "p", model: "m" });
  assert.deepEqual(buildSelection("p", "m", PROVIDER_DEFAULT_KEY), { provider: "p", model: "m" });
  assert.equal("reasoningEffort" in buildSelection("p", "m", PROVIDER_DEFAULT_KEY), false);
});

test("buildSelection：真实档位原样提交，且只构造一次", () => {
  assert.deepEqual(buildSelection("p", "m", "high"), { provider: "p", model: "m", reasoningEffort: "high" });
  assert.deepEqual(buildSelection("p", "m", "xhigh"), { provider: "p", model: "m", reasoningEffort: "xhigh" });
  // 模型名里的 medium 属于模型 ID，不是档位
  assert.deepEqual(buildSelection("p", "gpt-oss-120b-medium", "low"), { provider: "p", model: "gpt-oss-120b-medium", reasoningEffort: "low" });
  assert.throws(() => buildSelection("", "m"), /providerId is required/);
  assert.throws(() => buildSelection("p", ""), /modelId is required/);
});

test("effortChoices：有 defaultEffort 时不插供应商默认项，并标出默认档", () => {
  const withDefault = effortChoices({ efforts: [{ id: "low", name: "低" }, { id: "high", name: "高" }], defaultEffort: "high" }, "供应商默认");
  assert.deepEqual(withDefault.map((c) => c.key), ["effort:low", "effort:high"]);
  assert.deepEqual(withDefault.map((c) => c.isDefault), [false, true]);

  const withoutDefault = effortChoices({ efforts: [{ id: "low", name: "低" }] }, "供应商默认");
  assert.deepEqual(withoutDefault.map((c) => c.key), [PROVIDER_DEFAULT_KEY, "effort:low"]);
  assert.equal(withoutDefault[0].effort, undefined);
  assert.equal(withoutDefault[0].label, "供应商默认");
  assert.equal(withoutDefault[0].isDefault, true);

  assert.deepEqual(effortChoices(undefined, "供应商默认"), [], "无 reasoning 元数据时必须整段隐藏");
  assert.deepEqual(effortChoices({ efforts: [] }, "供应商默认").map((c) => c.key), [PROVIDER_DEFAULT_KEY]);
});

test("草稿有效性：连接换代或基础选择变化即作废", () => {
  const current = state().current;
  const draft = createDraft("s1", current, 0);
  assert.equal(draftMatches(draft, current, 0), true);
  assert.equal(draftMatches(draft, current, 1), false, "连接换代必须作废");
  assert.equal(draftMatches(draft, { ...current, model: "deepseek-flash" }, 0), false, "宿主换了模型必须作废");
  assert.equal(draftMatches(draft, { ...current, reasoningEffort: "low" }, 0), false, "宿主换了档位必须作废");
  assert.equal(draftMatches(draft, current, 0) && baseSelectionKeyOf(current), JSON.stringify(["deepseek-account", "deepseek-v4-pro", "high"]));
  assert.equal(draftMatches(null, current, 0), false);
});

test("resolveDraft：有效草稿优先，其次当前选择", () => {
  const current = state().current;
  const draft = { ...createDraft("s1", current, 0), providerId: "xiaomi", modelId: "mimo-v2.6-pro", effortId: "low" };
  const resolved = resolveDraft(draft, state(), { connectionGeneration: 0 });
  assert.equal(resolved.providerId, "xiaomi");
  assert.equal(resolved.modelId, "mimo-v2.6-pro");
  assert.equal(resolved.effortId, "low");
  assert.equal(resolved.fromDraft, true);

  const fallback = resolveDraft(draft, state(), { connectionGeneration: 5 });
  assert.equal(fallback.providerId, "deepseek-account");
  assert.equal(fallback.modelId, "deepseek-v4-pro");
  assert.equal(fallback.effortId, "high");
  assert.equal(fallback.fromDraft, false);
});

test("resolveDraft：目录默认与首个可选作为兜底", () => {
  const withDefault = resolveDraft(null, state({ current: null, default: { provider: "xiaomi", model: "mimo-v2.6-pro" } }), {});
  assert.equal(withDefault.providerId, "xiaomi");
  assert.equal(withDefault.effortId, "medium", "取宿主公布的 defaultEffort");

  const first = resolveDraft(null, state({ current: null }), {});
  assert.equal(first.providerId, "deepseek-account");
  assert.equal(first.modelId, "deepseek-v4-pro");

  const empty = resolveDraft(null, { current: null, groups: [] }, {});
  assert.equal(empty.providerId, undefined);
  assert.equal(empty.modelId, undefined);
});

test("resolveDraft：切到无默认档模型时不得沿用旧档位", () => {
  const current = state().current;
  const draft = { ...createDraft("s1", current, 0), providerId: "deepseek-account", modelId: "deepseek-flash", effortId: undefined };
  const resolved = resolveDraft(draft, state(), { connectionGeneration: 0 });
  assert.equal(resolved.modelId, "deepseek-flash");
  assert.equal(resolved.effortId, undefined, "该模型没有 defaultEffort，应保持未指定");
});

test("提交后以 selection 重建草稿：提交结果成为新的基线（客户端 draftStore.commit 的做法）", () => {
  const selection = buildSelection("xiaomi", "mimo-v2.6-pro", "medium");
  const next = createDraft("s1", selection, 0);
  assert.equal(next.baseSelectionKey, JSON.stringify(["xiaomi", "mimo-v2.6-pro", "medium"]));
  assert.equal(draftMatches(next, selection, 0), true);
  assert.equal(draftMatches(next, state().current, 0), false, "旧的当前选择不再匹配");
});

test("preferredEffort：记住的档位仍在就沿用，否则回到模型默认", () => {
  const reasoning = { efforts: [{ id: "low" }, { id: "high" }], defaultEffort: "low" };
  assert.equal(preferredEffort(reasoning, "high"), "high");
  assert.equal(preferredEffort(reasoning, "retired"), "low", "记录过期");
  assert.equal(preferredEffort(reasoning, undefined), "low", "没记过");
  const noDefault = { efforts: [{ id: "low" }] };
  assert.equal(preferredEffort(noDefault, "low"), "low");
  assert.equal(preferredEffort(noDefault, "retired"), undefined, "没有默认档 = 供应商默认");
  assert.equal(preferredEffort(undefined, "low"), undefined, "模型没有档位");
  assert.equal(preferredEffort(null, "low"), undefined);
});
