import test from "node:test";
import assert from "node:assert/strict";

import { stableKeyOf, sameRef, refOfSelection, dedupeByRef, applyPins } from "../src/core/identity.mjs";

const a = { providerId: "deepseek-account", modelId: "deepseek-v4-pro" };
const b = { providerId: "xiaomi", modelId: "deepseek-v4-pro" };
const c = { providerId: "deepseek-account", modelId: "deepseek-v4-pro" };

test("stableKeyOf 是 JSON 元组，保留原始大小写与前后缀", () => {
  assert.equal(stableKeyOf(a), '["deepseek-account","deepseek-v4-pro"]');
  assert.notEqual(stableKeyOf(a), stableKeyOf(b));
  assert.equal(stableKeyOf(a), stableKeyOf(c));
  // 不做去前缀 / 不折大小写 / 不裁量后缀
  assert.notEqual(stableKeyOf({ providerId: "p", modelId: "openai/gpt-5" }), stableKeyOf({ providerId: "p", modelId: "gpt-5" }));
  assert.notEqual(stableKeyOf({ providerId: "p", modelId: "MiMo-V2" }), stableKeyOf({ providerId: "p", modelId: "mimo-v2" }));
  assert.notEqual(stableKeyOf({ providerId: "p", modelId: "gpt-oss-120b-medium" }), stableKeyOf({ providerId: "p", modelId: "gpt-oss-120b" }));
});

test("sameRef 同名不同供应商不相等", () => {
  assert.equal(sameRef(a, c), true);
  assert.equal(sameRef(a, b), false);
  assert.equal(sameRef(a, null), false);
  assert.equal(sameRef(undefined, undefined), false);
});

test("refOfSelection 只取 provider/model，丢弃 reasoningEffort", () => {
  assert.deepEqual(refOfSelection({ provider: "p", model: "m", reasoningEffort: "high" }), { providerId: "p", modelId: "m" });
  assert.equal(refOfSelection(null), null);
});

test("dedupeByRef 保留首现顺序且不合并同名不同供应商", () => {
  const items = [{ ref: a }, { ref: b }, { ref: c }];
  assert.deepEqual(dedupeByRef(items).map((x) => x.ref), [a, b]);
});

test("applyPins 无 pin 时保持宿主原序", () => {
  const items = [{ providerId: "z" }, { providerId: "y" }, { providerId: "x" }];
  assert.deepEqual(applyPins(items, []).map((x) => x.providerId), ["z", "y", "x"]);
  assert.deepEqual(applyPins(items, undefined).map((x) => x.providerId), ["z", "y", "x"]);
});

test("applyPins 有 pin 时 pin 优先，其余保持原序", () => {
  const items = [{ providerId: "z" }, { providerId: "y" }, { providerId: "x" }, { providerId: "w" }];
  assert.deepEqual(applyPins(items, ["x", "z"]).map((p) => p.providerId), ["x", "z", "y", "w"]);
});

test("applyPins 重复 pin 只记首次", () => {
  const items = [{ providerId: "a" }, { providerId: "b" }];
  assert.deepEqual(applyPins(items, ["b", "b", "a"]).map((p) => p.providerId), ["b", "a"]);
});

test("U06：同一供应商下不同路径、末段相同的模型必须都保留（不去重、不串路由）", () => {
  const a = { providerId: "agg", modelId: "vendorA/model-x" };
  const b = { providerId: "agg", modelId: "vendorB/model-x" };
  const kept = dedupeByRef([{ ref: a }, { ref: b }, { ref: a }]);
  assert.equal(kept.length, 2, "同供应商不同路径不是同一个模型");
  assert.notEqual(stableKeyOf(a), stableKeyOf(b));
  assert.equal(sameRef(a, b), false);
  // 只有完全相同的 (providerId, modelId) 才算重复
  assert.equal(dedupeByRef([{ ref: a }, { ref: { providerId: "agg", modelId: "vendorA/model-x" } }]).length, 1);
});
