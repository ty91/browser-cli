# browser-cli

Local browser control CLI for agent/LLM workflows.
Daemon-backed sessions, tab management, and snapshot-based element ref system.

## Install (Global)

```bash
npm install -g @ty91/browser-cli
browser --version
```

## Local Dev Install

```bash
pnpm install
pnpm build
pnpm link --global
```

## Usage

```bash
# daemon, session
browser daemon start
browser start --headless

# navigate
browser open https://example.com
browser tabs
browser tab select 1

# snapshot → ref → action
browser snapshot
browser click e497
browser fill e12 "Hello"
browser press Enter

# cleanup
browser stop
browser daemon stop
```

## Commands

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

### Tab / Navigation

```bash
browser tabs
browser tab new
browser tab select 2
browser tab close 2

browser open https://example.com
browser navigate https://example.com/dashboard
```

### Snapshot / Screenshot

```bash
browser snapshot
browser screenshot
browser screenshot --tab 2 --full
```

`snapshot` prints a text snapshot of the current tab. Truncated after 1500 lines.
`screenshot` saves JPEG files to `~/.browser/screenshots/`.

### Ref Actions

Interact with the page using element refs (`e12`, `e497`, etc.) from `snapshot` output.

```bash
browser click e497
browser doubleclick e497
browser hover e497
browser fill e12 "Hello"       # clears existing value, sets new text
browser type e12 "Hello"       # appends to existing value
browser scrollintoview e497
browser press Enter
```

## Output

Default output is text. Use `--output json` for JSON.

```bash
browser daemon status --output json
browser snapshot --output json
browser version --output json
```

## Configuration

| Flag | Description |
|---|---|
| `--home <path>` | Override home directory (default: `~/.browser`, env: `BROWSER_HOME`) |
| `--context-id <id>` | Set routing context |
| `--share-group <name>` | Share context across shells |
| `--debug` | Print diagnostics to stderr |

```bash
browser --home ~/.browser-dev daemon start
browser --context-id qa-run-1 start --headless
browser --share-group qa tabs
```

## Troubleshooting

If commands fail, check daemon health first.

```bash
browser daemon status
browser daemon restart
```

## Release (Maintainer)

```bash
# 1) npm auth
npm login

# 2) bump version
pnpm version patch   # or minor / major

# 3) publish
pnpm publish --access public

# 4) verify
npm view @ty91/browser-cli version
```

## Version

```bash
browser version
browser --version
```
