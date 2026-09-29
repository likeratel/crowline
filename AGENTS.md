# Launchwatch

개인용 배포 모니터. Tauri 2 + React + TypeScript, Rust 서비스 연동.

- 로컬 Git 커밋은 허용된다. 원격 저장소 연결·push·배포는 별도 사용자 지시 전까지 하지 않는다.
- 인증은 사용자의 GitHub/Vercel CLI 세션과 AWS profile을 재사용한다. 토큰·개인 계정·실제 API 응답을 코드, 테스트 fixture, 로그에 기록하지 않는다.
- 조회 전용 앱이다. 재배포·취소·인프라 변경 명령을 추가하지 않는다.
- 화면에 전달하는 외부 URL과 IPC 입력을 검증한다. 셸 문자열 조합으로 명령을 실행하지 않는다.
- 조회 실패, 부분 조회, 실행자 미확인을 빈 성공 결과로 표시하지 않는다.
- README에 실제 지원 범위와 검증 한계를 기록한다. 테스트 데이터는 가상의 조직과 사용자만 사용한다.
- TypeScript 확인: `pnpm check`, `pnpm test`, `pnpm build`, `pnpm test:e2e`.
- Rust 확인: `cargo fmt --check`, `cargo test`, `cargo clippy --all-targets -- -D warnings` (src-tauri).
