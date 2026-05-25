# JetPipe 개발 히스토리

서버 간 SFTP 다이렉트 메모리 스트리밍 데스크톱 앱. plan.md → 동작하는 v0.1.11까지의 작업 기록.

## 현재 상태 (2026-05-26)

- **버전**: v0.1.11
- **GitHub**: https://github.com/ugiugi0823/JetPipe
- **빌드 산출물**:
  - Windows: GitHub Actions 자동 빌드 (`.exe` + `.msi`, ~3-5MB)
  - macOS Apple Silicon: 로컬에서 `npm run tauri:build` (~5MB)
- **마지막 배포**: v0.1.11 release draft에 Windows 인스톨러 첨부됨

## 아키텍처

```
JetPipe/
├── src/                       # React + TS 프론트엔드
│   ├── App.tsx                # 메인 레이아웃 + 전송 큐 오케스트레이션
│   ├── components/
│   │   ├── Sidebar.tsx        # 세션 보관함 + 접기/펴기
│   │   ├── Panel.tsx          # 한 서버 패널 (트리 + 리스트 + 경로바)
│   │   ├── TreeView.tsx       # 폴더 트리 (lazy load)
│   │   ├── FileList.tsx       # 파일 리스트 (폴더+파일)
│   │   ├── TransferQueue.tsx  # 큐 + 다중 선택 + 컨텍스트 메뉴
│   │   ├── DevConsole.tsx     # 디버그 콘솔 패널
│   │   ├── Splitter.tsx       # 동적 가로/세로 분할
│   │   ├── ConnectionDialog.tsx
│   │   ├── ImportDialog.tsx   # SSH config 일괄 임포트
│   │   ├── PromptDialog.tsx
│   │   ├── ConfirmDialog.tsx
│   │   └── ContextMenu.tsx
│   ├── lib/
│   │   ├── api.ts             # Tauri invoke + 타임아웃 + 트레이싱
│   │   ├── vault.ts           # 세션 메타데이터 (localStorage) + 시크릿(키체인)
│   │   ├── sshConfig.ts       # ~/.ssh/config 파서
│   │   ├── pathHistory.ts     # 방문 경로 히스토리
│   │   ├── devlog.ts          # 로그 버퍼 + hardLog(localStorage)
│   │   └── utils.ts
│   └── types.ts
└── src-tauri/                 # Rust 백엔드
    ├── Cargo.toml             # ssh2 + libssh2-sys + vendored-openssl
    └── src/
        ├── ssh.rs             # SSH/SFTP 연결, TCP 1초 타임아웃, Symlink 처리
        ├── session.rs         # 세션 store + mkdir/rename/delete
        ├── transfer.rs        # 파이프라인 + 청크 병렬 + 워커 풀
        ├── keychain.rs        # OS 키체인 브릿지 (keyring crate)
        ├── error.rs
        ├── lib.rs
        └── main.rs
```

## 주요 기능 (구현 순서)

1. **MVP** — 듀얼 패널 SFTP, 드래그앤드롭, 인메모리 스트리밍
2. **OS 키체인** — Apple Keychain / Windows Credential Manager (keyring crate)
3. **취소 + 부분 파일 정리** — AtomicBool 토큰, 실패 시 dest unlink
4. **SSH config 일괄 임포트** — ~/.ssh/config 붙여넣기 → 자동 등록
5. **WKWebView D&D fix** — `dragDropEnabled: false` + text/plain 폴백 + window global 폴백
6. **재귀 디렉토리 전송** — walk + mkdir + 파일별 진행
7. **작은 파일 우선** — sort_by_key(size) ascending + reverse before pop
8. **새 폴더 / 이름 변경 / 삭제** — sftp.mkdir/rename/unlink + 재귀 삭제
9. **우클릭 컨텍스트 메뉴** — 트리/리스트/큐 모두
10. **세로 동적 스플리터** — 트리⟷리스트, 메인⟷큐
11. **경로 히스토리 드롭다운** — saved session 기준 localStorage, 50개
12. **폴더별 드롭 타겟** — 트리/리스트 폴더 위 hover → 그 폴더로 직접 드롭
13. **사이드바 접기/펴기** + 세션 편집 버튼
14. **전송 큐 컬럼 조절** — 헤더 우측 드래그 + localStorage 저장
15. **파일 크기 정확 바이트 표시** (formatBytesExact)
16. **read/write 파이프라이닝** — `std::thread::scope` + bounded mpsc
17. **multi-session 청크 병렬** — 단일 파일 4분할, 워커별 SSH 세션
18. **SSH 압축 토글** — 패널 헤더 ⚡/⚡̸ (LLM 모델엔 OFF 권장)
19. **큐 다중 선택** — Cmd/Shift+클릭, 우클릭 메뉴
20. **TCP connect timeout 1초** — VPN 끊긴 호스트도 즉시 실패
21. **vendored OpenSSL + openssl-on-win32** — Windows Ed25519 키 지원

## 빌드 / 배포

### 로컬 macOS
```sh
cd /Users/jhw/dev/MY/JetPipe
. "$HOME/.cargo/env"
npm install                # 최초 1회
npm run tauri:build        # → src-tauri/target/release/bundle/dmg/
```

실행:
```sh
osascript -e 'tell application "JetPipe" to quit' 2>/dev/null
open /Users/jhw/dev/MY/JetPipe/src-tauri/target/release/bundle/macos/JetPipe.app
```

### Windows (GitHub Actions)
```sh
git tag v0.1.X && git push origin v0.1.X
# 약 13-15분 후 Release draft에 .exe / .msi 첨부됨
gh release edit v0.1.X --draft=false --repo ugiugi0823/JetPipe  # 공개로
```

### 버전 동기화
세 파일 반드시 함께 수정:
- `src-tauri/Cargo.toml` → `version = "X.Y.Z"`
- `src-tauri/tauri.conf.json` → `"version": "X.Y.Z"`
- `package.json` → `"version": "X.Y.Z"`

## 알려진 이슈 / 다음 작업 후보

### 미해결
- **Windows Ed25519 키 인증 최종 검증** — v0.1.11에 `libssh2-sys/openssl-on-win32` 추가했으나 사용자 실제 테스트 결과 미확인. 다음 세션 첫 작업.
- **`InvalidPath` 미사용 enum variant 경고** — `src-tauri/src/error.rs:16`. 무시 가능하지만 정리하면 깔끔.

### 다음 후보
- **연결 풀 사전 가열** — 전송 시작 시 3개 추가 SSH 핸드셰이크가 ~1초 추가 지연. 백그라운드 사전 연결로 해소 가능
- **실패 전송 재시도 버튼** — 현재 큐의 failed 항목은 dismiss만 가능
- **Windows MSI 코드 서명** — SmartScreen 경고 회피
- **대기열 일시정지 / 재개** — 큐 우클릭 메뉴의 "대기열 처리" 항목 실제 구현
- **드롭 시 중복 파일 처리 옵션** — 덮어쓰기/스킵/리네임 선택 UI
- **macOS Intel 빌드 워크플로우 복귀** — 필요해지면 release.yml의 matrix에 추가

## 라이브러리 핵심 결정 사항

### `Cargo.toml`의 두 줄
```toml
ssh2         = { version = "0.9", features = ["vendored-openssl"] }
libssh2-sys  = { version = "0.3", features = ["openssl-on-win32"] }
```
- `vendored-openssl`: openssl-sys를 정적 링크. macOS x86_64 cross-compile 통과.
- `openssl-on-win32`: libssh2가 WinCNG 대신 OpenSSL을 백엔드로 쓰게 강제. Ed25519 OpenSSH-format 키 인식의 핵심.
- 둘 다 필요. 한쪽만 있으면 무용지물 (v0.1.10 → v0.1.11 교훈).

### `tauri.conf.json`
- `"dragDropEnabled": false` — macOS WKWebView가 OS-level drag drop을 가로채는 걸 막아야 webview 내부 drop 이벤트가 발화함

### 성능 튜닝 상수
- `CHUNK_SIZE = 256 * 1024` (256KB) — SFTP packet 효율 sweet spot
- `PIPELINE_DEPTH = 12` — read-ahead 채널 깊이 (~3MB in-flight per file)
- `PARALLEL_STREAMS = 4` — 동시 SSH 세션 수
- `CHUNK_PARALLEL_THRESHOLD = 64 MB` — 이 이상 파일은 byte-range 4분할
- `TCP_CONNECT_TIMEOUT = 1s` — VPN/방화벽 즉시 감지

## 디버깅

### DevConsole
앱 우하단 `▣ console` 버튼 → 패널 펼침:
- 모든 invoke 호출 트레이싱 (시작/끝/duration/에러)
- `cmd_X timed out after Nms` — 그 명령에서 막힌 것
- 클릭 즉시 `[hardlog ...]` localStorage 기록 → freeze 후 force-quit해도 다음 실행 시 `prev` 버튼으로 복구

### Rust 컴파일
```sh
cd src-tauri && cargo build --release   # 빠른 사이클
```

## Git 상태

```sh
git log --oneline -10  # 최근 커밋 확인
git tag                # 태그 목록
git push origin vX.Y.Z # Windows 빌드 트리거
```
