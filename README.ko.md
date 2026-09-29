# crowline

[English](README.md) · 한국어

<img src="public/crowline.png" alt="줄 위에서 바라보는 세 마리 까마귀" width="160" />

GitHub Actions, Vercel, AWS의 실행 상태를 **메뉴바 / 시스템 트레이에서 확인하는 로컬 우선 앱**입니다. 까마귀 아이콘을 클릭하면 작은 검정 패널이 열리고, 검색과 긴 기간 조회가 필요할 때만 큰 대시보드를 엽니다.

Tauri 2 + React + TypeScript + Rust를 사용합니다. 앱 서버나 공용 계정은 없으며, 각 사용자가 자신의 컴퓨터에 있는 기존 자격 증명으로 서비스를 조회합니다. 현재 앱 UI는 한국어이고, 사용 설명서는 한국어와 영어로 제공합니다.

## 할 수 있는 일

- 진행 중인 실행과 최근 24시간 / 7일 내 종료·갱신된 실행 조회
- 내 실행 / 전체 실행, 서비스·계정 필터, 저장소·프로젝트·브랜치·실행자 검색
- GitHub Actions의 자동 실행, 수동 실행, 재실행 조회
- Vercel 개인용 팀(Hobby 포함)과 접근 가능한 팀의 프로젝트 배포 조회
- 선택한 AWS profile과 리전의 CloudFormation 스택 / ECS 서비스 조회
- 창을 닫아도 트레이에서 계속 조회; 트레이 메뉴의 Quit으로 완전히 종료
- 서비스 조회 실패와 일부 결과만 가져온 경우를 화면에 표시

배포·재실행·취소·인프라 변경은 하지 않습니다. 실행을 누르면 해당 서비스의 상세 화면을 엽니다.

## 처음 사용하기와 여러 계정

1. 메뉴바 / 트레이의 까마귀를 클릭하고 **연결 및 설정**을 엽니다.
2. GitHub / Vercel에는 기존 로컬 CLI를 재사용하는 기본 연결이 있습니다. 연결을 선택하고 **연결 및 대상 확인**으로 로그인 상태와 조회 대상을 확인합니다.
3. 다른 GitHub / Vercel 계정도 보려면 계정 추가 버튼을 누르고 이름을 정한 뒤, 그 연결을 선택하여 **브라우저로 로그인**을 사용합니다. 추가 연결은 앱이 관리하는 CLI 설정 디렉터리를 사용합니다. 추가 GitHub 연결은 OS 자격 증명 저장소 이름을 계정별로 분리하는 동봉 `gh-isolated`가 필수이며, 패치되지 않은 시스템 CLI로 대체하지 않습니다. Vercel은 연결별 global-config 디렉터리를 사용합니다.
4. 연결별로 저장소·프로젝트를 선택하고 **설정 저장**을 누릅니다. 여러 연결은 동시에 감시할 수 있습니다.
5. AWS는 기존 로컬 profile마다 연결을 하나씩 추가합니다. 각 연결에서 리전을 입력해 CloudFormation 스택과 ECS 서비스를 조회합니다. profile을 선택하지 않은 AWS 조회는 로컬 profile 이름만 읽고 AWS 서비스 요청은 보내지 않습니다. SSO 세션이 만료되었으면 **SSO 로그인**을 사용합니다.

패널과 대시보드의 서비스·**계정 필터**로 다른 연결을 끊지 않고 표시 행만 좁힐 수 있습니다. 추가한 연결을 제거하면 그 연결의 감시 대상과 메모리의 실행 데이터가 사라집니다. 서비스 로그아웃이나 보존된 CLI 설정 디렉터리·OS 자격 증명 항목 삭제는 하지 않습니다. 기본 GitHub / Vercel 로컬 연결은 제거할 수 없습니다.

GitHub CLI, Node.js, Vercel CLI는 패키지 앱에 함께 넣습니다. 기본 GitHub 연결과 Vercel 연결은 지원되는 로컬 CLI를 우선 사용하고, 없으면 동봉 도구를 사용합니다. 추가 GitHub 연결은 항상 격리 패치한 동봉 helper를 사용합니다. 서비스별 최초 로그인과 감시 대상 선택은 필요합니다. AWS 조회는 AWS SDK를 사용하며, 앱에서 AWS SSO 로그인을 시작할 때만 AWS CLI가 필요합니다.

## 메뉴바 패널 사용법

- **까마귀 클릭:** 패널 열기 / 닫기. 다른 곳을 클릭하거나 `Esc`를 누르면 닫힙니다.
- **내 실행 / 전체:** 선택한 연결에 귀속된 실행만 보거나, 조회 가능한 실행을 모두 봅니다.
- **서비스·계정 필터:** GitHub Actions / Vercel / AWS와 연결별로 결과를 좁힙니다.
- **실행 행 클릭:** 해당 서비스의 실행 상세 페이지를 브라우저에서 엽니다.
- **새로고침 아이콘:** 즉시 상태를 조회합니다.
- **상세 보기:** 검색과 조회 기간 선택이 있는 큰 대시보드를 엽니다.
- **트레이 우클릭 → Quit:** 앱과 백그라운드 조회를 종료합니다.

큰 숫자 카드 없이 상태 아이콘, 실행명, 프로젝트·브랜치, 시간을 보여줍니다. 상태를 알 수 없는 항목은 진행 중 / 완료에 섞지 않고 별도 표시합니다. 운영체제 테마와 관계없이 검정 테마를 사용합니다.

## '내 실행'의 의미

GitHub는 연결 계정과 실행의 `triggering_actor`를 비교하고, 없으면 `actor`를 사용합니다. 커밋 작성자와 실제 실행자는 다를 수 있습니다.

Vercel은 배포 API가 제공하는 실행자 식별 정보를 사용합니다. 개인용 Hobby 팀을 포함해 접근 가능한 팀을 조회할 수 있습니다. 실행자를 확정할 수 없으면 추측해서 내 실행에 넣지 않습니다.

AWS의 CloudFormation / ECS 응답만으로 시작한 사람을 안정적으로 알 수 없으므로 실행자를 미확인으로 표시합니다. **전체**에서 이런 항목까지 볼 수 있습니다. 이 필터가 선택한 계정·profile의 권한을 넓히지는 않습니다.

## 로컬 데이터, 인증, 한계

- GitHub/Vercel 로그인 흐름이 인증 저장과 갱신을 관리합니다. crowline은 자격 증명을 앱 설정에 복사하지 않습니다. 추가 연결은 앱이 관리하는 CLI 설정 디렉터리를 쓰고, 기본 로컬 연결은 기존 CLI 설정을 계속 사용합니다. GitHub helper는 자격 증명 저장소 이름만 변경합니다. 소스 고정값·패치·가상 keyring 회귀 테스트는 `tools-lock.json`과 `scripts/isolated-github.mjs`에 있습니다. 로컬/A/B 계정의 로그인·전환·로그아웃 격리는 테스트했으며, 추가 계정의 실제 로그인은 아직 검증하지 않았습니다.
- AWS SDK가 AWS 연결에 묶인 profile을 사용합니다. 앱은 AWS 키를 저장하지 않으며, profile 목록 조회는 로컬에 설정된 profile 이름을 읽습니다.
- 선택한 대상, 계정 이름, 필터는 OS의 앱 데이터 폴더 `io.crowline.desktop/settings.json`에 저장합니다. 추가 GitHub/Vercel 연결의 CLI 설정 디렉터리도 이 앱 데이터 폴더 아래에 보존합니다. 실행 목록과 로그인 상태는 메모리에 유지합니다.
- 실행 중에는 약 30초, 유휴 상태에는 약 120초 간격으로 조회하고 선택한 서비스 오류가 있으면 더 느리게 조회합니다. 앱이 실행 중이고 컴퓨터가 깨어 있어야 합니다.
- 시간 초과, API 한도, 부분 목록, 페이지 제한은 화면에 알립니다. 모든 과거 실행을 보관하는 도구는 아닙니다.
- 종료 시각이 API에 없으면 갱신 시각으로 표시하고, 정확한 실행 시간은 `—`로 표시합니다.
- Vercel SAML 재인증이 필요한 경우 백그라운드에서 브라우저를 열지 않습니다. CLI 내부 인증 시도가 시간 초과로 끝날 수 있으므로 앱 설정에서 직접 로그인해야 합니다.
- 자동 업데이트, 운영체제 로그인 시 자동 시작, 코드 서명, macOS 공증은 아직 구성하지 않았습니다.
- 포함 CLI 의존성에 알려진 보안 권고가 있습니다. 검토한 일부 권고는 앱에서 사용하지 않는 명령이나 입력을 전제로 하지만, Go 전이 의존성을 포함한 바이너리 전체의 취약점 검증은 완료되지 않았습니다. 상세 결과와 한계는 [보안 검토](docs/security-review.md)에 기록했습니다.

이 소프트웨어는 초기 개발 단계입니다. 현재 근거는 가상 데이터 브라우저 테스트, macOS Apple Silicon 앱·DMG 빌드와 패널 접근성 확인, 이전 macOS 빌드의 GitHub/Vercel 대상 탐색·배포 행 확인입니다. 자동화 도구의 포커스 전환이 패널에 영향을 주어, 트레이·드롭다운·설정의 전체 네이티브 조작은 수동 검수 항목으로 남았습니다. Windows 런타임, 실제 AWS 네트워크 접근, 추가 GitHub/Vercel 연결의 실제 브라우저 로그인은 아직 검증하지 않았습니다. 브라우저 모드는 가상 데이터만 사용하므로 네이티브 IPC, 실제 자격 증명, 서비스 접근을 검증하지 않습니다. 소스 저장소 검토는 특정 플랫폼의 패키지 바이너리 검증이 아닙니다.

## 개발

Node.js 22.23.3 이상, pnpm 10, Rust stable, Go 1.26.8과 [Tauri 플랫폼별 필수 도구](https://v2.tauri.app/start/prerequisites/)가 필요합니다. macOS는 Xcode Command Line Tools, Windows는 C++ Build Tools와 WebView2를 준비합니다.

```sh
git clone https://github.com/likeratel/crowline.git
cd crowline
pnpm install --frozen-lockfile
pnpm tools:prepare
pnpm tauri dev
```

`tools:prepare`는 고정된 GitHub CLI·Node·Vercel CLI를 내려받고, 체크섬으로 검증한 GitHub 원본 소스에 격리 패치를 적용해 helper를 빌드합니다. Go는 소스 빌드에만 필요하며 패키지 앱 사용자에게는 필요하지 않습니다. 인터넷 연결과 수백 MB의 여유 공간이 필요하며, 고정한 체크섬을 검증합니다. 이 스크립트는 전역 설치를 하지 않습니다.

```sh
pnpm desktop:build
```

패키지는 `src-tauri/target/release/bundle/`에 생성됩니다. macOS 앱은 macOS에서, Windows 설치 파일은 Windows에서 빌드하세요. macOS Apple Silicon / Intel / Windows x64용 CI 워크플로가 있지만 아직 원격에서 실행되지 않았습니다.

## 검증

```sh
pnpm check
pnpm test
pnpm test:tools
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
cd src-tauri
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings
```

## 라이선스와 포함 도구 고지

crowline 소스는 [MIT License](LICENSE)로 제공합니다. 고정한 보조 도구의 버전과 함께 포함하는 라이선스 파일은 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 정리했습니다. 패키지 앱에는 같은 고지를 `tools/THIRD_PARTY_NOTICES.md`, 도구별 라이선스를 `tools/licenses/`에 둡니다.

까마귀 심볼의 기록된 생성 프롬프트와 파생 아이콘 출처는 [브랜드 노트](docs/brand.md)에 있습니다. 서명된 배포물이나 공개 준비 완료 인증은 아직 없습니다.
