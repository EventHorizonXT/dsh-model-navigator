import test from "node:test";
import assert from "node:assert/strict";

import { buildCatalog, familyOrder, familyRows, naturalCompare, orderProviders, sortModelsForDisplay } from "../src/core/sort.mjs";
import { classifyModel } from "../src/core/classify.mjs";
import { rankModels, searchModels } from "../src/core/search.mjs";

const origin = {
  groups: [
    { id: "xiaomi", label: "Xiaomi", models: [{ id: "mimo-v2.6-pro", name: "MiMo V2.6 Pro" }, { id: "mimo-v2.6-flash", name: "MiMo V2.6 Flash" }] },
    { id: "deepseek-account", label: "DeepSeek", models: [{ id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" }, { id: "deepseek-flash", name: "DeepSeek Flash" }] },
    { id: "anthropic", models: [{ id: "claude-sonnet-4-5" }] }
  ]
};

const classify = (input) => classifyModel({ ...input, overrides: [], rules: [] });

/** 深冻结，用来证明分类/排序/搜索不产生任何原地写入。 */
function deepFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

test("orderProviders：pins > 官方偏好顺序 > 原序", () => {
  const providers = origin.groups.map((g) => ({ id: g.id, label: g.label }));
  assert.deepEqual(orderProviders(providers, []).map((p) => p.id), ["deepseek-account", "xiaomi", "anthropic"]);
  assert.deepEqual(orderProviders(providers, ["anthropic"]).map((p) => p.id), ["anthropic", "deepseek-account", "xiaomi"]);
  assert.deepEqual(orderProviders(providers, ["xiaomi", "anthropic"]).map((p) => p.id), ["xiaomi", "anthropic", "deepseek-account"]);
  // 排序必须稳定：同 rank 保持原序
  assert.deepEqual(orderProviders(providers, []).map((p) => p.id).filter((id) => id !== "deepseek-account"), ["xiaomi", "anthropic"]);
});

test("buildCatalog：保留原始顺序、原始 ID，并补齐展示字段", () => {
  const catalog = buildCatalog(origin, { classify, favorites: [] });
  assert.deepEqual(catalog.providers.map((p) => p.id), ["xiaomi", "deepseek-account", "anthropic"]);
  const mimo = catalog.modelOf.get('["xiaomi","mimo-v2.6-pro"]');
  assert.equal(mimo.originalName, "MiMo V2.6 Pro");
  assert.equal(mimo.familyId, "mimo");
  assert.equal(mimo.familyLabel, "MiMo");
  assert.equal(mimo.favorite, false);
  // label 缺失时回退到 id
  const anthropic = catalog.providers.find((p) => p.id === "anthropic");
  assert.equal(anthropic.label, "anthropic");
  assert.equal(anthropic.models[0].originalName, "claude-sonnet-4-5");
});

test("buildCatalog：同名模型不同供应商同时存在且互不覆盖", () => {
  const dup = {
    groups: [
      { id: "deepseek-account", label: "DeepSeek", models: [{ id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" }] },
      { id: "xiaomi", label: "Xiaomi", models: [{ id: "deepseek-v4-pro", name: "Xiaomi 托管 DeepSeek" }] }
    ]
  };
  const catalog = buildCatalog(dup, { classify, favorites: [] });
  assert.equal(catalog.providers.length, 2);
  assert.equal(catalog.providers[0].models[0].originalName, "DeepSeek V4 Pro");
  assert.equal(catalog.providers[1].models[0].originalName, "Xiaomi 托管 DeepSeek");
  assert.equal(catalog.modelOf.get('["xiaomi","deepseek-v4-pro"]').originalName, "Xiaomi 托管 DeepSeek");
});

test("familyRows：每个家族一个标题、计数正确、标题后紧跟本家族全部模型（不交错）", () => {
  const catalog = buildCatalog(
    {
      groups: [
        { id: "p", label: "P", models: [{ id: "gpt-5" }, { id: "gpt-5-mini" }, { id: "claude-sonnet-4-5" }, { id: "space-bunny" }, { id: "gpt-4o" }] }
      ]
    },
    { classify, favorites: [] }
  );
  const rows = familyRows(catalog.providers[0].models);
  // 每个家族只出一个标题，且被隔开的同家族模型（gpt-4o）被归到该标题之后的同一段里。
  // 未识别模型的标签是哨兵 "other"（界面按 familyId 换成本地化的「其他」），
  // 绝不是模型 ID。
  assert.deepEqual(rows.filter((r) => r.kind === "family").map((r) => `#${r.label}x${r.count}`), ["#GPTx3", "#Claudex1", "#otherx1"]);
  assert.deepEqual(rows.map((r) => (r.kind === "family" ? `#${r.label}` : r.model.ref.modelId)), [
    "#GPT", "gpt-4o", "gpt-5", "gpt-5-mini",
    "#Claude", "claude-sonnet-4-5",
    "#other", "space-bunny"
  ]);
});

test("U09：组内自然排序（model-2 在 model-10 之前）与收藏置前", () => {
  const models = [];
  const ids = ["model-10", "model-9", "model-2", "model-1"];
  for (let i = 0; i < ids.length; i += 1) {
    models.push({
      ref: { providerId: "p", modelId: ids[i] },
      originalName: ids[i],
      favorite: ids[i] === "model-10"
    });
  }
  const sorted = sortModelsForDisplay(models).map((m) => m.ref.modelId);
  assert.deepEqual(sorted, ["model-10", "model-1", "model-2", "model-9"]);
});

test("naturalCompare：数值感知、大小写不敏感、稳定决胜", () => {
  assert.ok(naturalCompare("model-2", "model-10") < 0);
  assert.ok(naturalCompare("gpt-5", "gpt-5-mini") < 0);
  // 大小写不参与主序（只在完全相同时用大小写决胜，方向固定且稳定）
  assert.equal(naturalCompare("gpt-5", "gpt-5"), 0);
  assert.equal(naturalCompare("gpt-5", "GPT-5"), 1);
  assert.equal(naturalCompare("GPT-5", "gpt-5"), -1);
  assert.ok(naturalCompare("a2b", "a10b") < 0);
  assert.ok(naturalCompare("", "a") < 0);
});

test("familyRows：family-first 按内置家族顺序排列，off 保持宿主原顺序", () => {
  const origin2 = {
    groups: [
      { id: "p", label: "P", models: [{ id: "space-bunny" }, { id: "gpt-5" }, { id: "claude-sonnet-4-5" }] }
    ]
  };
  const catalog = buildCatalog(origin2, { classify, favorites: [] });
  const channel = familyRows(catalog.providers[0].models, { mode: "channel-first" });
  assert.deepEqual(channel.filter((r) => r.kind === "family").map((r) => r.familyId), ["other", "gpt", "claude"]);
  const byFamily = familyRows(catalog.providers[0].models, { mode: "family-first" });
  assert.deepEqual(byFamily.filter((r) => r.kind === "family").map((r) => r.familyId), ["gpt", "claude", "other"]);
  const off = familyRows(catalog.providers[0].models, { mode: "off" });
  assert.deepEqual(off.filter((r) => r.kind === "model").map((r) => r.model.ref.modelId), ["space-bunny", "gpt-5", "claude-sonnet-4-5"]);
});

test("0.1.6 回归：off 模式家族标题随宿主原顺序就地插入，不得归并重排交错家族", () => {
  // 0.1.5 缺陷：off 模式仍按家族归并（[gpt-5, claude-sonnet, gpt-4o] 被重排成
  // [gpt-5, gpt-4o, claude-sonnet]）。计划要求 off = 官方原顺序逐行保留。
  const catalog = buildCatalog(
    { groups: [{ id: "p", label: "P", models: [{ id: "gpt-5" }, { id: "claude-sonnet-4-5" }, { id: "gpt-4o" }] }] },
    { classify, favorites: [] }
  );
  const off = familyRows(catalog.providers[0].models, { mode: "off" });
  // 模型行顺序必须与宿主逐行一致（交错保留）：
  assert.deepEqual(
    off.filter((r) => r.kind === "model").map((r) => r.model.ref.modelId),
    ["gpt-5", "claude-sonnet-4-5", "gpt-4o"],
    "off 模式不得把后面的同家族模型搬到前面"
  );
  // 家族标题只在每个家族首个成员处出现一次，且按首次出现位置排列：
  const headers = off.filter((r) => r.kind === "family").map((r) => r.familyId);
  assert.deepEqual(headers, ["gpt", "claude"], "每个家族一个标题，按首次出现排列");
  // 标题后紧跟该家族的首个成员：
  assert.deepEqual(
    off.map((r) => (r.kind === "family" ? "F:" + r.familyId : "M:" + r.model.ref.modelId)),
    ["F:gpt", "M:gpt-5", "F:claude", "M:claude-sonnet-4-5", "M:gpt-4o"]
  );
});

test("0.1.3 回归：真实 WorkBuddy 目录按厂商分桶，供应商名取 group.name，未识别的进 other", () => {
  // 来源：宿主 WorkBuddy 目录快照 的 17 个模型
  const ids = [
    "hy4-preview", "hy3", "hy3-x", "space-bunny", "deepseek-v4.1-flash",
    "glm-5.3", "glm-5.3-flash", "glm-5.2", "glm-5.1", "glm-5v-turbo",
    "minimax-m3", "minimax-m2.7", "kimi-k3-1", "kimi-k2.8-preview", "kimi-k2.7", "kimi-k2.6",
    "deepseek-v4-pro"
  ];
  const catalog = buildCatalog(
    { groups: [{ id: "workbuddy", name: "WorkBuddy", models: ids.map((id) => ({ id })) }] },
    { classify, favorites: [] }
  );
  // 供应商标题必须是宿主给的 name（0.1.2 读不存在的 group.label，页面显示成 WORKBUDDY）
  assert.equal(catalog.providers[0].label, "WorkBuddy");
  const buckets = new Map();
  for (const model of catalog.providers[0].models) {
    if (!buckets.has(model.familyId)) buckets.set(model.familyId, { label: model.familyLabel, ids: [] });
    buckets.get(model.familyId).ids.push(model.ref.modelId);
  }
  assert.deepEqual([...buckets.keys()].sort(), ["deepseek", "glm", "hunyuan", "kimi", "minimax", "other"]);
  assert.equal(buckets.get("hunyuan").label, "Hunyuan");
  assert.deepEqual(buckets.get("hunyuan").ids, ["hy4-preview", "hy3", "hy3-x"]);
  assert.equal(buckets.get("glm").ids.length, 5);
  assert.equal(buckets.get("kimi").ids.length, 4);
  assert.equal(buckets.get("minimax").ids.length, 2);
  assert.equal(buckets.get("deepseek").ids.length, 2);
  // 唯一无法识别的模型单独进「其他」，不冒充任何厂商
  assert.deepEqual(buckets.get("other").ids, ["space-bunny"]);
  assert.equal(buckets.get("other").label, "other");
});

test("familyRows：空列表与单家族", () => {
  assert.deepEqual(familyRows([]), []);
  const single = familyRows([
    { ref: { providerId: "p", modelId: "gpt-5" }, familyId: "gpt", familyLabel: "GPT" },
    { ref: { providerId: "p", modelId: "gpt-4o" }, familyId: "gpt", familyLabel: "GPT" }
  ]);
  assert.deepEqual(single.filter((r) => r.kind === "family").map((r) => r.count), [2]);
});

test("familyOrder：按首次出现去重", () => {
  const models = [{ familyId: "gpt", familyLabel: "GPT", familyOrder: 10 }, { familyId: "claude", familyLabel: "Claude", familyOrder: 20 }, { familyId: "gpt", familyLabel: "GPT", familyOrder: 10 }];
  assert.deepEqual(familyOrder(models).map((f) => f.familyId), ["gpt", "claude"]);
});

test("U10：冻结的官方目录对象不得被原地修改（分类/排序/搜索都只读）", () => {
  const frozenOrigin = {
    groups: [
      { id: "p", label: "P", models: [{ id: "model-10", name: "model-10" }, { id: "gpt-5", name: "GPT 5" }] },
      { id: "q", label: "Q", models: [{ id: "qwen3-max", name: "Qwen3 Max" }] }
    ],
    default: { provider: "p", model: "gpt-5" }
  };
  const before = JSON.stringify(frozenOrigin);
  deepFreeze(frozenOrigin);
  const catalog = buildCatalog(frozenOrigin, { classify, favorites: [] });
  assert.doesNotThrow(() => orderProviders(catalog.providers, ["q"]));
  assert.doesNotThrow(() => familyRows(catalog.providers[0].models, { mode: "family-first" }));
  assert.doesNotThrow(() => sortModelsForDisplay(catalog.providers[0].models));
  assert.doesNotThrow(() => rankModels([{ ref: { providerId: "p", modelId: "gpt-5" }, originalName: "GPT 5" }], "gpt"));
  assert.doesNotThrow(() => searchModels(catalog.providers, "qwen", {}));
  assert.equal(JSON.stringify(frozenOrigin), before, "官方目录对象必须一字未改");
});

test("U05：两个供应商各有同名模型时都必须可选，身份互不覆盖", () => {
  const origin3 = {
    groups: [
      { id: "p1", label: "P1", models: [{ id: "shared-model", name: "Shared" }] },
      { id: "p2", label: "P2", models: [{ id: "shared-model", name: "Shared" }] }
    ]
  };
  const catalog = buildCatalog(origin3, { classify, favorites: [] });
  const hits = rankModels(catalog.providers.flatMap((p) => p.models), "shared");
  assert.equal(hits.length, 2);
  assert.equal(hits[0].ref.providerId === hits[1].ref.providerId, false);
  assert.equal(catalog.modelOf.get('["p1","shared-model"]').providerId, "p1");
  assert.equal(catalog.modelOf.get('["p2","shared-model"]').providerId, "p2");
});
