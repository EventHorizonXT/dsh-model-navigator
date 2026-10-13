# Contributing

Bug reports and pull requests are welcome. Include host and plugin versions, reproduction steps, and the expected result. Redact credentials and private conversation content from reports.

Use Node `^22.19.0 || >=24.0.0` and run `npm run check` before submitting code. Edit `src/client/client.template.js` or `src/core/*.mjs`, rebuild the generated `lib/client.js`, and include it with the change. Build and tests need no installed npm dependencies.

For host lifecycle or selection changes, also run `node tools/verify-host.mjs /absolute/path/to/host/node_modules` against the host version being supported. Record actual desktop verification separately from simulated tests.

Release packaging uses macOS BSD tar: `npm run package`. Attach the resulting versioned tarball and SHA256SUMS to a GitHub Release. Update the pinned tarball URL in the plugin directory entry when releasing a new version.
