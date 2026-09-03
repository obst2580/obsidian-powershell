# 세션 히스토리 설계

작성: 2026-09-03
상태: 승인됨 (구현 착수)
범위: Obst Terminal 콘솔의 공통 기능. 프로바이더별 기능이 아니다.

## 1. 목적

`claude --resume`, `codex resume`처럼 이 볼트에서 있었던 AI 세션을 목록으로 보고
다시 열 수 있게 한다. 지금은 탭을 닫으면 세션이 잊힌다
(`closeInternalAgentSession`이 배열에서 제거만 함). CLI 쪽 기록은 디스크에 남아
있으므로 플러그인이 그것을 읽기만 하면 된다.

## 2. 결정 사항

- 히스토리는 콘솔의 **공통 기능**이다. 목록 하나에 세 프로바이더가 섞이고,
  프로바이더는 항목의 속성이다. 아래에서만 프로바이더별 어댑터가 각자 저장소를 읽는다.
- 목록은 **이 볼트 cwd의 세션 전부**다. Obsidian 밖 터미널에서 시작한 것도
  포함한다(`claude --resume`과 같은 범위). 출처는 `source`로 표시한다.
- UI는 **콘솔 안 패널**. 탭바의 시계 아이콘으로 토글하며, 트랜스크립트 자리에
  목록이 뜬다. 탭과 무관하게 전역이다.
- 항목 클릭 = **그 세션을 재개하는 새 탭**. 이미 열린 탭이면 그 탭으로 이동한다.
- 세 프로바이더 모두 1차에 포함한다.
- 히스토리는 읽기 전용 뷰다. 세션 상태 미러링(5곳 필드 복사)에는 손대지 않는다.

## 3. 공통 모델

```ts
interface AgentHistoryEntry {
  provider: AgentProvider;      // claude | codex | gemini
  id: string;                   // claude sessionId | codex threadId | agy conversation_id
  title: string;
  lastActiveAt: number;         // epoch ms
  turnCount: number | null;
  cwd: string | null;
  source: "plugin" | "external" | "unknown";
}

interface AgentHistorySource {
  readonly provider: AgentProvider;
  list(cwd: string): Promise<AgentHistoryEntry[]>;
}
```

병합 규칙: 세 어댑터 결과를 합쳐 `lastActiveAt` 내림차순. 열린 탭과 같은 id는
`open` 표시. 어댑터 하나가 실패해도 나머지는 보여준다(실패는 패널 하단 한 줄).

## 4. 어댑터

### 4.1 Claude — `~/.claude/projects/<cwd-slug>/*.jsonl`

- 디렉터리 탐색과 cwd 매칭은 기존 `getAgentSessionRoot`, `agentSessionFileMatches` 재사용.
- 제목: `type: "custom-title"` 레코드의 `customTitle`(이 볼트 47/47 존재).
  **단, 플러그인이 print 턴에 `--name <탭 라벨>`을 넘기고 Claude Code가 그것을
  custom-title로 저장하므로 "Claude Code 3" 같은 탭 라벨은 제목으로 쓰지 않는다.**
  그 경우와 custom-title이 없는 경우 첫 `type: "user"` 메시지 텍스트. 플러그인 프리앰블
  `[현재 실행 설정] … [현재 사용자 요청]\n` 이 앞에 붙어 있으면 그 뒤만 취한다.
- `lastActiveAt`: 레코드 `timestamp`의 **최대값**. (`last-prompt` 등 timestamp 없는
  레코드가 파일 끝에 오므로 tail을 쓰면 안 된다.)
- `turnCount`: `type: "assistant"` 레코드 수.
- `source`: `promptSource === "sdk"`인 user 레코드가 있으면 `plugin`, 아니면 `external`.
- 읽기 비용: 파일당 한 번 순차 스캔. 큰 파일은 앞 256KB로 제목·cwd, 뒤 256KB로
  최종 timestamp를 잡는 2단 읽기로 제한한다(기존 `readFilePrefix` 패턴).

### 4.2 Codex — `thread/list` RPC

- 파라미터: `{ cwd, sortKey: "updated_at", sortDirection: "desc", limit: 50 }`.
  `nextCursor`가 있으면 "더 보기"로 이어 받는다.
- 제목: `name` → 없으면 `preview`(프리앰블 제거 규칙 동일).
- `lastActiveAt = updatedAt`, `turnCount = turns.length`.
- `source`: `threadSource`/`source`가 `appServer`면 `plugin`, `cli`면 `external`.
- 백엔드가 살아 있을 때만 가능하다. 죽어 있으면 기존 `tryResumeRecentThread`처럼
  일시 프로세스를 띄우지 않고, 패널에 "Codex 세션을 시작하면 목록이 나옵니다"로 안내.
  (1차 범위. 별도 목록 전용 프로세스는 후속.)

### 4.3 Antigravity — `~/.gemini/antigravity-cli/conversation_summaries.db`

- SQLite. 플러그인이 이미 띄우는 **시스템 Node의 `node:sqlite`**로 읽는다.
  wasm 번들 없음, 패키징 변경 없음. 스크립트는 stdin으로 넘겨 Windows 인자 인용을
  피한다: `node --no-warnings --input-type=module -`.
- 쿼리: `conversation_id, title, preview, step_count, last_modified_time,
  workspace_uris` from `conversation_summaries` order by `last_modified_time desc`.
- 제목: `title` → 없으면 `preview`(프리앰블 제거).
- cwd: `workspace_uris`에 볼트 경로가 있으면 매칭. **플러그인이 시작한 대화는
  `workspace_uris`가 비어 있다.** 그런 항목은 프리앰블 존재로 `plugin`으로 표시하고
  목록에 포함한다. 나머지 빈 항목은 `unknown`으로 포함하되 필터로 숨길 수 있다.
- `node:sqlite` 하한: Node 22.13 이상 플래그 없음. 이하이거나 실패하면 빈 목록 +
  한 줄 안내. Windows Node 버전은 사용자 환경에서 확인한다.

## 5. 재개 배선

| 프로바이더 | 새 탭에 설정 | 이후 동작 |
|---|---|---|
| Claude | `claudeSessionId = id` | 기존 print 경로가 `--resume <id>`로 이어감 (`getClaudePrintSessionArgs`) |
| Codex | `codexThreadId = id` | 기존 `resumeThreadId` → `thread/resume` |
| Antigravity | `geminiSessionId = id` | **신규**: agy print 분기에 `--conversation <id>` 추가 |

`createInternalAgentSession(provider, resume?)`에 선택 인자를 추가한다. 세션 상태를
만든 직후, `applyAgentSessionRuntime` 전에 id를 넣는다. 다른 호출부는 변경 없음.

Antigravity는 재개뿐 아니라 **포착**도 필요하다. print 턴에 `--output-format json`을
쓰면 응답에 `conversation_id`가 온다. 이를 `agentGeminiSessionId`에 저장해야
플러그인에서 시작한 대화도 다음 턴부터 이어지고 히스토리에서 다시 열린다.
출력 파싱은 `response` 필드를 본문으로 쓴다. **실패 시에는 stderr가 비고 stdout JSON의
`error` 필드에 메시지가 오므로(exit 1, `status: "ERROR"`) 그 텍스트를 표시·매칭에 쓴다.**
`usage`(input/output/thinking/cache_read/total)는 IN/OUT 토큰 표시에 연결한다.

## 6. 패널

- 탭바 오른쪽, `+` 옆에 시계 아이콘. 토글.
- 상단: 검색 입력 하나, 프로바이더 칩(Claude/Codex/Antigravity), 출처 칩(전체/플러그인/외부).
- 행: 프로바이더 아이콘 · 제목 · 상대 시각 · 턴 수 · `open`/`external` 배지.
- 클릭: 열린 탭이면 전환, 아니면 재개 탭 생성 후 패널 닫힘.
- 로딩은 어댑터별 비동기. 먼저 온 것부터 그린다.
- 새로고침 버튼. 패널을 열 때마다 자동 재조회.

## 7. 하지 않는 것

삭제·이름 변경·아카이브, 세션 내용 미리보기, 프로바이더 간 이어붙이기,
Codex 목록 전용 프로세스, 모바일.

## 8. 검증

- 파서(Claude jsonl 제목/시각/턴, 프리앰블 제거, agy preview 정리, Codex 응답 매핑)는
  의존성 주입으로 순수 함수로 두고 `node:test`로 단위 테스트한다(새 의존성 없음).
- 통합 동작(패널, 재개)은 **윈도우 회사 PC**에서 확인한다. 이 맥은 개인 프로젝트용이며
  PM 세션이 없다.
- Antigravity `node:sqlite`는 윈도우 Node 버전에 따라 비활성일 수 있다. 그 경우
  안내 문구가 나오는 것까지가 1차 합격 기준이다.

## 9. 파일

- `src/history/types.ts` — 공통 모델
- `src/history/claude-sessions.ts` — Claude 어댑터 + 파서
- `src/history/codex-threads.ts` — Codex 어댑터
- `src/history/antigravity-conversations.ts` — agy 어댑터 (node:sqlite 스크립트 포함)
- `src/history/merge.ts` — 병합·정렬·open 표시
- `src/main.ts` — 패널 UI, 토글, `createInternalAgentSession` 재개 인자,
  agy `--conversation`/`--output-format json` 포착
- `test/history/*.test.mjs` — 파서 단위 테스트
