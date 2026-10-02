# crowline

[English](README.md) · 한국어 · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

<img src="public/crowline.png" alt="줄 위에서 바라보는 세 마리 까마귀" width="160" />

crowline은 배포와 CI 실행 상태를 확인하는 메뉴 막대·시스템 트레이 앱입니다. 패널에서 최근 실행을 빠르게 확인하고, 대시보드에서 계정 연결·이력 검색·알림을 설정합니다. Tauri 2, React, TypeScript, Rust로 만들었으며 서비스 조회는 사용자 컴퓨터에서 실행됩니다. 언어는 시스템 설정을 따르고 한국어·영어·일본어·중국어 간체를 지원합니다.

## 미리 보기

메뉴 막대 패널 → 배포 현황 → 서비스별 필터 → 계정 연결 → 프로젝트별 알림 설정 흐름을 확인해 보세요.

![서비스별 실행 조회와 계정 연결, 내 실행 알림 설정 데모](docs/images/walkthrough.gif)

가상 프로젝트와 계정으로 앱의 브라우저 미리보기를 촬영했습니다. 실제 배포나 알림 수신 장면은 아닙니다.

<details>
<summary>스크린샷 더 보기</summary>

**메뉴 막대 패널** — 실행 상태와 브랜치, 실행자를 빠르게 확인합니다.

<img src="docs/images/menu-bar.png" alt="플랫폼 아이콘과 실행자 이름이 표시된 메뉴 막대 요약 패널" width="420" />

**대시보드** — 진행 중인 실행과 최근 결과를 모아서 봅니다.

![GitHub Actions와 Vercel의 가상 배포 현황](docs/images/dashboard.png)

**서비스 연결** — 계정을 연결하고 모니터링할 프로젝트를 선택합니다.

![서비스 선택과 GitHub 계정 연결 화면](docs/images/connections.png)

**알림** — 프로젝트마다 내 실행만 받을지, 어떤 결과를 받을지 정합니다.

![프로젝트별 알림 대상과 결과 설정 화면](docs/images/notifications.png)

</details>

## 개발 환경에서 실행

Node.js 22.23.3 이상, pnpm 10, Rust stable이 필요합니다. 격리 GitHub helper 빌드에는 Go 1.26.8도 필요합니다(패키지 앱 사용자는 불필요). macOS에는 Xcode Command Line Tools, Windows에는 Microsoft C++ Build Tools와 WebView2 등 [Tauri 필수 도구](https://v2.tauri.app/start/prerequisites/)를 준비합니다.

```sh
git clone https://github.com/likeratel/crowline.git
cd crowline
pnpm install --frozen-lockfile
pnpm tools:prepare
pnpm tauri dev
```

`tools:prepare`는 고정된 GitHub CLI·Node.js·Vercel CLI를 내려받고 체크섬으로 검증한 원본에서 격리 helper를 빌드합니다. 인터넷과 수백 MB 공간이 필요하며 전역 설치는 하지 않습니다.

## 빌드

```sh
pnpm desktop:build
```

패키지는 `src-tauri/target/release/bundle/`에 만듭니다. macOS 앱은 macOS에서, Windows 설치 파일은 Windows에서 빌드합니다. 저장소의 다중 플랫폼 CI 설정은 원격 빌드나 공개 설치 파일이 있다는 근거가 아닙니다.

## 계정과 대상 연결

**설정 → 서비스 연결**에서 서비스를 고르고 계정을 연결한 뒤 모니터링할 프로젝트를 선택합니다. 설정은 바꾸는 즉시 적용됩니다. 계정 선택 옆 연필 버튼으로 별칭을 수정할 수 있습니다.

GitHub와 Vercel은 기존 CLI 로그인 정보를 사용하거나 브라우저 로그인으로 계정을 추가할 수 있습니다. 패키지 앱에는 두 서비스의 CLI가 포함됩니다. AWS는 기존 프로필과 선택한 리전을 사용하며, SSO 로그인을 시작할 때 AWS CLI가 필요합니다. 나머지 CLI 연동은 해당 서비스의 공식 CLI 설치와 로그인이 필요합니다.

추가 CLI 계정을 제거하면 모니터링 설정만 삭제하며 로그아웃하지는 않습니다. Bitbucket 계정을 제거하면 앱이 보관한 해당 인증 정보도 삭제합니다.

## 지원 범위

대부분의 서비스는 공식 CLI에 로그인한 뒤 앱을 재시작하면 연결할 수 있습니다. Bitbucket Cloud는 API 토큰으로 직접 연결합니다. 배포 hook이나 프로젝트 코드 수정은 필요 없습니다.

| 플랫폼 | 조회 | 제한 |
| --- | --- | --- |
| GitHub Actions | 워크플로 실행 | 기존 `gh`, 최근 목록과 진행 상태 별도 조회 |
| Vercel | 프로젝트 배포 | 기존 `vercel`, `BLOCKED` 제외 |
| AWS | CloudFormation, ECS, Amplify | 선택 profile/리전, 실행자 미확인 |
| GitHub Deployments | 배포 기록·최신 상태 | Actions와 별개, 상태 상세 최대 20건 |
| Railway, Netlify, Render | 배포 이력 | 공식 CLI와 서비스별 최근 목록 제한 |
| Heroku, Fly.io | 앱 릴리스 | Fly는 머신 상태가 아닌 릴리스 상태 |
| GitLab.com | 배포·CI 파이프라인 | self-managed, 실행자 판정 미지원 |
| Bitbucket Cloud | 저장소별 Pipelines | 이메일·API 토큰 인증, 최근 이력·진행 상태 조회, 실행자 구분. Data Center 미지원 |
| DigitalOcean, Google Cloud, Azure | 배포·Cloud Build/Run·Kudu | CLI별 범위·출력·페이지 제한 |

EAS/Expo, fastlane, Cloudflare Pages/Workers, Firebase, Supabase는 카탈로그에서 제약만 안내하며 직접 조회를 지원하지 않습니다. 현재 CLI/API로 계정 전체 대상 탐색 또는 신뢰할 수 있는 배포 이력을 얻을 수 없기 때문입니다. CI 작업은 가능한 경우 GitHub Actions나 GitLab 파이프라인으로 감시합니다. [모바일 플랫폼 조사](docs/mobile-provider-notes.md)를 참고하세요. 새 어댑터는 합성 fixture와 명령 계약으로 검증했으며 실계정 로그인 검증은 아닙니다.

### Bitbucket Cloud

**설정 → 서비스 연결 → Bitbucket**에서 Atlassian 이메일과 [API 토큰](https://support.atlassian.com/bitbucket-cloud/docs/create-an-api-token/)을 입력한 뒤 모니터링할 저장소를 선택합니다. 토큰에는 `read:user:bitbucket`, `read:workspace:bitbucket`, `read:repository:bitbucket`, `read:pipeline:bitbucket` 권한이 필요합니다. 별도 CLI 설치는 필요 없습니다. 기본 계정명은 Bitbucket에서 가져오며 연필 버튼으로 별칭을 정할 수 있습니다. **토큰 변경**으로 같은 계정의 인증 정보를 바꾸면 기존 저장소 선택을 유지합니다.

인증 정보는 OS 보안 저장소에만 보관하며 설정 파일·로그·설치 파일에는 넣지 않습니다. Bitbucket 연결을 제거하면 저장된 인증 정보도 삭제됩니다. 메뉴 막대 표시와 프로젝트별 알림은 기존 설정에서 관리합니다. 실행자를 확인할 수 없는 Pipeline은 ‘실행자 미확인’으로 남기며 ‘내 실행’에 포함하지 않습니다. 실제 Bitbucket 계정 연동은 미검증이며 가상 데이터로 테스트했습니다.

최근 Pipeline은 20개씩 불러옵니다. 진행 상태는 실행·대기·일시정지 상태별로 병렬 조회하며 상태당 최대 50개를 확인합니다. 저장소 탐색은 최대 1,000개 저장소, 저장소 50페이지, 워크스페이스 10페이지로 제한하며 한도 초과나 일부 실패는 화면에 표시합니다.

## 패널, 알림, 상태

- **메뉴 막대 패널:** 플랫폼 아이콘, 상태, 브랜치, 실행자를 표시합니다. GitHub 워크플로, Vercel 배포, Bitbucket 커스텀 파이프라인, GitLab 파이프라인·작업, Cloud Build 트리거 이름도 제공되는 경우 함께 표시합니다. 같은 이름은 한 번만 표시하며 바깥 클릭이나 `Esc`로 닫습니다.
- **대시보드:** 서비스·계정·**내 실행만 / 전체 실행**으로 필터링하고 이력을 검색합니다. 서비스가 지원하면 이전 이력을 더 불러올 수 있습니다. 실행자 미확인 항목은 **전체 실행**에서 확인합니다. 표시 필터와 알림 규칙은 별개입니다.
- **알림:** 프로젝트별로 **끔 / 내 실행 / 전체 실행**을 고르고 **모든 결과 / 성공만 / 실패만 / 직접 설정**을 선택합니다. 알림에는 서비스, 결과, 실행 이름·제목, 프로젝트, 브랜치, 실행자를 포함합니다. 긴 내용은 OS 배너에서 잘릴 수 있습니다. 앱을 켠 직후의 과거 결과는 알리지 않습니다.
- **메뉴 막대 설정:** 표시할 서비스·프로젝트와 영역별 1~10개 행을 선택합니다. 실행은 항상 최신순입니다. macOS에서 다른 앱 아이콘 사이의 위치는 Command 키를 누른 채 까마귀 아이콘을 드래그해 바꿉니다.
- **일반:** 언어, 로그인 시 실행, 업데이트 확인, 앱 버전을 관리합니다.

24시간을 넘긴 진행 항목과 Vercel `BLOCKED`는 숨깁니다. 완료 이력은 최근 24시간 또는 7일로 조회합니다. crowline은 조회 전용으로 배포·재실행·취소·인프라 변경을 하지 않습니다.

## 업데이트, 데이터, 한계

실행 중인 작업이 있으면 약 30초, 없으면 약 120초마다 조회하며 오류가 나면 간격을 늘립니다. 시간 초과, 일부 조회 실패, 서비스별 페이지 제한은 화면에 표시합니다. 늦게 조회된 결과는 알림에서 빠질 수 있으므로 전체 기록은 해당 서비스에서 확인하세요.

설정은 OS 앱 데이터 폴더의 `io.crowline.desktop/settings.json`에 보관합니다. GitHub/Vercel은 CLI 인증 정보, AWS는 프로필을 사용합니다. Bitbucket 인증 정보는 OS 보안 저장소에 보관하며, 설치 파일에는 사용자 계정 정보가 들어가지 않습니다.

현재 빌드는 자동 업데이트가 설정되어 있지 않습니다. 저장소는 비공개이며 저장소의 릴리스 주소를 공개 업데이트 경로로 사용할 수 없습니다. 배포·업데이트 설정은 [릴리스 문서](docs/releases.md)를 참고하세요.

로컬 검증 범위는 macOS Apple Silicon 빌드·실행, GitHub/Vercel 패널 데이터, 가상 데이터를 사용한 자동 테스트입니다. Windows 실행, 실제 AWS·Bitbucket 연결, 추가 계정 브라우저 로그인, 최신 시스템 알림 배너 수신은 미검증입니다. 의존성 관련 확인 사항은 날짜가 명시된 [보안 검토](docs/security-review.md)에 기록되어 있습니다.

릴리스·플랫폼 조사·이미지 제작·과거 리뷰는 [문서 목록](docs/README.md)에서 확인할 수 있습니다.

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
