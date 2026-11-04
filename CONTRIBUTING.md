# Contributing

Bug reports and pull requests are welcome. Include host and plugin versions, reproduction steps, and the expected result. Redact credentials and private conversation content from reports.

Use Node `^22.19.0 || >=24.0.0` and run `npm run check` before submitting code. Edit `src/client/client.template.js` or `src/core/*.mjs`, rebuild the generated `lib/client.js`, and include it with the change. Build and tests need no installed npm dependencies.

For host lifecycle or selection changes, also run `node tools/verify-host.mjs /absolute/path/to/host/node_modules [/absolute/path/to/dsh-client-ui-slots]` against the host version being supported. Host 0.2.1 and later bundle SlotCore into the web frontend, so pass the same-version `@deepseek-ai/dsh-client-ui-slots` npm package directory as the second argument. Record actual desktop verification separately from simulated tests.

Release packaging uses macOS BSD tar: `npm run package` writes `dsh-model-navigator-<version>.tgz`, an identical copy named `dsh-model-navigator.tgz`, and a SHA256SUMS that lists both. Attach all three to the GitHub Release. The plugin directory entry links to `releases/latest/download/dsh-model-navigator.tgz`, so new releases reach the directory without editing the entry. GitHub resolves `latest` to the newest release that is not a draft or prerelease, so publish test builds as prereleases. A release without the version-free tarball breaks the directory link.
