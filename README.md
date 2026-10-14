# DSH Model Navigator

[![Version](https://img.shields.io/badge/version-0.3.2-blue.svg)](https://github.com/EventHorizonXT/dsh-model-navigator/releases)
[![Host](https://img.shields.io/badge/DeepSeek%20Harness-0.2.0--rc.2-0f172a.svg)](https://github.com/EventHorizonXT/dsh-model-navigator)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

简体中文 · [English](./README.en.md) · [下载安装包 (v0.3.2)](https://github.com/EventHorizonXT/dsh-model-navigator/releases/download/v0.3.2/dsh-model-navigator-0.3.2.tgz) · [Releases](https://github.com/EventHorizonXT/dsh-model-navigator/releases) · [问题反馈](https://github.com/EventHorizonXT/dsh-model-navigator/issues)

**DSH Model Navigator** 是为 **DeepSeek Harness Desktop** 设计的模型选择器插件。它替换聊天输入框中的默认模型选择入口，直接沿用你已有的供应商、账户和模型列表，提供全局搜索、收藏夹、模型家族分组和思维强度切换，并支持随时一键切回原选择器。

---

## 核心功能

- **跨供应商全局搜索**：在所有已配置的供应商中即时搜索模型，支持显示真实模型 ID，方便区分同名或不同版本的模型。
- **收藏夹与最近使用**：置顶常用模型并自动记录最近使用的模型。两类列表均支持鼠标悬停、点击或键盘展开子菜单；当窗口空间不足时，子菜单会自动调整展开方向。
- **模型家族导航**：按模型家族归类展示，替代冗长的平铺列表，浏览和定位更直观。
- **思维强度选择**：直接读取并切换宿主提供的思维强度档位，在选定模型的同时完成档位切换。
- **配置零迁移**：复用宿主的模型目录与当前会话的选择状态，无需重新配置供应商或账户。
- **一键恢复原选择器**：可在设置中随时关闭替换；关闭替换、停用或卸载插件后，会自动恢复之前生效的选择器。

---

## 安装与升级

### 环境与前置条件

| 项目 | 说明 |
| :--- | :--- |
| **插件版本** | `0.3.2` |
| **已验证宿主版本** | DeepSeek Harness Desktop `0.2.0-rc.2` |
| **前置要求** | **必须保持官方模型选择插件启用**（它负责提供共享目录服务和 `/model` 命令） |

### 方式一：通过安装包安装（推荐）

1. 前往 [Releases](https://github.com/EventHorizonXT/dsh-model-navigator/releases) 下载安装包 [`dsh-model-navigator-0.3.2.tgz`](https://github.com/EventHorizonXT/dsh-model-navigator/releases/download/v0.3.2/dsh-model-navigator-0.3.2.tgz) 到本地。
2. 打开 DeepSeek Harness Desktop，进入 **插件 → 添加插件**。
3. 在 **包名或地址** 栏中填写下载文件的**本地绝对路径**（例如 `/Users/yourname/Downloads/dsh-model-navigator-0.3.2.tgz`），确认添加并启用。

### 方式二：通过本地源码安装

1. 克隆本仓库并在本地完成构建（详见[开发与构建](#开发与构建)）。
2. 打开 **插件 → 添加插件**，在 **包名或地址** 栏填写本地仓库目录的绝对路径，确认添加并启用。

### 升级方式

- **安装包升级**：先在插件列表中卸载旧版本，再按上述步骤添加新版 `.tgz` 安装包。
- **源码链接升级**：拉取最新代码并重新构建后，在宿主插件管理页**先关闭再重新启用**插件以加载新产物。

---

## 恢复默认选择器

如果你想切回宿主原有的模型选择器，可通过以下任一方式操作：

1. **在设置中关闭替换**：关闭本插件的替换开关后，立即恢复之前生效的选择器，无需卸载插件。
2. **停用或卸载插件**：在插件管理页停用或卸载本插件，输入框会自动切回之前生效的选择器。

---

## 兼容性与技术说明

### 实现机制

- **槽位与优先级**：插件通过更高优先级接管输入框的模型选择槽位；当关闭替换、停用或卸载时，自动将槽位交还给此前生效的选择器。
- **状态复用与原子提交**：直接复用宿主共享的模型目录与会话 `current` 状态；在切换模型及思维强度档位时执行原子提交，确保模型与思维强度状态同步更新。
- **官方插件依赖**：宿主的官方模型选择插件提供底层共享目录服务与 `/model` 命令，使用本插件期间请保持官方插件处于启用状态。

### 已知限制

- 暂未实现 Codex 专属的速度（Speed）与输出详略（Verbosity）控件。

---

## 开发与构建

本项目构建与测试均无需安装外部 npm 依赖（无需执行 `npm install`）。

- **Node.js 要求**：`^22.19.0 || >=24.0.0`
- **打包环境**：发布包使用 BSD `tar` 打包，已在 macOS 环境验证。

```bash
# 构建插件
npm run build

# 运行完整验证（包含 140 项测试）
npm run check
```

更多技术细节与文档请参阅 [`docs/`](./docs/) 目录。

---

## 许可证与声明

- **开源协议**：[MIT License](./LICENSE)
- **第三方声明**：[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)
- **反馈与建议**：欢迎提交至 [GitHub Issues](https://github.com/EventHorizonXT/dsh-model-navigator/issues)