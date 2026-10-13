# DSH Model Navigator

[English](README.en.md) · **[下载 v0.3.1](https://github.com/EventHorizonXT/dsh-model-navigator/releases/tag/v0.3.1)**

[![CI](https://github.com/EventHorizonXT/dsh-model-navigator/actions/workflows/ci.yml/badge.svg)](https://github.com/EventHorizonXT/dsh-model-navigator/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/EventHorizonXT/dsh-model-navigator)](https://github.com/EventHorizonXT/dsh-model-navigator/releases)
[![License: MIT](https://img.shields.io/github/license/EventHorizonXT/dsh-model-navigator)](LICENSE)

DeepSeek Harness Desktop 的模型选择器：用全局搜索、收藏、最近使用、模型家族导航和思维强度，替换输入框里的官方模型按钮。显示、切换与 `/model` 命令共用宿主的会话模型目录，界面始终以宿主 current 为准。

## 功能

**快速找到模型**

- 一次搜索全部供应商，按显示名、真实模型 ID 或供应商名查找，不必先选供应商。
- 结果同时列出供应商和真实模型 ID，同名模型不会混淆。
- 醒目的收藏夹入口，数量实时可见，不限制为 8 个，当前模型始终可收藏。
- 最近使用收在单行入口里并显示数量，按供应商记录成功切换。
- 悬停、点击或按 `→` 展开子菜单；默认向右展开，靠近屏幕边缘自动左移，指针移动留 200 ms 容错。
- `Esc` 和 `←` 只关闭子菜单，焦点回到入口本身。

**浏览模型目录**

- 供应商 → 模型家族 → 模型 → 思维强度 逐级浏览；当前所在家族默认展开，其余折叠状态会被记住。
- 三种分组模式：宿主顺序（按宿主原有顺序平铺）、渠道优先、家族优先。
- 思维强度档位取自宿主元数据，每次选择原子提交完整的 `{provider, model, reasoningEffort?}`。
- 在模型行上点星标即可收藏，取消后立即生效。

**与宿主保持一致**

- 以 priority `-20` 注册 `conversation.input.model` 单入口槽位，高于官方选择器（`0`）与 Codex Subscription（`-10`），输入框只出现一个模型按钮。
- 宿主尚未给出 current 时显示加载状态，不会把目录第一项误当当前模型。
- 关闭替换或卸载插件即注销槽位，此前生效的选择器立即恢复；入口渲染崩溃时由宿主退位到下一个存活入口。
- 锁定会话、目录加载失败（可手动重试）、快速重复点击、过期连接结果均被拦截，不会出现伪装的「已切换」。

## 安装

从 [GitHub Releases](https://github.com/EventHorizonXT/dsh-model-navigator/releases/tag/v0.3.1) 下载 `dsh-model-navigator-0.3.1.tgz`，在 Desktop 的 **插件 → 添加插件** 中把文件的绝对路径填入「包名或地址」。宿主的插件管理工具接受同一路径：

```text
plugin_manager action: install_bundle target: /absolute/path/dsh-model-navigator-0.3.1.tgz
```

请保持官方模型选择插件开启：它提供共享目录服务和 `/model` 命令。本插件替换的是模型入口，不提供新的模型账户。

源码目录安装则把仓库的本地路径交给同一工具，改代码后重新构建：

```text
plugin_manager action: install_bundle target: /absolute/path/dsh-model-navigator
```

## 更新

宿主没有插件自动更新。升级时先卸载旧版本，再安装新的 `.tgz`，并保留旧包以便回退。源码链接方式更新目录内容后，在插件页关闭再启用即可。不要同时安装同一插件的多个来源。校验值与回退步骤见 [安装说明](docs/INSTALL.md)。

## 兼容与设置

已验证宿主：DeepSeek Harness Desktop **0.2.0-rc.2**。其他版本需要重新运行接入验证。

**设置 → 通用 → 模型导航器** 里可开关替换、切换分组模式、决定大目录是否显示搜索框，并查看当前偏好存储层级（插件设置命名空间 → 浏览器本地存储 → 仅本次运行）。

替换启用时优先于 Codex Subscription 的入口，其订阅与配额服务照常运行。本版暂未实现 Codex 专属的速度与输出详略控件。

## 开发

构建和测试只需 Node.js `^22.19.0 || >=24.0.0`，无需安装 npm 依赖。打包脚本使用 BSD tar（已在 macOS 验证）。

```bash
npm run check     # 构建客户端 + 124 项测试
npm run package   # 可复现的 tarball + SHA256SUMS，输出到 dist/
node tools/verify-host.mjs /absolute/path/to/host/node_modules
```

`npm run check` 构建客户端，并对打包产物运行 124 项测试。`tools/verify-host.mjs` 隔离执行宿主实际的 Cordis、SlotCore、ModelDirectory 和 ModelDirectoryResolver，覆盖服务依赖、会话绑定、入口选举、开关、崩溃退位与卸载；存储通知与网络传输用模拟边界。CI 在 Ubuntu 与 macOS、Node 22 与 24 下运行全部检查。

诊断运行中的客户端，查看版本、会话、目录、槽位注册与最近错误：

```text
cordis_inspect_query  platform: client  provider: ModelNavigatorDiag  method: probe
```

桌面实机验证、集成边界与待覆盖项见 [测试报告](docs/TEST-REPORT.md)，另见 [兼容性](docs/COMPATIBILITY.md)、[开发验收标准](docs/DEVELOPMENT.md) 和 [回退说明](docs/ROLLBACK.md)。

## 反馈

到 [GitHub Issues](https://github.com/EventHorizonXT/dsh-model-navigator/issues) 反馈问题，请附上插件与宿主版本、复现步骤，以及去除私人信息的截图（如有帮助）。

MIT License。适配的宿主样式保留 [DeepSeek 许可声明](THIRD_PARTY_NOTICES.md)。
