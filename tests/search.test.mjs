import test from "node:test";
import assert from "node:assert/strict";

import { filterProviders, rankModels, scoreModel, searchModels } from "../src/core/search.mjs";

function model(modelId, name, providerId, familyId) {
  return {
    ref: { providerId, modelId },
    stableKey: JSON.stringify([providerId, modelId]),
    modelId,
    originalName: name,
    familyId: familyId ?? "other",
    providerLabel: providerId
  };
}

const providers = [
  {
    id: "deepseek-account",
    label: "DeepSeek",
    models: [model("deepseek-v4-pro", "DeepSeek V4 Pro", "deepseek-account", "deepseek"), model("deepseek-flash", "DeepSeek Flash", "deepseek-account", "deepseek")]
  },
  {
    id: "xiaomi",
    label: "Xiaomi",
    models: [model("mimo-v2.6-pro", "MiMo V2.6 Pro", "xiaomi", "mimo"), model("deepseek-v4-pro", "Xiaomi 托管 DeepSeek V4 Pro", "xiaomi", "deepseek")]
  }
];

test("scoreModel：完全匹配 < 前缀 < 子串 < 供应商命中", () => {
  const exact = scoreModel(model("gpt-5", "gpt-5", "P"), "gpt-5");
  const prefix = scoreModel(model("gpt-5-codex", "gpt-5-codex", "P"), "gpt-5");
  const infix = scoreModel(model("openai-gpt-5", "openai-gpt-5", "P"), "gpt-5");
  assert.ok(exact < prefix);
  assert.ok(prefix < infix);
  assert.equal(scoreModel(model("m", "m", "Zeta"), "zeta"), 3, "只有供应商名命中时排在最后");
});

test("rankModels：稳定排序，未命中被剔除", () => {
  const models = [
    model("gpt-5-codex", "gpt-5-codex", "P"),
    model("zzz", "zzz", "P"),
    model("gpt-5", "gpt-5", "P"),
    model("gpt-5-mini", "gpt-5-mini", "P")
  ];
  assert.deepEqual(rankModels(models, "gpt-5").map((m) => m.ref.modelId), ["gpt-5", "gpt-5-codex", "gpt-5-mini"]);
});

test("searchModels：空查询返回空数组（由界面回退到浏览排序）", () => {
  assert.deepEqual(searchModels(providers, ""), []);
  assert.deepEqual(searchModels(providers, "   "), []);
});

test("searchModels：按真实 (providerId, modelId) 去重，同名不同供应商都保留", () => {
  const hits = searchModels(providers, "v4-pro");
  assert.deepEqual(hits.map((m) => m.stableKey), ['["deepseek-account","deepseek-v4-pro"]', '["xiaomi","deepseek-v4-pro"]']);
});

test("searchModels：支持模型 ID 与别名匹配", () => {
  assert.deepEqual(searchModels(providers, "flash").map((m) => m.modelId), ["deepseek-flash"]);
  assert.deepEqual(searchModels([{ id: "p", label: "P", models: [{ ...model("gpt-oss-120b-medium", "gpt-oss-120b-medium", "P"), alias: "本地小模型" }] }], "本地小模型").length, 1);
});

test("searchModels：可按家族限定", () => {
  assert.deepEqual(searchModels(providers, "deepseek", { familyId: "mimo" }), []);
  assert.deepEqual(searchModels(providers, "v4", { familyId: "deepseek" }).length, 2);
});

test("filterProviders：供应商名命中即保留整组，模型命中亦保留", () => {
  assert.equal(filterProviders(providers, "").length, 2);
  assert.deepEqual(filterProviders(providers, "xiaomi").map((p) => p.id), ["xiaomi"]);
  assert.deepEqual(filterProviders(providers, "flash").map((p) => p.id), ["deepseek-account"]);
  assert.deepEqual(filterProviders(providers, "不存在的模型").length, 0);
});
