# Obst Terminal

Obsidian 데스크톱 우측 사이드바에서 현재 볼트 경로를 작업 디렉터리로 쓰는 **멀티 AI Agent Console** 플러그인입니다. 이 저장소의 현재 버전은 `0.6.89`입니다.

[English README](README.md)

> 데스크톱 전용 플러그인입니다. Claude Code, Codex CLI, Antigravity CLI(`agy`), Node.js, Git, npm 같은 외부 도구는 포함하지 않습니다. 사용자의 PC에 설치되어 있고 일반 터미널에서 실행되어야 합니다.

![Obsidian 우측 사이드바에서 AI agent를 실행한 Obst Terminal 화면](docs/images/obst-terminal-agent-console.png)

## 멀티 AI 세션 작업 공간

Obst Terminal은 한 명의 AI와만 대화하는 단일 콘솔이 아니라, **하나의 Obsidian 볼트 안에 여러 Claude Code / Codex / Antigravity 세션을 탭으로 열어두고 동시에 운용하는 작업 공간**입니다.

- 플러그인 내부 `+` 버튼 또는 `Open new AI session` 명령에서 Claude Code, Codex, Antigravity 중 하나를 선택해 AI 세션 탭을 추가합니다.
- 각 탭은 생성할 때 선택한 provider로 고정되며 독립적인 session ID, transcript, 실행 상태를 유지합니다.
- 탭을 전환해도 실행 중인 에이전트는 멈추지 않고 자기 transcript에 계속 기록합니다.
- Claude, Codex, Antigravity transcript는 세션/provider별 스크롤 위치를 보존하므로, 백그라운드 업데이트나 탭 전환 때문에 화면이 맨 위로 튀지 않습니다.
- 개인 Agent UI 상태는 볼트 밖의 현재 사용자 로컬 Obst Terminal 상태 폴더에 저장합니다. `.obsidian/plugins/vault-terminal/data.json`에는 공유 가능한 플러그인 설정만 남기며 Claude/Codex/Antigravity session ID, thread ID, 입력 중인 문장, transcript HTML은 저장하지 않습니다.
- PM, Writer, Reviewer, Researcher처럼 역할별 AI 직원을 같은 프로젝트 문서 옆에 나눠둘 수 있습니다.
- 한 세션에서 `@all`, `@codex`, `@claude`, `@gemini`(=`@antigravity`), `@"세션 제목"`으로 다른 실행 중인 AI 세션에 지시를 전달할 수 있습니다.
- composer 안의 paperclip 아이콘 또는 이미지 붙여넣기로 파일을 첨부할 수 있습니다. 붙여넣은 이미지는 설정된 attachment folder에 저장되고 Claude, Codex, Antigravity에 로컬 파일 경로로 전달됩니다.
- 마이크 버튼을 누르면 녹음을 시작하고, 정지할 때 전체 녹음을 설정된 서버로 한 번만 보내 전사합니다. 녹음 중에는 경과 시간만 표시하며, 결과는 AI에 자동 전송하지 않고 녹음을 시작한 탭의 입력창에 넣습니다.
- 입력창 위에는 현재 활성 Obsidian 노트와 선택 영역이 계속 표시됩니다. 연결을 끄지 않은 일반 turn은 이 상태를 전송 시점에 공유하므로 `이게`, `여기`, `이 부분`, `보니까`처럼 문서명을 생략해도 현재 문맥으로 해석합니다.
- Claude, Codex, Antigravity transcript 안에서 마우스로 일부 영역만 선택해 복사할 때 전체 메시지 카드가 복사되지 않도록 플러그인이 선택 범위 기준으로 복사합니다.

## 현재 동작 기준

Obst Terminal을 처음 열면 기본 `Claude Code` 탭이 생성됩니다. 이후에는 탭 끝의 `+` 메뉴에서 `Claude Code`, `Codex`, `Antigravity`를 선택하며, 생성된 탭의 provider는 변경되지 않습니다.

한 볼트 안에서 여러 AI 세션을 나눠 사용할 수 있습니다. `Open AI workspace` 명령은 첫 Obst Terminal 뷰를 재사용하고, `Open new AI session` 명령이나 Agent Console의 `+` 메뉴는 Obsidian 탭을 새로 만들지 않고 선택한 provider의 세션 탭을 플러그인 내부에 추가합니다. 각 탭은 provider 기반 이름, 독립 session ID, transcript, backend/프로세스 상태를 유지합니다. 탭을 바꿔도 실행 중인 에이전트는 정지되지 않고 자기 세션 transcript에 계속 기록됩니다. 이 구조는 PM, Writer, Reviewer처럼 역할이 다른 여러 AI를 같은 프로젝트 문서 옆에 나눠두는 용도입니다. 한 세션에서 `@all`, `@codex`, `@claude`, `@gemini`(=`@antigravity`), `@"세션 제목"`으로 다른 실행 중인 탭에 지시를 전달할 수 있습니다.

Claude Code와 Codex 탭에는 탭별 `Deep Vault` 토글이 있습니다. 기본값은 꺼짐입니다. 켜면 인덱스 상태를 확인하고, 여러 검색어로 볼트 전체를 조회하고, 근거가 강한 원문을 직접 연 뒤, 새 근거가 더 나오지 않을 때까지 검색을 보정하도록 프롬프트에 조사 절차를 추가합니다. 이는 모델이나 reasoning 등급이 아니라 플러그인 작업 프로필이며 입력·출력 토큰 사용량이 크게 늘 수 있습니다. 같은 옵션 줄의 `IN`, `OUT`에는 현재 turn에서 provider가 실제로 보고한 토큰만 표시하며 추정값은 사용하지 않습니다.

### Codex

Codex Agent Console은 기본적으로 fullscreen TUI가 아니라 `codex app-server`를 실행합니다.

- `codex app-server`와 JSON-RPC로 통신합니다.
- ChatGPT 로그인 상태를 확인하고, 필요하면 브라우저 로그인 또는 device code 로그인을 시작합니다.
- 모델, reasoning effort, access level을 composer 아래 Agent Console 드롭다운에서 선택합니다.
- 로그인한 계정의 모델 목록을 `codex app-server`에서 가져오며, 계정에 제공되는 `GPT-5.6-Sol`(frontier), `GPT-5.6-Terra`(balanced), `GPT-5.6-Luna`(fast)를 표시합니다. Sol과 Terra는 `max`·`ultra`, Luna는 `max`까지 모델별 reasoning level을 자동 표시합니다.
- 한 user turn의 reasoning, command 실행, tool 호출, 최종 답변을 하나의 transcript 카드 안에 표시합니다.
- 응답 중에는 composer의 화살표가 정지 아이콘으로 바뀌며 현재 turn을 interrupt합니다.
- 응답 중 새 메시지를 보내면 Codex app처럼 queue에 넣습니다.
- streaming delta는 일정 간격으로 모아 렌더링해서 Obsidian UI가 멈추는 현상을 줄입니다.
- `thread/tokenUsage/updated` 이벤트로 `IN`, `OUT`을 갱신합니다. Codex가 캐시 입력과 reasoning 출력을 제공하면 툴팁에서 정확한 수치를 확인할 수 있습니다.
- 설정에서는 Codex executable, app-server 사용 여부, approval policy, login method를 조정합니다. 모델은 설정 화면에 텍스트로 입력하지 않고 Agent Console 안에서 선택합니다.

### Claude Code

Claude Code Agent Console은 로그인/제어 흐름과 일반 대화 흐름을 분리합니다.

- 시작 시 `claude auth status --json`으로 로그인 상태를 확인합니다.
- 일반 메시지는 AI 세션별 Claude Code print turn으로 실행하고, 설정된 `--permission-mode`와 `--output-format stream-json`을 사용합니다.
- Claude 모델, effort, permission mode는 Agent Console 안에서 선택합니다. 최신 별칭은 현재 버전을 함께 표시합니다(`Fable 5`, `Opus 5`, `Sonnet 5`, `Haiku 4.5`). 고정 선택은 `claude-opus-5` 같은 전체 모델 ID를 사용하고, `Custom model ID`에는 향후 출시 모델이나 사내 gateway 모델 ID를 직접 입력할 수 있습니다. Claude가 응답하면 stream에서 확인한 실제 모델을 옵션 줄에 표시하고, 별칭이 다른 버전으로 해석된 경우 선택 항목의 버전도 자동으로 바꿉니다.
- 설정에서는 Claude executable, effort, permission mode, strict MCP config 사용 여부를 조정합니다.
- 응답 중 Claude의 streaming usage 이벤트를 읽어 정확한 `IN`, `OUT`을 갱신합니다. cache creation과 cache read 토큰은 `IN`에 포함하고 툴팁에도 따로 표시합니다.
- Claude print turn 이후 JSON의 `session_id`를 읽어 플러그인 탭을 실제 Claude Code 세션에 계속 묶어둡니다.
- Claude 응답은 `claude` 프로세스가 종료될 때까지 기다립니다. 전사나 대용량 문서 분석처럼 10분 이상 걸릴 수 있는 장시간 스킬도 중간에 강제 종료하지 않습니다.
- print-command 프로세스가 실행 중인 동안 현재 turn 카드 안에 `생각 중` 표시를 유지합니다.
- Claude가 session ID 사용 중 오류를 반환하면 `--resume <sessionId> --fork-session`으로 한 번 자동 재시도합니다. 이 fallback은 빈 UUID로 새로 시작하지 않고 기존 Claude 컨텍스트를 fork합니다.
- Claude 일반 응답 프로세스는 사용자별 로컬 상태 폴더에서 pid를 추적합니다. `Stop`, 탭 닫기, 플러그인 재시작 시 남은 프로세스를 정리하고, 시작 시 로컬 `agent-processes.json`에 남은 stale pid도 확인합니다.
- `/login`, MCP 연결, permission 또는 command prompt처럼 interactive 응답이 필요한 경우에는 뒤쪽 PTY host를 통해 입력을 전달합니다.
- Claude Code 세션 로그는 login/control 흐름 추적과 transcript 보정에 사용합니다.

### Antigravity CLI

세 번째 provider 슬롯은 공식 [Google Antigravity CLI](https://antigravity.google)(`agy`)를 사용합니다. 개인 Google 계정용 Gemini CLI는 2026-06-18부로 서비스가 종료되었고 Antigravity CLI가 후속입니다.

- PATH의 `agy`, `%LOCALAPPDATA%gyingy.exe`, 또는 설정의 `Antigravity executable` 경로 순으로 실행 파일을 찾습니다. legacy `gemini`만 설치된 경우(기업용 Gemini Code Assist Standard/Enterprise 라이선스) 기존 Gemini CLI 방식으로 동작합니다.
- 일반 메시지는 `agy --print ... --print-timeout 12h`로 보냅니다. `agy`는 비-TTY 파이프에서 멈추기 때문에 PTY 캡처 경로를 사용합니다.
- Agent Console 안에서 Antigravity 모델과 approval mode를 드롭다운으로 선택합니다. 모델 값은 `agy models` 표시명 그대로입니다(`Antigravity default`, `Gemini 3.5 Flash (Low/Medium/High)`, `Gemini 3.1 Pro (Low/High)`, `Claude Sonnet 4.6 (Thinking)`, `Claude Opus 4.6 (Thinking)`, `GPT-OSS 120B (Medium)`). approval `yolo`는 `--dangerously-skip-permissions`로 전달됩니다.
- 로그인 상태는 PTY `agy models` probe로 확인하고, `Login` 버튼은 Agent Console 안에서 Google OAuth 로그인 메뉴(authorization code 붙여넣기 포함)를 시작합니다.
- Windows에서는 `irm https://antigravity.google/cli/install.ps1 | iex`(macOS/Linux: `curl -fsSL https://antigravity.google/cli/install.sh | bash`)로 설치한 뒤, Obsidian을 시작하기 전에 일반 터미널에서 `agy --version`이 동작하는지 확인합니다.

## 요구사항

- Obsidian Desktop
- 시스템에 설치된 Node.js
- 사용할 CLI 도구: `claude`, `codex`, `agy`

VS Code extension에 포함된 Node.js나 CLI는 Obsidian에서 보이지 않을 수 있습니다. 아래 명령이 일반 PowerShell, Terminal, zsh, bash에서 실행되는지 확인하세요.

```text
node --version
claude --version
codex --version
agy --version
```

## 설치

### GitHub Release ZIP

릴리스 페이지에서 OS/아키텍처에 맞는 전체 ZIP을 받습니다.

[https://github.com/obst2580/obsidian-powershell/releases](https://github.com/obst2580/obsidian-powershell/releases)

| 파일 | 대상 |
| --- | --- |
| `ObstTerminal-<version>-windows-x64.zip` | Windows x64 |
| `ObstTerminal-<version>-macos-x64.zip` | macOS Intel |
| `ObstTerminal-<version>-macos-arm64.zip` | macOS Apple Silicon |

압축을 볼트 안의 아래 경로에 풉니다.

```text
<vault>/.obsidian/plugins/vault-terminal/
```

표시 이름은 `Obst Terminal`이지만, 플러그인 ID와 설치 폴더명은 기존 호환을 위해 `vault-terminal`을 유지합니다.

전체 ZIP 설치 후 플러그인 폴더에는 보통 아래 파일이 있어야 합니다.

```text
manifest.json
main.js
styles.css
pty-host.js
node_modules/
runtime.json
```

Obsidian을 재시작한 뒤 활성화합니다.

```text
Settings > Community plugins > Obst Terminal > Enable
```

### BRAT / Community Plugin 방식

BRAT 또는 Community Plugin 방식은 처음에 표준 플러그인 파일만 설치할 수 있습니다.

```text
manifest.json
main.js
styles.css
```

Obst Terminal은 Claude Code와 Antigravity CLI의 interactive 로그인/제어 흐름을 위해 native `node-pty` runtime이 필요합니다. runtime이 없거나 오래된 경우 같은 버전의 GitHub Release에서 `runtime-manifest.json`을 읽고, OS/아키텍처에 맞는 runtime ZIP을 내려받아 SHA-256 검증 후 설치합니다.

관련 명령과 설정:

```text
Command palette > Update runtime files
Settings > Obst Terminal > Runtime files > Install runtime
Settings > Obst Terminal > Install runtime automatically
Settings > Obst Terminal > Advanced runtime and network settings
```

BRAT으로 테스트 설치할 때는 아래 저장소를 추가합니다.

```text
https://github.com/obst2580/obsidian-powershell
```

## Agent Console 사용

1. Obsidian에서 프로젝트 볼트를 엽니다.
2. 명령 팔레트에서 `Open AI workspace`를 실행하거나 우측 사이드바의 Obst Terminal 탭을 엽니다.
3. 활성 탭의 agent가 자동으로 시작됩니다. 새 탭을 만들거나 정지된 탭으로 전환해도 동일합니다.
4. 다른 provider가 필요하면 탭 끝의 `+`를 누르고 `Claude Code`, `Codex`, `Antigravity` 중 하나를 선택합니다. 선택한 provider의 새 탭이 생성되고 자동으로 시작됩니다.
5. 로그인이 필요하면 외부 터미널에서 해당 CLI 로그인을 완료한 뒤 재생 아이콘을 누릅니다. 로그인과 입력 준비가 확인되면 재생 아이콘이 활성 상태로 표시됩니다.
6. 입력창에 메시지를 쓰고 화살표 아이콘을 누릅니다.

Codex, Claude, Antigravity가 응답 중일 때 화살표는 정지 아이콘으로 바뀝니다. 응답 중 새 메시지를 보내면 현재 turn이 끝난 뒤 이어서 실행되도록 queue에 들어갑니다.

여러 AI를 함께 쓸 때는 명령 팔레트의 `Open new AI session` 또는 Agent Console 탭 끝의 `+` 메뉴에서 provider를 선택합니다. 선택 전에는 탭이 생성되지 않으며, 생성된 탭은 `Claude Code`, `Codex`, `Antigravity` 중 해당 provider 이름으로 고정됩니다. 새 탭과 정지된 탭은 선택되는 즉시 자동으로 시작되고, 이미 실행 중인 탭은 다시 시작하지 않습니다.

세션 위임 명령은 같은 입력창에 그대로 입력합니다.

```text
@all 현재 프로젝트 계획을 검토하고 위험 요소를 정리해줘.
@codex 구현 흐름이 기존 코드와 맞는지 확인해줘.
@claude 인수인계 문서 초안을 작성해줘.
@gemini Antigravity 기준의 가정이 맞는지 비교해줘.
@"Reviewer" 이 볼트의 미결 질문을 요약해줘.
/send @"PM" 이 내용을 작업 목록으로 바꿔줘.
```

위임은 실행 중인 대상 탭에 텍스트와 선택된 첨부 파일을 전달합니다. 대상이 정지되어 있거나, 로그인 대기 중이거나, interactive prompt에서 멈춰 있으면 자동으로 시작하거나 승인하지 않고 보낸 세션과 대상 세션 transcript에 실패 기록을 남깁니다.

## 첨부 파일과 이미지

Agent Console composer 안의 paperclip 아이콘으로 파일을 첨부할 수 있습니다.

- 첨부 후 paperclip에는 고정 크기 숫자 badge가 표시됩니다.
- 입력 컨트롤 안에 파일/이미지 아이콘을 사용한 compact chip이 나타납니다.
- chip의 제거 아이콘으로 개별 첨부를 제거할 수 있습니다.
- 텍스트 없이 첨부 파일만 보내는 것도 가능합니다.

Codex app-server 경로에서는 이미지가 `localImage`, 일반 파일이 `mention` 입력으로 전달됩니다. Claude Code에는 명시적인 `Read` 대상, Antigravity/Gemini에는 `@` 파일 참조로 전달합니다. 볼트 밖에서 선택한 파일은 모든 provider가 접근할 수 있도록 먼저 attachment folder 안으로 복사합니다.

Agent Console에서 이미지를 붙여넣으면 첨부 chip으로 추가합니다.

기본 attachment folder:

```text
Obst Terminal Attachments/
```

설정:

```text
Settings > Obst Terminal > Attachment folder
```

입력창 위의 활성 노트 행은 노트를 전환하는 즉시 갱신됩니다. 선택 영역이 있으면 그 영역을 우선 공유하고, 없으면 현재 노트 경로와 커서 줄을 공유합니다. link 아이콘으로 열린 노트는 유지한 채 AI 공유만 끄거나 다시 켤 수 있습니다.

## 음성 전사

paperclip 옆의 마이크 아이콘을 누르면 녹음을 시작합니다. 녹음 중에는 입력 영역에 시간과 정지 버튼만 표시됩니다. 정지를 누르면 메모리에 보관한 전체 녹음을 설정된 전사 서버로 한 번 보내고, 결과를 커서 위치에 넣습니다.

- 녹음 중 중간 전사문이나 실시간 자막은 표시하지 않습니다.
- 음성은 메모리에서만 보관하며 볼트에 녹음 파일을 저장하지 않습니다.
- 전사문은 녹음을 시작한 탭에 삽입하며 AI에 자동 전송하지 않습니다.
- 활성 문서 문맥과 회사 기준 자료에서 필요한 이름·용어만 뽑아 짧은 전사 힌트로 사용합니다.
- 전사 후 `용어사전.md`, `조직구조.md`, `조직구조-전직원.md`, `제품구조.md`, `과제목록.md`를 기준으로 명시적인 별칭과 띄어쓰기 표기를 정리합니다.
- 기준 자료는 현재 볼트 또는 로컬 `obst-indexer` 기본 볼트에서 읽습니다. 전 직원 명단이나 기준 문서 전체를 서버에 전송하지 않습니다.
- 최초 녹음 시 운영체제의 마이크 권한 요청이 나타날 수 있습니다.

## 주요 설정

기본 설정 화면에는 평소 사용하는 Agent Console 설정만 보입니다. Runtime, PTY, Node.js, 사내 인증서 관련 항목은 `Advanced runtime and network settings` 안에 접어둡니다.

| 설정 | 동작 |
| --- | --- |
| `Attachment folder` | Agent Console에 전달하기 전 붙여넣기/드롭 첨부 파일을 저장합니다. |
| `Voice transcription server` | 정지 후 전체 녹음을 한 번 받는 Whisper 호환 `/v1/audio/transcriptions` 서비스입니다. |
| `Voice transcription language` | 전사 서버에 한국어, 영어 또는 자동 감지 힌트를 적용합니다. |
| `Persist Agent transcript snapshots` | 명시적으로 켠 경우에도 보이는 transcript HTML은 공유 볼트가 아니라 현재 사용자 로컬 Obst Terminal 상태에만 저장합니다. |

고급 설정:

| 설정 | 동작 |
| --- | --- |
| `Node executable` | Node.js가 PATH에 없을 때 절대경로를 지정합니다. |
| `Runtime files` | Claude Code와 Antigravity CLI의 interactive 로그인/제어 흐름에 쓰는 native runtime을 설치/재설치합니다. |
| `Windows PTY backend` | Windows에서 interactive agent 제어용 PTY backend를 선택합니다. |
| `Install runtime automatically` | runtime이 없거나 오래된 경우 자동 설치를 허용합니다. |
| `Use system certificate store` | Node 기반 CLI에 system CA store 옵션을 주입합니다. |
| `Extra CA certificate` | 사용자 PEM 인증서 경로를 지정하고 Claude, Codex, Antigravity, Python, curl, git, gRPC 계열 도구가 쓰는 공통 CA bundle 환경변수로 전달합니다. |

## TLS / 사내 인증서

기본 상태에서는 TLS 동작을 바꾸지 않습니다. TLS inspection proxy 또는 사내 CA가 필요한 네트워크에서 Claude Code 같은 Node 기반 CLI가 인증서 오류를 내면 아래 설정을 사용합니다.

```text
Settings > Obst Terminal > Use system certificate store
Settings > Obst Terminal > Extra CA certificate
```

`Extra CA certificate`가 비어 있으면 공통 위치를 자동 확인합니다.

```text
OBST_TERMINAL_EXTRA_CA_CERT
VAULT_TERMINAL_EXTRA_CA_CERT
C:\certs\extra-ca.pem
C:\ProgramData\Obst Terminal\extra-ca.pem
%USERPROFILE%\.obst-terminal\extra-ca.pem
%USERPROFILE%\.vault-terminal\extra-ca.pem
certs/extra-ca.pem
```

Windows 릴리스에는 인증서 설정 helper가 포함됩니다.

```powershell
.\configure-corporate-ca.ps1 -VaultPath "C:\path\to\vault" -Thumbprint "<root-ca-thumbprint>"
.\configure-corporate-ca.ps1 -VaultPath "C:\path\to\vault" -PemPath "C:\path\to\custom-ca.pem"
```

Obsidian 밖의 일반 PowerShell에서도 같은 PEM을 보게 하려면 `-SetUserEnvironment`를 추가합니다. 사용자 환경변수 반영 후에는 새 PowerShell을 열어 테스트하세요.

## 개발

```powershell
npm install
npm run build
```

Windows 볼트에 설치:

```powershell
.\install.ps1 -VaultPath "C:\path\to\vault"
```

설치 스크립트는 플러그인/runtime 파일을 복사하고 볼트의 `.obsidian/community-plugins.json`에 `vault-terminal`을 추가합니다.

macOS/Linux 볼트에 설치:

```bash
npm install
npm run build
./install.sh /path/to/vault
```

로컬 Windows 릴리스 ZIP 생성:

```powershell
pwsh -NoProfile -File .\scripts\package-release.ps1 -Platform windows -Arch x64 -OutputDir dist
```

## 릴리스

릴리스 tag는 `manifest.json`의 version과 정확히 같아야 합니다. `v` prefix를 붙이지 않습니다.

```powershell
git tag 0.6.89
git push origin 0.6.89
```

릴리스 workflow는 `npm ci`, `npm run build`, OS별 전체 ZIP, runtime-only ZIP, `runtime-manifest.json`, 표준 플러그인 파일을 생성합니다.

## 보안

Obst Terminal은 로컬 interactive shell을 기본으로 실행하지 않습니다. Claude Code의 interactive 로그인/제어 흐름에서만 별도 Node.js PTY host process를 사용할 수 있습니다.

- Agent Console에서 시작한 Claude Code, Codex CLI, Antigravity CLI는 사용자의 OS 계정 권한으로 실행됩니다.
- 실행한 CLI는 로컬 파일, 네트워크, 인증 정보에 접근할 수 있습니다.
- Claude Code, Codex CLI, Antigravity CLI, git, npm 등 외부 도구는 이 플러그인에 포함되지 않습니다.
- native runtime은 전체 ZIP에 포함되거나 같은 버전 GitHub Release에서 SHA-256 검증 후 설치됩니다.
- TLS/CA 환경변수는 사용자가 설정한 경우에만 주입합니다.
- Agent 세션 상태와 transcript snapshot은 플러그인 `data.json`에 저장하지 않고 현재 사용자 로컬 Obst Terminal 상태에만 저장합니다.
- 이전 버전이 공유 볼트에 남긴 상태를 정리하려면 `pwsh -NoProfile -File .\scripts\clean-shared-ai-state.ps1 -VaultPath "C:\path\to\vault"`를 실행합니다.
- 자체 telemetry, analytics, 광고 코드는 없습니다.

신뢰할 수 있는 release asset만 설치하세요.

## 라이선스

MIT
