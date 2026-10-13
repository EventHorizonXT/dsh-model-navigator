import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PREFERENCES,
  PREFERENCES_NAMESPACE,
  PREFERENCES_SCHEMA_VERSION,
  createDefaultPreferences,
  normalizePreferences,
  patchPreferences,
  preferencesEqual,
  familyCollapseKey,
  familyCollapsed
} from "../src/core/preferences.mjs";
import { classifyModel } from "../src/core/classify.mjs";

test("默认偏好是当前 schema 版本且命名空间稳定", () => {
  assert.equal(PREFERENCES_SCHEMA_VERSION, 1);
  assert.equal(PREFERENCES_NAMESPACE, "dsh-model-navigator");
  const a = createDefaultPreferences();
  const b = createDefaultPreferences();
  assert.notEqual(a, b, "必须返回新对象，避免默认值被就地修改");
  a.providerPins.push("mutated");
  assert.deepEqual(createDefaultPreferences().providerPins, [], "默认值不可被调用方污染");
  assert.equal(a.schemaVersion, PREFERENCES_SCHEMA_VERSION);
  assert.equal(a.grouping, "channel-first");
  assert.deepEqual(a.modelOverrides, []);
  assert.deepEqual(a.rules, []);
  assert.deepEqual(a.collapsedFamilies, {});
  assert.equal(DEFAULT_PREFERENCES.enabled, true);
});

test("normalizePreferences：损坏输入一律回退默认，不抛错", () => {
  for (const bad of [null, undefined, 42, "x", [], true]) {
    assert.deepEqual(normalizePreferences(bad), createDefaultPreferences());
  }
  const partial = normalizePreferences({ enabled: false, grouping: "不存在的模式", providerPins: "x", rules: [{}], modelOverrides: [{ providerId: 1 }] });
  assert.equal(partial.enabled, false);
  assert.equal(partial.grouping, "channel-first");
  assert.deepEqual(partial.providerPins, []);
  assert.deepEqual(partial.rules, []);
  assert.deepEqual(partial.modelOverrides, []);
});

test("normalizePreferences：数组去重、去空、保序", () => {
  const out = normalizePreferences({
    providerPins: ["b", "a", "b", "", null, 7],
    favorites: ['["p","m"]', '["p","m"]'],
    groupOrder: ["x", "y"]
  });
  assert.deepEqual(out.providerPins, ["b", "a"]);
  assert.deepEqual(out.favorites, ['["p","m"]']);
  assert.deepEqual(out.groupOrder, ["x", "y"]);
});

test("normalizePreferences：modelOverrides 与 rules 逐条校验", () => {
  const out = normalizePreferences({
    modelOverrides: [
      { providerId: "p", modelId: "m", groupId: "local", label: "本地" },
      { providerId: "p", modelId: "m2" },
      { providerId: "p" },
      "nope"
    ],
    rules: [{ pattern: "gpt-*", familyId: "gpt" }, { pattern: "x" }, { familyId: "gpt" }]
  });
  // 保留 providerId + modelId 都合法、且至少带一个效果字段（groupId / label）的条目
  assert.deepEqual(out.modelOverrides, [{ providerId: "p", modelId: "m", groupId: "local", label: "本地" }]);
  assert.deepEqual(out.rules, [{ pattern: "gpt-*", familyId: "gpt" }]);
  // 只有别名也能生效
  const aliasOnly = normalizePreferences({ modelOverrides: [{ providerId: "p", modelId: "m3", label: "小模型" }] });
  assert.deepEqual(aliasOnly.modelOverrides, [{ providerId: "p", modelId: "m3", label: "小模型" }]);
  assert.equal(classifyModel({ ref: { providerId: "p", modelId: "m3" }, overrides: aliasOnly.modelOverrides }).source, "override");
});

test("normalizePreferences：折叠状态保留两个方向，非布尔丢弃", () => {
  // true = 用户显式折叠，false = 用户显式展开。只留 true 的话，
  // 「默认折叠、用户手动展开」在下次读偏好时会被忘掉，界面又缩回去。
  const out = normalizePreferences({ collapsedFamilies: { "p:gpt": true, "p:claude": false, "p:x": "yes" } });
  assert.deepEqual(out.collapsedFamilies, { "p:gpt": true, "p:claude": false });
});

test("familyCollapsed：默认折叠，只默认展开当前选择所在的家族，显式状态优先", () => {
  const key = familyCollapseKey("workbuddy", "kimi");
  assert.equal(key, "workbuddy\u0000kimi", "折叠键用 NUL 分隔 provider 与 family，避免两段自带分隔符时歧义");
  assert.equal(familyCollapseKey("a", "b"), "a\u0000b");

  const map = {};
  assert.equal(familyCollapsed(map, key, false), true, "没记过 → 默认折叠");
  assert.equal(familyCollapsed(map, key, true), false, "没记过但在当前选择所在家族 → 默认展开");
  assert.equal(familyCollapsed(undefined, key, true), false, "偏好缺失时同样走默认");
  assert.equal(familyCollapsed(null, key, false), true);

  assert.equal(familyCollapsed({ [key]: false }, key, false), false, "显式展开：即便不是当前家族也展开");
  assert.equal(familyCollapsed({ [key]: true }, key, true), true, "显式折叠：即便是当前家族也保持折叠");
  assert.equal(familyCollapsed({ [key]: "yes" }, key, false), true, "非布尔值不被当成显式状态");
});

test("patchPreferences：数组整体替换，映射逐键合并，undefined 不覆盖", () => {
  const base = normalizePreferences({ providerPins: ["a"], collapsedFamilies: { x: true }, favorites: ["f1"] });
  const next = patchPreferences(base, { providerPins: ["b"], collapsedFamilies: { y: true }, enabled: undefined });
  assert.deepEqual(next.providerPins, ["b"]);
  assert.deepEqual(next.collapsedFamilies, { x: true, y: true });
  assert.deepEqual(next.favorites, ["f1"]);
  assert.equal(next.enabled, true, "undefined 不得覆盖为假值");
});

test("patchPreferences：补丁不可信也被规范化", () => {
  const next = patchPreferences(createDefaultPreferences(), { grouping: "family-first", rules: [{ pattern: "*", familyId: "gpt" }] });
  assert.equal(next.grouping, "family-first");
  assert.deepEqual(next.rules, [{ pattern: "*", familyId: "gpt" }]);
});

test("preferencesEqual 比较规范化结果，相同则视为无变化", () => {
  assert.equal(preferencesEqual({ enabled: true }, { enabled: true }), true);
  assert.equal(preferencesEqual({ enabled: true }, { enabled: false }), false);
  assert.equal(preferencesEqual({ providerPins: ["a"] }, { providerPins: ["b"] }), false);
  // 显式写出默认值与省略是等价的
  assert.equal(preferencesEqual({ enabled: true }, { enabled: true, grouping: "channel-first" }), true);
  assert.equal(preferencesEqual(normalizePreferences({ providerPins: ["a"] }), { providerPins: ["a"] }), true);
});
