# 接入与兼容性

核对日期：2026-11-05。插件 0.4.0；宿主 DeepSeek Harness Desktop 0.2.0-rc.2（实机验收）、0.2.1-rc.1 / rc.2（按已安装宿主源码适配，`verify-host` 通过）与 0.2.1-rc.5（维护者实机试用，`verify-host` 尚未重跑）。

## 模型入口

宿主声明 `conversation.input.model` 为 `single/session` 槽位，按 priority 从小到大选举一个存活条目。同一 priority 的重复注册会被拒绝。

| 入口 | priority | 生效关系 |
| --- | ---: | --- |
| Model Navigator | -20 | 增强启用时替换下方所有模型入口 |
| Codex Subscription | -10 | 关闭增强后恢复；其目录、订阅与配额服务继续运行 |
| 官方 ModelSelect | 0 | 无 Codex 入口时，关闭、卸载或增强入口崩溃后恢复 |

导航器不再向 `conversation.input.right` 增加第二个按钮。偏好关闭时销毁注册；仅返回空组件无法交还槽位，因此不用于开关回退。注册冲突会记录错误，保留宿主其余入口。

## 状态与提交

官方 `modelDirectories.directoryFor(sessionId)` 提供目录、加载和提交方法。导航器复用其 store，订阅 `current/groups/status/pending/error`。标签取宿主当前模型，加载尚未提供 current 时显示加载状态，不把目录第一个模型显示为当前模型。

宿主按 `sessions.binding(sessionId)` 的对象身份管理目录。导航器使用 WeakMap 对绑定缓存 face，同名会话的新绑定不会继承旧目录。缺少 binding 能力的测试或旧宿主只能降级为按 ID 缓存；该降级没有真实宿主兼容承诺。

提交完整模型选择，默认档位省略 reasoningEffort。owner 的 locked 状态传递到触发器和提交回调；同步引用拦截重渲染前的重复点击。连接换代与组件卸载后，迟到的提交结果不会记录成功或关闭新菜单。

## 生命周期

样式标记 `data-plugin=dsh-model-navigator`，跟随 Cordis effect 清理。槽位注入的生命周期管理注册与偏好订阅。浮层优先使用 `react-dom.createPortal(document.body)`，不可用时内联回退。

`inject` 声明 slots、sessions、modelDirectories、locale、remote 和 remote.session；可选的 cordisInspect 通过 ctx.get 读取。宿主没有插件设置作用域服务，偏好保存在 localStorage，不可用时退到仅本次运行有效的内存存储。官方模型插件必须保持启用，因为它提供共享目录服务。

## 验证边界

174 项离线测试覆盖打包产物交互；`tools/verify-host.mjs` 执行本机实际的 Cordis、SlotCore、ModelDirectory 与 ModelDirectoryResolver，覆盖首次创建目录的依赖门禁、会话绑定重建、单入口、开关、Codex 入口先后注册冲突、共享投影、崩溃回退与卸载；对 0.2.1 还断言刷新保留 groups、选择失败的 error 字符串与 failures 透传，以及模型标签子槽位的读取。0.2.1 不再在 node_modules 中附带 `dsh-client-ui-slots`，需另行传入同版本 npm 包目录作为第二个参数。该验证模拟 store 通知与 RPC，不能代替桌面点击和真实后端验收。

浅色主题、超大目录性能、输入法组合输入和所有供应商的真实调用尚未全部验收；不以单测通过宣称“全面领先”。

## 0.2.1 消失回归

Codex Subscription 对所有根会话注册 priority -10 的模型入口，非仅 Codex 模型。0.2.0 的 -5 无法替换它；0.2.1 改为 -20，真实 SlotCore 验证两种加载顺序，关闭、崩溃退位和卸载均恢复 -10 入口。现场探针增加 seat.priority/enabled/registered/error；registered 表示注册已完成，不等同于组件已渲染。

## 0.3.0 快捷子菜单（0.4.0 已移除）

0.4.0 起收藏与最近使用改为模型页内的分组，以下浮层子菜单不再存在。

收藏夹与最近使用为独立的固定定位浮层，优先放在主菜单右侧，空间不足时向左避让并限制视口尺寸。与主菜单共同 portal 到 body；外部点击检测包含两个浮层。进入子菜单会取消 200ms 的离开关闭计时，Esc/左方向键只关闭子菜单并回到入口，右方向键可打开并聚焦第一项。偏好存储状态只在设置页显示。

与官方 ModelSelect 一致，目录超过 4 个模型时才显示搜索框。打开菜单或切换面板后，焦点进入搜索框，没有搜索框时进入第一项。方向键只在行之间移动，星标按钮用 Tab 到达。第一项按 ↑ 回到搜索框，根层按 Esc 关闭后焦点回到触发器。

## 0.3.1 首次创建目录回归

官方目录服务在创建尚未缓存的会话目录时，间接以调用者上下文读取 `remote.session`。0.3.0 未声明这项依赖，别的选择器预先创建目录时会掩盖缺陷。删除 Codex Subscription 和 WorkBuddy 后，导航器成为第一个目录使用者，入口因此无法解析。0.3.1 声明完整依赖，独立启动不再依赖其他插件的缓存。集成测试将服务提供者与消费者置于真实 Cordis 的不同 fiber，以保留实际依赖检查。

## 0.3.3 宿主 0.2.1-rc.1 适配

0.2.1 的 ModelDirectory 快照为 `{ current, routable, groups, failures, status, pending, error, retainedEffort? }`，目录由全局 ModelCatalogDirectory 共享，并在 `llm/adapters-updated`、`settings/document-updated`、`credentials/*-updated` 时后台刷新，`connection/reset` 时换代清空。

| 宿主行为 | 导航器处理 |
| --- | --- |
| 刷新期间 `status=loading` 且保留 groups 与 current | 视为可用目录，照常可选；状态行显示「正在刷新模型列表…」 |
| 刷新失败 `status=error` 且保留 groups | 照常可选，同时显示目录错误与重试 |
| `failures` 列出加载失败的供应商 | 不可选的警告行与重试；0.4.0 起收进模型页底部默认折叠的「不可用」分组 |
| `routable` 表示 current 是否在目录中 | 显式 `false` 时以宿主为准标注「不在目录中」 |
| `select` 失败时目录整体 `status=error`、`error="code: message"`，并返回 `{ ok:false, error }` | 记录本次选择的错误串，与 store 中一致时不显示目录加载失败；选项保持可用；`load()` 会清除该状态 |

`conversation.input.model.label` 是 0.2.1 新增的子槽位，由官方入口注册时在 children 中声明。SlotCore 拒绝重复声明同名子槽位，`renderSlot` 也只允许渲染本条目声明的子槽位（否则抛 `SlotOwnershipError`），因此替换入口无法通过 `renderSlot` 渲染它。官方入口即使被遮蔽仍保持注册，子槽位依旧存在，其他插件注册不会失败。0.3.3 在导航器生效时不显示这些标签；0.4.0 起改为自行渲染，见下节。

## 0.4.0 两级结构与模型标签

界面与官方 ModelSelect 同构：根层为「模型 / 思维强度」两个 cell，模型页依次为搜索、收藏、最近使用、供应商与家族分组（供应商与家族均可折叠，默认只展开当前选择所在的那一个），思维强度页列出档位。目录就绪后仍找不到的收藏/最近使用与加载失败的供应商集中在模型页底部的「不可用」分组，默认折叠，只显示数量；目录加载中无法判断是否失效，相应条目留在原位。浮层右对齐触发器，位于其上方 8px，四周保留 12px。

分区标题由插件自己渲染，不使用官方 `MenuGroup`：它的吸顶标签在半透明菜单上会让滚动中的行透出来，样式也不受插件控制。`MenuSurface`、`Toast` 和图标仍来自官方。

标签子槽位的处理：导航器不声明 children，而是用 `ctx.slots` 的 SlotCore 读接口（`entriesOfSlot / subscribe / getVersion`）取该槽位的胜出项，再按官方渲染器的 props 顺序渲染：

1. `entry.inject(sessionId)` 的结果，去掉 `hooks / keyedHooks`；
2. owner props：`provider { id, name }`、宿主原始 `model`、`placement`（`trigger / menu / option`）、`selected`、`sessionId`；
3. `t = locale.bind(entry.locale)`。

外层仍是官方同形的 `<span data-provider-id data-model-id>`，只靠 CSS 属性选择器定制的标签插件同样生效。宿主专有的 hooks 源无法复刻；依赖它的标签组件会被错误边界接住，退回纯文本模型名，并记入 `window.__DSMN_DIAG__.label`。如果宿主的 `ctx.slots` 不提供这组读接口，`label.api` 为 `false`，界面显示纯文本。
