/**
 * 模型家族分类（纯逻辑，无宿主依赖）。
 *
 * 目标：在第二级（模型级）把模型按家族分组成可折叠标题。
 * 优先级（高 → 低）：
 *   1. 用户对某个精确模型的显式分组覆盖（override，来自偏好）
 *   2. 用户自定义匹配规则（rule，仅支持精确匹配与受限 glob）
 *   3. 可靠的内置家族特征（builtin）
 *   4. 兜底分组（fallback）
 *
 * 约束（见开发计划 §5 / §7）：
 *   - 分组只影响显示，绝不改写 providerId / modelId / reasoningEffort。
 *   - 不使用 includes("gpt") 这类任意子串匹配。
 *   - 不把「第一个 / 前面的字符串」当渠道（ht.co / unsloth / ... 反例）。
 *   - 自定义规则不支持任意正则、不支持可执行 JS。
 */

export const FALLBACK_FAMILY_ID = "other";

/**
 * 兜底家族（开发计划 §5.2：「无法判断时进入『其他』，不猜测」）。
 *
 * `label` 是给界面用的稳定哨兵值，**不是**模型 ID：界面按 `familyId` 换成当前
 * 语言的「其他 / Other」。0.1.2 及以前这里取模型 ID 的第一个片段，于是同一供应商
 * 里所有无法识别的模型会拼成一个以「桶内第一个模型」命名的家族（真实页面表现为
 * 「hy4-preview 8 个模型」），看起来像是把 hy4 当成了供应商。
 */
export const FALLBACK_FAMILY_LABEL = "other";

/** 兜底家族排在所有内置家族之后。 */
export const FALLBACK_FAMILY_ORDER = 900;

/**
 * 内置家族表。`tokens` 用词边界匹配，`prefixes` 用于明确的厂商前缀。
 * order 决定第二级里家族标题的先后；数值越小越靠前。
 */
export const BUILTIN_FAMILIES = [
  { id: "gpt", label: "GPT", order: 10, tokens: ["gpt", "o1", "o3", "o4", "chatgpt", "codex", "gpt-oss"], prefixes: [] },
  { id: "claude", label: "Claude", order: 20, tokens: ["claude"], prefixes: [] },
  { id: "devin", label: "Devin", order: 30, tokens: ["devin"], prefixes: ["devin/"] },
  { id: "grok", label: "Grok", order: 40, tokens: ["grok"], prefixes: [] },
  { id: "deepseek", label: "DeepSeek", order: 50, tokens: ["deepseek", "dbrx"], prefixes: [] },
  { id: "qwen", label: "Qwen", order: 60, tokens: ["qwen", "qwq"], prefixes: [] },
  { id: "mimo", label: "MiMo", order: 70, tokens: ["mimo", "mimo-v"], prefixes: [] },
  { id: "gemini", label: "Gemini", order: 80, tokens: ["gemini", "gemma", "palm"], prefixes: [] },
  // 下面这组是真实 WorkBuddy 目录里出现过的厂商（0.1.3 增补）。token 匹配要求
  // 词边界，所以 `hy` 只命中 `hy3` / `hy4-preview` / `hy3-x` 这类短前缀，不命中
  // `hyperbolic-*`（后面还跟着字母）。
  { id: "hunyuan", label: "Hunyuan", order: 90, tokens: ["hunyuan", "hy"], prefixes: [] },
  { id: "glm", label: "GLM", order: 100, tokens: ["glm"], prefixes: [] },
  { id: "kimi", label: "Kimi", order: 110, tokens: ["kimi", "moonshot"], prefixes: [] },
  { id: "minimax", label: "MiniMax", order: 120, tokens: ["minimax", "abab"], prefixes: [] }
];

export const FAMILY_BY_ID = new Map(BUILTIN_FAMILIES.map((family) => [family.id, family]));

/**
 * 单个 token 在模型 ID 中的边界匹配：
 *   - gpt-5 / gpt-oss-120b / openai/gpt-4o / qwen3-max / mimo2 都命中
 *   - gptx / mimox 不命中（避免 includes 式任意子串匹配）
 * 前边界：只排除小写字母；后边界：排除小写字母（允许数字，才能命中 qwen3）。
 */
function matchesToken(lowerId, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^a-z])" + escaped + "([^a-z]|$)").test(lowerId);
}

/** 只保留受限 glob 的 * 与 ?，其余正则元字符全部转义。 */
export function globToRegExpSource(pattern) {
  const text = String(pattern);
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "*") out += ".*";
    else if (char === "?") out += ".";
    else out += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return out;
}

/**
 * 受限 glob 匹配（大小写不敏感）。空 pattern 永远不匹配。
 * @param pattern - 只支持 * 与 ? 的字面模式
 * @param value - 被匹配的模型 ID
 */
export function matchesGlob(pattern, value) {
  if (typeof pattern !== "string" || pattern.length === 0) return false;
  return new RegExp("^" + globToRegExpSource(pattern) + "$", "i").test(String(value));
}

/** 找到 modelId 命中的渠道（按 BUILTIN_FAMILIES 表序）；返回 {family, prefix}，未命中 undefined。 */
function channelMatchOf(modelId) {
  const lower = String(modelId).toLowerCase();
  for (let i = 0; i < BUILTIN_FAMILIES.length; i += 1) {
    const family = BUILTIN_FAMILIES[i];
    for (let p = 0; p < family.prefixes.length; p += 1) {
      if (lower.startsWith(family.prefixes[p])) return { family, prefix: family.prefixes[p] };
    }
  }
  return undefined;
}

/** 明确的渠道前缀命中（首版只内置 `devin/`）；失败返回 undefined。 */
export function channelFamilyOf(modelId) {
  const match = channelMatchOf(modelId);
  return match === undefined ? undefined : match.family;
}

/**
 * 内置家族判定；失败返回 undefined（交给 fallback）。
 *
 * `mode` 决定「渠道前缀」与「模型家族」谁优先（开发计划 §5.2 / §5.3）：
 *   - `"channel-first"`（默认）：`devin/gpt-5-4` → Devin（渠道优先）
 *   - `"family-first"`：`devin/claude-sonnet-4-6` → Claude（家族优先，渠道只作为标签）
 * 渠道前缀永远不会**被当成「第一个 `/` 前面的字符串」推断，只认同内置的明确前缀。
 *
 * family-first 有一个 0.1.5 修掉的坑：直接对全 ID 跑 token 匹配时，`devin/grok-4`
 * 里的 `grok` 确实能被词边界命中，但表序在前的 `devin` token 也命中整个 ID，
 * 于是分类结果取决于渠道家族在表里排得靠不靠前。正确做法是先剥掉已识别的
 * 渠道前缀，只对**剩余的模型部分**做家族判定；渠道身份留在 channelId 里。
 */
export function builtinFamilyOf(modelId, options) {
  const opts = options === undefined || options === null ? {} : options;
  const mode = opts.mode === "family-first" ? "family-first" : "channel-first";
  const lower = String(modelId).toLowerCase();
  const match = channelMatchOf(lower);
  if (mode !== "family-first") {
    if (match !== undefined) return match.family;
  } else if (match !== undefined) {
    // family-first：剥渠道前缀后对模型部分分类；剩余部分认不出家族时才归渠道家族。
    const rest = lower.slice(match.prefix.length);
    for (let i = 0; i < BUILTIN_FAMILIES.length; i += 1) {
      const family = BUILTIN_FAMILIES[i];
      if (family === match.family) continue;
      for (let t = 0; t < family.tokens.length; t += 1) {
        if (matchesToken(rest, family.tokens[t])) return family;
      }
    }
    return match.family;
  }
  for (let i = 0; i < BUILTIN_FAMILIES.length; i += 1) {
    const family = BUILTIN_FAMILIES[i];
    for (let t = 0; t < family.tokens.length; t += 1) if (matchesToken(lower, family.tokens[t])) return family;
  }
  return undefined;
}

/** 把渠道标签附到分类结果上（渠道只影响标签，不改变身份）。 */
function withChannel(result, channel) {
  if (channel === undefined || channel === null) return result;
  result.channelId = channel.id;
  result.channelLabel = channel.label;
  return result;
}

/**
 * 完整分类。
 * @param input.ref - { providerId, modelId }
 * @param input.originalName - 宿主公布的显示名（仅用于展示，不参与身份）
 * @param input.overrides - [{ providerId, modelId, groupId?, label? }]，精确覆盖
 * @param input.rules - [{ pattern, familyId }]，受限 glob 规则
 * @param input.mode - "channel-first"（默认）| "family-first"，只影响渠道前缀与家族谁优先
 * @returns {{familyId, label, order, source, channelId?, channelLabel?, alias?}}
 */
export function classifyModel(input) {
  const source = input === null || input === undefined ? {} : input;
  const ref = source.ref;
  const overrides = Array.isArray(source.overrides) ? source.overrides : [];
  const rules = Array.isArray(source.rules) ? source.rules : [];
  const mode = source.mode === "family-first" ? "family-first" : "channel-first";
  const channel = ref === null || ref === undefined ? undefined : channelFamilyOf(ref.modelId);

  for (let i = 0; i < overrides.length; i += 1) {
    const override = overrides[i];
    if (override === null || typeof override !== "object") continue;
    if (override.providerId !== ref.providerId || override.modelId !== ref.modelId) continue;
    const hasGroup = typeof override.groupId === "string" && override.groupId.length > 0;
    const alias = typeof override.label === "string" && override.label.length > 0 ? override.label : undefined;
    if (!hasGroup && alias === undefined) continue;
    if (!hasGroup) {
      // 只有别名：家族仍走内置判定，只替换展示名
      const builtin = builtinFamilyOf(ref.modelId, { mode });
      return withChannel({
        familyId: builtin?.id ?? FALLBACK_FAMILY_ID,
        label: builtin?.label ?? FALLBACK_FAMILY_LABEL,
        order: builtin?.order ?? FALLBACK_FAMILY_ORDER,
        alias,
        source: "override"
      }, channel);
    }
    const known = FAMILY_BY_ID.get(override.groupId);
    return withChannel({
      familyId: override.groupId,
      label: alias ?? known?.label ?? override.groupId,
      order: known?.order ?? 500,
      alias,
      source: "override"
    }, channel);
  }

  for (let r = 0; r < rules.length; r += 1) {
    const rule = rules[r];
    if (rule === null || typeof rule !== "object") continue;
    if (typeof rule.familyId !== "string" || rule.familyId.length === 0) continue;
    if (!matchesGlob(rule.pattern, ref.modelId)) continue;
    const known = FAMILY_BY_ID.get(rule.familyId);
    return withChannel({
      familyId: rule.familyId,
      label: known?.label ?? rule.familyId,
      order: known?.order ?? 500,
      source: "rule"
    }, channel);
  }

  const builtin = builtinFamilyOf(ref.modelId, { mode });
  if (builtin !== undefined) {
    return withChannel({ familyId: builtin.id, label: builtin.label, order: builtin.order, source: "builtin" }, channel);
  }

  return withChannel({
    familyId: FALLBACK_FAMILY_ID,
    label: FALLBACK_FAMILY_LABEL,
    order: FALLBACK_FAMILY_ORDER,
    source: "fallback"
  }, channel);
}
