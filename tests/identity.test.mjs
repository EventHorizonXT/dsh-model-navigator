import test from "node:test";
import assert from "node:assert/strict";

import { stableKeyOf } from "../src/core/identity.mjs";

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

test("U06：同一供应商下不同路径、末段相同的模型必须是不同的键（不去重、不串路由）", () => {
  const x = { providerId: "agg", modelId: "vendorA/model-x" };
  const y = { providerId: "agg", modelId: "vendorB/model-x" };
  assert.notEqual(stableKeyOf(x), stableKeyOf(y), "同供应商不同路径不是同一个模型");
  // 只有完全相同的 (providerId, modelId) 才算同一个键
  assert.equal(stableKeyOf(x), stableKeyOf({ providerId: "agg", modelId: "vendorA/model-x" }));
  // 拼接分隔符不会产生歧义
  assert.notEqual(stableKeyOf({ providerId: "a/b", modelId: "c" }), stableKeyOf({ providerId: "a", modelId: "b/c" }));
});
