# DSH Model Navigator

[![Version](https://img.shields.io/badge/version-0.4.0-blue.svg)](https://github.com/EventHorizonXT/dsh-model-navigator/releases)
[![Host](https://img.shields.io/badge/DeepSeek%20Harness-0.2.0--rc.2-0f172a.svg)](https://github.com/EventHorizonXT/dsh-model-navigator)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

[简体中文](./README.md) · English · [Download Package (v0.4.0)](https://github.com/EventHorizonXT/dsh-model-navigator/releases/download/v0.4.0/dsh-model-navigator-0.4.0.tgz) · [Releases](https://github.com/EventHorizonXT/dsh-model-navigator/releases) · [Issues](https://github.com/EventHorizonXT/dsh-model-navigator/issues)

**DSH Model Navigator** is an enhanced model picker plugin for **DeepSeek Harness Desktop**. It replaces the model selector in the chat input bar while reusing your configured providers, accounts, and model catalog—bringing cross-provider search, favorites, model family grouping, thinking effort selection, and a one-click fallback to the previous picker.

---

## Key Features

- **Global Search Across Providers**: Quickly find models across all configured providers and display real model IDs to easily tell apart models with similar display names.
- **Official Two-Level Layout**: The root shows Model and Thinking Effort. The model page combines search, favorites, recent models and the full catalog. Clicking a model opens its thinking effort page first; models without effort levels switch right away.
- **Favorites & Recent Models**: Pin your go-to models; the five most recently used models are listed automatically, each with its provider and model ID.
- **Model Label Plugins**: Labels contributed through the official `conversation.input.model.label` slot (such as the "1017" badge) keep rendering.
- **Collapsible Providers & Families**: Models are grouped by provider, then by family. Only the provider and family of the current model start expanded; the rest show just a name and count, and your expand/collapse choices are remembered. Collapsing a provider also folds its families.
- **Clear Hierarchy**: Providers, families and models differ in size, color and indent rails, and blue marks only the path to the current model.
- **Unavailable Items Hidden by Default**: Favorites and recent models that are no longer in the catalog, plus providers that failed to load, move into a collapsed "Unavailable" section at the bottom that shows only a count; expand it to remove or retry them.
- **Thinking Effort Selection**: Choose from host-provided thinking effort levels directly within the picker when switching models. Each model remembers its last effort and preselects it when you come back.
- **Zero Setup Overhead**: Reuses the host's model catalog and active session selection state, working out of the box with your existing providers and accounts.
- **Instant Restore**: Turn off selector replacement in settings, or disable/uninstall the plugin at any time to immediately restore the previously active selector.

---

## Installation & Upgrading

### Requirements

| Item | Details |
| :--- | :--- |
| **Plugin Version** | `0.4.0` |
| **Verified Host Version** | DeepSeek Harness Desktop `0.2.0-rc.2` (on device); adapted to `0.2.1-rc.1 / rc.2` against host sources and integration tests; `0.2.1-rc.5` tried on device by the maintainer, integration checks not yet rerun |
| **Prerequisite** | **Keep the official model selector plugin enabled** (it provides the shared catalog service and the `/model` command) |

### Option 1: Install from Release Package (Recommended)

1. Download [`dsh-model-navigator-0.4.0.tgz`](https://github.com/EventHorizonXT/dsh-model-navigator/releases/download/v0.4.0/dsh-model-navigator-0.4.0.tgz) from [Releases](https://github.com/EventHorizonXT/dsh-model-navigator/releases).
2. In DeepSeek Harness Desktop, go to **Plugins → Add Plugin** (`插件 → 添加插件`).
3. In the **Package Name or Address** (`包名或地址`) field, enter the **full local absolute path** to the downloaded `.tgz` file (for example, `/Users/yourname/Downloads/dsh-model-navigator-0.4.0.tgz`), then add and enable the plugin.

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