# 安装与更新

已验证宿主：DeepSeek Harness Desktop **0.2.0-rc.2**。插件 v0.2.1 不额外配置供应商或凭据，沿用宿主目录。

## 推荐：安装预构建包

1. 打开 [v0.2.1 Release](https://github.com/EventHorizonXT/dsh-model-navigator/releases/tag/v0.2.1)。
2. 下载 `dsh-model-navigator-0.2.1.tgz` 与 `SHA256SUMS`。
3. 可选：在下载目录运行 `shasum -a 256 -c SHA256SUMS` 核对包。
4. 在 Desktop 的 **插件 → 添加插件** 中安装下载文件；也可使用宿主工具：

   ```text
   plugin_manager action: install_bundle target: /absolute/path/dsh-model-navigator-0.2.1.tgz
   ```

   `target` 使用下载文件的绝对路径。
5. 确认插件页显示 v0.2.1 且启用，输入框只显示一个模型按钮，打开后可见供应商导航、当前模型和全局搜索。

官方模型选择插件必须保持开启，以提供目录服务及 `/model`。本插件取代模型入口，不提供新的模型账户。

## 更新

安装新版本包后，在插件页关闭再启用模型导航器，重新加载客户端代码。已验证该操作能使 0.2.0 更新为 0.2.1。

升级前可保留旧版本 `.tgz`。需要回退时停用或卸载当前包，再安装旧包。不要同时使用同一个插件的多个来源。

## 源码安装

仓库包含正式构建产物 `lib/client.js`，可把仓库的本地绝对路径交给宿主插件管理器：

```text
plugin_manager action: install_bundle target: /absolute/path/dsh-model-navigator
```

目录安装形成开发链接。修改代码后先运行 `npm run check`，再在插件页关闭并启用该插件。

## 构建与打包

需要 Node `^22.19.0 || >=24.0.0`，不需要安装 npm 依赖。打包脚本的 tar 参数已在 macOS 的 BSD tar 验证。

```sh
npm run check
npm run package
```

输出 `dist/dsh-model-navigator-0.2.1.tgz` 和 `dist/SHA256SUMS`。包采用 npm-pack 布局（顶层 `package/`），包含源码、正式客户端、测试和文档。测试探针只供离线测试使用，宿主加载 `lib/client.js`。

## 关闭增强

**设置 → 通用 → 模型导航器 → 替换原生模型选择器**。关闭后注销增强入口，恢复之前生效的原生或 Codex Subscription 入口。也可直接在插件页停用本插件。

本版本暂未实现 Codex 专属速度和输出详略控件。其他宿主版本、主题及平台的覆盖见 [兼容性](COMPATIBILITY.md) 和 [测试报告](TEST-REPORT.md)。
