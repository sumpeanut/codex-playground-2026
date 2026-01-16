# HTML tool test harness contract

These pages expose a small automation surface so a coordinator can run them in an iframe.

## Query string

- `?autorun=1` will auto-start the test harness.

## `window.caTest`

Each page provides `window.caTest` with:

- `run(): Promise<void>` — starts the suite (or reports manual-only).
- `getStatus(): { name, status, passed, details }`

`status` is one of `idle`, `running`, `pass`, or `fail`.

## `postMessage` protocol

Pages emit messages to `window.parent`:

- `ca-test-status`: `{ type: "ca-test-status", name, status, details }`
- `ca-test-result`: `{ type: "ca-test-result", name, passed, details }`

Manual-only pages report `passed: false` with `details.manualOnly = true`.
