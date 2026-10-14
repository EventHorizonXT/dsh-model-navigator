# 更新日志 / Changelog

本文件记录 DSH Model Navigator 的版本变化。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.2] — 2026-10-14

### 修复

- 目录中已移除的收藏与最近使用不再被静默过滤，显示模型 ID、不可用状态与移除按钮，计数与可见记录保持一致。临时断线不清空收藏，模型恢复后可重新选择。
- 供应商或模型在菜单打开期间消失时，返回可用目录；空供应商显示明确空态，不再停留在空白模型页或思维强度页。
- 点击和提交时重新检查实时目录与思维强度，防止旧按钮提交已删除的模型或档位；提交途中模型消失时，不写入成功历史，保留菜单供重新选择。
- 当前模型离开目录时保留宿主的真实模型 ID 与档位，提供刷新入口，不再声称模型仍可用。加载中不误报模型消失，完全空目录也可手动刷新。

### 验证

140 项自动测试通过，新增 16 项回归覆盖失效记录、临时加载、恢复、旧按钮、提交期间删除、空目录和清理时的并发选择。实际宿主的槽位、目录与首次目录创建接入验证通过。

## [0.3.1] — 2026-10-14

### 修复

- 补齐 `remote` 和 `remote.session` 服务依赖，修复卸载 Codex Subscription、WorkBuddy 后首次创建模型目录时入口被禁用的问题。
- 导航器独立作为第一个目录使用者时可以正常加载；不依赖其他选择器提前建立的缓存。

### 验证

124 项自动测试通过。新增冷目录回归在旧版本下失败；宿主实际 Cordis 与 ModelDirectoryResolver 复现同一 `remote.session` 依赖错误，修复后冷创建、模型提交与会话绑定重建均通过。桌面已在两个插件均已卸载的环境中验收。

## [0.3.0] — 2026-10-13

### 改进

- 顶部常驻带数量的醒目收藏夹；无收藏时展示添加方法。
- 最近使用改为单行入口，悬停后展开独立子菜单。收藏夹同样支持悬停、点击和键盘。
- 子菜单默认向右展开，窗口边缘自动避让；移动指针进入子菜单不会误关闭。
- 模型菜单移除偏好存储技术信息，设置页继续显示实际存储位置。

### 修复

- 收藏列表不再跨“当前模型”“最近使用”分区去重；当前模型可正常出现在收藏夹。
- 收藏列表移除 8 项上限，保留全部可用收藏并支持滚动。
- 子菜单点击不会被误判为外部点击；模型与思维强度仍使用原有提交流程。

### 验证

122 项自动测试，涵盖收藏入口、当前模型收藏、列表完整性、悬停延迟、外部点击、键盘、视口避让与子菜单切换后的高度。

## [0.2.1] — 2026-10-13

### 修复

- 导航器 priority 改为 -20，修复启用 Codex Subscription 时被其 -10 模型入口遮蔽、只显示原生样式选择器的问题。
- 关闭、卸载或渲染崩溃退位时恢复之前生效的入口；继续复用官方目录，不停用订阅插件。
- 诊断增加槽位 priority、enabled、registered 与 registration error，区分未注册与未渲染。

### 验证

110 项离线测试通过；真实宿主 SlotCore 回归先复现 -5 失败，再验证 -20 对两种加载顺序均获选，关闭、崩溃与卸载可恢复 -10 入口。

## [0.2.0] — 2026-10-13

### 变更

- 注册官方模型单入口槽位，priority -5；关闭增强时注销，恢复原生入口。
- 首层全局搜索、当前模型快捷入口、收藏操作和各供应商最近成功选择。
- 模型行显示供应商及真实 ID，同名搜索结果可区分。

### 修复

- 会话按绑定身份缓存；重新加载同一会话 ID 不再复用旧目录。
- 传递宿主 locked 状态，避免忙碌时错误提交。
- 引用门禁拦截快速重复点击，同步和异步失败均保留菜单。
- 连接换代释放提交状态，忽略旧连接或已卸载组件的迟到结果。
- 恢复成功后停止占位重试；目录加载错误改为显式重试。
- 无宿主 current 时显示加载状态，避免把目录首项误显示为当前模型。
- 宿主顺序模式平铺，避免交错家族中的模型被错误折叠。
- 进入另一模型的思维强度页时，选中状态使用该模型的默认档位。

### 验证

109 项离线测试通过。新增 tools/verify-host.mjs，执行实际宿主的 SlotCore 与 ModelDirectory，验证单入口、共享投影、开关、专用入口优先级、崩溃回退及卸载；store 与 RPC 为模拟边界。

## [0.1.6] — 2026-10-11

**按结构审阅结论修复：两个 P1（占位重试死循环、ES5 转译语义错误）+ 三个 P2（off 重排、家族优先渠道压制、Escape 层级）+ 文档同步。**

### 修复（P1）

- **ComposerEntry 占位重试死循环**（0.1.5 真实页面累计 `renders 27927 / fallbacks 27867`）。
  根因：`resolve()` 只补齐 face 对象本身，而组件收到的 props 是宿主 inject 时拍下的旧快照；
  `setTick` 重放旧 props → 永远渲染占位 → effect 里的 `setTimeout(retry)` 无限循环。
  修复：重试成功后把 face 的最新值写进组件 state（face 本体挂在 `resolve.__dsmn_face` 上），
  渲染取值规则「props 优先、否则 live 回退」——旧 props 快照也能渲染出真正入口。
- **es5-transform 语义错误**：`rewriteOptionalChains` 产出的三元表达式不加括号，
  随后 `rewriteNullish` 的操作符扫描把无括号三元的 `?`/`:` 当普通操作符吞进右操作数，
  产出 `label:(alias != null ? alias : known) == null ? void 0 : …` —— alias 有值时
  `(alias ?? known)==null` 恒为假，语义反转为 `void 0`，运行时抛
  `TypeError: Cannot read properties of undefined (reading 'label')`（lib/client.js:298）。
  修复：可选链替换整体加括号 `(${target} == null ? void 0 : ${target}.${member})`，嵌套链多轮收敛。

### 修复（P2）

- **off 模式不再归并重排**：`familyRows(models, {mode:"off"})` 此前仍按家族归并
  （`[gpt-5, claude-sonnet, gpt-4o]` 被重排成 `[gpt-5, gpt-4o, claude-sonnet]`）。现在 off =
  宿主原顺序逐行保留，家族标题只在每个家族首个成员处插入一次。
- **family-first 不再被渠道前缀压制**：`devin/grok-4`、`devin/deepseek-chat`、`devin/qwen3-max`
  此前全部进 Devin 家族（family-first 分支先看渠道前缀）。现在剥掉已识别渠道前缀后对剩余部分
  做家族分类，认不出才回退渠道家族；channel-first 行为不变，渠道标签保留、提交身份不变。
- **Escape 层级冲突**：0.1.5 及以前 document capture 监听无条件 `setOpen(false)`，
  模型层按 Esc 直接整层关闭而非返回供应商层。现在 capture 监听里 Escape 命中面板/触发器内部时
  不抢先关闭，由菜单内部逐层处理（providers 层关菜单、下层返回上级）。

### 测试

- 新增 `tests/es5-transform.test.mjs`：把 `?.`/`??` 混合表达式的转译产物**真的求值**并与 ESM 语义对拍
  （0.1.5 的 89 条测试全绿恰恰因为 client-surface 只对拍 ESM 版 classifyModel，从不执行产物切片）。
- `client-surface` 新增「重试成功后旧 props 快照也渲染真正入口」回归（复现 0.1.5 死循环入口）；
  `sort` 新增 off 模式交错家族不重排回归；`classify` 新增 family-first 渠道前缀回归。
- 合计 **96 passed / 0 failed**（`client-surface 32`、`classify 14`、`sort 13`、`draft 9`、
  `identity 8`、`preferences 9`、`search 7`、`es5-transform 4`）。

### 文档

- README 安装示例从 0.1.2.tgz 更新为 0.1.6.tgz，测试计数 79 → 96；
  `docs/INSTALL.md` 的预构建包引用同步到 0.1.6；`docs/COMPATIBILITY.md` 更正转译器测试描述
  （0.1.5 的该段描述引用了当时并不存在的 `tests/es5-transform.test.mjs`）。

## [0.1.5] — 2026-10-11

**按用户反馈：模型家族改为默认折叠，只默认展开「当前选择所在的那一族」。**

### 变更

- **家族默认折叠**（用户反馈：「改成默认折叠模型家族，不然一点开还是全展开的，看着繁杂」）。
  此前偏好里没记过就等于展开，于是点开一个多家族供应商就是满屏模型行。现在没记过 = 折叠，
  只有**当前选择所在的那一族**默认展开（与计划 §4.5「默认只展开当前组」一致）；单家族供应商照旧平铺。
- **折叠偏好的语义**：`collapsedFamilies[key]` 现在两个方向都保留——`true` = 用户显式折叠，`false` = 用户显式展开。
  此前 `normalizeCollapse` 只留 `true`，于是「默认折叠 + 用户手动展开」在下次读偏好时会被忘掉、界面又缩回去。
- **core 新增纯助手**（客户端内联的就是同一份实现）：`familyCollapseKey(providerId, familyId)`（NUL 分隔的折叠键）
  与 `familyCollapsed(map, key, isCurrentFamily)`（默认折叠、显式状态优先）。

### 测试

- `preferences` 新增「默认折叠 / 当前家族默认展开 / 显式状态优先 / 非布尔丢弃 / 折叠键格式」；
  `client-surface` 新增「家族默认折叠，只默认展开当前家族」端到端用例，并改写家族折叠回归以匹配新默认。
- 合计 **89 passed / 0 failed**（`client-surface 31`、`classify 13`、`sort 12`、`draft 9`、`identity 8`、`preferences 9`、`search 7`）。

## [0.1.4] — 2026-10-11

**按审阅反馈修复：触发器改为显示宿主公布的当前选择；补回家族折叠；浮层改走 `createPortal`。**

### 修复

- **触发器显示宿主当前选择**（用户截图：我们的药丸显示 `Kimi-K3 · x1.62`，紧邻的原生药丸显示 `DeepSeek-V41-Flash High`）。
  触发器此前显示草稿解析结果：宿主当前模型不在该会话目录里时，草稿会退到目录里第一个可寻址模型，于是药丸显示的是
  「我们会提交什么」而不是「宿主当前是什么」。现在以 `snapshot.current` 的显示名为准；模型不在目录时额外标注
  「当前模型不在本目录中」，无法寻址时显示自己的 ID。`__DSMN_DIAG__.selection` 同时记下 `current` / `trigger` / `resolved`，
  便于区分「我们显示错了」与「别的入口没刷新」。
- **家族折叠回来了**（计划 §4.5）：0.1.3 重写官方样式时把这段丢了，`collapsedFamilies` 不再写入偏好。现在点家族头
  可折叠/展开、`aria-expanded` 同步、折叠状态进偏好（`normalizeCollapse` 只保留 `true`，展开等价于不折叠）。
- **浮层改走 `createPortal` 挂 `document.body`**：面板内联渲染在 `conversation.input.right` 槽里时，祖先的
  `transform/filter/contain` 会让 `position: fixed` 相对该祖先定位（错位或被裁）；取不到 `react-dom` 时退回内联渲染，
  激活与功能不受影响。

### 变更

- **诊断新增 `dom` 段**：`portalAvailable` / `mode`（`portal`/`inline`/`closed`）/ `portalError` /
  `panelAncestorSlot`（面板打开时真实的 DOM 父亲，`body` 才说明没被槽位祖先影响）。浮层走哪条路径不必再靠肉眼猜。
- composer face 的 `t` 改为转发读取：locale effect 会把模块级 `t` 重新绑定成宿主 `locale.bind(NS)` 的结果，
  捕获函数会让这一侧永远停在绑定前的内建词条。
- 清理死代码（搜索命中分支里只被 `void` 掉的 `defaultEffort`）；模板头注释与现状对齐（可选 require + 等价回退、
  `dsmn_` 面板前缀 / `dsmn-` 设置页前缀、激活绝不外抛）。

### 测试

- `node --test tests/*.test.mjs` → **87 passed / 0 failed**（新增：触发器取宿主当前选择、缺 `react-dom` 时的标注与内联回退、
  家族折叠写入偏好与再展开、`createPortal` 与内联两条浮层路径、官方 atoms 复用路径、诊断 `dom` 现场）。
- 修了测试脚手架保真度：迷你 React 的 `useSyncExternalStore` 此前只在首次渲染读快照，于是「写入偏好 → 重新渲染」
  在离线测试里看不到效果（家族折叠、开关这类行为都测不出来）；现在每次渲染重读，与真实 React 一致。

## [0.1.3] — 2026-10-11

**界面改为「照官方 `ui-model-selection` 做一个」：CSS 与面板结构直接取自官方产物。**

### 变更

- **呈现层照抄官方**：把官方 ModelSelect 的样式表（38 条规则，仅把 `cl2Rlq_` 前缀换成 `dsmn_`）原样内联，
  面板改成官方的 `root → model → effort` 三级切换：触发器用官方标记（`IconDataOutlineRegular` + 名称 + 档位 +
  `IconChevronDownOutlineRegular`），供应商用官方 `cell` 行，模型/档位用官方 `option` 行（`optionCopy` /
  `modelName` / `check` + `IconCheckOutlineRegular`）。图标、分组标题、输入框优先经
  `require("@deepseek-ai/dsh-client-ui-primitives")` 使用官方 atoms（平台 seed 模块表里就有它），取不到时退回等价原生元素。
- **供应商标题取宿主的 `group.name`**：此前读不存在的 `group.label`，回退成裸 providerId，再被 CSS 大写化，
  于是界面显示 `WORKBUDDY`；`deepseek-account` 按官方行为走本地化词条（`providerAccount`）。
- **无法识别的模型统一进「其他」**：兜底家族的标签改成稳定哨兵（界面按 `familyId` 本地化为「其他」），
  不再沿用「桶内第一个模型的 ID」——0.1.2 因此出现「hy4-preview 8 个模型」，看起来像把 hy4 当成了供应商。
- **按真实目录补家族**：Hunyuan（`hy3`/`hy4-preview`）、GLM、Kimi（含 `moonshot`）、MiniMax（含 `abab`）；
  `hy` 仍按词边界匹配，不会吞掉 `hyperbolic-*`。只有一个家族的供应商平铺（计划 §5.6）。
- **模型行显示宿主的 `name`**（WorkBuddy 已把计费/促销拼进 name，例如 `Hy4 preview · x0.29 · 夜间免费`），
  完整模型 ID 放在 `title` 里；用户自定义别名时才额外显示真实 ID。
- **诊断通道扩展**：`ModelNavigatorDiag.probe` 现在还会返回 `catalog` 摘要（每个供应商的家族分桶与样本 ID），
  以后这类分类问题可以直接在现场看到，不必靠截图反推。

### 测试

- `node --test tests/*.test.mjs` → **82 passed / 0 failed**（新增：0.1.3 分类回归、官方同款面板的三级流程与取消路径）。

## [0.1.2] — 2026-10-11

**修复：0.1.1 在真实页面仍然看不到入口 —— 这一次不是「启动失败」，而是「渲染成了空」。**

### 修复

- **真正的现场根因：触发器标题读错字段，渲染成空字符串。** 0.1.2 装进真实 profile 后，我们用插件自带的诊断通道
  （见下）取回现场：入口其实**一直在渲染**，只是标题那个 span 是空的——
  `<span class="dsmn-trigger-label"></span>`，只剩小圆点 + 档位 + 箭头，看起来就和「入口不见了」一样。
  原因是标题只读原始目录模型上的 `alias`/`originalName`，而宿主
  `modelDirectories.directoryFor(sessionId).store` 快照里的模型对象就是 `{ id, name, reasoning }`
  （官方 `@deepseek-ai/dsh-client-ui-model-selection` 的两处渲染也都写 `model.name`）。
  现在新增 `modelDisplayName`，按 `alias → name → originalName → displayName → modelName → id` 取第一个非空字符串，
  客户端优先用规范化显示对象（`catalog.modelOf`，能体现别名/分组规则），全空才回退到 `modelId`；`shorten` 同时防 `null`。
- **档位不再空着**：草稿有效但 `effortId` 为 `undefined`（当前选择没有显式 `reasoningEffort`）时，触发器此前
  不显示档位、思维强度列表里一行也不打勾；而宿主公布了 `defaultEffort` 时，第三级里并没有「供应商默认」这一项，
  `undefined` 无从表达。现在这种情形显示宿主的 `defaultEffort`——**只影响显示**，提交时依旧完全不带 `reasoningEffort` 键。
- **解析失败不再静默消失**：`modelDirectories.directoryFor(sessionId)` 抛错时，0.1.1 的入口组件会 `return null`——
  槽位里什么都不渲染、也不抛错，renderer 的 `SlotErrorBoundary` 因此连一条记录都没有，表现为
  「插件已激活、界面上一无所有」。现在入口**永远渲染出可见的东西**：目录不可用时渲染一个可点的占位药丸，
  title/aria 写明原因（`directory-unavailable` / `directory-pending`）与最近一次错误文本；挂载后自动重试一次，
  点击占位也可手动重试，`face.resolve()` 就地补齐目录后随即渲染真正的入口。
- **解析结果不再被永久缓存**：renderer 按 entry×binding 缓存 `inject` 的返回值，所以「第一次解析失败」会被它记一辈子。
  face 改为可重试（`face.resolve()` 幂等），失败不再变成不可恢复的状态。
- **占位必须可点**：占位按钮用 `aria-disabled`（而非 `disabled`）——`disabled` 会吞掉 click，「点击重试」根本不会发生。
- **子会话不占位**：`sessions.subagentAddress(sessionId)` 有地址时（子会话没有模型目录）渲染空，
  与原生模型座位的 `available=false` 语义一致；次数记入 `DIAG.composer.subagentSkips`，不再是无痕的静默。
- **hook 顺序稳定**：占位分支的 hook 调用保持无条件执行（Rules of Hooks），分支只影响 effect 内部行为与返回值。

### 新增

- **只读现场诊断通道**：插件向客户端 `cordisInspect` 注册 provider `ModelNavigatorDiag`（方法 `probe`），
  宿主侧可直接查询、无需用户开 DevTools：
  `cordis_inspect_query(platform:"client", provider:"ModelNavigatorDiag", method:"probe")`。
  返回激活计数（inject/render/解析成功/占位/子会话跳过）、最近错误，以及输入框右下那一排的真实 DOM
  （`.standardControls` 及其子节点、`.dsmn-trigger`/`.dsmn-root` 计数、`style[data-plugin]` 清单、前 40 个 button）。
  `cordisInspect` 故意不写进 `inject`：服务不存在时插件照常激活，只在诊断里记一笔。
- **`window.__DSMN_DIAG__`**：同一份计数与错误也挂在页面上，供用户自己在 DevTools 里自证。

### 测试

- 迷你 React 渲染器改为**按组件实例维护 hook 表**（键 = 组件链）。此前只有一份共享数组、按 index 取 cell，
  于是「给入口加一个带 hook 的包装组件」会让内层 `ModelNavigator` 读到外层的 cell（把 `useState` 的 `[0]`
  当成目录快照），供应商/模型行全部渲染不出来——那是 harness 保真度不足，不是产品缺陷。
- 新增回归用例：解析失败必须渲染可见占位、点击重试后必须渲染真正入口；诊断 provider 的 manifest/schema 形状
  （对齐官方 `EMPTY_INPUT`/`ANY_OUTPUT`）、查询结果只读且可 JSON 过线；`cordisInspect` 缺失时不影响激活；
  子会话渲染空但留痕；宿主目录模型只有 `name` 时触发器标题必须显示它（不是空字符串），
  以及只给 `modelName` 的兼容形态。
- `tools/build-client.mjs`：正式产物 `lib/client.js` **永远不带探针**（发布物里不该出现
  `window.__DSH_MODEL_NAVIGATOR_CORE__`）；`--with-embeds` 只**额外**写测试用探针包，并且**同时刷新正式产物**。
  此前 `--with-embeds` 只写探针包，于是「改完 `src/core/*` 再跑一次 `--with-embeds`」会把正式产物留在旧版本上，
  而测试读的正是 `lib/client.js`——一次真实的误判来源（core 已修好、客户端测试却仍失败）。
- `node --test tests/*.test.mjs` → **79 passed / 0 failed**。

## [0.1.1] — 2026-10-11

**修复：0.1.0 在真实页面激活失败，导致整个 Web 界面起不来。**

### 修复

- **`inject` 声明补齐**：客户端 `ctx` 对属性访问按 `inject` 门禁，未声明的属性名会抛
  `cannot get property "<name>" without inject`。`apply` 里读了未声明的 `ctx.locale`，已加入 `inject`。
- **不再使用 `ctx.styles`**：`0.2.0-rc.2` 的客户端容器没有 `styles` 服务（该符号只属于 dynamic client half 的闭包参数），
  读取它会因未声明而抛错。改为在 `ctx.effect` 里自插 `<style data-plugin="dsh-model-navigator">`，
  清理时移除；`data-plugin` 让宿主的样式记账/HMR 与卸载清理能认领这个标签。
- **激活不再可能拖挂整个 boot**：`apply` 外层增加 try/catch；样式、locale、连接事件、两个槽位注册各自独立护栏，
  任何异常只记 `console.error("[dsh-model-navigator] … failed:", error)` 并降级，绝不外抛
  （客户端启动是「全有或全无」：一个 entry 失败 = 整页起不来）。
- **离线回归防护**：测试用的迷你 ctx 现在**复刻 inject 门禁**（未声明即抛），并新增断言
  「apply 期间访问过的每个属性都在 `inject` ∪ {effect,on,get,provide} 内」「样式标签带 `data-plugin` 且 dispose 后移除」，
  以及一条门禁自检用例。0.1.0 的缺陷形态从此无法在离线测试里静默通过。

### 验证

- `node --test tests/*.test.mjs` → **74 passed / 0 failed**（`client-surface` 19 条）。
- 根因由宿主自带的 `@deepseek-ai/cordis` 本地最小复现确认；平台规则记入 `docs/COMPATIBILITY.md` §5.2，
  缺陷与修复过程记入 `docs/TEST-REPORT.md` §0。

### 注意（升级须知）

0.1.0 触发启动失败后，桌面应用进入了恢复/安全模式：`desktop` profile 的 `dsh.profile.bundles`
被缩减为仅基础 bundle（第三方插件全部停用），`cordis.patch.yml` 被最小化。
升级到 0.1.1 后需要重新启用插件，并（如需要）恢复其他插件的启用状态，见 `docs/INSTALL.md` §9。

## [0.1.0] — 2026-10-11

首个可用版本。目标宿主：**DeepSeek Harness Desktop `0.2.0-rc.2`**（构建提交 `5e9e301dd9dc8923b2762f76dacfc5751f6ca851`）。

### 新增

- 三级模型选择器：**供应商 → 模型（家族分组）→ 思维强度**，作为独立触发器注册在 `conversation.input.right`。
- 模型家族分组：内置 GPT / Claude / Devin / Grok / DeepSeek / Gemini / Qwen / MiMo 家族识别，支持三种分组模式
  （`宿主顺序` / `渠道优先` / `家族优先`）、可折叠家族标题、精确覆盖（override）与受限 glob 规则（rule）。
- 思维强度档位**完全来自宿主公布的 `reasoning.efforts` / `defaultEffort`**，不硬编码任何档位；
  宿主未公布 `defaultEffort` 时提供「供应商默认」，提交时省略 `reasoningEffort` 键。
- 全局搜索：支持完整模型 ID 与显示别名匹配，按真实 `(providerId, modelId)` 去重；空查询回到浏览排序。
- 组内排序：收藏置前 → 名称自然排序（`model-2` 排在 `model-10` 之前）→ 原始名称 → 原始 ID → 原目录位置；
  `宿主顺序` 模式保留官方目录原顺序。
- 设置页一行「模型导航器」（`settings.general.item`，`id: dsh-model-navigator`，`order: 40`）：
  启用/关闭、分组方式、是否显示搜索、当前偏好存储层级。
- 偏好存储三级降级：宿主设置命名空间（若存在 `settingsScope`）→ 浏览器 `localStorage` → 仅本次运行（内存），
  并在设置行如实显示当前层级；不写宿主 `settings.yaml`。
- 原子提交：只在用户确认档位时发出一次 `{provider, model, reasoningEffort?}`；关闭菜单不提交、不回滚。

### 设计约束（刻意不做的事）

- 不注册、不替换、不禁用官方 `/model` 命令与官方搜索。
- 不注册 `conversation.input.model`，因此不遮蔽原生模型按钮，也不与 `dsh-codex-subscription`（priority `-10`）争抢单槽位；
  代价是输入框右侧会有两个模型入口（明确接受的取舍）。
- 不 require 任何 `@deepseek-ai/dsh-client-ui-*` Harness 客户端包；样式只用 `--dsw-alias-*` 主题令牌，类名统一 `dsmn-` 前缀。
- 不改模型调用链路：不碰 API Key、Base URL、供应商协议、模型列表、供应商适配器、提示词、工具定义、审批、沙箱。
- 不按名称猜模型能力/价格，不把 `medium` / `pro` / `flash` 之类后缀解释为思维强度或可比较数值。

### 已知限制

- 输入框右侧同时存在原生模型按钮与本插件触发器。
- 偏好可能降级到 `localStorage` 或仅本次运行（`0.2.0-rc.2` 无公开的插件自有设置命名空间）。
- 分组、别名、收藏、排序都只影响显示，不影响提交的 `providerId` / `modelId` / `reasoningEffort`。
- 视觉与真实交互（主题对比度、输入法、大目录性能）需人工验收，见 `docs/TEST-REPORT.md` 中的「未执行」项。
- 仅承诺 `0.2.0-rc.2`；其他宿主版本行为未验证。

### 验证

- 离线自动化：`node --test tests/*.test.mjs` → **73 passed / 0 failed**
  （身份 8、分类 12、排序 11、搜索 7、草稿 9、偏好 8、打包产物/渲染/提交 18）。
- 安装实测：以本地目录 link 方式装入 desktop profile，`plugin_manager` 报告 `applied` 且已启用。
- 逐条对照计划 §15 测试矩阵的结果记录在 `docs/TEST-REPORT.md`（含未执行项）。
