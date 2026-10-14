# DSH Model Navigator

[![Version](https://img.shields.io/badge/version-0.3.2-blue.svg)](https://github.com/EventHorizonXT/dsh-model-navigator/releases)
[![Host](https://img.shields.io/badge/DeepSeek%20Harness-0.2.0--rc.2-0f172a.svg)](https://github.com/EventHorizonXT/dsh-model-navigator)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

[简体中文](./README.md) · English · [Download Package (v0.3.2)](https://github.com/EventHorizonXT/dsh-model-navigator/releases/download/v0.3.2/dsh-model-navigator-0.3.2.tgz) · [Releases](https://github.com/EventHorizonXT/dsh-model-navigator/releases) · [Issues](https://github.com/EventHorizonXT/dsh-model-navigator/issues)

**DSH Model Navigator** is an enhanced model picker plugin for **DeepSeek Harness Desktop**. It replaces the model selector in the chat input bar while reusing your configured providers, accounts, and model catalog—bringing cross-provider search, favorites, model family grouping, thinking effort selection, and a one-click fallback to the previous picker.

---

## Key Features

- **Global Search Across Providers**: Quickly find models across all configured providers and display real model IDs to easily tell apart models with similar display names.
- **Favorites & Recent Models**: Pin your go-to models and access recently used ones. Both sections support opening submenus via hover, click, or keyboard navigation, and automatically flip submenu direction when viewport space is tight.
- **Model Family Navigation**: Browse models organized by family instead of scrolling through long flat lists.
- **Thinking Effort Selection**: Choose from host-provided thinking effort levels directly within the picker when switching models.
- **Zero Setup Overhead**: Reuses the host's model catalog and active session selection state, working out of the box with your existing providers and accounts.
- **Instant Restore**: Turn off selector replacement in settings, or disable/uninstall the plugin at any time to immediately restore the previously active selector.

---

## Installation & Upgrading

### Requirements

| Item | Details |
| :--- | :--- |
| **Plugin Version** | `0.3.2` |
| **Verified Host Version** | DeepSeek Harness Desktop `0.2.0-rc.2` |
| **Prerequisite** | **Keep the official model selector plugin enabled** (it provides the shared catalog service and the `/model` command) |

### Option 1: Install from Release Package (Recommended)

1. Download [`dsh-model-navigator-0.3.2.tgz`](https://github.com/EventHorizonXT/dsh-model-navigator/releases/download/v0.3.2/dsh-model-navigator-0.3.2.tgz) from [Releases](https://github.com/EventHorizonXT/dsh-model-navigator/releases).
2. In DeepSeek Harness Desktop, go to **Plugins → Add Plugin** (`插件 → 添加插件`).
3. In the **Package Name or Address** (`包名或地址`) field, enter the **full local absolute path** to the downloaded `.tgz` file (for example, `/Users/yourname/Downloads/dsh-model-navigator-0.3.2.tgz`), then add and enable the plugin.

### Option 2: Install from Local Source

1. Clone this repository and build the project locally (see [Development & Building](#development--building)).
2. Go to **Plugins → Add Plugin** and enter the local absolute path to the repository directory in the **Package Name or Address** field.

### Upgrading

- **Release Package (`.tgz`)**: Uninstall the older version in the plugins view first, then add the new `.tgz` package using its absolute path.
- **Linked Source Directory**: Pull the latest changes, rebuild the project, and **disable then re-enable** the plugin in the host app to load the updated build.

---

## Restoring the Original Selector

You can switch back to the previously active model selector at any time:

1. **Toggle Off in Settings**: Disable the replacement toggle in the plugin settings to restore the previous selector without uninstalling the plugin.
2. **Disable or Uninstall**: Disabling or uninstalling the plugin in the plugins manager automatically restores the previous selector.

---

## Compatibility & Technical Details

### How It Works

- **Slot & Priority**: The plugin mounts into the input bar's model selector slot with higher priority. Turning off replacement, disabling, or uninstalling the plugin cleanly yields the slot back to the previously active selector.
- **Shared State & Atomic Commits**: The plugin reads from the host's model catalog and session `current` selection state. Model and thinking effort changes are applied via atomic commits to avoid inconsistent intermediate states.
- **Official Plugin Dependency**: The built-in official model selector plugin must remain enabled, as it provides the underlying shared catalog service and the `/model` slash command.

### Known Limitations

- Codex-specific speed and verbosity controls are not yet implemented.

---

## Development & Building

Building and testing require **no npm dependencies** to be installed (`npm install` is not needed).

- **Node.js Requirement**: `^22.19.0 || >=24.0.0`
- **Release Packaging**: Release archives are packaged using BSD `tar` (verified on macOS).

```bash
# Build plugin artifacts
npm run build

# Run full verification suite (140 tests)
npm run check
```

For additional technical documentation, see the [`docs/`](./docs/) directory.

---

## License & Notices

- **License**: [MIT License](./LICENSE)
- **Third-Party Notices**: [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)
- **Feedback & Bug Reports**: [GitHub Issues](https://github.com/EventHorizonXT/dsh-model-navigator/issues)