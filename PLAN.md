# browser-cli 구현 계획 (CLI 중심 재설계)

## 1) 문서 목적

이 문서는 `/Users/taeyoung/Developer/workspace/cdt` 저장소에서, Chrome DevTools MCP 기능과 동등한 브라우저 제어 능력을 갖춘 CLI(`cdt`)를 구축하기 위한 **상세 실행 계획**이다.

핵심 목표는 다음과 같다.

- MCP 도구 이름/형식을 그대로 복제하지 않고, CLI 베스트 프랙티스에 맞는 명령 체계로 재설계
- 내부적으로는 MCP 26개 기능과 1:1 매핑 가능한 동작 보장
- 추후 기능 추가/변경 시 영향 반경이 작도록 높은 응집도와 관심사 분리를 유지
- 최종적으로 에이전트가 MCP 대신 `cdt` CLI만으로 동일 수준의 브라우저 제어를 수행 가능

---

## 2) 범위와 비범위

### 2.1 In Scope

- TypeScript + Node.js 기반 CLI/Daemon 프로젝트 구성
- Chrome DevTools Protocol(CDP) 기반 브라우저 제어
- 세션/페이지 상태 관리 및 로컬 영속화(`~/.cdt`)
- 에이전트가 세션 ID를 몰라도 동작하는 자동 컨텍스트 격리(Context-based isolation)
- JSON 자동화 출력 + 텍스트 사람 친화 출력 동시 지원
- 테스트 계층(unit/integration/e2e) 구축
- MCP 26개 기능 동등성 확보(명령명은 재설계)

### 2.2 Out of Scope (초기 단계)

- Firefox/Safari 지원
- 원격 분산 실행(다중 머신)
- GUI/TUI 대시보드
- 인증/권한이 필요한 외부 서비스 연동

---

## 3) 성공 기준 (Success Criteria)

### 3.1 기능적 성공 기준

- [ ] `cdt` 명령 체계로 브라우저 시작, 페이지 이동, DOM 상호작용, 스냅샷/스크린샷, 스크립트 실행, 네트워크/콘솔 조회, 에뮬레이션, 트레이싱 가능
- [ ] MCP 26개 도구와 동등한 기능 제공(명령명은 다름)
- [ ] 기본 출력이 JSON이며(`--output json` 기본값), 사람이 읽기 쉬운 출력은 선택적으로 제공
- [ ] 단순 명령으로 시작해 필요 시 상세 옵션으로 확장되는 progressive disclosure UX 제공
- [ ] `--help`로 명령이 자기 설명(self-documenting) 가능
- [ ] 에이전트가 session id를 지정하지 않아도 자동으로 격리된 브라우저 환경이 선택됨
- [ ] 필요 시 여러 에이전트가 의도적으로 같은 브라우저 컨텍스트를 공유할 수 있음(명시적 group key)
- [ ] 에이전트 루프를 위한 관측/행동 프리미티브(`observe`, 좌표 마우스/타이핑, wait 확장) 제공

### 3.2 구조적 성공 기준

- [ ] CLI 파싱/출력 로직과 비즈니스 로직(Application) 완전 분리
- [ ] Application이 CDP 구체 구현(ws/chrome-launcher)에 직접 의존하지 않음(Port/Adapter)
- [ ] 세션 저장소/락/원자적 쓰기 분리
- [ ] 명령 추가 시 기존 파일 대량 수정 없이 모듈 추가로 확장 가능
- [ ] 명령 브로커(daemon) 1개와 컨텍스트별 브라우저 슬롯(slot) 관리가 분리되어 있음
- [ ] 컨텍스트 식별(ContextResolver)과 브라우저 수명관리(LeaseManager)가 분리되어 있음

### 3.3 운영/품질 성공 기준

- [ ] lint/typecheck/tests 전체 통과
- [ ] 최소 1개 종단간 시나리오(e2e)로 실브라우저 제어 검증
- [ ] 오류 코드/에러 메시지 정책 일관화
- [ ] semantic exit code 체계로 기계 파싱 가능한 오류 처리 보장
- [ ] 실패 시 수정 가이드(suggestion) 노출로 self-correcting UX 제공
- [ ] stdout/stderr 규율을 지켜 pipe/jq/shell script 합성이 자연스럽게 동작
- [ ] 멀티 에이전트 동시 호출(격리/공유 혼합)에서 레이스/데이터 누수 없이 동작

---

## 4) 설계 원칙

1. **높은 응집도**
   - 모듈은 한 가지 책임만 가진다.
   - `page`, `element`, `network` 등 리소스 단위로 기능 응집.

2. **관심사 분리**
   - CLI(입력/출력) ↔ UseCase(업무 로직) ↔ Infra(CDP/IPC/FS) 분리.
   - 상태 저장 책임과 런타임 제어 책임 분리.

3. **추상화의 방향**
   - 상위 계층이 하위 계층(구체 인프라)을 참조하지 않게 Port를 사용.
   - CDP 상세는 `BrowserPort` 뒤에 캡슐화.

4. **명시적 계약**
   - 모든 요청/응답 스키마를 Zod로 선언.
   - 에러를 코드 기반으로 표준화.

5. **자동화 우선**
   - 기본 출력은 JSON이며 모든 명령은 `--output json`/`--output text`를 지원.
   - 종료코드 일관성 유지.

6. **안전한 상태 관리**
   - 파일락 + 원자적 쓰기 + PID 검증.
   - 세션 충돌/중복 데몬 방지.

7. **Token Efficient 인터페이스**
   - 기본 응답은 최소 필드만 반환하고, 상세 데이터는 명시적 플래그로 지연 공개.
   - 불필요한 설명 문구/배너/중복 로그를 기본 출력에서 제거.

8. **Composable (Unix Philosophy)**
   - 성공 데이터는 stdout(JSON), 진단/경고/오류 설명은 stderr로 분리.
   - 안정적인 필드명과 결정적 출력으로 `jq`, `xargs`, `while read` 파이프라인 친화성 확보.

9. **Self-Correcting**
   - 에러에 명확한 `code`, `reason`, `suggestions`를 포함.
   - 실행 가능한 다음 액션 예시(재시도 명령, 필요한 플래그)를 항상 제시.

10. **Self-Documenting**
   - 모든 리소스/명령이 `--help`로 스스로 사용법을 설명.
   - 문서 없이도 CLI 내부 도움만으로 탐색 가능해야 함.

11. **Agent-Transparent Isolation**
   - 기본 모드에서 에이전트가 `session id`를 입력/관리하지 않아도 격리가 자동 적용.
   - 격리 키는 런타임 컨텍스트로 자동 해석하고, 필요 시에만 명시적 공유 키를 사용.

---

## 5) 벤치마크 참고 요약 (browser-debugger-cli)

참고 저장소: `~/Developer/oss/browser-debugger-cli`

재사용할 핵심 패턴:

- CLI와 daemon 분리
- Unix socket + JSONL IPC
- CDP WebSocket 클라이언트 추상화
- 세션 메타/락/PID 파일 기반 관리
- 명령 레지스트리 기반 확장 구조
- 세션 디렉토리(예: `BDG_SESSION_DIR`) 단위로 프로필/락/소켓을 분리하는 네임스페이스 전략

본 계획에서는 위 패턴을 유지하되, 명령 체계를 CLI 친화적으로 재설계한다.

---

## 6) CLI 명령 체계 (재설계안)

## 6.1 Top-Level Command Tree

```text
cdt session start|stop|status|restart
cdt page open|list|use|close|navigate|resize|wait-text|wait-selector|wait-url
cdt observe state|targets
cdt element click|hover|drag|fill|fill-form|upload
cdt input key|type|mouse-move|click|mouse-down|mouse-up|drag|scroll
cdt dialog handle
cdt runtime eval
cdt capture snapshot|screenshot
cdt console list|get|wait
cdt network list|get|wait
cdt emulation set|reset
cdt trace start|stop|insight
```

### 6.2 공통 옵션

- `--page <id>`: 대상 페이지 지정(없으면 current page)
- `--timeout <ms>`: 명령 타임아웃
- `--output <text|json>`: 출력 형식
- `--headless / --headed`: 브라우저 실행 모드(세션 start 시)
- `--input-file <path>`: 대형 입력 JSON 파일
- `--fields <k1,k2,...>`: 필요한 필드만 선택 반환(토큰 절감)
- `--share-group <name>`: 여러 에이전트가 의도적으로 동일 컨텍스트를 공유할 때 사용
- `--context-id <id>`: 수동 컨텍스트 지정(디버그/운영자 전용, 일반 에이전트 경로에서는 비권장)
- `--describe`: 현재 명령의 입력 스키마/예시/오류코드 설명 출력
- `--verbose`: 사람이 읽는 부가 진단(기본은 최소 출력)

### 6.3 출력 규약

- 기본 출력은 JSON(`--output json`)이며, `--output text`를 명시하면 사람 친화 형식으로 변환
- 성공(stdout): `{"ok":true,"data":...,"meta":{"requestId":"...","durationMs":12}}`
- 실패(stdout): `{"ok":false,"error":{"code":"...","message":"...","details":...,"suggestions":["..."]}}`
- stderr는 부가 진단 로그 전용(자동화 파이프라인에서 stdout JSON 순도 유지)
- 기본 응답은 최소 필드만 포함하며, 상세 데이터는 `--verbose` 또는 리소스별 상세 플래그로 확장
- 기본적으로 ANSI color/장식 문구를 출력하지 않음(파이프 친화). 필요 시 text 모드에서만 선택 적용

### 6.4 종료 코드 규약

- `0` 성공
- `2` 사용법/검증 오류
- `3` 리소스 없음(page/context/slot not found)
- `4` 타임아웃
- `5` 상태 충돌(예: 이미 실행 중 세션 시작 시도)
- `6` 외부 의존 실패(Chrome 실행 실패, 파일 접근 실패)
- `7` 프로토콜 오류(IPC/CDP 응답 형식 불일치)
- `8` 일시 오류(재시도 가능)
- `10` 데몬/브라우저 연결 실패
- `11` 내부 오류

---

### 6.5 Progressive Disclosure 규약

- 레벨 0: 기본 명령은 최소 인자만으로 동작(예: `cdt page list`)
- 레벨 1: 고급 옵션은 명시적으로만 노출(예: `--include-body`, `--full-page`)
- 레벨 2: 진단/디버그는 opt-in (`--verbose`, `--describe`)
- 레벨 3: 초고급 기능은 별도 서브커맨드로 격리(예: `trace insight`)

### 6.6 Self-Documenting 규약

- `cdt --help`: 최상위 리소스/명령 목록 탐색
- `cdt <resource> --help`: 하위 커맨드 목록 탐색
- `cdt <resource> <command> --help`: 옵션/인자/예시 확인
- `cdt errors --help`: 오류 코드 조회 경로 안내

---

### 6.7 컨텍스트 자동 해석 규약 (세션 ID 무자각)

- 기본 모드에서는 `session id` 인자를 요구하지 않음
- CLI는 호출 시 `CallerContext`를 수집하고 broker daemon에 전달
- broker는 `ContextResolver`로 `contextKey`를 계산해 해당 브라우저 슬롯에 라우팅
- 컨텍스트 키 해석 우선순위:
  1. `CDT_CONTEXT_ID` (런타임/에이전트 프레임워크 주입값)
  2. `--share-group` (명시적 공유 요청)
  3. 프로세스 fingerprint(`pid`, `ppid`, `tty`, `cwd`) 기반 자동 키
  4. 최후 fallback 임시 키(수명 짧음, 경고 반환)
- `--context-id`는 운영자 디버그/복구용으로만 허용하고 자동 모드를 기본으로 유지

---

## 7) MCP 26개 기능 매핑표 (내부 동등성 확보용)

| MCP Tool | cdt Command |
|---|---|
| new_page | `page open` |
| list_pages | `page list` |
| select_page | `page use` |
| close_page | `page close` |
| navigate_page | `page navigate` |
| wait_for | `page wait-text` |
| resize_page | `page resize` |
| click | `element click` |
| hover | `element hover` |
| drag | `element drag` |
| fill | `element fill` |
| fill_form | `element fill-form` |
| upload_file | `element upload` |
| press_key | `input key` |
| handle_dialog | `dialog handle` |
| evaluate_script | `runtime eval` |
| take_snapshot | `capture snapshot` |
| take_screenshot | `capture screenshot` |
| list_console_messages | `console list` |
| get_console_message | `console get` |
| list_network_requests | `network list` |
| get_network_request | `network get` |
| emulate | `emulation set/reset` |
| performance_start_trace | `trace start` |
| performance_stop_trace | `trace stop` |
| performance_analyze_insight | `trace insight` |

---

## 8) 아키텍처 상세

### 8.1 계층 구조

1. **Interface Layer (`src/interface`)**
   - CLI 명령 파싱
   - 옵션/입력 스키마 검증 진입점
   - 출력 포맷(text/json)

2. **Application Layer (`src/application`)**
   - 유스케이스 실행 (예: `PageOpenUseCase`)
   - 트랜잭션 경계/오케스트레이션
   - Port 호출 조합

3. **Domain Ports (`src/domain/ports`)**
   - `BrowserPort`, `SessionStorePort`, `DaemonControlPort`
   - 추상 계약 선언(구현 비의존)

4. **Infrastructure Layer (`src/infrastructure`)**
   - CDP client/chrome launcher
   - IPC client/server
   - 파일 저장소/락/PID/원자적 쓰기

### 8.2 의존성 규칙

- `interface -> application -> domain(ports) <- infrastructure`
- 상위 계층이 하위 구체 구현을 import하지 않도록 강제
- 역의존성은 생성자 주입으로 해결

### 8.3 런타임 구성

- `cdt`(CLI)는 요청을 IPC로 broker daemon에 전달
- broker daemon은 `ContextResolver`로 호출자 컨텍스트를 해석
- broker는 `contextKey -> browser slot` 매핑으로 라우팅
- 각 browser slot은 독립된 Chrome 프로세스 + `user-data-dir` + 텔레메트리 저장소를 보유
- CDP 이벤트(network/console 등)는 컨텍스트별 텔레메트리 저장소로 축적

### 8.4 브로커/슬롯 책임 분리

- **BrokerDaemon**
  - IPC endpoint 제공
  - ContextResolver 호출
  - Slot lifecycle 제어(create/reuse/stop)
  - 공통 정책 적용(rate limit, queue, exit code mapping)
- **BrowserSlot**
  - Chrome launch/attach
  - 페이지 선택/조작 상태 유지
  - context 전용 `user-data-dir` 관리
- **LeaseManager**
  - `lastSeenAt`, heartbeat, idle timeout 관리
  - owner process 종료 시 orphan slot 정리

---

## 9) 저장소 구조 계획

```text
.
├── PLAN.md
├── package.json
├── tsconfig.json
├── src
│   ├── bin
│   │   ├── cdt.ts
│   │   └── cdt-daemon.ts
│   ├── interface
│   │   └── cli
│   │       ├── program.ts
│   │       ├── output.ts
│   │       ├── errors.ts
│   │       └── commands
│   │           ├── session.ts
│   │           ├── page.ts
│   │           ├── element.ts
│   │           ├── input.ts
│   │           ├── dialog.ts
│   │           ├── runtime.ts
│   │           ├── capture.ts
│   │           ├── console.ts
│   │           ├── network.ts
│   │           ├── emulation.ts
│   │           └── trace.ts
│   ├── application
│   │   ├── session
│   │   ├── context
│   │   │   ├── ContextResolver.ts
│   │   │   ├── ContextRegistry.ts
│   │   │   ├── SlotRouter.ts
│   │   │   └── LeaseManager.ts
│   │   ├── page
│   │   ├── element
│   │   ├── input
│   │   ├── dialog
│   │   ├── runtime
│   │   ├── capture
│   │   ├── console
│   │   ├── network
│   │   ├── emulation
│   │   └── trace
│   ├── domain
│   │   └── ports
│   │       ├── BrowserPort.ts
│   │       ├── SessionStorePort.ts
│   │       └── DaemonControlPort.ts
│   ├── infrastructure
│   │   ├── cdp
│   │   │   ├── ChromeLauncher.ts
│   │   │   ├── CDPClient.ts
│   │   │   └── adapters
│   │   │       └── BrowserPortCDPAdapter.ts
│   │   ├── ipc
│   │   │   ├── protocol.ts
│   │   │   ├── JsonlSocketClient.ts
│   │   │   ├── JsonlSocketServer.ts
│   │   │   ├── BrokerRouter.ts
│   │   │   └── handlers
│   │   └── store
│   │       ├── paths.ts
│   │       ├── AtomicJsonFile.ts
│   │       ├── LockFile.ts
│   │       ├── PidFile.ts
│   │       ├── ContextKey.ts
│   │       ├── SessionStoreFs.ts
│   │       ├── ContextStoreFs.ts
│   │       └── TelemetryStoreFs.ts
│   └── shared
│       ├── errors
│       │   ├── ErrorCode.ts
│       │   ├── AppError.ts
│       │   └── toCliError.ts
│       ├── schema
│       │   ├── common.ts
│       │   └── envelopes.ts
│       ├── logging
│       └── util
└── tests
    ├── unit
    ├── integration
    └── e2e
```

---

## 10) 데이터 모델 & 상태 모델

### 10.1 `~/.cdt` 파일 구조

```text
~/.cdt/
  broker/
    daemon.pid
    daemon.sock
    daemon.lock
    daemon.log
  locks/
    context-<hash>.lock
  contexts/
    <hash>/
      metadata.json
      state.json
      lease.json
      owner.json
      chrome-profile/
      console.jsonl
      network.jsonl
      trace/
        latest.json
```

### 10.2 Context Metadata 예시

```json
{
  "contextKeyHash": "ctx_4f2c1...",
  "shareGroup": null,
  "resolvedBy": "env:CDT_CONTEXT_ID",
  "startedAt": "2026-02-22T00:00:00.000Z",
  "chromePid": 12345,
  "debugPort": 9222,
  "currentPageId": 1,
  "headless": true,
  "status": "running",
  "lastSeenAt": "2026-02-22T00:01:10.000Z"
}
```

### 10.3 Page State 예시

```json
{
  "pages": [
    { "id": 1, "targetId": "ABC", "url": "https://example.com", "title": "Example" }
  ],
  "selectedPageId": 1,
  "updatedAt": "2026-02-22T00:00:00.000Z"
}
```

---

## 11) IPC 프로토콜 계획

### 11.1 Envelope

- Request:
  - `id: string`
  - `op: string` (예: `page.open`)
  - `payload: object`
  - `context: { caller: CallerContext, shareGroup?: string, timeoutMs?: number }`

- Response:
  - `id: string`
  - `ok: boolean`
  - `data?: object`
  - `error?: { code: string, message: string, details?: object, suggestions?: string[] }`
  - `meta?: { durationMs: number, retryable?: boolean }`

### 11.2 오퍼레이션 네이밍

- `session.start`, `session.stop`, `session.status`
- `page.open`, `page.list`, `page.use`, `page.navigate`, ...

`CallerContext` 예시:

```json
{
  "runtimeContextId": "agent-opaque-id-if-present",
  "pid": 1234,
  "ppid": 1200,
  "tty": "/dev/ttys004",
  "cwd": "/Users/taeyoung/Developer/workspace/cdt"
}
```

### 11.3 Validation 경계

- CLI 진입 시 1차 검증(Zod)
- Daemon Handler 진입 시 2차 검증(Zod, 신뢰 경계 재확인)

### 11.4 동시성 제어

- 컨텍스트 단위 startup lock (동일 컨텍스트 중복 브라우저 생성 방지)
- 컨텍스트 단위 command queue (mutating op 직렬화)
- 컨텍스트 간 완전 병렬 처리

---

## 12) 에러 처리 정책

### 12.1 표준 ErrorCode 초안

- `VALIDATION_ERROR`
- `SESSION_NOT_FOUND`
- `SESSION_ALREADY_RUNNING`
- `CONTEXT_RESOLUTION_FAILED`
- `CONTEXT_LOCK_TIMEOUT`
- `CONTEXT_LEASE_EXPIRED`
- `PAGE_NOT_FOUND`
- `ELEMENT_NOT_FOUND`
- `DIALOG_NOT_OPEN`
- `NETWORK_REQUEST_NOT_FOUND`
- `TIMEOUT`
- `DAEMON_UNAVAILABLE`
- `BROWSER_LAUNCH_FAILED`
- `CDP_DISCONNECTED`
- `INTERNAL_ERROR`

### 12.2 매핑 규칙

- Domain/Application 에러는 `AppError`로 throw
- CLI 출력 직전에 사용자 메시지 + 기계용 code 동시 제공
- 실패 시 최소 1개 이상의 actionable suggestion 포함(가능하면 실행 가능한 명령 예시 제공)
- 내부 stack trace는 `--debug`에서만 노출

### 12.3 Self-Correcting 오류 응답 템플릿

실패 시 JSON 응답은 아래 형태를 강제한다.

```json
{
  "ok": false,
  "error": {
    "code": "PAGE_NOT_FOUND",
    "message": "Page 99 does not exist in current context.",
    "details": { "pageId": 99, "contextKeyHash": "ctx_4f2c1..." },
    "suggestions": [
      "Run: cdt page list --output json",
      "Then select a valid page: cdt page use --page <id>"
    ]
  },
  "meta": {
    "durationMs": 8,
    "retryable": false
  }
}
```

규칙:

- `error.code`는 고정된 enum만 사용
- `suggestions`는 최소 1개, 가능하면 2개 이상(즉시 실행 가능한 명령 포함)
- `retryable: true`인 경우 재시도 전략(백오프/타임아웃 조정) 힌트 포함

---

## 13) 테스트 전략

### 13.1 Unit Tests

- 각 UseCase 입력/출력/에러 분기
- Output formatter(text/json) 스냅샷 테스트
- schema 검증 테스트

### 13.2 Integration Tests

- CLI -> IPC client -> daemon handler 라우팅
- session store/lock/pid 동작
- 에러 코드/exit code 일치성
- ContextResolver 우선순위(`CDT_CONTEXT_ID` -> `--share-group` -> fingerprint) 검증
- 동일 컨텍스트 재호출 시 browser slot 재사용 검증
- 다른 컨텍스트 동시 호출 시 slot 분리 검증

### 13.3 E2E Tests (실 브라우저)

핵심 시나리오:

1. `session start`
2. `page open` (example.com)
3. `runtime eval` (title 읽기)
4. `element fill` + `input key`
5. `capture snapshot`
6. `network list` / `console list`
7. `session stop`

합격 기준:

- 모든 단계 `ok: true` 혹은 기대된 에러 코드
- 타임아웃 없이 완료
- 종료 후 orphan chrome/daemon 프로세스 없음

### 13.4 Multi-Agent 동시성 테스트

- 시나리오 A: 10개 에이전트(서로 다른 `CDT_CONTEXT_ID`)가 동시에 `page open` 실행
  - 기대: 10개의 독립 `chrome-profile` 생성, 상태/로그 교차 오염 없음
- 시나리오 B: 3개 에이전트가 동일 `--share-group`으로 실행
  - 기대: 동일 browser slot 재사용, 페이지 목록 공유
- 시나리오 C: 에이전트 프로세스 강제 종료
  - 기대: lease 만료 후 orphan slot 정리, 락/소켓 잔존 없음

---

## 14) 구현 단계 상세 (Phase Plan)

## Phase 0 — 부트스트랩

목표: 빌드/테스트 가능한 최소 뼈대 확보

작업:

- `package.json`/`tsconfig`/lint/test 도구 설정
- `src/bin/cdt.ts`, `src/interface/cli/program.ts` 기본 wiring
- 공통 에러/출력 유틸 작성
- JSON 기본 출력 + `--output text` 토글 구조 확정
- `--help`, `--describe` 스캐폴딩 추가
- `CallerContext` 수집 스캐폴딩(`CDT_CONTEXT_ID`, pid/ppid/tty/cwd) 추가

완료 기준:

- `cdt --help` 동작
- `cdt --help`, `cdt <resource> --help`, `--describe` 기본 동작
- `pnpm lint`, `pnpm test`, `pnpm typecheck` 기본 통과

---

## Phase 1 — Daemon + IPC + Session Core

목표: 상주 프로세스/통신/상태 기반 마련

작업:

- broker daemon 런처/종료/상태
- Unix socket JSONL client/server
- `~/.cdt` 경로/락/원자적 파일쓰기/PID 관리
- ContextResolver + ContextRegistry + LeaseManager 구현
- `session start|status|stop`를 현재 컨텍스트 기준으로 동작하도록 연결
- stdout/stderr 분리 규약 적용(파이프라인 안전성)

완료 기준:

- broker daemon 자동기동
- 중복 daemon 방지
- 강제 종료 후 복구 경로(cleanup) 존재
- 세션/IPC 오류가 semantic exit code로 안정적으로 매핑
- 같은 컨텍스트 재호출 시 동일 slot 재사용, 다른 컨텍스트 호출 시 분리 검증

---

## Phase 2 — MVP 10개 명령

목표: “CLI만으로 브라우저 제어 가능” 달성

우선 구현:

1. `page open`
2. `page list`
3. `page use`
4. `page navigate`
5. `capture snapshot`
6. `element fill`
7. `element click`
8. `input key`
9. `page wait-text`
10. `runtime eval`

완료 기준:

- MVP e2e 시나리오 통과
- JSON 출력 스키마 안정화
- self-correcting 에러(suggestions 포함) 기본 적용

---

## Phase 3 — Full Parity (26개 동등 기능)

목표: 나머지 기능 확장

추가 구현:

- `page close`, `page resize`
- `element hover`, `element drag`, `element fill-form`, `element upload`
- `dialog handle`
- `capture screenshot`
- `console list/get`
- `network list/get`
- `emulation set/reset`
- `trace start/stop/insight`

완료 기준:

- 매핑표 26개 전부 동작
- 각 명령 최소 1개 테스트 확보
- composable 사용성 검증(`jq`/pipe 예시 스크립트 테스트) 추가
- 컨텍스트 공유(`--share-group`)와 기본 격리(auto context) 동작이 전 명령에서 일관됨

---

## Phase 4 — Loop Primitives (Perception + Action)

목표: 에이전트 루프에서 즉시 사용할 수 있는 관측/조작 기본기를 제공

작업:

- `observe state`, `observe targets` 추가(루프용 구조화 상태 출력)
- `input`에 좌표 기반 액션 추가
  - `mouse-move`, `click`, `mouse-down`, `mouse-up`, `drag`, `scroll`, `type`
- `capture screenshot` 메타데이터 확장
  - 파일 경로, 해시, 해상도, 캡처 시각, 리사이즈 여부
- 스크린샷 저장 경로 표준화
  - 기본: `~/.cdt/contexts/<hash>/artifacts/screenshots/YYYY-MM-DD/`
  - 파일명 규약과 기본 보관 개수(LRU 정리) 적용

완료 기준:

- 관측(`observe`)과 액션(`input`) 프리미티브 E2E 통과
- 수동 스크린샷 캡처 + 메타데이터 계약이 안정화
- 에이전트가 “관측→행동→재관측” 루프를 구성할 수 있음

---

## Phase 5 — Feedback Loop Contract & Reliability

목표: 루프의 실패 복구/검증 가능성을 강화해 자동화 신뢰도 향상

작업:

- wait 확장
  - `page wait-selector`, `page wait-url`
  - `network wait`, `console wait`
- 루프 친화 오류 코드 확장
  - 예: `TARGET_OUT_OF_VIEW`, `TARGET_OBSCURED`, `TARGET_NOT_INTERACTABLE`, `ACTION_NO_EFFECT`
- 액션 결과 표준화(최소 공통 메타: page, target, duration, changed/noop)
- 관측 출력 compact/fields 최적화(토큰 절감 + 안정 필드 계약)

완료 기준:

- 액션 실패를 코드 기반 분기로 자동 복구 가능
- wait 계열 명령으로 루프 검증 단계가 안정적으로 작동
- 장시간 실행에서도 컨텍스트/아티팩트 누수 없이 동작

---

## Phase 6 — 안정화/운영성 강화

목표: 유지보수성/관측성 강화

작업:

- 구조 리팩터링(큰 파일 분리, 순환 의존 제거)
- 로그 수준/진단 명령(`cdt session status --verbose`)
- 실패 복구 전략(소켓 stale, pid stale 자동 정리)
- orphan context slot janitor(lease timeout 기반) 안정화

완료 기준:

- 장애 재현 시 원인 파악 가능(log 품질)
- 릴리즈 가능한 품질 게이트 통과
- 토큰 효율(기본 최소 응답)과 상세 공개(옵션 기반)의 UX 회귀 테스트 통과

---

## 15) 모듈별 구현 체크리스트

### 15.1 Session 모듈

- [ ] `start`: 현재 컨텍스트의 chrome launch + metadata 저장 + default page 선택
- [ ] `status`: broker/slot/pid/socket/context 상태 조회
- [ ] `stop`: 현재 컨텍스트 브라우저 정상 종료 + 잠금 해제
- [ ] stale lock/pid 정리 경로
- [ ] ContextResolver 우선순위/오류 처리
- [ ] `--share-group` 기반 명시적 공유 라우팅

### 15.2 Page 모듈

- [ ] open/list/use/close/navigate/resize/wait-text/wait-selector/wait-url
- [ ] current page fallback 규칙
- [ ] page not found 오류 통일

### 15.3 Element/Input/Dialog 모듈

- [ ] click/hover/drag/fill/fill-form/upload
- [ ] key/type 입력(복합 키 포함)
- [ ] 좌표 기반 마우스 액션(click/move/down/up/drag/scroll)
- [ ] dialog accept/dismiss + prompt text

### 15.4 Runtime/Capture 모듈

- [ ] eval(직렬화 가능한 반환 규칙)
- [ ] snapshot
- [ ] screenshot(파일 경로/품질/fullPage + 해시/해상도/캡처시각 메타)
- [ ] screenshot artifact 저장/정리 정책(LRU)

### 15.5 Observe 모듈

- [ ] `observe state` (url/title/viewport/scroll/activeElement/dialogOpen)
- [ ] `observe targets` (bbox/visible/enabled/editable/selector candidate)
- [ ] 루프 친화 compact/fields 출력

### 15.6 Console/Network 모듈

- [ ] list/get
- [ ] wait(pattern/method/status 기반)
- [ ] pagination 또는 limit 지원
- [ ] request/response body 저장 옵션

### 15.7 Emulation/Trace 모듈

- [ ] viewport/user-agent/network throttling/geolocation
- [ ] trace start/stop 저장
- [ ] insight 분석 결과 조회

---

## 16) 명령 UX 상세 가이드

### 16.1 예시 명령

```bash
cdt session start --headless --output json
cdt page open --url https://example.com --output json
cdt page list --output text
cdt page use --page 1
cdt runtime eval --function "() => document.title" --output json
cdt element fill --uid node-123 --value "hello"
cdt element click --uid node-456
cdt capture snapshot --output json
cdt session stop

# 여러 에이전트가 의도적으로 공유해야 할 때만 명시
cdt page list --share-group qa-team --output json
```

### 16.2 UX 규칙

- JSON이 기본 출력이며 텍스트 출력은 opt-in
- stdout은 파싱 가능한 결과만, stderr는 진단/경고 전용
- JSON 출력은 필드명/구조 안정성 유지(가능한 deterministic)
- 기본 응답은 최소 필드(토큰 효율), 상세는 옵션으로 점진 공개
- 사용자 입력 오류는 즉시 `VALIDATION_ERROR` + suggestions 반환
- 모든 명령은 `--help`/`--describe`로 자기 설명 가능해야 함
- 기본 사용자 경로에서 session id 입력을 요구하지 않아야 함(자동 컨텍스트 라우팅)

### 16.3 Composable 사용 예시(검증 대상)

```bash
# 현재 페이지 ID 추출 후 재사용
PAGE_ID=$(cdt page list --output json | jq -r '.data.pages[0].id')
cdt page use --page "$PAGE_ID" --output json

# 실패 코드 기반 분기 처리
cdt page use --page 999 --output json >/tmp/out.json
code=$?
if [ "$code" -eq 3 ]; then
  cdt page list --output json | jq '.data.pages'
fi

# 필요한 필드만 가져오기 (토큰/로그 절감)
cdt network list --fields id,url,status --output json | jq '.data.requests'
```

검증 포인트:

- 파이프라인에서 stdout JSON이 깨지지 않음
- stderr 로그가 stdout을 오염시키지 않음
- exit code로 조건 분기 가능

---

## 17) 리스크 및 대응

1. **CDP 이벤트 순서/레이스 컨디션**
   - 대응: 요청 ID 매핑 + 컨텍스트 큐/락 + 리트라이 정책 최소화

2. **데몬/소켓 stale 상태**
   - 대응: startup health-check + stale cleanup + pid alive 검사

3. **브라우저 버전 차이**
   - 대응: 지원 Chrome 버전 범위 명시 + CI에서 버전 고정

4. **테스트 flaky**
   - 대응: wait 조건 명시, 고정 sleep 금지, 테스트 전용 타임아웃 관리

5. **모듈 비대화**
   - 대응: 파일 크기 가이드(500 LOC 내외) 초과 시 분리

6. **컨텍스트 키 충돌/오탐**
   - 대응: 우선순위 높은 런타임 주입 키(`CDT_CONTEXT_ID`) 사용, fingerprint는 fallback 전용

7. **과도한 슬롯 증가로 인한 리소스 고갈**
   - 대응: idle timeout, max slot 수 제한, LRU 기반 정리 정책

---

## 18) 마일스톤 & 산출물

### M1 (Phase 0 완료)

- 산출물: 빌드 가능한 CLI skeleton
- 검증: help/lint/typecheck

### M2 (Phase 1 완료)

- 산출물: broker daemon + IPC + context core
- 검증: context-resolved `session start/status/stop` integration 통과

### M3 (Phase 2 완료)

- 산출물: MVP 10개 명령 + e2e 1개
- 검증: 실제 브라우저 제어 데모 성공

### M4 (Phase 3 완료)

- 산출물: 26개 동등 기능 지원
- 검증: 매핑 전 항목 테스트 통과

### M5 (Phase 4 완료)

- 산출물: 관측/액션 루프 프리미티브
- 검증: observe/input/capture 확장 E2E 통과

### M6 (Phase 5 완료)

- 산출물: feedback loop 계약/신뢰성 강화
- 검증: wait/오류코드/복구 분기 테스트 통과

### M7 (Phase 6 완료)

- 산출물: 안정화/문서화/운영성 개선
- 검증: 품질 게이트 + 수동 탐색 테스트 + composable/suggestion 회귀 테스트

---

## Progress Log

- 2026-02-22: Phase 1 착수 — TypeScript CLI 스캐폴드, daemon JSONL IPC, `~/.cdt` store 유틸, ContextResolver/Registry/LeaseManager, `session start|status|stop` 초기 연결 및 통합 테스트 초안 추가
- 2026-02-22: Phase 3 완료 — 26개 동등 기능(페이지/요소/콘솔/네트워크/에뮬레이션/트레이스) 구현 및 통합 테스트 통과
- 2026-02-22: Phase 4/5 착수 — `observe` 리소스, 좌표 기반 `input` 액션, wait 확장(`page/network/console`), 스크린샷 메타/아티팩트 정책 구현 및 루프 통합 테스트 통과

---

## 19) Definition of Done (최종)

- [ ] CLI 명령 체계가 베스트 프랙티스 형태로 정리됨
- [ ] MCP 26개 기능 동등성 달성
- [ ] 아키텍처 계층 분리 및 포트/어댑터 적용
- [ ] 테스트(단위/통합/e2e)로 핵심 경로 검증
- [ ] 린트/타입체크/테스트 전체 통과
- [ ] `PLAN.md` 기준 구현 체크리스트 모두 완료
- [ ] JSON 기본 출력, text 옵션 출력, stdout/stderr 분리 규약 준수
- [ ] semantic exit code + suggestions 기반 self-correcting UX 적용
- [ ] `--help`/`--describe` 기반 self-documenting UX 적용
- [ ] `jq`/pipe/shell script 합성 시나리오 검증 통과
- [ ] 세션 ID 무자각 자동 격리(default) + 명시적 공유(`--share-group`) 동작 검증 통과
- [ ] 멀티 에이전트 동시 호출 스트레스 테스트 통과(격리 누수 없음)

---

## 20) 즉시 다음 실행 순서 (Kickoff)

1. 프로젝트 bootstrap (`package.json`, TS 설정, 기본 CLI 엔트리)
2. `~/.cdt` store 유틸(atomic/lock/pid/path) 구현
3. IPC(JSONL socket) client/server + broker daemon lifecycle 구현
4. ContextResolver/ContextRegistry/LeaseManager 구현
5. CDP adapter + 컨텍스트 기반 `session start/status/stop` 연결
6. MVP 10개 명령 순차 구현 + e2e 작성

위 순서로 진행하면, 가장 빠르게 “CLI로 브라우저 제어 성공” 상태에 도달하면서도 구조적 품질을 유지할 수 있다.
