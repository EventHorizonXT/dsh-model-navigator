# DSH Model Navigator

[中文说明](README.zh-CN.md) · [Download v0.2.1](https://github.com/EventHorizonXT/dsh-model-navigator/releases/tag/v0.2.1)

A model picker for DeepSeek Harness Desktop with global search, favorites, recent selections, model-family navigation and reasoning effort selection. It replaces the composer model picker while using the host's shared model directory and selection API.

## Features

- Search across providers by display name or model ID.
- Distinguish models with the same name using provider labels and real IDs.
- Jump to the current model, favorites and recent selections.
- Browse provider → model family → model → reasoning effort.
- Keep model selection and the composer label synchronized with host state.
- Handle locked sessions, failed loads, rapid clicks and stale connection responses.
- Restore the previous picker when disabled or unloaded.

## Install

Download `dsh-model-navigator-0.2.1.tgz` from [GitHub Releases](https://github.com/EventHorizonXT/dsh-model-navigator/releases/tag/v0.2.1). In DeepSeek Harness Desktop, open **Plugins → Add plugin** and paste the downloaded package’s absolute path into **Package name or address**. The host's plugin manager also accepts its absolute path:

```text
plugin_manager action: install_bundle target: /absolute/path/dsh-model-navigator-0.2.1.tgz
```

Keep the official model selection plugin enabled: it supplies the shared directory. For a package update, uninstall the old version and add the new tarball. For a source-directory link, rebuild and disable/re-enable the plugin to reload it. See [installation details](docs/INSTALL.md).

## Compatibility and settings

Verified with DeepSeek Harness Desktop **0.2.0-rc.2**. Other host versions require integration verification.

In **Settings → General → Model Navigator**, turn the replacement on or off and adjust navigation preferences. Storage uses the available host scope, browser local storage or memory; the settings row shows the active storage mode.

The replacement takes priority over the Codex Subscription picker. Codex subscription and quota services continue to run. This version implements model and reasoning effort selection; Codex-specific speed and output-detail controls are not included.

## Development

Node.js `^22.19.0 || >=24.0.0`. No npm dependencies are needed for building or testing. Release packaging uses BSD tar (tested on macOS).

```sh
npm run check
npm run package
# Optional: verify against an installed host's modules
node tools/verify-host.mjs /absolute/path/to/host/node_modules
```

110 automated tests cover core logic and execution of the generated client. The host integration script runs actual SlotCore and ModelDirectory code with simulated storage and transport boundaries. See the [test report](docs/TEST-REPORT.md) for desktop verification and remaining coverage.

Report bugs through [GitHub Issues](https://github.com/EventHorizonXT/dsh-model-navigator/issues), including plugin/host versions, reproduction steps and a redacted screenshot if useful.

MIT. Adapted host styles retain the [DeepSeek license notice](THIRD_PARTY_NOTICES.md).
