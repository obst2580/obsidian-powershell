# Agent Console v2 설계 — 어댑터 아키텍처와 Codex App-Server 통합

작성: 2026-06-11. 구현 대상 세션을 위한 자기완결 설계 문서.
구현 전 이 문서 전체와 "구현 세션 시작 가이드"(맨 끝)를 읽을 것.

## 1. 배경과 문제

Obst Terminal은 Obsidian 우측 사이드바에서 볼트 경로를 cwd로 Claude Code / Codex CLI를
구독 인증 그대로 실행하는 플러그인이다. 현재 두 가지 표시 경로가 있다.

- Raw terminal: xterm.js + node-pty. TUI 전체 재그리기(CSI 2J/3J), ConPTY(특히
  Windows 10 19045) 한계로 스크롤 소실, 글자 잘림, 중복 프레임 등 렌더링 버그가
  반복된다. CLI 쪽 원인(openai/codex#14277 등)은 플러그인에서 근본 해결 불가.
- Agent Console: PTY로 입력을 보내고 출력은 로컬 세션 로그(JSONL)를 폴링해 렌더.
  로그 포맷이 비공식이고, 로그인/승인 프롬프트 감지가 정규식 휴리스틱이라 취약.

해결 방향: 터미널 에뮬레이션을 우회하고 구조화된 프로토콜로 직결한다.

## 2. 확정된 외부 사실 (2026-06-11 검증)

1. Codex CLI는 공식 `codex app-server` JSON-RPC 2.0 프로토콜을 제공한다.
   - OpenAI의 VS Code 확장, 웹, 데스크톱 앱이 모두 이 프로토콜로 동작.
   - "Sign in with ChatGPT" 포함 — 구독 인증 유지.
   - 이 머신의 codex-cli 0.139.0에서 `codex app-server`, `generate-ts`,
     `generate-json-schema` 동작 확인. v2 타입 473개 생성 확인
     (ThreadStartParams, TurnStartParams, *RequestApprovalParams 등).
   - 단 CLI 도움말에 [experimental] 표기 — 버전 간 프로토콜 변경 가능. 9절 리스크 참조.
2. Anthropic 2026-06-15 과금 변경: `claude -p` / Agent SDK / GitHub Actions는 구독
   한도에서 분리되어 별도 월 크레딧(Pro $20 / Max5x $100 / Max20x $200 상당)으로
   이동. 크레딧 소진 시 옵트인하면 API 요금, 안 하면 요청 실패. 인터랙티브 터미널
   사용은 무변경. 따라서:
   - Claude를 구독 한도 안에서 내 UI로 쓰는 유일한 경로 = 인터랙티브 CLI를 PTY 뒤에
     숨기고 세션 로그를 렌더하는 현행 Agent Console 방식.
   - Agent SDK 경로는 "월 크레딧 실측 후" 선택지로 보류.

## 3. 목표 / 비목표

목표
- G1. Codex를 app-server 프로토콜로 직결해 터미널 렌더링 버그를 원천 제거한다.
- G2. 구독 인증(ChatGPT 로그인, Claude 구독)을 유지한다.
- G3. UI(transcript, composer, 승인 카드)는 공용으로 한 번만 만들고, 백엔드는
  어댑터로 교체 가능하게 한다.
- G4. Raw terminal은 폴백으로 유지한다(셸 작업, 비상시).

비목표
- N1. Claude Agent SDK 백엔드의 본 구현 (6/15 이후 크레딧 실측 뒤 별도 결정.
  단 어댑터 인터페이스는 이를 수용할 수 있어야 함).
- N2. 기존 raw terminal / pty-host 경로의 리팩토링.
- N3. 모바일 지원 (플러그인은 isDesktopOnly).

## 4. 전체 아키텍처

```
                        +--------------------------+
                        |  AgentConsoleView (공용)  |
                        |  transcript / composer / |
                        |  approval cards / status  |
                        +-----------+--------------+
                                    | AgentBackend 인터페이스
            +-----------------------+-----------------------+
            |                       |                       |
  CodexAppServerBackend   ClaudeSessionLogBackend   ClaudeAgentSdkBackend
  (신규, 이번 구현)        (현행 로직 추출)           (후속, 스텁만)
            |                       |
  codex app-server          pty-host.js + claude CLI
  (JSON-RPC over stdio)     (~/.claude/projects JSONL 폴링)
```

### 4.1 AgentBackend 인터페이스 (src/agent/types.ts)

```ts
export interface AgentBackend {
  readonly id: "codex-appserver" | "claude-sessionlog" | "claude-agent-sdk";
  start(options: AgentStartOptions): Promise<void>;
  stop(): Promise<void>;
  sendUserMessage(input: AgentUserInput): Promise<void>;
  interrupt(): Promise<void>;
  respondToApproval(requestId: string, decision: ApprovalDecision): Promise<void>;
  on(listener: (event: AgentUiEvent) => void): () => void;  // unsubscribe 반환
}

export interface AgentStartOptions {
  cwd: string;                  // vault path
  resumeThreadId?: string;
  model?: string;
  effort?: string;
}

export type AgentUserInput = {
  text: string;
  attachments?: Array<{ kind: "localImage" | "mention"; path: string }>;
};

export type ApprovalDecision =
  | "accept" | "acceptForSession" | "decline" | "cancel";

// 백엔드 -> UI 단방향 이벤트. UI는 이것만 알면 된다.
export type AgentUiEvent =
  | { type: "status"; state: AgentStatus; detail?: string }
  | { type: "auth-required"; methods: AuthMethod[] }
  | { type: "auth-url"; url: string; userCode?: string }
  | { type: "item-start"; item: TranscriptItem }
  | { type: "item-delta"; itemId: string; textDelta: string }
  | { type: "item-complete"; item: TranscriptItem }
  | { type: "approval-request"; request: ApprovalRequest }
  | { type: "approval-resolved"; requestId: string }
  | { type: "turn-complete"; status: "completed" | "interrupted" | "failed";
      tokenUsage?: TokenUsage }
  | { type: "thread-ready"; threadId: string }
  | { type: "fatal"; message: string; canRestart: boolean };

export type AgentStatus =
  | "idle" | "starting" | "checking-auth" | "login-required"
  | "ready" | "running" | "waiting-approval" | "stopped" | "error";

export interface TranscriptItem {
  id: string;
  kind: "userMessage" | "agentMessage" | "reasoning" | "commandExecution"
      | "fileChange" | "plan" | "webSearch" | "mcpToolCall" | "system";
  text: string;                 // 누적 텍스트 (delta로 갱신)
  meta?: Record<string, unknown>; // command, exitCode, diff 등 kind별 부가정보
}

export interface ApprovalRequest {
  id: string;                   // JSON-RPC 서버 요청 id (응답에 사용)
  kind: "commandExecution" | "fileChange";
  summary: string;              // 명령어 또는 변경 파일 요약
  detail: string;               // 전체 명령 / diff
}
```

설계 원칙: UI 이벤트 모델은 의도적으로 "최소 공통분모"다. Claude 세션로그
백엔드는 delta 없이 item-complete만 쏘면 되고, Codex 백엔드는 delta를 쏜다.
UI는 둘 다 동일하게 렌더한다.

## 5. Codex App-Server 어댑터 상세

### 5.1 프로세스 수명주기 (src/agent/codex/process.ts)

- spawn 대상: `codex app-server` (stdio transport가 기본).
- Windows에서 npm 설치 codex는 `codex.cmd` shim이다. `spawn("codex", ...)`는
  실패한다. 해결: 기존 플러그인의 node 해석 패턴을 따라 codex 실행 파일 해석
  유틸을 만든다.
  1. 설정값 `codexExecutable`이 있으면 그것.
  2. `where.exe codex` (win) / `which codex` (unix) 결과의 첫 항목.
  3. `.cmd`/`.ps1`이면 그 안의 실제 node 스크립트를 직접 실행하거나
     `spawn(cmdPath, args, { shell: false })` 대신
     `spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", cmdPath, ...args])`.
     (셸 인자 주입 방지: 인자는 고정 문자열 "app-server"뿐이므로 안전.)
- env: 기존 `buildProcessEnv({ useSystemCa, extraCaCertPath })`를 재사용한다.
  사내 CA 환경에서 app-server의 HTTPS 통신이 동작해야 한다.
- cwd: 볼트 경로.
- 수명: 뷰(AgentConsoleView)가 열려 있는 동안 1개 프로세스. onClose 시
  stdin end + 유예 후 kill. 플러그인 onunload에서도 보장.
- 크래시: exit 이벤트 수신 시 `fatal { canRestart: true }` 발행. UI에 Restart
  버튼. 자동 재시작은 1회만(루프 방지).

### 5.2 JSON-RPC 클라이언트 (src/agent/codex/rpc.ts)

- Framing: newline-delimited JSON, 한 줄당 한 메시지. `"jsonrpc":"2.0"` 필드는
  와이어에서 생략된다 (공식 문서 명시).
- stdout 버퍼링: 기존 `handleHostStdout`과 동일한 줄 단위 누적 파서.
  부분 줄은 다음 청크까지 보류. (참고: Agent Console 1MB 버그의 교훈 —
  라인 경계 처리 필수.)
- 요청: 증가 정수 id, `Map<id, {resolve, reject, timeoutTimer}>`.
  기본 타임아웃 30s, `turn/start`는 타임아웃 없음(턴은 길 수 있음 — 응답은
  턴 종료가 아니라 턴 객체 반환이므로 실제로는 빨리 옴. 그래도 60s).
- 알림(id 없음): 이벤트 디스패처로.
- 서버->클라이언트 요청(id 있음 + method 있음): 승인 요청이 이 형태다.
  `item/commandExecution/requestApproval` 등. 반드시 같은 id로 응답을 보내야
  한다. pending 서버 요청 Map으로 관리.
- 에러 -32001 (overloaded): 지수 백오프 + 지터로 재시도 (최대 3회).
- 알 수 없는 알림: 무시(로그만). 전방 호환의 핵심.
- 노이즈 감소: initialize 시 `capabilities.optOutNotificationMethods`로
  불필요 알림(fuzzyFileSearch/*, fs/changed 등) 구독 해제.

### 5.3 핸드셰이크와 인증 상태머신 (src/agent/codex/backend.ts)

시작 시퀀스:

```
spawn -> initialize(clientInfo: {name:"obst-terminal", version: manifest.version})
      -> initialized notification 전송
      -> account/read
           로그인됨   -> thread/start 또는 thread/resume -> status: ready
           미로그인   -> status: login-required, auth-required 이벤트
```

로그인 흐름 (UI 버튼 "Sign in with ChatGPT" 클릭 시):

```
account/login/start { type: "chatgpt" }
  -> 응답의 authUrl을 기존 openExternalUrlWithSystemBrowser()로 열기
  -> account/login/completed 알림 대기 -> account/read 재확인 -> ready
```

폴백: 브라우저 콜백(localhost 서버)이 막힌 환경용으로
`{ type: "chatgptDeviceCode" }` — 응답의 verificationUrl + userCode를
transcript에 표시(기존 auth-code UI 패턴 재사용). 설정으로 선택 가능하게 한다.

`account/login/cancel`, `account/logout`도 UI에 노출 (로그인 버튼의 메뉴).

### 5.4 스레드와 턴

- `thread/start { cwd, approvalPolicy, model? }` -> threadId 저장.
  - threadId는 플러그인 데이터(data.json)에 볼트별 최근 스레드로 저장하고,
    다음 시작 시 `thread/resume { threadId }`를 우선 시도, 실패하면 start.
  - `thread/list { cwd }`로 과거 스레드 선택 UI는 Phase 4.
- `turn/start { threadId, input: [...] }`
  - 텍스트: `{ type: "text", text }`.
  - 이미지 붙여넣기(기존 saveAttachmentBytes 흐름): 볼트에 저장 후
    `{ type: "localImage", path: 절대경로 }`로 입력에 직접 첨부. 기존 `@path`
    문자열 삽입보다 정확하다.
  - 현재 노트 자동 공유(active note context): `{ type: "mention", path }`.
- 진행 중 추가 입력: `turn/steer { expectedTurnId }` — Phase 4.
- 중단: `turn/interrupt { threadId, turnId }`. Stop 버튼에 연결.
  turn/completed가 `status: "interrupted"`로 온다.

### 5.5 이벤트 -> UI 매핑 (src/agent/codex/events.ts)

| app-server 알림 | AgentUiEvent | UI 표현 |
|---|---|---|
| `thread/started` | thread-ready | 상태줄에 스레드명 |
| `turn/started` | status: running | 로딩 인디케이터 |
| `item/started` (agentMessage) | item-start | 빈 어시스턴트 말풍선 생성 |
| `item/agentMessage/delta` | item-delta | 말풍선에 텍스트 스트리밍 |
| `item/completed` (agentMessage) | item-complete | 말풍선 확정 |
| `item/reasoning/summaryTextDelta` | item-delta (kind: reasoning) | 접힌 "Thinking" 섹션 |
| `item/started` (commandExecution) | item-start (kind: commandExecution) | 명령 카드 (명령어 표시) |
| `item/commandExecution/outputDelta` | item-delta | 카드 내 출력 스트리밍. payload는 base64 — 디코드 필요 |
| `item/completed` (commandExecution) | item-complete | exit code 뱃지 |
| `item/completed` (fileChange) | item-complete (kind: fileChange) | 변경 파일 목록 + diff 토글 |
| `turn/plan/updated` | item-complete (kind: plan) | 체크리스트 위젯 |
| `turn/diff/updated` | (meta 갱신) | "전체 diff 보기" 버튼 |
| `item/commandExecution/requestApproval` (서버 요청) | approval-request | 승인 카드: Accept / Accept for session / Decline |
| `item/fileChange/requestApproval` (서버 요청) | approval-request | 동일 |
| `serverRequest/resolved` | approval-resolved | 승인 카드 비활성화 |
| `turn/completed` | turn-complete | 상태 idle + 토큰 사용량 |
| `thread/tokenUsage/updated` | (status detail) | 상태줄 토큰 카운터 |
| `account/rateLimits/updated` | (status detail) | 상태줄 |
| `account/login/completed` | status 갱신 | 로그인 완료 처리 |
| `thread/status/changed` (systemError) | fatal | 에러 + Restart |
| 그 외 전부 | 무시 | - |

### 5.6 승인 흐름

approvalPolicy 기본값은 `"unlessTrusted"` (설정으로 never/always 선택).
서버 요청 수신 -> ApprovalRequest로 변환해 UI에 카드 표시 -> 사용자가 버튼
클릭 -> `respondToApproval`이 보류 중인 서버 요청 id로 JSON-RPC 응답 전송.
응답 값: `accept` / `acceptForSession` / `decline` / `cancel`
(CommandExecutionRequestApprovalResponse 타입 준수 — vendored 타입 참조).
뷰가 닫히거나 프로세스가 죽으면 보류 승인 요청은 모두 무효화하고 transcript에
시스템 메시지를 남긴다.

## 6. UI 설계 (AgentConsoleView 변경)

기존 createAgentConsole의 구조(헤더/툴바/transcript/composer)를 유지하되,
백엔드 직결 부분을 AgentBackend 이벤트 구독으로 교체한다.

- 프로바이더 버튼: Claude / Codex 유지. Codex 선택 시 신규 백엔드 사용.
  설정 `codexUseAppServer`(기본 ON)가 꺼져 있으면 기존 PTY 경로로 폴백.
- transcript: 기존 appendAgentTranscript를 확장해 (a) item-delta로 같은 말풍선
  텍스트를 갱신하는 streaming 모드, (b) kind별 카드(명령/파일변경/계획/추론)
  렌더러를 추가. DOM 노드는 itemId -> element Map으로 추적.
- 승인 카드: 기존 agentPromptActionsEl 패턴 재사용 (버튼 행). 단 정규식 감지가
  아니라 구조화 이벤트 기반이므로 휴리스틱 코드는 Codex 경로에서 제거된다.
- 상태줄: AgentStatus enum 직결. 기존 setAgentStatus 재사용.
- Stop 버튼 -> interrupt(). Restart 버튼 -> stop() 후 start().
- Raw 버튼(터미널 폴백) 유지.

## 7. 설정 추가

| 키 | 기본값 | 설명 |
|---|---|---|
| `codexUseAppServer` | true | Codex를 app-server 프로토콜로 실행 (끄면 기존 PTY 경로) |
| `codexExecutable` | "" (auto) | codex 실행 파일 경로 수동 지정 |
| `codexApprovalPolicy` | "unlessTrusted" | never / unlessTrusted / always |
| `codexLoginMethod` | "browser" | browser / deviceCode |
| `codexModel` | "" (서버 기본) | Phase 4에서 model/list로 드롭다운 |

기존 codexNoAltScreen / codexDisableResizeReflow / codexPreserveScrollback은
raw terminal 전용임을 설정 설명에 명시 (app-server 경로에는 무관).

## 8. 타입 바인딩 전략

- `codex app-server generate-ts --out src/agent/codex/protocol/` 결과를 저장소에
  vendoring한다 (codex 0.139.0 기준, v2 디렉토리 포함 473파일).
  생성 버전을 `src/agent/codex/protocol/VERSION` 파일에 기록.
- 코드에서는 v2 타입만 import. 전부 타입 전용(import type)이므로 번들 크기
  영향 없음 (esbuild가 제거).
- codex 버전이 올라 프로토콜이 바뀌면: initialize 응답의 서버 정보로 로깅만
  하고, 알 수 없는 알림은 무시하므로 대부분 호환. 깨지는 변경 발견 시
  generate-ts 재실행 + 어댑터 수정.

## 9. 리스크와 완화

| 리스크 | 완화 |
|---|---|
| app-server가 [experimental] — 버전 간 변경 가능 | 최소 지원 버전 0.139.0 명시, 타입 vendoring, 알 수 없는 이벤트 무시, account/read 실패 시 명확한 에러 메시지("codex CLI를 업데이트하세요") |
| Windows에서 codex.cmd spawn 실패 | 5.1의 실행 파일 해석 유틸 + ComSpec 경유 실행 |
| 사내 프록시/CA로 로그인 콜백 실패 | deviceCode 폴백 + buildProcessEnv 재사용 |
| 승인 요청을 놓치면 턴이 영구 대기 | 보류 서버 요청 추적 + 뷰 종료 시 cancel 응답 전송 |
| 프로세스 좀비 (Obsidian 강제 종료) | windowsHide + 자식 프로세스는 Obsidian 종료 시 OS가 정리. stdin end 우선, kill 폴백 |
| 5500줄 main.ts에 추가 시 비대화 | 신규 코드는 전부 src/agent/ 모듈로 분리 (아래 10절) |

## 10. 파일 구조 (신규 코드)

```
src/
  main.ts                      # 기존. AgentConsole 연결부만 수정
  agent/
    types.ts                   # AgentBackend, AgentUiEvent, TranscriptItem 등
    codex/
      backend.ts               # CodexAppServerBackend (상태머신, 5.3-5.4)
      process.ts               # 실행 파일 해석 + spawn/kill (5.1)
      rpc.ts                   # JSONL framing, 요청/응답/서버요청 관리 (5.2)
      events.ts                # 알림 -> AgentUiEvent 매핑 (5.5)
      protocol/                # generate-ts vendored 타입 (8절)
    claude/
      sessionlog-backend.ts    # Phase 5: 기존 로직 추출 (선택)
```

각 파일 200-400줄 목표. main.ts에서 신규 로직을 추가하지 않는다.

## 11. 단계별 구현 계획 (구현 세션용 체크리스트)

Phase 0 — 준비 (반나절)
- [ ] `codex app-server generate-ts`로 protocol/ vendoring + VERSION 기록
- [ ] src/agent/types.ts 인터페이스 정의
- [ ] codex 실행 파일 해석 유틸 + 단위 테스트 가능 구조로 분리
- [ ] 설정 5종 추가 (스키마 버전 bump 불필요 — 추가만)

Phase 1 — RPC + 인증 (1일)
- [ ] rpc.ts: framing, 요청/알림/서버요청 분기, 타임아웃, -32001 백오프
- [ ] process.ts: spawn/stop/crash 처리
- [ ] backend.ts: initialize -> account/read -> 상태 이벤트
- [ ] UI: Codex 선택 + Start 시 로그인 상태 표시, Sign in 버튼으로 browser
      로그인 왕복 (account/login/start -> authUrl -> completed)
- 검증: 로그인 안 된 상태/된 상태 각각에서 상태줄이 올바른가

Phase 2 — 대화 (1일)
- [ ] thread/start(+resume) / turn/start
- [ ] agentMessage delta 스트리밍 렌더 (itemId -> element Map)
- [ ] reasoning 접힘 섹션, turn/completed -> 토큰 사용량 표시
- [ ] Stop = turn/interrupt
- 검증: 긴 응답 스트리밍, 중단, 연속 턴, Obsidian 재시작 후 resume

Phase 3 — 실행과 승인 (1일)
- [ ] commandExecution 카드 + outputDelta(base64 디코드) 스트리밍
- [ ] fileChange 카드 (변경 파일 목록, diff 토글)
- [ ] requestApproval 서버 요청 -> 승인 카드 -> 응답 왕복
- [ ] 뷰 종료/크래시 시 보류 승인 cancel 처리
- 검증: approvalPolicy 3종 각각에서 명령 실행 시나리오

Phase 4 — 편의 기능 (1일)
- [ ] 이미지 붙여넣기 -> localImage 첨부, 노트 참조 -> mention
- [ ] model/list 기반 모델/effort 선택 드롭다운
- [ ] thread/list 기반 과거 세션 선택
- [ ] turn/steer (진행 중 추가 입력)

Phase 5 — 마무리
- [ ] 에러 복구 시나리오 점검 (프로세스 kill, 네트워크 단절, 미로그인 토큰 만료)
- [ ] README/README.ko 업데이트, 버전 bump, 릴리스
- [ ] (선택) 기존 Claude 세션로그 로직을 ClaudeSessionLogBackend로 추출

별도 트랙 — Claude Agent SDK 백엔드 (6/15 이후)
- 크레딧 풀 옵트인 후 한 달 사용량 실측 -> 크레딧 내면 구현 결정
- @anthropic-ai/claude-agent-sdk(TS)의 query() 스트림을 AgentUiEvent로 매핑
- AgentBackend 인터페이스는 이미 이를 수용하도록 설계됨 (4.1)

## 12. 테스트 계획

- 순수 로직(라인 framing 파서, 이벤트 매핑, codex 경로 해석)은 vitest 도입 후
  단위 테스트. node-pty 등 네이티브 의존성과 무관하므로 CI에서도 돌릴 수 있다.
- 프로세스/UI 통합은 수동 시나리오 체크리스트(각 Phase의 "검증" 항목).
- 회귀 주의점: raw terminal 경로와 기존 Claude Agent Console 경로는 건드리지
  않으므로 기존 동작 그대로여야 한다.

## 13. 구현 세션 시작 가이드

1. 이 문서를 처음부터 끝까지 읽는다.
2. `codex app-server generate-ts --out <temp>`를 실행해 현재 설치된 codex의
   프로토콜 타입을 확인한다 (이 문서는 0.139.0 기준).
3. 기존 코드의 진입점을 파악한다 (라인 번호는 변할 수 있으니 심볼로 검색):
   - `VaultPowerShellView.createAgentConsole` — Agent Console UI 구성
   - `startAgent` / `sendAgentInput` / `appendAgentTranscript` — 현행 흐름
   - `buildProcessEnv` — CA/프록시 env 구성 (재사용 필수)
   - `openExternalUrlWithSystemBrowser` — 로그인 URL 열기 (재사용)
   - `saveAttachmentBytes` — 이미지 첨부 (Phase 4에서 재사용)
4. Phase 0부터 순서대로. 각 Phase 끝에 빌드(npm run build) + 수동 검증 후
   커밋. 릴리스 절차는 README "Release process" 참조 (태그 = manifest 버전,
   v 접두사 금지).
5. 외부 문서:
   - https://developers.openai.com/codex/app-server
   - https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
