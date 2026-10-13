import test from "node:test";
import assert from "node:assert/strict";

import {
  BUILTIN_FAMILIES,
  FALLBACK_FAMILY_ID,
  FALLBACK_FAMILY_LABEL,
  FALLBACK_FAMILY_ORDER,
  builtinFamilyOf,
  channelFamilyOf,
  classifyModel,
  globToRegExpSource,
  matchesGlob
} from "../src/core/classify.mjs";

const ref = (providerId, modelId) => ({ providerId, modelId });

test("内置家族：GPT 系", () => {
  for (const id of ["gpt-5", "gpt-5-codex", "openai/gpt-4o", "gpt-oss-120b", "gpt-oss-120b-medium", "o3", "o4-mini", "chatgpt-4o-latest", "codex-mini-latest"]) {
    assert.equal(builtinFamilyOf(id)?.id, "gpt", id);
  }
  // 任意子串匹配被禁止：gptx 不是 gpt 家族
  assert.equal(builtinFamilyOf("gptx-1"), undefined);
});

test("内置家族：Claude / Devin / Grok / DeepSeek / Gemini", () => {
  for (const id of ["claude-sonnet-4-5", "anthropic/claude-opus-4-1", "claude-3-5-haiku-latest"]) {
    assert.equal(builtinFamilyOf(id)?.id, "claude", id);
  }
  assert.equal(builtinFamilyOf("devin/2.0")?.id, "devin");
  assert.equal(builtinFamilyOf("devin")?.id, "devin");
  assert.equal(builtinFamilyOf("grok-4")?.id, "grok");
  assert.equal(builtinFamilyOf("grok-code-fast-1")?.id, "grok");
  for (const id of ["deepseek-v4-pro", "deepseek-chat", "deepseek/deepseek-reasoner", "dbrx-instruct"]) {
    assert.equal(builtinFamilyOf(id)?.id, "deepseek", id);
  }
  assert.equal(builtinFamilyOf("gemini-3-pro-preview")?.id, "gemini");
  assert.equal(builtinFamilyOf("gemma-3-27b")?.id, "gemini");
});

test("内置家族：Qwen 与 MiMo，且不与子串混淆", () => {
  for (const id of ["qwen3-max", "qwen2.5-coder-32b", "qwq-32b"]) assert.equal(builtinFamilyOf(id)?.id, "qwen", id);
  for (const id of ["mimo-v2.6-pro", "MiMo-V2-Flash", "xiaomi/mimo-v2.6-flash"]) assert.equal(builtinFamilyOf(id)?.id, "mimo", id);
  // grok 含 "ok"？不会误判为 mimo；qwen 不误判为 gemini
  assert.equal(builtinFamilyOf("llama-3.1-70b"), undefined);
  assert.equal(builtinFamilyOf("space-bunny"), undefined);
  // `hy` 只在词边界上命中（hy3/hy4-preview），不能吞掉 hyperbolic-*
  assert.equal(builtinFamilyOf("hyperbolic-hermes-3"), undefined);
});

test("内置家族：0.1.3 按真实 WorkBuddy 目录增补的 Hunyuan / GLM / Kimi / MiniMax", () => {
  for (const id of ["hy4-preview", "hy3", "hy3-x", "hunyuan-t1"]) assert.equal(builtinFamilyOf(id)?.id, "hunyuan", id);
  for (const id of ["glm-5.3", "glm-5.3-flash", "glm-5.2", "glm-5.1", "glm-5v-turbo"]) assert.equal(builtinFamilyOf(id)?.id, "glm", id);
  for (const id of ["kimi-k3-1", "kimi-k2.8-preview", "kimi-k2.7", "kimi-k2.6", "moonshot-v1-8k"]) assert.equal(builtinFamilyOf(id)?.id, "kimi", id);
  for (const id of ["minimax-m3", "minimax-m2.7", "abab6.5s-chat"]) assert.equal(builtinFamilyOf(id)?.id, "minimax", id);
  // WorkBuddy 目录里真的无法判断的那一个：必须进「其他」，不许猜
  assert.equal(builtinFamilyOf("space-bunny"), undefined);
});

test("内置家族 order 唯一且递增", () => {
  const orders = BUILTIN_FAMILIES.map((f) => f.order);
  assert.equal(new Set(orders).size, orders.length);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
});

test("未知家族走 fallback：familyId=other、标签是本地化哨兵，绝不拿模型/路径段冒充家族名", () => {
  const out = classifyModel({ ref: ref("p", "ht.co/space-bunny") });
  assert.equal(out.familyId, FALLBACK_FAMILY_ID);
  assert.equal(out.order, FALLBACK_FAMILY_ORDER);
  assert.equal(out.source, "fallback");
  assert.equal(out.label, FALLBACK_FAMILY_LABEL);
  assert.notEqual(out.label, "ht.co");
  assert.equal(out.channelId, undefined, "兜底标签不是渠道");

  const bare = classifyModel({ ref: ref("p", "space-bunny") });
  assert.equal(bare.label, FALLBACK_FAMILY_LABEL);

  // 同一供应商里所有无法识别的模型必须落进同一个「其他」桶：0.1.2 的真实页面
  // 把它们散成了以桶内第一个模型命名的家族（「hy4-preview 8 个模型」）。
  const ids = ["space-bunny", "liquid-lfm-2", "totally-unknown-x"];
  const families = new Set(ids.map((id) => classifyModel({ ref: ref("p", id) }).familyId));
  const labels = new Set(ids.map((id) => classifyModel({ ref: ref("p", id) }).label));
  assert.equal(families.size, 1);
  assert.deepEqual([...labels], [FALLBACK_FAMILY_LABEL]);
});

test("受限 glob：只支持 * 与 ?，其余元字符按字面处理", () => {
  assert.equal(matchesGlob("gpt-*", "gpt-5"), true);
  assert.equal(matchesGlob("gpt-*", "openai/gpt-5"), false);
  assert.equal(matchesGlob("*-codex", "gpt-5-codex"), true);
  assert.equal(matchesGlob("gpt-?-codex", "gpt-5-codex"), true);
  assert.equal(matchesGlob("gpt-?-codex", "gpt-55-codex"), false);
  assert.equal(matchesGlob("gpt[0-9]", "gpt5"), false, "方括号必须按字面处理");
  assert.equal(matchesGlob("!!!", "!!!"), true);
  assert.equal(matchesGlob("", "anything"), false);
  assert.equal(globToRegExpSource("a.b"), "a\\.b");
});

test("分类优先级：override > rule > builtin > fallback", () => {
  const target = ref("xiaomi", "mimo-v2.6-pro");
  const override = classifyModel({
    ref: target,
    overrides: [{ providerId: "xiaomi", modelId: "mimo-v2.6-pro", groupId: "local", label: "本地模型" }],
    rules: [{ pattern: "mimo-*", familyId: "gpt" }]
  });
  assert.equal(override.source, "override");
  assert.equal(override.label, "本地模型");
  assert.equal(override.order, 500, "未知 groupId 用 500 兜底但仍按 override 生效");

  const ruled = classifyModel({ ref: target, rules: [{ pattern: "mimo-*", familyId: "gpt" }] });
  assert.equal(ruled.source, "rule");
  assert.equal(ruled.familyId, "gpt");
  assert.equal(ruled.order, 10);

  const builtin = classifyModel({ ref: target });
  assert.equal(builtin.source, "builtin");
  assert.equal(builtin.familyId, "mimo");

  // override 必须精确匹配 providerId + modelId，不能只匹配 modelId
  const other = classifyModel({
    ref: ref("other-provider", "mimo-v2.6-pro"),
    overrides: [{ providerId: "xiaomi", modelId: "mimo-v2.6-pro", groupId: "local" }]
  });
  assert.equal(other.source, "builtin");
});

test("规则只匹配 modelId，不匹配 providerId", () => {
  const out = classifyModel({ ref: ref("gpt-provider", "mimo-v2.6-pro"), rules: [{ pattern: "gpt-*", familyId: "gpt" }] });
  assert.equal(out.source, "builtin");
  assert.equal(out.familyId, "mimo");
});

test("U02：渠道优先 —— devin/gpt-5-4 进 Devin 主组，并保留 GPT 事实", () => {
  const out = classifyModel({ ref: ref("p", "devin/gpt-5-4"), mode: "channel-first" });
  assert.equal(out.familyId, "devin");
  assert.equal(out.label, "Devin");
  assert.equal(out.channelId, "devin", "渠道必须被识别为显式前缀");
  // 提交用的 modelId 一字不改
  assert.equal(out.alias, undefined);
});

test("U03：家族优先 —— devin/claude-sonnet-4-6 进 Claude 主组，Devin 只作标签", () => {
  const out = classifyModel({ ref: ref("p", "devin/claude-sonnet-4-6"), mode: "family-first" });
  assert.equal(out.familyId, "claude");
  assert.equal(out.label, "Claude");
  assert.equal(out.channelId, "devin");
  assert.equal(out.channelLabel, "Devin");
  // 同一模型在渠道优先模式下走 Devin
  const channelFirst = classifyModel({ ref: ref("p", "devin/claude-sonnet-4-6"), mode: "channel-first" });
  assert.equal(channelFirst.familyId, "devin");
});

test("U04：仓库路径里的 Qwen 长 ID 必须按家族分类，绝不把 ht.co 当渠道", () => {
  const longId = "ht.co/unsloth/Qwen3-Coder-480B-A35B-Instruct";
  const out = classifyModel({ ref: ref("aggregator", longId) });
  assert.equal(out.familyId, "qwen");
  assert.equal(out.label, "Qwen");
  assert.equal(out.channelId, undefined, "只有显式内置前缀才算渠道");
  assert.equal(channelFamilyOf(longId), undefined);
  // unsloth / ht.co 这类路径段永远不参与渠道判定：
  // 有家族特征的按家族；没有家族特征的进「其他」分组（familyId=other），
  // 即使标签沿用路径首段，也绝不被当作渠道或改变提交身份。
  assert.equal(classifyModel({ ref: ref("aggregator", "unsloth/gpt-oss-120b") }).familyId, "gpt");
  assert.equal(classifyModel({ ref: ref("aggregator", "ht.co/deepseek-chat") }).familyId, "deepseek");
  const unknown = classifyModel({ ref: ref("aggregator", "openrouter/meta-llama/llama-3-70b") });
  assert.equal(unknown.familyId, FALLBACK_FAMILY_ID);
  assert.equal(unknown.source, "fallback");
  assert.equal(unknown.channelId, undefined, "路径首段不是渠道");
  assert.equal(unknown.label, FALLBACK_FAMILY_LABEL, "兜底家族用本地化哨兵，不拿路径首段冒充家族名");
});

test("U07：误导性子串不强行归类（devin 之外的渠道前缀都不算渠道）", () => {
  for (const id of ["devins/2.0", "xdevin/y", "claudex-1", "gptx-1", "qwenx"]) {
    assert.equal(channelFamilyOf(id), undefined, id);
  }
  assert.equal(classifyModel({ ref: ref("p", "devins/2.0") }).source, "fallback");
  assert.equal(classifyModel({ ref: ref("p", "qwenx") }).familyId, FALLBACK_FAMILY_ID);
});

test("0.1.6 回归：family-first 下渠道前缀不再吞掉可识别的模型家族", () => {
  // 0.1.5 缺陷：family-first 分支先看渠道前缀（devin/xxx），命中就直接归 devin，
  // 导致 devin/grok-4、devin/deepseek-chat、devin/qwen3-max 全进 Devin 家族。
  // 修复后：剥掉已识别渠道前缀，对剩余部分做家族分类；认不出才回退渠道家族。
  assert.equal(classifyModel({ ref: ref("p", "devin/grok-4"), mode: "family-first" }).familyId, "grok");
  assert.equal(classifyModel({ ref: ref("p", "devin/deepseek-chat"), mode: "family-first" }).familyId, "deepseek");
  assert.equal(classifyModel({ ref: ref("p", "devin/qwen3-max"), mode: "family-first" }).familyId, "qwen");
  // 渠道信息仍然保留（标签上可见），提交身份不变：
  const kept = classifyModel({ ref: ref("p", "devin/grok-4"), mode: "family-first" });
  assert.equal(kept.channelId, "devin");
  assert.equal(kept.alias, undefined);
  // 无法识别的残余仍归渠道家族（devin/devin-2 只有 devin 特征）：
  assert.equal(classifyModel({ ref: ref("p", "devin/devin-2"), mode: "family-first" }).familyId, "devin");
  // channel-first 行为不变：
  assert.equal(classifyModel({ ref: ref("p", "devin/grok-4"), mode: "channel-first" }).familyId, "devin");
});
