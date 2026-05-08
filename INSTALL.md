# Vault Terminal 설치 매뉴얼

이 문서는 사용자가 Obsidian 볼트에 Vault Terminal 플러그인을 설치하고 활성화하는 절차를 설명합니다.

Vault Terminal은 Obsidian 우측 탭에 현재 볼트 경로를 작업 디렉터리로 사용하는 터미널을 띄웁니다. 이 터미널 안에서 PowerShell, Git, npm, Python, Claude Code, Codex CLI 같은 명령을 실행할 수 있습니다.

## 설치 전 확인

- Obsidian Desktop 앱에서만 사용합니다.
- 플러그인은 볼트마다 따로 설치합니다.
- Windows용 패키지와 macOS용 패키지는 서로 다릅니다.
- Community Plugin Directory 또는 BRAT처럼 표준 플러그인 파일만 설치하는 방식에서는 첫 실행 때 OS/아키텍처에 맞는 런타임을 추가 설치해야 합니다.
- Node.js가 시스템에 설치되어 있어야 합니다. 릴리스 패키지는 Node.js 22 기준으로 빌드합니다.
- VS Code extension이 내부적으로 사용하는 Node.js는 Obsidian에서 보이지 않습니다. 일반 PowerShell, Terminal, zsh, bash에서 `node --version`이 실행되는지 확인합니다.
- Claude Code, Codex CLI, Git, Python 등은 필요한 사용자 PC에 별도로 설치되어 있어야 합니다.
- Claude Code나 Codex를 VS Code extension으로만 설치한 경우 Vault Terminal 안의 `claude`, `codex` 명령과는 별개일 수 있습니다. 필요한 CLI는 시스템 npm 또는 공식 설치 방법으로 별도 설치합니다.
- 일반 인터넷 환경에서는 SSL 설정을 바꿀 필요가 없습니다.
- TLS inspection proxy 또는 사용자 지정 인증서가 필요한 환경에서만 아래의 SSL 설정 절차를 확인합니다.

## Windows 설치

### GitHub Release 전체 ZIP 설치

관리자가 배포한 Windows용 ZIP 파일을 받습니다.

예시:

```text
VaultTerminal-<version>-windows-x64.zip
```

설치할 Obsidian 볼트 경로를 확인합니다.

예시:

```text
C:\obsidian\labide-validation
```

ZIP 파일을 아래 위치에 압축 해제합니다.

```text
<볼트경로>\.obsidian\plugins\vault-terminal\
```

예시:

```text
C:\obsidian\labide-validation\.obsidian\plugins\vault-terminal\
```

압축 해제 후 폴더 안에 다음 파일과 폴더가 있어야 합니다.

```text
manifest.json
main.js
styles.css
pty-host.js
node_modules\
```

Obsidian을 재시작한 뒤 플러그인을 활성화합니다.

```text
Settings > Community plugins > Vault Terminal > Enable
```

좌측 리본 메뉴의 터미널 아이콘을 누르면 우측 탭에 Vault Terminal이 열립니다.

### Community Plugin / BRAT 설치 후 런타임 설치

Community Plugin Directory 또는 BRAT으로 설치하면 처음에는 아래 표준 플러그인 파일만 설치될 수 있습니다.

```text
manifest.json
main.js
styles.css
```

이 상태에서 Vault Terminal 탭을 열면 **Runtime installation required** 안내가 표시됩니다. **Install runtime**을 누르면 현재 플러그인 버전과 같은 GitHub Release에서 Windows x64 런타임 ZIP을 내려받고 SHA-256 검증 후 설치합니다.

설정에서도 같은 작업을 할 수 있습니다.

```text
Settings > Vault Terminal > Runtime files > Install runtime
```

런타임 설치 후 Vault Terminal 탭을 새로 열면 터미널이 시작됩니다.

## 화면 색상 설정

기본값은 **Follow Obsidian**입니다. Obsidian이 라이트 테마이면 밝은 터미널 배경을 쓰고, 다크 테마이면 어두운 터미널 배경을 쓰며, Codex/Claude Code 같은 CLI 도구의 ANSI 색상은 읽기 쉬운 팔레트로 유지합니다.

색상을 바꾸려면:

```text
Settings > Vault Terminal > Terminal color scheme
```

선택지:

- **Follow Obsidian**: Obsidian 배경/텍스트 색을 따르되 ANSI 색상은 읽기 쉬운 팔레트 유지
- **Light terminal**: 밝은 배경의 고대비 터미널
- **Dark terminal**: 어두운 배경의 고대비 터미널

스크롤이 CLI에 잡혀서 위 내용이 잘 안 보이면:

```text
Shift + 마우스 휠
Ctrl + Shift + PageUp / PageDown
Ctrl + Shift + Home / End
```

멀티라인 입력을 지원하는 도구에서는 `Shift + Enter`로 줄바꿈을 넣을 수 있습니다. 기본값은 **Claude backslash newline**입니다. 이 모드는 Claude Code가 안내하는 줄 끝 `\` + Enter 멀티라인 경로를 사용하며, 한글 IME 마지막 글자가 먼저 커밋되도록 아주 짧게 지연한 뒤 Claude Code 입력창에서 줄바꿈으로 변환합니다.

Windows에서는 기본 PTY backend가 **winpty**입니다. ConPTY는 Claude Code/Codex가 쓰는 일부 수정 키 입력 시퀀스를 프로그램에 전달하기 전에 필터링할 수 있어서, 멀티라인 입력이 필요한 agent CLI에는 winpty가 기본값입니다. 필요하면 플러그인 설정의 **Windows PTY backend**에서 ConPTY로 바꾸고 Vault Terminal 탭을 새로 엽니다.

Codex, Claude Code 같은 fullscreen TUI 도구는 alternate screen을 사용할 수 있습니다. 이 모드에서는 오래된 출력이 일반 터미널 scrollback이 아니라 CLI 내부 화면에 들어가기 때문에, 일반 PowerShell 출력처럼 전부 위로 스크롤되지 않을 수 있습니다.

## macOS 설치

macOS에서는 CPU 아키텍처에 맞는 패키지를 사용해야 합니다.

예시:

```text
VaultTerminal-<version>-macos-arm64.zip
VaultTerminal-<version>-macos-x64.zip
```

ZIP 파일을 아래 위치에 압축 해제합니다.

```text
<볼트경로>/.obsidian/plugins/vault-terminal/
```

Obsidian을 재시작한 뒤 플러그인을 활성화합니다.

```text
Settings > Community plugins > Vault Terminal > Enable
```

macOS에서 Node.js를 `nvm`으로만 설치한 경우 Obsidian이 Node 경로를 자동으로 찾지 못할 수 있습니다. 이 경우 플러그인 설정의 **Node executable**에 절대경로를 입력합니다.

Community Plugin Directory 또는 BRAT으로 설치한 경우 Windows와 동일하게 첫 실행 때 **Install runtime**을 눌러 macOS Intel 또는 Apple Silicon 런타임을 설치합니다. 플러그인이 현재 Mac의 CPU 아키텍처를 감지해 맞는 런타임 ZIP을 선택합니다.

## Linux 설치

현재 GitHub Release ZIP은 Windows x64, macOS Intel x64, macOS Apple Silicon arm64를 배포합니다.

Linux에서는 소스에서 빌드한 뒤 설치합니다.

```bash
npm install
npm run build
./install.sh /path/to/vault
```

## 여러 볼트에 설치

플러그인은 볼트별로 설치됩니다. 다른 볼트에서도 쓰려면 각 볼트의 `.obsidian/plugins/vault-terminal` 폴더에 동일하게 설치해야 합니다.

Windows에서 설치 스크립트를 사용하는 경우:

```powershell
.\install.ps1 -VaultPath "C:\obsidian\labide-validation"
.\install.ps1 -VaultPath "C:\obsidian\team-vault"
.\install.ps1 -VaultPath "D:\vaults\project-a"
```

`C:\obsidian` 아래의 모든 볼트에 설치하려면 먼저 대상 볼트를 확인합니다.

```powershell
Get-ChildItem "C:\obsidian" -Directory |
  Where-Object { Test-Path (Join-Path $_.FullName ".obsidian") } |
  Select-Object -ExpandProperty FullName
```

목록이 맞으면 설치합니다.

```powershell
Get-ChildItem "C:\obsidian" -Directory |
  Where-Object { Test-Path (Join-Path $_.FullName ".obsidian") } |
  ForEach-Object {
    .\install.ps1 -VaultPath $_.FullName
  }
```

## SSL / 인증서 설정

기본 설치 상태에서는 Vault Terminal이 Node TLS 또는 인증서 동작을 바꾸지 않습니다. 인증서 파일도 패키지에 포함하지 않습니다.

Claude Code 같은 Node 기반 CLI에서 다음 오류가 나오면 인증서 설정이 필요할 수 있습니다.

```text
Self-signed certificate detected
Unable to connect to API
```

Obsidian에서 아래 설정을 확인합니다.

```text
Settings > Vault Terminal
```

권장 설정:

- **Use system certificate store**: 켬
- **Extra CA certificate**: PEM 인증서 경로

예시:

```text
C:\certs\custom-ca.pem
```

볼트 안에 인증서를 넣는 경우에는 플러그인 폴더 기준 상대경로도 사용할 수 있습니다.

```text
certs/extra-ca.pem
```

## 업데이트

GitHub Release 전체 ZIP을 쓰는 경우 새 ZIP 파일을 받으면 기존 폴더에 덮어씁니다.

```text
<볼트경로>\.obsidian\plugins\vault-terminal\
```

`0.1.x`에서 업데이트하는 경우 플러그인 ID가 `obsidian-powershell-agent`에서 `vault-terminal`로 바뀌었습니다. 설치 스크립트는 기존 `data.json`과 `certs` 폴더를 새 위치로 복사합니다. 수동 설치 시에는 기존 설정이 필요하면 직접 옮긴 뒤 이전 폴더를 제거하세요.

덮어쓴 뒤 Obsidian을 재시작합니다.

문제가 있으면 플러그인을 비활성화한 뒤 다시 활성화합니다.

```text
Settings > Community plugins > Vault Terminal
```

Community Plugin Directory 또는 BRAT으로 업데이트한 경우 표준 플러그인 파일만 갱신될 수 있습니다. Vault Terminal 탭이나 설정 화면에서 런타임이 누락되었다고 나오면 **Install runtime**을 다시 실행합니다. 런타임 설치는 기존 native runtime 폴더를 지우고 새 버전으로 교체합니다.

## 삭제

Obsidian에서 플러그인을 비활성화합니다.

```text
Settings > Community plugins > Vault Terminal > Disable
```

그 다음 아래 폴더를 삭제합니다.

```text
<볼트경로>\.obsidian\plugins\vault-terminal\
```

## 문제 해결

플러그인이 목록에 보이지 않으면:

- 압축 해제 위치가 맞는지 확인합니다.
- `manifest.json`이 바로 아래 경로에 있는지 확인합니다.

```text
<볼트경로>\.obsidian\plugins\vault-terminal\manifest.json
```

터미널이 열리지 않으면:

- Obsidian을 재시작합니다.
- 일반 PowerShell, Terminal, zsh, bash에서 `node --version`이 실행되는지 확인합니다.
- `Node.js was not found` 또는 `spawn node ENOENT`가 표시되면 Node.js를 시스템에 설치한 뒤 Obsidian을 재시작합니다.
- Node.js를 별도 위치에 설치했다면 플러그인 설정의 **Node executable**에 절대경로를 입력합니다.
- `Runtime installation required`가 표시되면 **Install runtime**을 눌러 런타임 파일을 설치합니다.
- 런타임 다운로드가 실패하면 GitHub Release asset에 접근 가능한 네트워크인지 확인합니다.

Claude Code 또는 Codex CLI 명령이 인식되지 않으면:

- 해당 CLI가 PC에 설치되어 있는지 확인합니다.
- 일반 PowerShell 또는 터미널에서 먼저 실행되는지 확인합니다.
- PATH 설정이 필요한 경우 해당 CLI 설치 경로를 사용자 PATH에 추가합니다.
- VS Code extension으로 설치된 Claude Code/Codex와 터미널에서 실행하는 `claude`, `codex` CLI는 다를 수 있습니다.

SSL 오류가 발생하면:

- **Use system certificate store**를 켭니다.
- PEM 인증서를 **Extra CA certificate**에 지정합니다.
- `NODE_TLS_REJECT_UNAUTHORIZED=0`처럼 TLS 검증을 끄는 설정은 사용하지 않습니다.

## 조직/팀 배포 권장 방식

공개 오픈소스 릴리즈에는 인증서 파일을 포함하지 않습니다. 같은 네트워크 정책을 쓰는 사용자에게는 플러그인 ZIP과 함께 인증서 설정 스크립트를 제공합니다.

관리자는 루트 인증서의 thumbprint 또는 PEM 파일을 확인합니다. Windows 인증서 저장소에 필요한 루트 인증서가 이미 배포되어 있다면 thumbprint 방식이 가장 간단합니다.

설치 후 각 사용자 PC에서 실행할 명령 예시:

```powershell
.\configure-corporate-ca.ps1 `
  -VaultPath "C:\Users\<user>\Documents\ObsidianVault" `
  -Thumbprint "<root-ca-thumbprint>"
```

`ps1` 파일은 PowerShell 스크립트입니다. 브라우저에서 클릭해도 자동 실행되지 않으므로 PowerShell에서 실행해야 합니다.

더 단순하게 안내하려면 `configure-corporate-ca.ps1`과 `configure-corporate-ca.cmd`를 같은 폴더에 받은 뒤 `configure-corporate-ca.cmd`를 더블클릭하게 합니다. 그러면 볼트 경로와 인증서 thumbprint 또는 PEM 경로를 입력하는 창이 열립니다.

PEM 파일을 보안팀에서 따로 제공하는 경우:

```powershell
.\configure-corporate-ca.ps1 `
  -VaultPath "C:\Users\<user>\Documents\ObsidianVault" `
  -PemPath "C:\certs\custom-ca.pem"
```

이 스크립트가 하는 일:

- Windows 인증서 저장소 또는 PEM 파일에서 루트 인증서를 가져옵니다.
- 플러그인 폴더에 `certs/extra-ca.pem`을 만듭니다.
- 플러그인 설정 파일 `data.json`에 `useSystemCa: true`와 `extraCaCertPath: "certs/extra-ca.pem"`을 기록합니다.
- 새 Vault Terminal 세션에서 `NODE_OPTIONS`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`이 자동으로 적용되게 합니다.

이미 열려 있던 터미널이나 Claude Code 세션에는 새 환경변수가 적용되지 않습니다. 설정 후 Obsidian을 재시작하거나 Vault Terminal 탭을 새로 열어야 합니다.

## 보안 안내

Vault Terminal은 Obsidian 볼트 경로에서 실제 터미널 명령을 실행할 수 있게 하는 플러그인입니다.

- 신뢰할 수 있는 배포본만 설치합니다.
- 출처를 알 수 없는 ZIP 파일은 설치하지 않습니다.
- 터미널에서 실행하는 명령은 사용자 PC 권한으로 실행됩니다.
- 터미널에서 실행한 CLI는 로컬 파일, 네트워크, 인증 정보에 접근할 수 있습니다.
- Vault Terminal은 자체 telemetry, analytics, 광고 코드를 포함하지 않습니다.
- 조직 보안 정책에 맞지 않는 외부 API 키나 인증 정보를 볼트에 저장하지 않습니다.
