# Obst Terminal

Obsidian 데스크톱 우측 사이드바에서 현재 볼트 경로를 작업 디렉터리로 쓰는 **멀티 AI Agent Console** 플러그인입니다. 이 저장소의 현재 버전은 `0.6.55`입니다.

[English README](README.md)

> 데스크톱 전용 플러그인입니다. Claude Code, Codex CLI, Gemini CLI, Node.js, Git, npm 같은 외부 도구는 포함하지 않습니다. 사용자의 PC에 설치되어 있고 일반 터미널에서 실행되어야 합니다.

![Obsidian 우측 사이드바에서 AI agent를 실행한 Obst Terminal 화면](docs/images/obst-terminal-agent-console.png)

## 멀티 AI 세션 작업 공간

Obst Terminal은 한 명의 AI와만 대화하는 단일 콘솔이 아니라, **하나의 Obsidian 볼트 안에 여러 Claude Code / Codex / Gemini CLI 세션을 탭으로 열어두고 동시에 운용하는 작업 공간**입니다.

- 플러그인 내부 `+` 버튼 또는 `Open new AI session` 명령으로 AI 세션 탭을 추가합니다.
- 각 탭은 독립적인 Claude sessionId / Codex threadId / Gemini local sessionId, provider, 제목, transcript, 실행 상태를 유지합니다.
- 탭을 전환해도 실행 중인 에이전트는 멈추지 않고 자기 transcript에 계속 기록합니다.
- Claude, Codex, Gemini transcript는 세션/provider별 스크롤 위치를 보존하므로, 백그라운드 업데이트나 탭 전환 때문에 화면이 맨 위로 튀지 않습니다.
- 기본적으로 transcript HTML은 `.obsidian/plugins/vault-terminal/data.json`에 저장하지 않습니다. 세션 제목과 provider ID 같은 메타데이터만 저장합니다. 재시작 후 UI transcript까지 그대로 복원하고 싶을 때만 `Persist Agent transcript snapshots` 설정을 켜면 됩니다.
- PM, Writer, Reviewer, Researcher처럼 역할별 AI 직원을 같은 프로젝트 문서 옆에 나눠둘 수 있습니다.
- 한 세션에서 `@all`, `@codex`, `@claude`, `@gemini`, `@"세션 제목"`으로 다른 실행 중인 AI 세션에 지시를 전달할 수 있습니다.
- Attach 버튼 또는 composer 이미지 붙여넣기로 파일을 첨부할 수 있습니다. 붙여넣은 이미지는 설정된 attachment folder에 저장되고 Claude, Codex, Gemini에 로컬 파일 경로로 전달됩니다.
- `이 문서`, `이문서`, `옆에 문서`, `현재 문서`, `열린 문서` 같은 표현은 현재 Obsidian 볼트에서 활성화된 열린 노트로 해석하고, agent prompt에 vault file reference로 자동 주입합니다.

## 현재 동작 기준

Obst Terminal을 열면 기본 화면은 **Agent Console**입니다. 상단에서 `Claude`, `Codex`, `Gemini`를 선택할 수 있고, 현재 선택된 provider는 `현재 Claude Code`, `현재 Codex`, `현재 Gemini CLI` chip으로 표시됩니다. Claude, Codex, Gemini transcript는 서로 섞이지 않고 따로 유지됩니다.

한 볼트 안에서 여러 AI 세션을 나눠 사용할 수 있습니다. `Open AI workspace` 명령은 첫 Obst Terminal 뷰를 재사용하고, `Open new AI session` 명령이나 Agent Console의 `+` 버튼은 Obsidian 탭을 새로 만들지 않고 플러그인 내부 상단에 AI 세션 탭을 추가합니다. 각 탭은 독립 Claude sessionId / Codex threadId / Gemini local sessionId, 선택 provider, 수정 가능한 제목, 표시 중인 transcript, 실행 중인 backend/프로세스 상태를 유지합니다. 탭을 바꿔도 실행 중인 에이전트는 정지되지 않고 자기 세션 transcript에 계속 기록됩니다. 이 구조는 PM, Writer, Reviewer처럼 역할이 다른 여러 AI를 같은 프로젝트 문서 옆에 나눠두는 용도입니다. 한 세션에서 `@all`, `@codex`, `@claude`, `@gemini`, `@"세션 제목"`으로 다른 실행 중인 탭에 지시를 전달할 수 있습니다.

### Codex

Codex Agent Console은 기본적으로 fullscreen TUI가 아니라 `codex app-server`를 실행합니다.

- `codex app-server`와 JSON-RPC로 통신합니다.
- ChatGPT 로그인 상태를 확인하고, 필요하면 브라우저 로그인 또는 device code 로그인을 시작합니다.
- 모델, reasoning effort, access level을 composer 아래 Agent Console 드롭다운에서 선택합니다.
- 한 user turn의 reasoning, command 실행, tool 호출, 최종 답변을 하나의 transcript 카드 안에 표시합니다.
- 응답 중에는 `Send` 버튼이 `Stop` 역할을 하며 현재 turn을 interrupt합니다.
- 응답 중 새 메시지를 보내면 Codex app처럼 queue에 넣습니다.
- statusline에는 현재 볼트 경로, git branch, 선택 모델, context 사용률, 5시간/7일 rate-limit meter를 표시합니다.
- streaming delta는 일정 간격으로 모아 렌더링해서 Obsidian UI가 멈추는 현상을 줄입니다.
- 설정에서는 Codex executable, app-server 사용 여부, approval policy, login method를 조정합니다. 모델은 설정 화면에 텍스트로 입력하지 않고 Agent Console 안에서 선택합니다.

### Claude Code

Claude Code Agent Console은 로그인/제어 흐름과 일반 대화 흐름을 분리합니다.

- 시작 시 `claude auth status --json`으로 로그인 상태를 확인합니다.
- 일반 메시지는 AI 세션별 `claude --session-id <uuid> --strict-mcp-config --permission-mode bypassPermissions --output-format json -p`로 실행하고 prompt를 stdin으로 전달합니다.
- Claude 모델은 Agent Console 안의 드롭다운에서 `Claude default`, `sonnet`, `opus`, `haiku` 중 선택합니다.
- 설정에서는 Claude executable, effort, permission mode, strict MCP config 사용 여부를 조정합니다.
- statusline에는 설정된 Claude 모델/모드, 플러그인이 붙이는 transcript context meter, Claude JSON 출력에서 확인 가능한 usage 요약을 표시합니다.
- Claude print turn 이후 JSON의 `session_id`를 읽어 플러그인 탭을 실제 Claude Code 세션에 계속 묶어둡니다.
- Claude 응답은 `claude` 프로세스가 종료될 때까지 기다립니다. 전사나 대용량 문서 분석처럼 10분 이상 걸릴 수 있는 장시간 스킬도 중간에 강제 종료하지 않습니다.
- Claude가 session ID 사용 중 오류를 반환하면 `--resume <sessionId> --fork-session`으로 한 번 자동 재시도합니다. 이 fallback은 빈 UUID로 새로 시작하지 않고 기존 Claude 컨텍스트를 fork합니다.
- Claude/Gemini 일반 응답 프로세스는 플러그인이 pid를 추적합니다. `Stop`, 탭 닫기, 플러그인 재시작 시 남은 프로세스를 정리하고, 시작 시 `agent-processes.json`에 남은 stale pid도 확인합니다.
- `/login`, MCP 연결, permission 또는 command prompt처럼 interactive 응답이 필요한 경우에는 뒤쪽 PTY host를 통해 입력을 전달합니다.
- Claude Code 세션 로그는 login/control 흐름 추적과 transcript 보정에 사용합니다.

### Gemini CLI

Gemini CLI는 Claude 일반 메시지와 같은 print-command 방식으로 실행합니다.

- 시작 시 `gemini --version`으로 CLI가 PATH에서 보이는지 확인하고, prompt를 받기 전에 Gemini CLI 인증 방식이 설정되어 있는지도 확인합니다.
- 일반 메시지는 `gemini --skip-trust --approval-mode yolo --output-format text`로 실행하고, 실제 prompt는 stdin으로 전달합니다. Gemini CLI는 `--prompt` 값을 stdin 뒤에 붙이므로, 플러그인은 더 이상 dummy `--prompt=.`를 추가하지 않습니다.
- Gemini 모델은 Agent Console 안의 드롭다운에서 `flash`, `pro`, `flash-lite`, `gemini-3.5-flash`, `gemini-3-flash`, `gemini-2.5-flash`, `gemini-2.5-pro` 중 선택합니다. `flash` 같은 CLI alias는 계정 접근 권한에 따라 Gemini CLI가 실제 모델로 해석하므로 UI에서는 특정 모델로 단정하지 않고 alias로 표시합니다. 기존에 저장된 preset 밖 전체 모델명은 삭제하지 않고 드롭다운 옵션으로 보존합니다.
- Gemini CLI가 `ModelNotFoundError`를 반환하면 플러그인이 안전한 fallback 모델(`flash`, `gemini-2.5-flash`, `gemini-2.5-pro`)로 자동 재시도하고, 처음 성공한 fallback을 저장해 같은 404를 반복하지 않게 합니다.
- 설정에서는 Gemini executable, approval mode, skip-trust, sandbox flag를 조정합니다.
- statusline에는 설정된 Gemini 모델/모드, 플러그인이 붙이는 transcript context meter, Gemini CLI text 출력에서 reliable usage를 제공하지 않는 경우 `usage n/a`를 표시합니다.
- 일반 Gemini/Claude prompt에는 현재 CLI 실행 모델 설정을 함께 주입하므로, “현재 어떤 모델을 쓰는지” 질문에는 모델의 자기인식이 아니라 플러그인의 실행 설정 기준으로 답할 수 있습니다.
- Gemini 응답도 장시간 작업을 고려해 10분 제한으로 끊지 않고, `Stop`을 누르면 현재 프로세스 트리를 종료합니다.
- Gemini의 native `--resume`은 여러 플러그인 탭이 같은 최신 세션을 잡아 충돌할 수 있어 기본 사용하지 않습니다. 대신 플러그인 탭별 transcript context와 Gemini local sessionId로 UI 세션을 분리합니다.
- Gemini 구독 로그인은 Agent Console의 `Login` 버튼에서 시작합니다. 플러그인은 control PTY 안에서 `NO_BROWSER=true`와 함께 `gemini --skip-trust --screen-reader`를 열고, Sign in with Google은 Gemini CLI의 수동 URL/code 인증 흐름으로 진행하게 합니다.
- `Login`은 기존 Gemini 로그인 PTY가 떠 있으면 먼저 정리한 뒤 `/auth`를 열어, 브라우저 기반 인증에서 멈춘 prompt를 수동 인증 prompt로 교체합니다.
- Gemini가 수동 authorization code를 요구하면 Agent Console 메시지 입력창에 코드만 붙여넣고 `Send`를 누릅니다.
- `oauth-personal` 방식에서는 Gemini CLI의 `google_accounts.json`에 활성 계정이 있어야 로그인 완료로 봅니다. `selectedType`만 있으면 로그인 필요 상태로 처리합니다.
- Windows terminal 경고, 중복 YOLO 안내, `grep_search` timeout 진단처럼 알려진 Gemini CLI startup/tool fallback noise는 visible transcript에서 숨깁니다.
- API 또는 Vertex 방식은 `GEMINI_API_KEY`, `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_GENAI_USE_GCA` 중 필요한 값을 OS 환경변수나 Gemini가 읽는 `.env`에 설정한 뒤 Obsidian을 완전히 재시작합니다.
- Gemini CLI가 설치되어 있지 않거나 인증 방식이 없으면 Start 단계에서 설치/PATH/인증 안내를 표시하고 prompt를 보내지 않습니다.

## 요구사항

- Obsidian Desktop
- 시스템에 설치된 Node.js
- 사용할 CLI 도구: `claude`, `codex`, `gemini`

VS Code extension에 포함된 Node.js나 CLI는 Obsidian에서 보이지 않을 수 있습니다. 아래 명령이 일반 PowerShell, Terminal, zsh, bash에서 실행되는지 확인하세요.

```text
node --version
claude --version
codex --version
gemini --version
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

Obst Terminal은 Claude Code와 Gemini CLI의 interactive 로그인/제어 흐름을 위해 native `node-pty` runtime이 필요합니다. runtime이 없거나 오래된 경우 같은 버전의 GitHub Release에서 `runtime-manifest.json`을 읽고, OS/아키텍처에 맞는 runtime ZIP을 내려받아 SHA-256 검증 후 설치합니다.

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
3. 상단 provider 버튼에서 `Claude`, `Codex`, `Gemini` 중 하나를 선택합니다.
4. `Start`로 agent를 시작합니다.
5. 필요하면 `Login`으로 로그인 흐름을 시작합니다.
6. 입력창에 메시지를 쓰고 `Send`를 누릅니다.

Codex, Claude, Gemini가 응답 중일 때 `Send`는 `Stop`으로 동작합니다. 응답 중 새 메시지를 보내면 현재 turn이 끝난 뒤 이어서 실행되도록 queue에 들어갑니다.

여러 AI를 함께 쓸 때는 명령 팔레트의 `Open new AI session` 또는 Agent Console 상단의 `+` 버튼으로 플러그인 내부 AI 세션 탭을 추가합니다. 각 세션은 수정 가능한 제목을 갖고, subtitle에 Claude sessionId, Codex threadId, Gemini local sessionId의 짧은 값이 표시됩니다.

세션 위임 명령은 같은 입력창에 그대로 입력합니다.

```text
@all 현재 프로젝트 계획을 검토하고 위험 요소를 정리해줘.
@codex 구현 흐름이 기존 코드와 맞는지 확인해줘.
@claude 인수인계 문서 초안을 작성해줘.
@gemini 회의록 초안에서 누락된 의사결정을 찾아줘.
@"Reviewer" 이 볼트의 미결 질문을 요약해줘.
/send @"PM" 이 내용을 작업 목록으로 바꿔줘.
```

위임은 실행 중인 대상 탭에 텍스트와 선택된 첨부 파일을 전달합니다. 대상이 정지되어 있거나, 로그인 대기 중이거나, interactive prompt에서 멈춰 있으면 자동으로 시작하거나 승인하지 않고 보낸 세션과 대상 세션 transcript에 실패 기록을 남깁니다.

## 첨부 파일과 이미지

Agent Console composer의 `Attach` 버튼으로 파일을 첨부할 수 있습니다.

- 첨부 후 버튼은 `Attach (N)`으로 바뀝니다.
- 입력창 아래에 `첨부됨 N개` 영역이 나타납니다.
- 각 파일은 `IMG` 또는 `FILE` chip으로 표시됩니다.
- chip의 `x` 버튼으로 개별 첨부를 제거할 수 있습니다.
- 텍스트 없이 첨부 파일만 보내는 것도 가능합니다.

Codex app-server 경로에서는 이미지가 `localImage`, 일반 파일이 `mention` 입력으로 전달됩니다. Claude Code와 Gemini CLI 경로에서는 prompt 하단에 `첨부 파일:` 목록을 붙여 전달합니다.

Agent Console에서 이미지를 붙여넣으면 첨부 chip으로 추가합니다.

기본 attachment folder:

```text
Obst Terminal Attachments/
```

설정:

```text
Settings > Obst Terminal > Attachment folder
```

현재 노트 참조는 Agent Console의 `Add current note` 버튼으로 넣을 수 있습니다.

## 주요 설정

기본 설정 화면에는 평소 사용하는 Agent Console 설정만 보입니다. Runtime, PTY, Node.js, 사내 인증서 관련 항목은 `Advanced runtime and network settings` 안에 접어둡니다.

| 설정 | 동작 |
| --- | --- |
| `Attachment folder` | Agent Console에 전달하기 전 붙여넣기/드롭 첨부 파일을 저장합니다. |
| `Persist Agent transcript snapshots` | 명시적으로 켠 경우에만 보이는 transcript HTML을 플러그인 `data.json`에 저장합니다. |

고급 설정:

| 설정 | 동작 |
| --- | --- |
| `Node executable` | Node.js가 PATH에 없을 때 절대경로를 지정합니다. |
| `Runtime files` | Claude Code와 Gemini CLI의 interactive 로그인/제어 흐름에 쓰는 native runtime을 설치/재설치합니다. |
| `Windows PTY backend` | Windows에서 interactive agent 제어용 PTY backend를 선택합니다. |
| `Install runtime automatically` | runtime이 없거나 오래된 경우 자동 설치를 허용합니다. |
| `Use system certificate store` | Node 기반 CLI에 system CA store 옵션을 주입합니다. |
| `Extra CA certificate` | 사용자 PEM 인증서 경로를 지정합니다. |

## TLS / 사내 인증서

기본 상태에서는 Node TLS 동작을 바꾸지 않습니다. TLS inspection proxy 또는 사내 CA가 필요한 네트워크에서 Claude Code 같은 Node 기반 CLI가 인증서 오류를 내면 아래 설정을 사용합니다.

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

## 개발

```powershell
npm install
npm run build
```

Windows 볼트에 설치:

```powershell
.\install.ps1 -VaultPath "C:\path\to\vault"
```

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
git tag 0.6.55
git push origin 0.6.55
```

릴리스 workflow는 `npm ci`, `npm run build`, OS별 전체 ZIP, runtime-only ZIP, `runtime-manifest.json`, 표준 플러그인 파일을 생성합니다.

## 보안

Obst Terminal은 로컬 interactive shell을 기본으로 실행하지 않습니다. Claude Code와 Gemini CLI의 interactive 로그인/제어 흐름에서만 별도 Node.js PTY host process를 사용할 수 있습니다.

- Agent Console에서 시작한 Claude Code, Codex CLI, Gemini CLI는 사용자의 OS 계정 권한으로 실행됩니다.
- 실행한 CLI는 로컬 파일, 네트워크, 인증 정보에 접근할 수 있습니다.
- Claude Code, Codex CLI, Gemini CLI, git, npm 등 외부 도구는 이 플러그인에 포함되지 않습니다.
- native runtime은 전체 ZIP에 포함되거나 같은 버전 GitHub Release에서 SHA-256 검증 후 설치됩니다.
- TLS/CA 환경변수는 사용자가 설정한 경우에만 주입합니다.
- `Persist Agent transcript snapshots`를 명시적으로 켠 경우가 아니면 Agent transcript는 플러그인 `data.json`에 저장하지 않습니다.
- 자체 telemetry, analytics, 광고 코드는 없습니다.

신뢰할 수 있는 release asset만 설치하세요.

## 라이선스

MIT
