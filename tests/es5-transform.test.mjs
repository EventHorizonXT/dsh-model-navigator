import test from "node:test";
import assert from "node:assert/strict";

import { toEs5 } from "../tools/es5-transform.mjs";

/**
 * 0.1.6 回归：es5-transform 的产物必须与 ESM 源**语义等价**，而不只是「没有现代语法」。
 * 0.1.5 的缺陷：rewriteOptionalChains 产出的三元表达式不加括号，
 * 随后 rewriteNullish 的操作符扫描把无括号三元的 `?`/`:` 当成普通操作符吞进右操作数，
 * 产出 `label:(alias != null ? alias : known) == null ? void 0 : (...)` ——
 * alias 有值时语义反转成 void 0，运行时抛 TypeError
 * （lib/client.js:298，Cannot read properties of undefined (reading 'label')）。
 * 现有 89 条测试全绿，因为 client-surface 只对拍 ESM 版 classifyModel，从不执行产物切片。
 */

test("?? 右侧的 ?. 必须整体加括号：语义与 ESM 一致", () => {
  const es5 = toEs5("const label = (alias ?? known?.label ?? override.groupId);");
  // 产物里不允许出现裸的三元嵌在 ?? 展开右侧——直接求值对拍：
  const run = (code, sandbox) => {
    const keys = Object.keys(sandbox);
    const values = keys.map((k) => sandbox[k]);
    const m = code.match(/^(?:const|let|var)\s+(\w+)\s*=/m);
    return new Function(...keys, `"use strict";${code}; return ${m ? m[1] : "undefined"};`)(...values);
  };
  // 情形 1：alias 有值 —— ESM 语义返回 alias，坏产物会走 void 0 分支抛错/返回 undefined
  const es5Out1 = run(es5, { alias: "Small", known: undefined, override: { groupId: "local" } });
  assert.equal(es5Out1, "Small", "alias 有值时必须原样返回，不得被转译反转");
  // 情形 2：alias 空且 known 存在 —— 必须取 known.label
  const es5Out2 = run(es5, { alias: null, known: { label: "Known" }, override: { groupId: "local" } });
  assert.equal(es5Out2, "Known");
  // 情形 3：全空 —— 兜底 groupId
  const es5Out3 = run(es5, { alias: null, known: null, override: { groupId: "local" } });
  assert.equal(es5Out3, "local");
});

test("三元表达式出现在 ?? 右侧时整句求值仍正确", () => {
  // 直接复刻 lib/client.js:298 的原始 ESM 形态（rewriteOptionalChains + rewriteNullish 的输入）
  const esm = "const label = known?.label ?? override.groupId;";
  const es5 = toEs5(esm);
  const run = (code, sandbox) => {
    const keys = Object.keys(sandbox);
    const values = keys.map((k) => sandbox[k]);
    const m = code.match(/^(?:const|let|var)\s+(\w+)\s*=/m);
    return new Function(...keys, `"use strict";${code}; return ${m ? m[1] : "undefined"};`)(...values);
  };
  // known 有值：取 known.label；known 为 null：兜底 groupId。0.1.5 的坏产物两处都错。
  assert.equal(run(es5, { known: { label: "L" }, override: { groupId: "g" } }), "L");
  assert.equal(run(es5, { known: null, override: { groupId: "g" } }), "g");
});

test("多个 ?? 与 ?. 混链（search.mjs:29 同型）", () => {
  const es5 = toEs5("const q = a?.b ?? c?.d ?? \"fallback\";");
  const run = (code, sandbox) => {
    const keys = Object.keys(sandbox);
    const values = keys.map((k) => sandbox[k]);
    const m = code.match(/^(?:const|let|var)\s+(\w+)\s*=/m);
    return new Function(...keys, `"use strict";${code}; return ${m ? m[1] : "undefined"};`)(...values);
  };
  assert.equal(run(es5, { a: { b: 1 }, c: { d: 2 } }), 1);
  assert.equal(run(es5, { a: null, c: { d: 2 } }), 2);
  assert.equal(run(es5, { a: null, c: null }), "fallback");
});

test("产物不再包含裸 `?.` / `??`（既有约束，防止回归）", () => {
  const es5 = toEs5("const v = a?.b ?? c;");
  assert.ok(!es5.includes("?."));
  assert.ok(!es5.includes("??"));
  assert.ok(!es5.includes("=>"));
});
