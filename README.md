# JetPipe ⚡

> In-memory streaming SFTP pipeline — direct server-to-server file transfer without touching local disk.

## 특징

- 무제한 세션 보관함 (메타데이터는 localStorage)
- **OS 네이티브 키체인**으로 시크릿 저장 (macOS Keychain / Windows Credential Manager / Linux Secret Service) — 앱이 파일로 저장하지 않음
- 듀얼 SFTP 패널 UI (좌/우 분할)
- Jet-Stream 드래그앤드롭: A 서버 → 로컬 RAM 버퍼 → B 서버 다이렉트 스트리밍
- **전송 취소 및 부분 파일 자동 정리**: 네트워크 단절·취소 시 목적지의 반쪽 파일을 자동 unlink
- **백프레셔**: ssh2-rs의 블로킹 소켓 + OS TCP 흐름 제어로 자연스럽게 처리
- Tauri 2 (Rust) 기반 초경량 (~10MB)

## 실행 준비

### 1. Rust 설치 (필수)

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

### 2. macOS 추가 의존성 (이미 있다면 스킵)

```sh
xcode-select --install
```

### 3. Node 의존성 설치 (완료 상태일 수 있음)

```sh
npm install
```

## 개발 모드

```sh
npm run tauri:dev
```

처음 실행 시 Rust 크레이트 컴파일에 수 분이 걸립니다 (`ssh2-rs`, `tauri` 등).

## 프로덕션 빌드

```sh
npm run tauri:build
```

빌드 산출물: `src-tauri/target/release/bundle/` 아래의 `.dmg` (macOS) / `.msi` (Windows).

## 프로젝트 구조

```
JetPipe/
├── src/                       # React 프론트엔드
│   ├── App.tsx                # 메인 레이아웃 + 드래그앤드롭 오케스트레이션
│   ├── components/
│   │   ├── Sidebar.tsx        # 세션 보관함
│   │   ├── FilePanel.tsx      # SFTP 디렉토리 뷰
│   │   ├── ConnectionDialog.tsx
│   │   └── TransferBar.tsx    # 전송 진행률
│   ├── lib/
│   │   ├── api.ts             # Tauri invoke 래퍼
│   │   ├── vault.ts           # 로컬 세션 보관함
│   │   └── utils.ts
│   └── types.ts
└── src-tauri/                 # Rust 백엔드
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/
        ├── lib.rs             # Tauri 부트스트랩
        ├── ssh.rs             # ssh2-rs 기반 SFTP 연결
        ├── session.rs         # 세션 보관소 + invoke 커맨드
        ├── transfer.rs        # Jet-Stream RAM 버퍼 파이프 + cancel/cleanup
        ├── keychain.rs        # OS 네이티브 키체인 브릿지 (keyring crate)
        └── error.rs
```

## 핵심 로직: Jet-Stream

`src-tauri/src/transfer.rs` 의 `cmd_pipe_transfer` 가 핵심입니다:

```rust
let mut reader = src.sftp().open(Path::new(&src_path))?;
let mut writer = dst.sftp().create(Path::new(&dst_path))?;
let mut buf = vec![0u8; 256 * 1024]; // 256KB RAM 버퍼

loop {
    let n = reader.read(&mut buf)?;
    if n == 0 { break; }
    writer.write_all(&buf[..n])?;
    // 100ms 마다 progress 이벤트 emit
}
```

소스 파일은 디스크에 절대 떨어지지 않고, 256KB 청크 단위로 RAM → 목적지로 직행합니다.

### 백프레셔 (Backpressure)

ssh2-rs는 블로킹 소켓 위에서 동작합니다. 목적지가 바쁘면 `write_all` 호출이 자동으로 블록되어, 소스에서 읽는 루프 자체가 일시 정지합니다. 별도의 워터마크/펌프 로직 없이 OS의 TCP 흐름 제어가 곧 백프레셔가 됩니다.

### 취소 & 부분 파일 정리

전송은 `Arc<AtomicBool>` cancel token으로 즉시 중단됩니다. 어떤 종류의 실패(읽기 에러/쓰기 에러/취소)든 catch되면 목적지의 미완성 파일을 `sftp.unlink()`로 즉시 제거합니다. "껍데기만 전송된" 상태가 남지 않습니다.

### 키체인 (Keychain)

`keyring` crate가 OS별로:
- macOS → Security framework (Apple Keychain)
- Windows → Credential Manager (WinAPI)
- Linux → Secret Service / GNOME Keyring

으로 위임합니다. JetPipe는 평문 시크릿을 자체 파일에 저장하지 않습니다.

## 아이콘

`src-tauri/icons/` 디렉토리에 아래 파일을 넣어주세요 (Tauri 빌드 요구사항):

- `32x32.png`, `128x128.png`, `128x128@2x.png`
- `icon.icns` (macOS), `icon.ico` (Windows)

`npx @tauri-apps/cli icon path/to/logo.png` 로 일괄 생성 가능.

## 배포 / 멀티플랫폼 빌드

### macOS
이미 빌드된 산출물:
```
src-tauri/target/release/bundle/dmg/JetPipe_0.1.0_aarch64.dmg
```

다시 빌드하려면:
```sh
npm run tauri:build
```

### Windows / Linux — GitHub Actions

Tauri 2는 cross-compile을 공식 지원하지 않습니다 (Windows .msi 패키징은 WiX 툴셋이 Windows에서만 동작). 가장 깔끔한 해결은 GitHub Actions 클라우드 빌드입니다 — 이미 `.github/workflows/release.yml`이 준비되어 있습니다.

**사용법**:

1. 코드를 GitHub repo에 push:
   ```sh
   git init && git add -A && git commit -m "Initial commit"
   gh repo create JetPipe --private --source . --push
   ```

2. 태그를 만들어 push:
   ```sh
   git tag v0.1.0 && git push origin v0.1.0
   ```

3. GitHub Actions가 자동으로 다음을 빌드:
   - **Windows**: `.msi` 인스톨러 + `.exe` (NSIS)
   - **macOS (Apple Silicon)**: `.dmg`
   - **macOS (Intel)**: `.dmg`
   - **Linux**: `.deb` + `.AppImage`

4. 결과는 GitHub Releases 페이지에 draft로 자동 업로드 (다운로드 가능).

수동 빌드만 필요하면 GitHub repo의 **Actions** 탭에서 `Release Build` 워크플로우를 `Run workflow`로 실행. 태그 없이도 artifact를 받을 수 있습니다.

### Windows 로컬 빌드 (Windows 머신이 있다면)
Windows에서 직접 빌드하는 게 가장 안정적입니다:
```ps1
# PowerShell
winget install Microsoft.VisualStudio.2022.BuildTools  # MSVC + Win SDK
winget install Rustlang.Rustup
winget install OpenJS.NodeJS

# 프로젝트 clone 후
npm install
npm run tauri:build
```

산출물: `src-tauri\target\release\bundle\msi\JetPipe_0.1.0_x64_en-US.msi`

## 라이선스

MIT — 데이터 유실/전송 실패에 대한 법적 책임 면책 (plan.md 참고).
