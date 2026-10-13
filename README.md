# DSH Model Navigator

**[中文说明](README.zh-CN.md)** · **[Download v0.3.1](https://github.com/EventHorizonXT/dsh-model-navigator/releases/tag/v0.3.1)**

[![CI](https://github.com/EventHorizonXT/dsh-model-navigator/actions/workflows/ci.yml/badge.svg)](https://github.com/EventHorizonXT/dsh-model-navigator/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/EventHorizonXT/dsh-model-navigator)](https://github.com/EventHorizonXT/dsh-model-navigator/releases)
[![License: MIT](https://img.shields.io/github/license/EventHorizonXT/dsh-model-navigator)](LICENSE)

A model picker for DeepSeek Harness Desktop that replaces the composer's model button with global search, favorites, recent selections, model-family navigation and reasoning effort. It reuses the host's shared model directory, so the composer label, the `/model` command and every other picker stay on the same session state.

## Features

**Find a model fast**

- Search every provider at once by display name, real model ID or provider name — no provider preselection needed.
- Results show the provider label and the real model ID, so models sharing a display name stay distinguishable.
- A prominent Favorites entry with a live count; no eight-item cap, and the current model is always eligible.
- A single Recent entry with a count, recorded from your successful selections per provider.
- Hover, click or press `ArrowRight` to open a submenu; it expands to the right, flips left at the screen edge, and forgives a 200 ms pointer drift.
- `Esc` and `ArrowLeft` close only the submenu and return focus to its entry.

**Navigate the catalog**

- Browse provider → model family → model → reasoning effort. The current family is expanded; your other collapse choices are remembered.
- Three grouping modes: host order (a flat list in the host's own order), channel first and family first.
- Reasoning effort comes from host metadata; each selection submits one complete `{ provider, model, reasoningEffort? }`.
- Star any model from its row; unstarring updates the list immediately.

**Stay consistent with the host**

- Registers the single-slot `conversation.input.model` at priority `-20`, above the official picker (`0`) and the Codex Subscription picker (`-10`) — only one model button appears.
- Shows a loading state until the host reports a current model, rather than guessing the first row.
- Disabling or unloading unregisters the slot and the previously active picker returns; a rendering crash is demoted to the next surviving entry.
- Locked sessions, failed loads with manual retry, rapid clicks and stale connection results are handled without a false "switched" state.

## Install

Download `dsh-model-navigator-0.3.1.tgz` from [GitHub Releases](https://github.com/EventHorizonXT/dsh-model-navigator/releases/tag/v0.3.1). In DeepSeek Harness Desktop, open **Plugins → Add plugin** and paste the file's absolute path into **Package name or address**. The host's plugin manager accepts the same path:

```text
plugin_manager action: install_bundle target: /absolute/path/dsh-model-navigator-0.3.1.tgz
```

Keep the official model selection plugin enabled: it supplies the shared directory service and `/model`. This plugin replaces the model entry, not the model account.

For a source-directory install, point the same tool at the repository's local path, and rebuild after code changes:

```text
plugin_manager action: install_bundle target: /absolute/path/dsh-model-navigator
```

## Update

The host has no automatic plugin update. Uninstall the old version, then add the new `.tgz`; keep the previous tarball for rollback. For a source link, refresh the directory, then disable and re-enable the plugin. Never install the same plugin from two sources. Checksums and rollback steps: [installation details](docs/INSTALL.md).

## Compatibility and settings

Verified with DeepSeek Harness Desktop **0.2.0-rc.2**. Other host versions need their own integration verification.

**Settings → General → Model Navigator** offers the replacement toggle, grouping mode, an optional search box for large catalogs, and the active storage tier (plugin settings namespace → browser local storage → memory for this run).

The replacement outranks the Codex Subscription picker while its subscription and quota services keep running. Codex-specific speed and output-detail controls are not implemented in this version.

## Development

Node.js `^22.19.0 || >=24.0.0`; no npm dependencies for building or testing. Release packaging uses BSD tar (tested on macOS).

```sh
npm run check     # build client + 124 tests
npm run package   # reproducible tarball + SHA256SUMS in dist/
node tools/verify-host.mjs /absolute/path/to/host/node_modules
```

`npm run check` builds the client and runs 124 tests against the packaged artifact. `tools/verify-host.mjs` exercises the host's real Cordis, SlotCore, ModelDirectory and ModelDirectoryResolver — service dependencies, session binding, slot election, toggling, crash demotion and unloading — with simulated storage and transport boundaries. CI runs this on Ubuntu and macOS across Node 22 and 24.

Probe a running client for its version, session, directory, slot registration and recent errors:

```text
cordis_inspect_query  platform: client  provider: ModelNavigatorDiag  method: probe
```

Desktop verification, integration boundaries and remaining coverage live in the [test report](docs/TEST-REPORT.md); also see [compatibility](docs/COMPATIBILITY.md), [development criteria](docs/DEVELOPMENT.md) and [rollback](docs/ROLLBACK.md).

## Support

Report bugs in [GitHub Issues](https://github.com/EventHorizonXT/dsh-model-navigator/issues) with plugin and host versions, reproduction steps and a redacted screenshot if useful.

MIT. Adapted host styles retain the [DeepSeek license notice](THIRD_PARTY_NOTICES.md).
