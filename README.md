# browser-cli

`browser-cli` is a local browser control CLI designed for agent/LLM workflows.
It focuses on fast terminal ergonomics, stable daemon-backed sessions, and LLM-friendly page state snapshots.

## Why browser-cli

- Daemon-backed runtime for faster repeated commands.
- Tab-first commands (`tabs`, `tab new/select/close`, `open`, `navigate`).
- LLM-friendly `snapshot` output with element refs for follow-up actions.
- Simple human-readable text output by default, JSON when needed.
- Handy ref actions: `click`, `doubleclick`, `hover`, `fill`, `type`, `scrollintoview`, `press`.

## Quickstart (Local Dev)

```bash
pnpm install
pnpm build
pnpm link --global

browser --version
# 0.1.0
```

## 5-Minute Flow

```bash
# 1) Start daemon and session
browser daemon start
browser start --headless

# 2) Open a page in a new tab, then inspect tabs
browser open https://example.com
browser tabs

# 3) Switch tab if needed
browser tab select 1

# 4) Get LLM-friendly snapshot (with refs like e12, e497)
browser snapshot

# 5) Act on refs
browser click e497
browser fill e12 "Hello"
browser type e12 "Hello"
browser press Enter

# 6) Save screenshot
browser screenshot

# 7) Stop session/daemon when done
browser stop
browser daemon stop
```

## Recommended Commands (Latest)

### Daemon

```bash
browser daemon start
browser daemon status
browser daemon restart
browser daemon stop
```

### Session

```bash
browser start --headless
browser status
browser stop
```

### Tabs and Navigation

```bash
browser tabs
browser tab new
browser tab select 2
browser tab close 2

browser open https://example.com
browser navigate https://example.com/dashboard
```

### Snapshot and Screenshot

```bash
browser snapshot
browser screenshot
browser screenshot --tab 2 --full
```

- `browser snapshot` prints a text snapshot for the selected tab.
- Snapshot text is truncated after 1500 lines.
- `browser screenshot` saves JPEG files under `~/.browser/screenshots/`.

### Ref-Based Actions

```bash
browser click e497
browser doubleclick e497
browser hover e497
browser fill e12 "Hello"
browser type e12 "Hello"
browser scrollintoview e497
browser press Enter
```

- `browser fill` clears existing value and sets new text.
- `browser type` keeps current value and types additional text.

## Output Modes

Text is default:

```bash
browser daemon status
browser tabs
```

JSON when needed:

```bash
browser daemon status --output json
browser snapshot --output json
browser version --output json
# {"version":"0.1.0"}
```

## Help and Discovery

```bash
browser
browser help
browser --help
browser tab --help
browser tab select --help
browser errors
```

## Context and Home Directory

- Default home: `~/.browser`
- Override home: `--home <path>` or `BROWSER_HOME=<path>`
- Force routing context: `--context-id <id>`
- Share context across shells: `--share-group <name>`

Examples:

```bash
browser --home ~/.browser-dev daemon start
browser --context-id qa-run-1 start --headless
browser --share-group qa tabs
```

## Version

```bash
browser version
browser --version
```

## Troubleshooting

- If commands fail unexpectedly, check daemon health first:
  - `browser daemon status`
  - `browser daemon restart`
- For details from machine-readable responses:
  - add `--output json`
  - add `--debug` for stderr diagnostics
