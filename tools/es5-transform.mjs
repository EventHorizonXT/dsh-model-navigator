/**
 * 把 src/core/*.mjs 的语法子集转成 ES5，供 lib/client.js 内联使用。
 *
 * 刻意「窄而响」：只支持本仓库实际写出的写法，遇到不认识的现代语法直接抛错，
 * 绝不允许静默产出坏代码。tests/es5-transform.test.mjs 会把生成结果真的求值一遍，
 * 并与 src/core 的 ESM 版本逐函数对拍，因此两份实现不会漂移。
 *
 * 关键正确性约束：所有 token 下标都相对**同一个** comment-stripped 源码，
 * 因此这里只调用一次 stripComments，之后一律用 `raw` 做括号配对与切片。
 */

const FORBIDDEN = [
  [/\bclass\s+\w/, "class 声明"],
  [/\basync\s+function|\bawait\s/, "async/await"],
  [/\bfor\s*\([^)]*\bof\b/, "for...of"],
  [/\b(?:const|let)\s+[\[{]/, "数组/对象解构"],
  [/\byield\s/, "generator"],
  [/\bnew\s+class\b/, "class 表达式"]
];

const REGEX_PRECEDING = /[=(,:[!&|?{};+\-*%~^<>]/;

/** source[i] 是否开启一个字面量正则（而不是除号）。 */
function opensRegex(source, i) {
  let at = i - 1;
  while (at >= 0 && /\s/.test(source[at])) at -= 1;
  if (at < 0) return true;
  return REGEX_PRECEDING.test(source[at]);
}

/** 跳过 source[i] 处的字符串/模板串/正则字面量，返回其后第一个下标。 */
function skipLiteral(source, i) {
  const char = source[i];
  if (char === "\"" || char === "'" || char === "\u0060") {
    let at = i + 1;
    while (at < source.length && source[at] !== char) {
      if (source[at] === "\\") at += 1;
      at += 1;
    }
    return at + 1;
  }
  if (char === "/") {
    let at = i + 1;
    let closed = false;
    while (at < source.length) {
      const probe = source[at];
      if (probe === "\\") {
        at += 2;
        continue;
      }
      if (probe === "[") {
        at += 1;
        while (at < source.length && source[at] !== "]") {
          if (source[at] === "\\") at += 1;
          at += 1;
        }
        at += 1;
        continue;
      }
      if (probe === "/") {
        closed = true;
        at += 1;
        break;
      }
      if (probe === "\n") break;
      at += 1;
    }
    if (!closed) return i + 1;
    while (at < source.length && /[a-z]/.test(source[at])) at += 1;
    return at;
  }
  return i + 1;
}

/** 是否是字面量（字符串/模板串/正则）的起始位置。 */
function isLiteralStart(source, i) {
  const char = source[i];
  if (char === "\"" || char === "'" || char === "\u0060") return true;
  return char === "/" && source[i + 1] !== "/" && source[i + 1] !== "*" && opensRegex(source, i);
}

/** 剥掉注释，用等长空白替换，保证所有下标与原文件一致。 */
function stripComments(source) {
  const out = [];
  let i = 0;
  while (i < source.length) {
    if (isLiteralStart(source, i)) {
      const next = skipLiteral(source, i);
      out.push(source.slice(i, next));
      i = next;
      continue;
    }
    if (source[i] === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const closing = end < 0 ? source.length : end + 2;
      out.push(source.slice(i, closing).replace(/[^\n]/g, " "));
      i = closing;
      continue;
    }
    if (source[i] === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      const closing = end < 0 ? source.length : end;
      out.push(source.slice(i, closing).replace(/[^\n]/g, " "));
      i = closing;
      continue;
    }
    out.push(source[i]);
    i += 1;
  }
  return out.join("");
}

/**
 * 从 openAt 起按字面量级配对扫描，返回：
 *   { kind: "string"|"template"|"regex", end, value }  —— openAt 处在字面量里
 *   { kind: "bracket", end }                            —— openAt 是括号，end 为配对闭合符下标
 *   { kind: "spread", end }                             —— openAt 处是 `...`，end 为省略号之后
 *   { kind: "atom", end }                               —— 普通原子，end 为其结束下标
 * 括号/逗号/分号只在 depth 为 0 时才是结构符号。
 */
function scanSpan(source, openAt) {
  if (isLiteralStart(source, openAt)) {
    const end = skipLiteral(source, openAt);
    return { kind: source[openAt] === "/" ? "regex" : source[openAt] === "\u0060" ? "template" : "string", end, value: source.slice(openAt, end) };
  }
  if (source.startsWith("...", openAt)) return { kind: "spread", end: openAt + 3 };
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const closer = pairs[source[openAt]];
  if (closer !== undefined) {
    let depth = 0;
    let at = openAt;
    while (at < source.length) {
      if (isLiteralStart(source, at)) {
        at = skipLiteral(source, at);
        continue;
      }
      const char = source[at];
      if (char === "(" || char === "[" || char === "{") {
        depth += 1;
      } else if (char === ")" || char === "]" || char === "}") {
        depth -= 1;
        if (depth === 0) {
          if (char !== closer) throw new Error("mismatched bracket while scanning");
          return { kind: "bracket", end: at };
        }
        if (depth < 0) throw new Error("unbalanced bracket while scanning");
      }
      at += 1;
    }
    throw new Error("unbalanced bracket while scanning");
  }
  if (source[openAt] === "," || source[openAt] === ";" || source[openAt] === ")") return { kind: "stop", end: openAt };
  let at = openAt;
  let depth = 0;
  while (at < source.length) {
    if (isLiteralStart(source, at)) {
      at = skipLiteral(source, at);
      continue;
    }
    const char = source[at];
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") {
      if (depth === 0) break;
      depth -= 1;
    } else if (depth === 0 && (char === "," || char === ";")) break;
    at += 1;
  }
  return { kind: "atom", end: at };
}

/** 从 openAt 处的括号扫描到配对闭合符，返回闭合符下标。 */
function matchBracket(source, openAt) {
  const span = scanSpan(source, openAt);
  if (span.kind !== "bracket") throw new Error("matchBracket called on a non-bracket character");
  return span.end;
}

/**
 * 按顶层逗号切分 `opener..closer` 内部的内容，返回片段列表（含起止下标）。
 * 结构符号只在 depth 为 0 时生效。
 */
function splitTopLevel(source, from, to) {
  const parts = [];
  let at = from;
  let start = from;
  let depth = 0;
  while (at < to) {
    if (isLiteralStart(source, at)) {
      at = skipLiteral(source, at);
      continue;
    }
    const char = source[at];
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push({ start, end: at });
      start = at + 1;
    }
    at += 1;
  }
  parts.push({ start, end: to });
  return parts;
}

/** 把 `{ ...a, k: v }` / `[ ...a, x ]` 改写成 __merge(...) / [].concat(...)。 */
function rewriteSpreads(source) {
  let out = source;
  for (let guard = 0; guard < 500; guard += 1) {
    let cursor = 0;
    let target = -1;
    while (cursor < out.length) {
      if (isLiteralStart(out, cursor)) {
        cursor = skipLiteral(out, cursor);
        continue;
      }
      if (out.startsWith("...", cursor)) {
        let back = cursor - 1;
        while (back >= 0 && /\s/.test(out[back])) back -= 1;
        if (back >= 0 && (out[back] === "{" || out[back] === "[")) {
          target = back;
          break;
        }
      }
      cursor += 1;
    }
    if (target < 0) return out;
    const closer = out[target] === "{" ? "}" : "]";
    const close = matchBracket(out, target);
    const inner = out.slice(target + 1, close);
    const parts = splitTopLevel(out, target + 1, close);
    const spreadExprs = [];
    const plain = [];
    for (let i = 0; i < parts.length; i += 1) {
      const text = out.slice(parts[i].start, parts[i].end).trim();
      if (text.length === 0) continue;
      if (text.startsWith("...")) spreadExprs.push(text.slice(3).trim());
      else plain.push(text);
    }
    if (spreadExprs.length === 0) {
      cursor = close + 1;
      continue;
    }
    const head = out[target] === "{" ? "__merge(" : "[].concat(";
    const tail = out[target] === "{" ? ")" : ")";
    const args = spreadExprs.slice();
    if (out[target] === "{") {
      // 必须始终补一个「普通成员」对象作尾参：__merge(base, extra) 的 extra 不能缺省，
      // 否则 `{ ...a }` 会变成 __merge(a) 并在 Object.keys(undefined) 上抛错。
      args.push(plain.length > 0 ? `{ ${plain.join(", ")} }` : "{}");
    } else if (plain.length > 0) {
      args.push(plain.join(", "));
    }
    const replacement = `${head}${args.join(", ")}${tail}`;
    out = `${out.slice(0, target)}${replacement}${out.slice(close + 1)}`;
    void inner;
  }
  throw new Error("spread rewrite did not converge");
}

/** 把 `a?.b` / `a?.[i]` 改写成显式三元（只处理本仓库写出的链式形态）。 */
function rewriteOptionalChains(source) {
  let out = source;
  for (let guard = 0; guard < 200; guard += 1) {
    const before = out;
    // 三元必须整体加括号：后续 rewriteNullish 的 leftOperand/scanRight 按「括号配对」
    // 取操作数，不加括号时 `x ?? (a?.b)` 会把 `a == null ? void 0 : a.b` 拆开吞并，
    // 产出语义错误甚至抛 TypeError 的代码（0.1.5 的 lib/client.js:298 缺陷）。
    // 目标侧允许一个已加括号的分组，这样嵌套链 `a?.b?.c` 在上一轮加括号后仍能继续改写。
    out = out.replace(
      /(\([^()]*\)|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\[\]]+\])*)\?\.([A-Za-z_$][\w$]*)/,
      (match, target, member) => `(${target} == null ? void 0 : ${target}.${member})`
    );
    out = out.replace(
      /(\([^()]*\)|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\[\]]+\])*)\?\.\[([^\[\]]+)\]/,
      (match, target, index) => `(${target} == null ? void 0 : ${target}[${index}])`
    );
    if (out === before) break;
  }
  return out;
}

/**
 * 把 `a ?? b` 改写成显式三元（`a != null ? a : b`）。
 *
 * 不能只用正则匹配括号内的 `??`：本仓库会写出 `a?.b?.[0] ?? (a ?? b)` 这类位于
 * 表达式/函数实参位置的形态。这里按「成员表达式 + 首元表达式」做最小解析，
 * 以避免吞掉相邻的 `? :`（它同样以 `?` 开头），并在原位置就地替换。
 */
/** 与 `raw[closeAt]` 处的 `)`/`]`/`}` 反向配对的开启括号下标；找不到返回 -1。 */
function matchBracketBackward(source, closeAt) {
  const close = source[closeAt];
  if (close !== ")" && close !== "]" && close !== "}") return -1;
  const open = close === ")" ? "(" : close === "]" ? "[" : "{";
  let depth = 0;
  for (let at = closeAt; at >= 0; at -= 1) {
    if (source[at] === close) depth += 1;
    else if (source[at] === open) {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
}

function rewriteNullish(source) {
  const scanPrimary = (text, at) => {
    const startAt = at;
    let cursor = at;
    const char = text[cursor];
    if (char === undefined) return undefined;
    if (char === "(" || char === "[") {
      const close = matchBracket(text, cursor);
      if (close < 0) return undefined;
      cursor = close + 1;
    } else if (char === '"' || char === "'" || char === "`") {
      const end = skipLiteral(text, cursor);
      if (end < 0) return undefined;
      cursor = end;
    } else if (/[A-Za-z_$]/.test(char)) {
      while (cursor < text.length && /[A-Za-z0-9_$]/.test(text[cursor])) cursor += 1;
    } else if (/[0-9]/.test(char)) {
      while (cursor < text.length && /[0-9A-Za-z_.]/.test(text[cursor])) cursor += 1;
    } else return undefined;
    if (cursor <= startAt) return undefined;
    return cursor;
  };

  /** 从 at 起吃一条成员链（`a.b[0]` / `f(x)`），返回结束下标。 */
  const scanPostfix = (text, at) => {
    let cursor = scanPrimary(text, at);
    if (cursor === undefined) return undefined;
    for (;;) {
      const char = text[cursor];
      if (char === "." && /[A-Za-z_$]/.test(text[cursor + 1] || "")) {
        const next = scanPrimary(text, cursor + 1);
        if (next === undefined) return cursor;
        cursor = next;
      } else if (char === "(" || char === "[") {
        const close = matchBracket(text, cursor);
        if (close < 0) return cursor;
        cursor = close + 1;
      } else return cursor;
    }
  };

  /**
   * 吃掉「左操作数」：左侧全部合法内容必须正好在 at 结束。
   * 从最近一个表达式边界开始逐项右推，可以正确处理 `a.b ?? c` 与 `a ?? b ?? 0`。
   */
  /**
   * 找出紧贴在 `??` 左边的左操作数区间。
   *
   * 主页路径是「反向吃成员链/调用」：`a.b`、`f(x)[0]`、`(a == null ? void 0 : a.b)`
   * 都能整体回退到起点。没有合法形态时返回 undefined，调用方保持源码不变。
   */
  const leftOperand = (text, at) => {
    let end = at;
    while (end > 0 && /\s/.test(text[end - 1])) end -= 1;
    if (end <= 0) return undefined;
    const tail = text[end - 1];
    if (!/[A-Za-z0-9_$)\]}]/.test(tail)) return undefined;
    let head = end;
    const idChar = (char) => /[A-Za-z0-9_$]/.test(char);
    for (;;) {
      if (/[)\]}]/.test(text[head - 1])) {
        const open = matchBracketBackward(text, head - 1);
        if (open < 0) return undefined;
        head = open;
      } else if (idChar(text[head - 1])) {
        while (head > 0 && idChar(text[head - 1])) head -= 1;
      } else {
        return undefined;
      }
      if (head > 0 && text[head - 1] === ".") head -= 1;
      else break;
    }
    return { start: head, end };
  };

  const scanRight = (text, at) => {
    let span = scanPostfix(text, at);
    if (span === undefined) return undefined;
    let cursor = span;
    for (;;) {
      const chained = scanPostfix(text, cursor);
      if (chained !== undefined) cursor = chained;
      let far = cursor;
      while (far < text.length && /\s/.test(text[far])) far += 1;
      if (far >= text.length) return cursor;
      const char = text[far];
      if (text.startsWith("=>", far)) return cursor;
      if (!/[+\-*/%&|^<>!=:]/.test(char) && char !== "?") return cursor;
      far += 1;
      while (far < text.length && /\s/.test(text[far])) far += 1;
      const next = scanPostfix(text, far);
      if (next === undefined) return cursor;
      cursor = next;
    }
  };

  let out = "";
  let cursor = 0;
  while (cursor < source.length) {
    if (source.startsWith("??", cursor)) {
      const left = leftOperand(out, out.length);
      if (left !== undefined) {
        let after = cursor + 2;
        while (after < source.length && /\s/.test(source[after])) after += 1;
        const rightEnd = scanRight(source, after);
        if (rightEnd !== undefined) {
          const leftText = out.slice(left.start, left.end);
          const right = source.slice(after, rightEnd);
          out = out.slice(0, left.start) + `(${leftText} != null ? ${leftText} : ${right})`;
          cursor = rightEnd;
          continue;
        }
      }
      out += "??";
      cursor += 2;
      continue;
    }
    out += source[cursor];
    cursor += 1;
  }
  return out;
}


/** 默认参数 -> 函数体开头的 `if (x === void 0) x = ...;`。 */
function rewriteDefaultParams(source) {
  return source.replace(/(function\s+[A-Za-z_$][\w$]*\s*\()([^)]*)\)\s*\{/g, (match, head, params) => {
    const plain = [];
    const defaults = [];
    const parts = params.split(",").map((value) => value.trim()).filter(Boolean);
    for (let i = 0; i < parts.length; i += 1) {
      const at = parts[i].indexOf("=");
      if (at < 0) {
        plain.push(parts[i]);
        continue;
      }
      const name = parts[i].slice(0, at).trim();
      defaults.push(`if (${name} === void 0) ${name} = ${parts[i].slice(at + 1).trim()};`);
      plain.push(name);
    }
    return `${head}${plain.join(", ")}) ${defaults.length > 0 ? `{ ${defaults.join(" ")}` : "{"}`;
  });
}

/**
 * 箭头函数 -> function，就地线性扫描实现（要求 raw 中没有 `=>` 的字符串字面量）。
 *
 * **下标契约**：`out` 始终等于 `raw.slice(0, cursor)` 再叠加已完成的替换，
 * 因此所有回溯用的下标都直接取自 `raw`。绝不能用 `String.replace` 在这里
 * 改变字符串长度（否则后续下标整体漂移——这是本项目踩过的坑）。
 */
function rewriteArrows(raw) {
  const tokens = tokenize(raw);
  let out = "";
  let cursor = 0;
  let ti = 0;
  // out 末尾在 raw 中的镜像位置：out.length === outLenAtCursor + (cursor - cursor)。
  // 箭头改写的替换文本长度与原始 `(params) =>` 不同，因此不能拿 raw 下标直接切 out。
  let outLenAtCursor = 0;

  while (cursor < raw.length) {
    while (ti < tokens.length && tokens[ti].end <= cursor) ti += 1;
    const token = ti < tokens.length ? tokens[ti] : undefined;

    if (token !== undefined && token.type === "=>" && token.start === cursor) {
      const prev = previousToken(tokens, ti);
      let cut = -1;
      let params;
      if (prev !== undefined && prev.type === ")") {
        const open = matchingOpenParen(raw, prev.start);
        if (open >= 0) {
          cut = open;
          params = raw.slice(open + 1, prev.start);
        }
      } else if (prev !== undefined && prev.type === "id") {
        cut = prev.start;
        params = raw.slice(prev.start, prev.end);
      }
      if (cut < 0) throw new Error(`unsupported arrow function head: ${raw.slice(Math.max(0, cursor - 40), cursor + 10)}`);
      const cutInOut = outLenAtCursor + (cut - cursor);
      if (cutInOut < 0) throw new Error(`arrow rewrite lost track of its output offset near: ${raw.slice(Math.max(0, cursor - 40), cursor + 10)}`);
      // 箭头可以出现在任何「表达式」位置，而 function 声明式要求函数名，
      // 因此整体包一层括号，产出函数表达式：`(function (params) BODY)`。
      // 注意 JS 的函数体必须由 `{` 开始，`x => expr` 必须补 `return`。
      const head = `(function (${params.trim()})`;
      let bodyAt = token.end;
      while (bodyAt < raw.length && /\s/.test(raw[bodyAt])) bodyAt += 1;
      if (raw[bodyAt] === "{") {
        const bodyEnd = matchBracket(raw, bodyAt);
        if (bodyEnd < 0) throw new Error(`unbalanced arrow body near: ${raw.slice(bodyAt, bodyAt + 40)}`);
        out = out.slice(0, cutInOut) + head + " " + raw.slice(bodyAt, bodyEnd + 1) + ")";
        cursor = bodyEnd + 1;
      } else {
        const bodyEnd = expressionEnd(raw, bodyAt);
        let body = raw.slice(bodyAt, bodyEnd).trim();
        // `({ ... })` / `(a + b)` 这类分组表达式去掉最外层括号，避免 `return (( ... ))`。
        if (body.charAt(0) === "(" && matchBracket(body, 0) === body.length - 1) body = body.slice(1, -1).trim();
        if (body.charAt(0) === "{") body = "(" + body + ")";
        out = out.slice(0, cutInOut) + head + " { return " + body + "; })";
        cursor = bodyEnd;
      }
      outLenAtCursor = out.length;
      continue;
    }

    out += raw[cursor];
    cursor += 1;
    outLenAtCursor = out.length;
  }
  return out;
}

/**
 * 返回与 raw[closeAt] 这个 `)` 配对的 `(` 下标，并且只认「箭头参数表」的形态。
 *
 * 纯 `(`/`)` 计数无法区分 `map((x) => …)` 的外层与内层括号（两者深度相同），
 * 因此额外要求：配对到的 `(` 前面不能是标识符/`.`/`]` —— 那些都是函数调用，
 * 例如 `a.map((x) => x)` 真正要替换的是内层 `(x)`。
 */
function matchingOpenParen(raw, closeAt) {
  let depth = 0;
  for (let at = closeAt; at >= 0; at -= 1) {
    const char = raw[at];
    if (char === ")") depth += 1;
    else if (char === "(") {
      depth -= 1;
      if (depth === 0) {
        const before = at > 0 ? raw[at - 1] : "";
        if (/[A-Za-z0-9_$.\]]/.test(before)) return -1;
        return at;
      }
    }
  }
  return -1;
}


/**
 * 找出从 raw[from] 开始的箭头函数体的结束下标（不含）。
 *
 * - `{ ... }` / `( ... )` / `[ ... ]` 走括号配对；
 * - 其余按裸表达式推进，遇到顶层出现、且不属于表达式语法一部分的 `)` `]` `}` `,` `;`
 *   或行尾结束。字符串/模板串/正则整体跳过，避免误判其中的标点。
 */
function expressionEnd(raw, from) {
  const open = raw[from];
  if (open === "{" || open === "(" || open === "[") {
    const close = matchBracket(raw, from);
    if (close < 0) throw new Error(`unbalanced expression near: ${raw.slice(from, from + 40)}`);
    return close + 1;
  }
  let at = from;
  while (at < raw.length) {
    const char = raw[at];
    if (char === '"' || char === "'" || char === "`" || (char === "/" && opensRegex(raw, at))) {
      const end = skipLiteral(raw, at);
      if (end < 0) break;
      at = end;
      continue;
    }
    if (char === "{" || char === "(" || char === "[") {
      const close = matchBracket(raw, at);
      if (close < 0) break;
      at = close + 1;
      continue;
    }
    if (char === ")" || char === "]" || char === "}" || char === "," || char === ";") break;
    if (char === "\n") {
      // 行尾表达式：仅在括号深度为 0 时结束（上面已确保 inside 括号被整体跳过）。
      break;
    }
    at += 1;
  }
  return at;
}

/** 返回 tokens 中 at 之前最近的非空白 token。 */
function previousToken(tokens, at) {
  for (let i = at - 1; i >= 0; i -= 1) {
    if (!/^\s+$/.test(tokens[i].type)) return tokens[i];
  }
  return undefined;
}


/** i 处的字符是否是空白。 */
function isWhitespace(source, i) {
  return /\s/.test(source[i]);
}


/** 把源码切成 token 列表（注释已剥离；字符串/模板串/正则整体成 token）。 */
function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    if (isLiteralStart(source, i)) {
      const start = i;
      const end = skipLiteral(source, i);
      const type = source[start] === "/" ? "regex" : source[start] === "\u0060" ? "template" : "string";
      tokens.push({ type, start, end });
      i = end;
      continue;
    }
    const char = source[i];
    if (/[\w$]/.test(char)) {
      const start = i;
      while (i < source.length && /[\w$]/.test(source[i])) i += 1;
      tokens.push({ type: "id", start, end: i });
      continue;
    }
    if (char === "=" && source[i + 1] === ">") {
      tokens.push({ type: "=>", start: i, end: i + 2 });
      i += 2;
      continue;
    }
    tokens.push({ type: char, start: i, end: i + 1 });
    i += 1;
  }
  return tokens;
}

/** 返回第一个 start >= offset 的 token 下标。 */
function skipPast(tokens, offset) {
  let at = 0;
  while (at < tokens.length && tokens[at].start < offset) at += 1;
  return at;
}

/** 把一段 src/core 源码（不含 import）转成同作用域的 ES5 声明。 */
export function toEs5(source, label) {
  const raw = stripComments(source);
  for (const [pattern, name] of FORBIDDEN) {
    if (pattern.test(raw)) throw new Error(`${label} uses unsupported syntax: ${name}`);
  }
  if (/`/.test(raw)) throw new Error(`${label} uses an unsupported template literal`);

  let out = raw.replace(/^export\s+/gm, "");
  // 箭头体是原样切下来的源码片段，嵌套箭头要再来一遍；每遍只减少箭头，必然收敛。
  for (let pass = 0; pass < 10 && out.includes("=>"); pass += 1) out = rewriteArrows(out);
  if (out.includes("=>")) throw new Error(`${label} has arrow functions nested too deeply to rewrite`);
  out = rewriteDefaultParams(out);
  out = rewriteSpreads(out);
  out = rewriteOptionalChains(out);
  out = rewriteNullish(out);

  if (/=>|\?\.|\?\?/.test(out)) {
    throw new Error(`${label} still contains modern syntax after transform:\n${out.slice(0, 400)}`);
  }
  return out;
}

/** 抽取 `export const NAME =` / `export function NAME(` 的绑定名。 */
export function exportedNames(source) {
  const names = [];
  const pattern = /^export\s+(?:const|function|let|var)\s+(\w+)/gm;
  let match = pattern.exec(source);
  while (match !== null) {
    names.push(match[1]);
    match = pattern.exec(source);
  }
  return names;
}
