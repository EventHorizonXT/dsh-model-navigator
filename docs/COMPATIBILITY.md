# 接入与兼容性

核对日期：2026-10-14。插件 0.3.1；宿主 DeepSeek Harness Desktop 0.2.0-rc.2。

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

`inject` 声明 slots、sessions、modelDirectories、locale、remote 和 remote.session；可选 settingsScope、cordisInspect 通过 ctx.get 读取。官方模型插件必须保持启用，因为它提供共享目录服务。

## 验证边界

124 项离线测试覆盖打包产物交互；`tools/verify-host.mjs` 执行本机实际的 Cordis、SlotCore、ModelDirectory 与 ModelDirectoryResolver，覆盖首次创建目录的依赖门禁、会话绑定重建、单入口、开关、Codex 入口先后注册冲突、共享投影、崩溃回退与卸载。该验证模拟 store 通知与 RPC，不能代替桌面点击和真实后端验收。

浅色主题、超大目录性能、输入法组合输入和所有供应商的真实调用尚未全部验收；不以单测通过宣称“全面领先”。

## 0.2.1 消失回归

Codex Subscription 对所有根会话注册 priority -10 的模型入口，非仅 Codex 模型。0.2.0 的 -5 无法替换它；0.2.1 改为 -20，真实 SlotCore 验证两种加载顺序，关闭、崩溃退位和卸载均恢复 -10 入口。现场探针增加 seat.priority/enabled/registered/error；registered 表示注册已完成，不等同于组件已渲染。

## 0.3.0 快捷子菜单

收藏夹与最近使用为独立的固定定位浮层，优先放在主菜单右侧，空间不足时向左避让并限制视口尺寸。与主菜单共同 portal 到 body；外部点击检测包含两个浮层。进入子菜单会取消 200ms 的离开关闭计时，Esc/左方向键只关闭子菜单并回到入口，右方向键可打开并聚焦第一项。偏好存储状态只在设置页显示。

## 0.3.1 首次创建目录回归

官方目录服务在创建尚未缓存的会话目录时，间接以调用者上下文读取 `remote.session`。0.3.0 未声明这项依赖，别的选择器预先创建目录时会掩盖缺陷。删除 Codex Subscription 和 WorkBuddy 后，导航器成为第一个目录使用者，入口因此无法解析。0.3.1 声明完整依赖，独立启动不再依赖其他插件的缓存。集成测试将服务提供者与消费者置于真实 Cordis 的不同 fiber，以保留实际依赖检查。
