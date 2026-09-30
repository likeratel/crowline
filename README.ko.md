# crowline

[English](README.md) · 한국어 · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

<img src="public/crowline.png" alt="줄 위에서 바라보는 세 마리 까마귀" width="160" />

crowline은 배포와 CI 결과를 확인하는 로컬 우선 데스크톱 모니터입니다. 메뉴바/시스템 트레이의 까마귀에서 요약 패널을 열고, 대시보드에서 계정 연결·감시 대상·검색·이력을 관리합니다. Tauri 2, React, TypeScript, Rust로 만들었으며 공용 계정이나 앱 서버는 없습니다. 이 컴퓨터에 이미 있는 자격 증명으로만 서비스를 조회합니다. UI 기본값은 시스템 언어이며 한국어, 영어, 일본어, 중국어 간체를 지원합니다. 시스템 언어를 인식하지 못하면 영어로 표시합니다.

## 클론에서 실행

Node.js 22.23.3 이상, pnpm 10, Rust stable이 필요합니다. 격리 GitHub helper 빌드에는 Go 1.26.8도 필요합니다(패키지 앱 사용자는 불필요). macOS에는 Xcode Command Line Tools, Windows에는 Microsoft C++ Build Tools와 WebView2 등 [Tauri 필수 도구](https://v2.tauri.app/start/prerequisites/)를 준비합니다.

```sh
git clone https://github.com/likeratel/crowline.git
cd crowline
pnpm install --frozen-lockfile
pnpm tools:prepare
pnpm tauri dev
```

`tools:prepare`는 고정된 GitHub CLI·Node.js·Vercel CLI를 내려받고 체크섬으로 검증한 원본에서 격리 helper를 빌드합니다. 인터넷과 수백 MB 공간이 필요하며 전역 설치는 하지 않습니다.

```sh
pnpm desktop:build
```

패키지는 `src-tauri/target/release/bundle/`에 만듭니다. macOS 앱은 macOS에서, Windows 설치 파일은 Windows에서 빌드합니다. 저장소의 다중 플랫폼 CI 설정은 원격 빌드나 공개 설치 파일이 있다는 근거가 아닙니다.

## 계정과 대상 연결

대시보드 사이드바의 단일 **설정** 항목을 엽니다. 탭은 **서비스 연결**, **알림**, **메뉴 막대**, **일반**입니다. GitHub/Vercel은 기존 로컬 CLI 계정으로 시작합니다. 연결을 확인하고 감시할 대상을 고르면 바로 반영됩니다. 추가 GitHub/Vercel 계정은 이름을 붙인 슬롯을 만들고 브라우저에서 로그인합니다. 추가 GitHub 계정은 OS 자격 증명 저장소 이름을 계정별로 분리하는 동봉 `gh-isolated`만 쓰며, 패치되지 않은 시스템 CLI로 대체하지 않습니다. Vercel은 별도 global-config 디렉터리를 사용합니다.

AWS는 기존 local profile별 슬롯을 추가하고 리전을 골라 CloudFormation, ECS, Amplify 브랜치를 찾습니다. profile 전에는 로컬 이름만 읽고 AWS 요청을 보내지 않습니다. SSO 만료 시 앱에서 SSO 로그인을 시작합니다. 계정 추가·제거와 대상 선택은 즉시 적용됩니다. 추가 계정을 제거해도 로그아웃하거나 CLI 설정·OS 자격 증명을 삭제하지 않습니다. 기본 GitHub/Vercel 계정은 제거할 수 없습니다. 패키지 앱은 GitHub CLI, Node.js, Vercel CLI를 포함하며 AWS 조회는 SDK를 씁니다.

## 지원 범위

공식 CLI를 설치·로그인한 뒤 앱을 재시작해 감지합니다. 지원 어댑터에는 토큰 입력, 배포 hook, 코드 삽입이 필요 없습니다.

| 플랫폼 | 조회 | 제한 |
| --- | --- | --- |
| GitHub Actions | 워크플로 실행 | 기존 `gh`, 최근 목록과 진행 상태 별도 조회 |
| Vercel | 프로젝트 배포 | 기존 `vercel`, `BLOCKED` 제외 |
| AWS | CloudFormation, ECS, Amplify | 선택 profile/리전, 실행자 미확인 |
| GitHub Deployments | 배포 기록·최신 상태 | Actions와 별개, 상태 상세 최대 20건 |
| Railway, Netlify, Render | 배포 이력 | 공식 CLI와 서비스별 최근 목록 제한 |
| Heroku, Fly.io | 앱 릴리스 | Fly는 머신 상태가 아닌 릴리스 상태 |
| GitLab.com | 배포·CI 파이프라인 | self-managed, 실행자 판정 미지원 |
| DigitalOcean, Google Cloud, Azure | 배포·Cloud Build/Run·Kudu | CLI별 범위·출력·페이지 제한 |

EAS/Expo, fastlane, Cloudflare Pages/Workers, Firebase, Supabase는 카탈로그에서 제약만 안내하며 직접 조회를 지원하지 않습니다. 현재 CLI/API로 계정 전체 대상 탐색 또는 신뢰할 수 있는 배포 이력을 얻을 수 없기 때문입니다. CI 작업은 가능한 경우 GitHub Actions나 GitLab 파이프라인으로 감시합니다. [모바일 플랫폼 조사](docs/mobile-provider-notes.md)를 참고하세요. 새 어댑터는 합성 fixture와 명령 계약으로 검증했으며 실계정 로그인 검증은 아닙니다.

## 패널, 알림, 상태

- 까마귀 클릭으로 패널을 열고 닫으며 바깥 클릭/`Esc`로 닫습니다. 서비스·계정·**내 실행만**·**전체 실행** 필터는 표시만 바꿉니다. GitHub는 `triggering_actor`(없으면 `actor`), Vercel은 배포 생성자를 씁니다. 실행자 미확인 항목은 **전체 실행**에만 보입니다.
- 새로고침은 즉시 조회를 요청합니다. 결과는 대상별로 도착하며, 다음 cursor가 있을 때만 이력을 더 가져옵니다. 완료 이력은 24시간/7일과 검색을 지원합니다.
- **설정**은 **서비스 연결**, **알림**, **메뉴 막대**, **일반** 네 탭으로 구성됩니다. 모든 설정은 바꾸는 즉시 적용됩니다. 앱은 변경을 순서대로 처리하고 백엔드는 필드 단위로 원자적으로 병합합니다. 한 항목 저장에 실패하면 그 항목만 되돌리고 **다시 시도**를 제공합니다. 계정 선택 옆 연필에서 별칭을 편집할 수 있으며, 입력이 멈춘 뒤 500ms 또는 입력칸을 벗어날 때 저장합니다. 별칭이 우선이고, 없으면 서비스에서 확인한 계정명, 저장된 profile 또는 서비스명 순으로 표시합니다. 기존의 사용자가 정한 계정명은 유지합니다.
- **메뉴 막대**에서 표시 서비스·프로젝트, 진행/완료, 각 1~10행을 정합니다. 프로젝트는 항상 최신 `updatedAt` 기준 내림차순으로 표시하며, 프로젝트 고정이나 실패 우선 정렬은 없습니다. macOS에서 다른 메뉴 막대 앱 사이의 까마귀 아이콘 위치는 시스템 메뉴 막대에서 Command 키를 누른 채 드래그해 바꿉니다. crowline은 앱 우선순위를 보장하지 않습니다.
- **알림**의 간결한 프로젝트 행에서 **끔**, **내 실행**, **전체 실행**과 **실패만**, **모든 결과**, **직접 설정** 결과를 고릅니다. 새 규칙은 성공·실패·취소 결과를 모두 포함하며 기존 규칙의 선택은 유지합니다. 사용자 지정을 고르면 결과 편집기가 계속 열려 있고, 결과는 하나 이상 선택된 상태로 유지합니다. 검색·서비스 필터·명시적으로 선택한 프로젝트에만 적용하는 일괄 적용으로 여러 규칙을 바꿉니다. 알림 규칙은 표시 필터와 독립적입니다. 앱 시작 후 첫 결과는 기준선만 만들고 알리지 않아 과거 결과 알림이 쌓이지 않습니다.
- 서비스 상태는 로그인 필요, CLI 미설치, 연결 확인 필요, 일부 조회 실패, 조회 중을 보여줍니다. 연결 설정에서 재로그인하고, 안내된 CLI를 설치해 재연결하며, 오류면 네트워크·계정 권한을 확인합니다. 부분/오류 뒤 결과는 오래됐을 수 있습니다.
- **로그인할 때 Crowline 실행**은 선택 사항이며 OS 설정에 즉시 적용됩니다. **새 버전 자동 확인** 기본값은 켜짐입니다. 앱 버전은 **일반**의 정보에서 확인합니다.

24시간을 넘긴 대기/실행/승인 대기는 실패 처리 없이 숨기고, Vercel `BLOCKED`도 제외합니다. 상태 미확인과 조회 오류는 따로 보입니다. crowline은 조회 전용으로 워크플로 재실행, 배포, 취소, 인프라 변경, 사용자 제공 명령 실행을 하지 않습니다.

알림은 주기적 조회와 서비스에서 제공하는 시간을 기준으로 동작합니다. 최신 이벤트보다 10분 이상 늦게 처음 조회된 결과는 알림에서 빠질 수 있습니다. 처리량이 많아 알림 기록을 정리할 때도 중복 방지를 위해 일부 늦은 결과를 건너뜁니다. 전체 배포 기록은 서비스의 이력에서 확인하세요.

## 업데이트, 데이터, 한계

저장소에는 서명된 초안 데스크톱 릴리스와 updater 메타데이터를 만들기 위한 수동 워크플로가 있습니다. 하지만 현재 빌드에는 updater 공개 키나 게시 릴리스 구성이 없어 앱 내 업데이트를 사용할 수 없다고 표시합니다. 공개 키·서명 배포물·공개 릴리스가 존재한다고 주장하지 않습니다. 자동 확인 기본값이 켜져도 릴리스 경로가 구성·게시되기 전에는 업데이트를 제공하지 않습니다.

GitHub/Vercel 인증 흐름은 자격 증명을 관리하고 앱 설정으로 복사하지 않습니다. AWS는 선택 profile을 쓰며 키를 저장하지 않습니다. API 토큰/개인정보 입력 폼은 없습니다. 설정은 OS 앱 데이터의 `io.crowline.desktop/settings.json`에, 추가 CLI 설정도 그 아래에 보존하며 실행 캐시와 로그인 상태는 메모리에 둡니다. 진행 중에는 약 30초, 유휴면 약 120초마다 조회하고 오류 뒤에는 느려집니다.

시간 초과, API 한도, 부분 목록, 페이지 제한은 UI에 표시합니다. 백그라운드 Vercel SAML 재인증은 브라우저를 열 수 없습니다. 포함 CLI 의존성에는 알려진 보안 권고가 있고 Go 전이 모듈을 포함한 전체 바이너리 취약점 검증은 미완료입니다. [보안 검토](docs/security-review.md)를 참고하세요.

초기 개발 단계입니다. 합성 브라우저 테스트, macOS Apple Silicon app/DMG 빌드·패널 접근성, 이전 macOS GitHub/Vercel 확인이 기존 근거입니다. 네이티브 트레이/드롭다운/설정 전체 조작은 수동 검수 항목이며 Windows 런타임, 실제 AWS 접근, 추가 GitHub/Vercel 계정 브라우저 로그인은 미확인입니다.

## 개발 확인

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

현재 확인 명령이며, 고정 테스트 수나 현재 통과를 주장하지 않습니다.

## 라이선스

crowline은 [MIT License](LICENSE)로 제공합니다. helper 도구 버전·라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에, 패키지 고지는 `tools/`에 있습니다. 까마귀 아이콘 출처는 [브랜드 노트](docs/brand.md)에 기록했습니다.
