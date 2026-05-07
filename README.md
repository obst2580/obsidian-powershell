# Vault Terminal

Obsidian 데스크톱 앱의 우측 사이드바에 현재 볼트 경로를 작업 디렉터리로 사용하는 실제 터미널을 여는 플러그인입니다.

> 상태: 초기 데스크톱 베타입니다. Windows와 macOS 릴리스 패키지를 배포하며, Linux는 소스 설치 경로를 유지합니다.

## 주요 기능

- Vault Terminal 탭을 열면 터미널이 자동으로 시작됩니다.
- 현재 Obsidian 볼트가 셸의 작업 디렉터리가 됩니다.
- PowerShell, zsh, bash 같은 일반 셸 명령을 탭 안에서 실행합니다.
- Claude Code, Codex CLI, Git, Python, npm 같은 CLI 도구를 볼트 기준으로 실행합니다.
- 터미널 텍스트 선택과 복사를 지원합니다.
- Claude Code 멀티라인 입력을 위해 `Shift + Enter`를 기본적으로 Claude의 `\` + Return 줄바꿈 경로로 보냅니다.
- 한글 IME 조합 중 마지막 글자가 다음 줄로 밀리지 않도록 짧은 지연 후 줄바꿈을 보냅니다.
- Obsidian 테마를 기본으로 따르되 Codex/Claude Code ANSI 색상이 읽히도록 터미널 팔레트를 보정합니다.
- 긴 scrollback과 `Shift + Wheel`, `Ctrl + Shift + PageUp/PageDown` 강제 스크롤을 지원합니다.
- 회사 SSL 검사 환경을 위해 Node TLS/CA 설정을 선택적으로 주입할 수 있습니다.

## 릴리스 다운로드

GitHub Actions가 태그 릴리스마다 OS별 ZIP을 자동 생성합니다.

| 파일 | 대상 |
| --- | --- |
| `VaultTerminal-<version>-windows-x64.zip` | Windows x64 |
| `VaultTerminal-<version>-macos-x64.zip` | macOS Intel |
| `VaultTerminal-<version>-macos-arm64.zip` | macOS Apple Silicon |

릴리스 페이지:

```text
https://github.com/obst2580/obsidian-powershell/releases
```

Windows 회사 인증서 설정 스크립트도 릴리스 asset으로 함께 올라갑니다.

```text
configure-corporate-ca.ps1
configure-corporate-ca.cmd
```

## 설치

플러그인은 볼트마다 설치됩니다. ZIP을 아래 경로에 압축 해제합니다.

```text
<볼트경로>/.obsidian/plugins/obsidian-powershell-agent/
```

압축 해제 후 플러그인 폴더에는 다음 파일과 폴더가 있어야 합니다.

```text
manifest.json
main.js
styles.css
pty-host.js
node_modules/
```

Obsidian을 재시작한 뒤 아래 메뉴에서 플러그인을 활성화합니다.

```text
Settings > Community plugins > Vault Terminal > Enable
```

업데이트할 때도 같은 위치에 새 ZIP을 덮어쓴 뒤 Obsidian을 재시작하거나 플러그인을 껐다 켭니다.

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

로컬 릴리스 ZIP 생성:

```powershell
pwsh -NoProfile -File .\scripts\package-release.ps1 -Platform windows -Arch x64 -OutputDir dist
```

## GitHub Actions 릴리스

태그를 푸시하면 `.github/workflows/release.yml`이 실행됩니다.

```powershell
git tag v<version>
git push origin v<version>
```

워크플로는 다음 작업을 수행합니다.

- `npm ci`
- `npm run build`
- OS별 ZIP 패키징
- GitHub Release 생성 또는 기존 Release asset 갱신

사용하는 GitHub-hosted runner:

- `windows-latest`: Windows x64 패키지
- `macos-15-intel`: macOS Intel x64 패키지
- `macos-14`: macOS Apple Silicon arm64 패키지

macOS runner 라벨은 GitHub 공식 hosted runner 문서를 기준으로 선택했습니다.

## 런타임 파일

이 플러그인은 터미널 UI에 `xterm`, 실제 pseudo-terminal에 `node-pty` 런타임을 사용합니다.

`pty-host.js`는 Obsidian renderer 프로세스 안에서 native PTY를 직접 로드하지 않도록 별도 Node 프로세스로 실행됩니다.

기본 셸 선택:

- Windows: PowerShell 7이 있으면 PowerShell 7, 없으면 Windows PowerShell
- macOS: Homebrew `pwsh`가 있으면 `pwsh`, 없으면 사용자 `$SHELL`, 그 다음 `zsh`/`bash`
- Linux: `pwsh`가 있으면 `pwsh`, 없으면 사용자 `$SHELL`, 그 다음 `bash`/`sh`

native PTY 런타임이 포함되므로 릴리스 ZIP은 OS/아키텍처별로 분리됩니다.

## Windows PTY

Windows 기본 PTY backend는 `winpty`입니다.

ConPTY는 일부 raw keyboard/paste escape sequence를 Node 기반 CLI가 읽기 전에 필터링할 수 있습니다. Claude Code/Codex 같은 agent CLI의 특수 입력을 안정적으로 전달하기 위해 Windows 기본값은 `winpty`입니다.

환경에 따라 ConPTY가 더 잘 맞으면 플러그인 설정에서 바꿀 수 있습니다.

```text
Settings > Vault Terminal > Windows PTY backend
```

## Shift + Enter

기본값은 **Claude backslash newline**입니다.

Claude Code는 줄 끝의 `\` + Return을 멀티라인 줄바꿈으로 처리합니다. Vault Terminal은 `Shift + Enter`를 이 경로로 보내며, 한글 IME 마지막 글자가 먼저 커밋되도록 짧게 지연합니다.

다른 도구를 위해 아래 모드도 남겨두었습니다.

- `Claude backslash newline`
- `Bracketed newline paste`
- `xterm paste newline`
- `Modified Enter`
- `CSI-u Shift Enter`
- `Line feed`

설정 위치:

```text
Settings > Vault Terminal > Shift+Enter behavior
```

## 화면 색상과 스크롤

기본 색상은 **Follow Obsidian**입니다. Obsidian의 라이트/다크 테마를 따르되, 터미널 ANSI 색상은 읽기 쉬운 팔레트로 보정합니다.

스크롤 관련 동작:

- 일반 출력은 50,000줄 scrollback을 유지합니다.
- CLI가 마우스 입력을 잡고 있으면 `Shift + mouse wheel`로 터미널 scrollback을 강제 스크롤합니다.
- `Ctrl + Shift + PageUp/PageDown`으로 페이지 단위 이동을 할 수 있습니다.
- fullscreen TUI 도구는 alternate screen buffer를 사용할 수 있습니다. 이 경우 오래된 출력은 일반 scrollback이 아니라 CLI 내부 화면에 있을 수 있습니다.

## SSL / 회사 프록시

기본 설치 상태에서는 Node TLS 또는 인증서 동작을 바꾸지 않고, 회사 인증서를 포함하지 않습니다.

회사 TLS inspection proxy 뒤에서 Claude Code 같은 Node 기반 CLI가 아래 오류를 내면 인증서 설정이 필요할 수 있습니다.

```text
Self-signed certificate detected
Unable to connect to API
```

플러그인 설정:

- **Use system certificate store**: Node의 system CA store 사용
- **Extra CA certificate**: PEM 인증서 파일 경로. 상대 경로는 플러그인 폴더 기준입니다.

Windows에서 회사 루트 인증서를 내보내고 설정하려면 릴리스의 스크립트를 사용합니다.

```powershell
.\configure-corporate-ca.ps1 -VaultPath "C:\path\to\vault" -Thumbprint "<company-root-ca-thumbprint>"
```

PEM 파일을 직접 받은 경우:

```powershell
.\configure-corporate-ca.ps1 -VaultPath "C:\path\to\vault" -PemPath "C:\path\to\company-ca.pem"
```

브라우저는 `.ps1`을 자동 실행하지 않습니다. PowerShell에서 직접 실행하거나, 같은 폴더에 있는 `configure-corporate-ca.cmd`를 실행합니다.

## 배포 메모

Obsidian Community Plugin 표준 설치는 보통 `manifest.json`, `main.js`, `styles.css`만 다룹니다. 이 플러그인은 실제 터미널을 위해 `pty-host.js`와 native `node-pty` 런타임도 필요합니다.

따라서 현재 배포 방식은 GitHub Release ZIP 설치를 기준으로 합니다.

## 라이선스

MIT
