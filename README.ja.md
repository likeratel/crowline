# crowline

[English](README.md) · [한국어](README.ko.md) · 日本語 · [简体中文](README.zh-CN.md)

<img src="public/crowline.png" alt="電線にとまる三羽のカラス" width="160" />

crowline はデプロイと CI の実行状況を確認するメニューバー・システムトレイアプリです。パネルで最近の実行を確認し、ダッシュボードでアカウント接続、履歴検索、通知を設定できます。Tauri 2、React、TypeScript、Rust 製で、サービスへの問い合わせは利用者のコンピューター上で行います。表示言語はシステム設定に従い、日本語・英語・韓国語・簡体字中国語に対応します。

## プレビュー

メニューバーパネルから、デプロイ状況の確認、サービスでの絞り込み、アカウント接続、プロジェクトごとの通知設定まで。

![サービスで実行を絞り込み、接続と通知を設定するデモ](docs/images/walkthrough.gif)

架空のプロジェクトとアカウントを使い、アプリのブラウザプレビューを韓国語 UI で撮影しています。実際のデプロイや通知の受信を示すものではありません。

<details>
<summary>スクリーンショットを見る</summary>

**メニューバーパネル** — 実行状況、ブランチ、実行者をすばやく確認できます。

<img src="docs/images/menu-bar.png" alt="サービスのアイコンと実行者を表示するメニューバーパネル" width="420" />

**ダッシュボード** — 実行中の処理と最近の結果をまとめて確認できます。

![架空の GitHub Actions と Vercel のデプロイ状況](docs/images/dashboard.png)

**接続** — サービスとアカウントを選び、監視するプロジェクトを設定します。

![サービスの選択と GitHub アカウントの接続設定](docs/images/connections.png)

**通知** — プロジェクトごとに、誰の実行を対象にするか、どの結果を通知するかを選べます。

![プロジェクトごとの通知対象と結果の設定](docs/images/notifications.png)

</details>

## 開発環境で実行

Node.js 22.23.3 以降、pnpm 10、Rust stable が必要です。隔離 GitHub helper のビルドには Go 1.26.8 も必要です（パッケージ版には不要）。macOS は Xcode Command Line Tools、Windows は Microsoft C++ Build Tools と WebView2 などの [Tauri 前提条件](https://v2.tauri.app/start/prerequisites/)を準備してください。

```sh
git clone https://github.com/likeratel/crowline.git
cd crowline
pnpm install --frozen-lockfile
pnpm tools:prepare
pnpm tauri dev
```

`tools:prepare` は固定版 GitHub CLI、Node.js、Vercel CLI を取得し、チェックサムで確認した上流ソースから隔離 helper をビルドします。インターネット接続と数百 MB の空き容量が必要で、グローバルインストールはしません。

## ビルド

```sh
pnpm desktop:build
```

パッケージは `src-tauri/target/release/bundle/` に作成されます。macOS アプリは macOS、Windows インストーラーは Windows でビルドします。リポジトリのマルチプラットフォーム CI 設定は、リモートビルドや公開インストーラーの証拠ではありません。

## 接続と対象選択

**設定 → 接続**でサービスとアカウントを選び、監視するプロジェクトを指定します。変更はすぐに反映されます。アカウント選択欄の横にある鉛筆ボタンで表示名を変更できます。

GitHub と Vercel は既存の CLI ログイン情報を利用するか、ブラウザで別のアカウントにログインできます。パッケージ版には両サービスの CLI を同梱しています。AWS は既存のプロファイルと選択したリージョンを使い、SSO ログインの開始には AWS CLI が必要です。その他の CLI 連携には、公式 CLI のインストールとログインが必要です。

追加した CLI アカウントを削除してもログアウトはせず、監視設定だけを削除します。Bitbucket の接続を削除すると、アプリが保存した認証情報も削除します。

## 対応監視

多くのサービスは公式 CLI のログイン情報を利用します。CLI にログインしてから crowline を再起動してください。Bitbucket Cloud は API トークンで直接接続します。デプロイ hook やプロジェクトのコード変更は不要です。

| プラットフォーム | 監視 | 制限 |
| --- | --- | --- |
| GitHub Actions | ワークフロー実行 | 既存 `gh`、最近一覧と実行中状態を別途参照 |
| Vercel | プロジェクトデプロイ | 既存 `vercel`、`BLOCKED` を除外 |
| AWS | CloudFormation、ECS、Amplify | 選択したプロファイルとリージョン、実行者不明 |
| GitHub Deployments | 記録と最新状態 | Actions とは別、状態詳細は最大 20 件 |
| Railway、Netlify、Render | デプロイ履歴 | 公式 CLI とサービス別の最近一覧制限 |
| Heroku、Fly.io | アプリリリース | Fly はマシン状態ではなくリリース状態 |
| GitLab.com | デプロイ・CI パイプライン | self-managed と実行者判定は未対応 |
| Bitbucket Cloud | リポジトリの Pipelines | メールアドレスと API トークン、最近の履歴・実行中の状態・実行者の判定。Data Center は未対応 |
| DigitalOcean、Google Cloud、Azure | デプロイ・Cloud Build/Run・Kudu | CLI ごとの対象/出力/ページ制限 |

EAS/Expo、fastlane、Cloudflare Pages/Workers、Firebase、Supabase はカタログ上の制約案内のみで、直接監視には未対応です。現行 CLI/API ではアカウント全体の対象検出または信頼できるデプロイ履歴を取得できません。該当する CI 作業は GitHub Actions または GitLab パイプラインで監視してください。[モバイルプロバイダー調査](docs/mobile-provider-notes.md)を参照してください。新アダプターの検証は合成 fixture とコマンド契約であり、実アカウントログインではありません。

### Bitbucket Cloud

**設定 → 接続 → Bitbucket** で Atlassian のメールアドレスと [API トークン](https://support.atlassian.com/bitbucket-cloud/docs/create-an-api-token/)を入力し、監視するリポジトリを選択します。必要な権限は `read:user:bitbucket`、`read:workspace:bitbucket`、`read:repository:bitbucket`、`read:pipeline:bitbucket` です。CLI のインストールは不要です。アカウント名は Bitbucket から取得し、鉛筆ボタンで表示名を変更できます。**トークンを変更**すると、監視対象を保持したまま同じアカウントの認証情報を更新できます。

認証情報は OS の資格情報ストアに保管し、設定ファイル・ログ・インストーラーには含めません。Bitbucket 接続を削除すると、保存した認証情報も削除されます。メニューバー表示とプロジェクト別通知は既存の設定を使います。実行者を確認できない Pipeline は不明として扱い、自分の実行には含めません。実アカウントでの接続は未検証で、テストには架空のデータを使用しています。

最近の Pipeline は20件ずつ読み込みます。実行中・待機中・一時停止中の状態を並列で照会し、各状態で最大50件を確認します。リポジトリ検出は1,000件、リポジトリ50ページ、ワークスペース10ページが上限です。上限到達や一部の取得失敗は画面に表示します。

## パネル、通知、状態

- **メニューバーパネル:** サービスのアイコン、状態、ブランチ、実行者を表示します。取得できる場合は GitHub ワークフロー、Vercel デプロイ、Bitbucket カスタムパイプライン、GitLab パイプライン・ジョブ、Cloud Build トリガーの名前も表示します。同じ名前は重複させません。外側のクリックか `Esc` で閉じます。
- **ダッシュボード:** サービス、アカウント、自分の実行・すべての実行で絞り込み、履歴を検索できます。サービスが対応していれば過去の履歴を追加で読み込めます。実行者不明の項目はすべての実行に含まれます。表示フィルターと通知ルールは独立しています。
- **通知:** プロジェクトごとにオフ・自分の実行・すべての実行と、すべての結果・成功のみ・失敗のみ・カスタムを選びます。通知にはサービス、結果、実行名・タイトル、プロジェクト、ブランチ、実行者を含めます。長い内容は OS のバナーで省略される場合があります。起動直後に取得した過去の結果は通知しません。
- **メニューバー設定:** 表示するサービス・プロジェクトと各欄の行数（1～10）を選びます。実行は常に新しい順です。macOS でアイコンの位置を変えるには、Command キーを押しながらカラスをドラッグします。
- **一般:** 言語、ログイン時の起動、更新確認、アプリのバージョンを管理します。

24 時間を超えた進行中の項目と Vercel の `BLOCKED` は非表示にします。完了履歴は 24 時間または 7 日間で表示できます。crowline は参照専用で、デプロイ・再実行・キャンセル・インフラ変更は行いません。

## アップデート、データ、制限

実行中の処理があるときは約 30 秒、ないときは約 120 秒間隔で取得し、エラー後は間隔を延ばします。タイムアウト、部分的な取得失敗、ページ上限は画面に表示します。遅れて取得した結果は通知されない場合があるため、完全な記録は各サービスで確認してください。

設定は OS のアプリデータ内の `io.crowline.desktop/settings.json` に保存します。GitHub/Vercel は CLI の認証情報、AWS はプロファイルを使います。Bitbucket の認証情報は OS の認証情報ストアに保存し、インストーラーに利用者のアカウント情報は含めません。

現在のビルドでは自動更新を設定していません。リポジトリは非公開のため、そのリリース URL は公開の更新元として利用できません。配布・更新設定は[リリース手順](docs/releases.md)を参照してください。

ローカルで確認済みなのは macOS Apple Silicon のビルド・起動、GitHub/Vercel のパネル表示、架空データによる自動テストです。Windows、実際の AWS・Bitbucket 接続、追加アカウントのブラウザログイン、最新の OS 通知バナーは未検証です。依存関係の確認事項は日付付きの[セキュリティレビュー](docs/security-review.md)に記録しています。

その他の資料は[ドキュメント一覧](docs/README.md)をご覧ください。

## 開発確認

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

これは現在の確認コマンドであり、固定件数や現時点の成功結果は主張しません。

## ライセンス

crowline は [MIT License](LICENSE) で提供します。helper の版とライセンスは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)、パッケージの告知は `tools/` にあります。カラスアイコンの来歴は[ブランドノート](docs/brand.md)にあります。
