# browser-cli

Agent/LLM 워크플로우를 위한 로컬 브라우저 제어 CLI.
데몬 기반 세션, 탭 관리, 스냅샷 기반 element ref 시스템을 제공한다.

## Install

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

`snapshot`은 현재 탭의 텍스트 스냅샷을 출력한다. 1500줄에서 잘린다.
`screenshot`은 JPEG를 `~/.browser/screenshots/`에 저장한다.

### Ref Actions

`snapshot` 출력에 포함된 element ref(`e12`, `e497` 등)로 페이지와 상호작용한다.

```bash
browser click e497
browser doubleclick e497
browser hover e497
browser fill e12 "Hello"       # 기존 값을 지우고 입력
browser type e12 "Hello"       # 기존 값 뒤에 이어서 입력
browser scrollintoview e497
browser press Enter
```

## Output

기본 출력은 텍스트. `--output json`으로 JSON을 받을 수 있다.

```bash
browser daemon status --output json
browser snapshot --output json
browser version --output json
```

## Configuration

| Flag | 설명 |
|---|---|
| `--home <path>` | 홈 디렉토리 변경 (기본: `~/.browser`, env: `BROWSER_HOME`) |
| `--context-id <id>` | 라우팅 컨텍스트 지정 |
| `--share-group <name>` | 셸 간 컨텍스트 공유 |
| `--debug` | stderr 진단 출력 |

```bash
browser --home ~/.browser-dev daemon start
browser --context-id qa-run-1 start --headless
browser --share-group qa tabs
```

## Troubleshooting

명령이 실패하면 데몬 상태부터 확인한다.

```bash
browser daemon status
browser daemon restart
```

## Version

```bash
browser version
browser --version
```
