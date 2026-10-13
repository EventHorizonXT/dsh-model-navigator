# DSH Model Navigator

[English](README.md) · [下载 v0.2.1](https://github.com/EventHorizonXT/dsh-model-navigator/releases/tag/v0.2.1)

用增强导航器替换输入框里的官方模型按钮：供应商 → 按家族分组的模型 → 宿主提供的思维强度。

0.2.1 使用 `conversation.input.model` 的单入口槽位（priority `-20`）。显示、切换和 `/model` 共享官方 `modelDirectories` 的会话目录，界面以宿主 `current` 为准。

## 功能

- 首层全局搜索，可按显示名、真实模型 ID 或供应商查找。
- 当前模型快捷入口、收藏按钮、收藏列表、各供应商最近成功选择的模型。
- 搜索结果同时显示供应商与模型 ID，同名模型可区分。
- 按家族折叠；默认展开当前家族，保存用户展开和折叠偏好。
- 宿主顺序模式逐行保留模型顺序；渠道优先和家族优先提供分组导航。
- 推理档位来自宿主元数据，一次提交完整的 `{provider, model, reasoningEffort?}`。
- 等待提交时防止重复点击；失败保留菜单并显示原因，目录失败支持手动重试。
- 显示当前模型不在目录的状态，目录刷新和连接恢复不会伪装成已切换。

## 开关与兼容性

设置 → 通用 → 模型导航器 → **替换原生模型选择器**。关闭后注销增强入口，官方入口立即恢复；可以随时重新开启。

官方模型选择插件仍提供数据服务和 `/model`。增强启用时优先于 `dsh-codex-subscription` 的 `-10` 入口；关闭或卸载增强后，宿主恢复之前生效的选择器。增强入口出现渲染错误时，宿主将其退位，恢复下一个存活入口。

偏好保存到插件命名空间、浏览器存储或内存，设置行显示实际存储层级。模型切换沿用官方接口，会影响当前会话的下一次模型选择。

本次验证的宿主是 DeepSeek Harness Desktop **0.2.0-rc.2**，其他版本需要重新运行接入验证。

## 安装与更新

从 [GitHub Releases](https://github.com/EventHorizonXT/dsh-model-navigator/releases/tag/v0.2.1) 下载 `dsh-model-navigator-0.2.1.tgz`，在 Desktop 的 **插件 → 添加插件** 的“包名或地址”栏填入下载文件的绝对路径进行安装。也可以把下载文件的绝对路径交给宿主插件管理工具：

```text
plugin_manager action: install_bundle target: /absolute/path/dsh-model-navigator-0.2.1.tgz
```

包安装升级时先卸载旧版本，再添加新版本包；源码目录链接更新后，在插件页关闭再启用导航器。源码安装、校验值与更新方式见 [安装说明](docs/INSTALL.md)。

本版覆盖模型与思维强度选择，暂未实现 Codex 专属的速度和输出详略控件。

## 开发

构建和单测使用 Node 内置模块，无需安装依赖。Node 版本为 `^22.19.0 || >=24.0.0`；打包脚本使用 BSD tar，已在 macOS 验证：

```bash
npm run check
node tools/verify-host.mjs /absolute/path/to/host/node_modules
npm run package
```

- `src/core/`：身份、搜索、分类、排序、草稿和偏好纯逻辑。
- `src/client/client.template.js`：客户端接入与界面。
- `lib/client.js`：宿主加载的正式产物。
- `tests/`：110 项回归测试，包含真实执行打包产物的交互测试。
- `tools/verify-host.mjs`：隔离执行宿主实际的 `SlotCore` 和 `ModelDirectory`，验证入口选举、共享投影、开关、崩溃回退和卸载；存储通知与网络传输边界使用模拟实现。

诊断通道：

```text
cordis_inspect_query  platform: client  provider: ModelNavigatorDiag  method: probe
```

结果包含版本、当前会话、目录、触发器显示、槽位接入和最近错误。详见 [测试报告](docs/TEST-REPORT.md)、[兼容性](docs/COMPATIBILITY.md)、[回退说明](docs/ROLLBACK.md)和[开发验收标准](docs/DEVELOPMENT.md)。

反馈问题请在 [Issues](https://github.com/EventHorizonXT/dsh-model-navigator/issues) 提供插件与宿主版本、复现步骤和去除私人信息的截图。

MIT License。适配的宿主样式保留 [DeepSeek 许可声明](THIRD_PARTY_NOTICES.md)。
