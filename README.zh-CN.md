# crowline

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · 简体中文

<img src="public/crowline.png" alt="三只停在电线上的乌鸦" width="160" />

crowline 是本地优先的桌面端部署与 CI 结果监控工具。通过菜单栏/系统托盘的乌鸦打开摘要面板；在仪表板中管理账号连接、监控项目、搜索和历史记录。它由 Tauri 2、React、TypeScript 和 Rust 构建，没有共享账号或应用服务器，使用本地 CLI 登录信息或已连接账号直接查询服务。UI 默认跟随系统语言，支持韩语、英语、日语和简体中文；无法识别系统区域设置时回退到英语。

## 界面预览

查看部署状态 → 按服务筛选 → 连接账号 → 设置项目通知。

![按服务筛选执行记录、连接账号并设置个人执行通知的演示](docs/images/walkthrough.gif)

使用虚构项目和账号，在应用的浏览器预览中录制，界面语言为韩语。演示不包含真实部署或通知推送。

<details>
<summary>查看更多截图</summary>

**菜单栏面板** — 快速查看运行状态、分支和触发人。

<img src="docs/images/menu-bar.png" alt="显示服务图标和触发人的菜单栏摘要面板" width="420" />

**仪表板** — 集中查看正在运行的任务和最近的结果。

![虚构的 GitHub Actions 和 Vercel 部署状态](docs/images/dashboard.png)

**账号连接** — 选择服务和账号，设置需要监控的项目。

![服务选择和 GitHub 账号连接设置](docs/images/connections.png)

**通知** — 为每个项目选择关注谁的执行记录，以及接收哪些结果。

![各项目的通知对象和结果设置](docs/images/notifications.png)

</details>

## 开发环境与运行

需要 Node.js 22.23.3 或更高版本、pnpm 10 与 Rust stable。构建隔离 GitHub helper 还需要 Go 1.26.8（打包应用用户不需要）。macOS 需 Xcode Command Line Tools，Windows 需 Microsoft C++ Build Tools、WebView2 等 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/)。

```sh
git clone https://github.com/likeratel/crowline.git
cd crowline
pnpm install --frozen-lockfile
pnpm tools:prepare
pnpm tauri dev
```

`tools:prepare` 下载固定版本的 GitHub CLI、Node.js 与 Vercel CLI，并从经校验和验证的上游源码构建隔离 helper。它需要联网和数百 MB 磁盘空间，不会全局安装工具。

## 构建

```sh
pnpm desktop:build
```

包生成在 `src-tauri/target/release/bundle/`。请在 macOS 构建 macOS 应用，在 Windows 构建 Windows 安装程序。仓库中的多平台 CI 配置仅是配置，不能证明远程构建或公开安装包已经存在。

## 连接账号和选择项目

在仪表板侧边栏打开唯一的 **设置** 项。它包含 **连接**、**通知**、**菜单栏** 和 **常规** 四个标签页。GitHub/Vercel 从现有本地 CLI 账号开始：确认连接并选择要监控的项目，选择会立即生效。新增 GitHub/Vercel 账号时，创建带标签的账号槽位并在浏览器登录。新增 GitHub 账号始终使用随附 `gh-isolated`，它按账号隔离 OS 凭据存储名称，绝不回退到未打补丁的系统 CLI；Vercel 使用私有 global-config 目录。

AWS 可为每个已有本地配置文件 添加槽位，选择区域后发现 CloudFormation、ECS 与 Amplify 分支。选择配置文件前只读取本地名称，不会发送 AWS 服务请求。SSO 过期时从应用启动登录。账号添加/删除和项目选择都会立即生效。删除新增 CLI 账号不会退出登录或删除 CLI 配置、系统凭据。删除 Bitbucket 连接则会同时删除应用保存的对应凭据。打包应用包含 GitHub CLI、Node.js、Vercel CLI；AWS 查询使用 SDK。

## 已支持的监控

大多数服务使用官方 CLI 的登录信息；登录后重启 crowline 即可检测。Bitbucket Cloud 通过 API 令牌直接连接，无需部署 hook 或修改项目代码。

| 平台 | 监控 | 限制 |
| --- | --- | --- |
| GitHub Actions | 工作流运行 | 现有 `gh`；最近列表和活动状态分别查询 |
| Vercel | 项目部署 | 现有 `vercel`；排除 `BLOCKED` |
| AWS | CloudFormation、ECS、Amplify | 选定的配置文件和区域；执行者未知 |
| GitHub Deployments | 部署记录和最新状态 | 独立于 Actions；状态详情最多 20 条 |
| Railway、Netlify、Render | 部署历史 | 官方 CLI 和服务各自的最近列表限制 |
| Heroku、Fly.io | 应用发布 | Fly 展示发布状态，不代表机器运行状态 |
| GitLab.com | 部署与 CI 管道 | 不支持 self-managed 和执行者判定 |
| Bitbucket Cloud | 仓库 Pipelines | 邮箱和 API 令牌、最近记录与运行状态、执行者识别。不支持 Data Center |
| DigitalOcean、Google Cloud、Azure | 部署、Cloud Build/Run、Kudu | 各 CLI 的范围/输出/分页限制 |

EAS/Expo、fastlane、Cloudflare Pages/Workers、Firebase、Supabase 只提供目录中的限制说明，并非直接监控集成。现有 CLI/API 无法提供账户范围的目标发现或可信的部署历史。适用时请通过 GitHub Actions 或 GitLab 管道监控 CI 工作。参见[移动端服务商调研](docs/mobile-provider-notes.md)。新适配器仅以合成 fixture 与命令契约验证，不代表真实账号登录验证。

### Bitbucket Cloud

在 **设置 → 连接 → Bitbucket** 中输入 Atlassian 邮箱和 [API 令牌](https://support.atlassian.com/bitbucket-cloud/docs/create-an-api-token/)，再选择要监控的仓库。令牌需要 `read:user:bitbucket`、`read:workspace:bitbucket`、`read:repository:bitbucket` 和 `read:pipeline:bitbucket` 权限，无需安装 CLI。默认账号名称来自 Bitbucket，也可点击铅笔设置别名。通过 **更换令牌** 更新同一账号的凭据时，会保留已选仓库。

凭据仅保存在系统凭据存储中，不会写入设置文件、日志或安装包。删除 Bitbucket 连接时，也会删除对应凭据。菜单栏显示和项目通知沿用现有设置。无法确认执行者的 Pipeline 会标为未知，不计入“我的执行”。尚未验证真实账号连接，测试使用虚构数据。

最近的 Pipeline 每页读取20条。运行、等待及暂停等状态并行查询，每种状态最多50条。仓库发现最多查询1,000个仓库、50页仓库列表和10页工作区列表；达到上限或部分查询失败时会在界面提示。

## 面板、通知和状态

- 点击乌鸦开关面板，点击外部或按 `Esc` 关闭。服务、账号、**仅我的运行**、**所有运行**筛选只改变显示。GitHub 使用 `triggering_actor`（缺失时 `actor`），Vercel 使用部署创建者；执行者未知仅出现在 **所有运行**。
- 刷新请求立即轮询。结果按项目返回，只有服务提供下一页游标 时才加载更多历史。完成记录支持 24 小时/7 天和搜索。
- **设置** 包含 **连接**、**通知**、**菜单栏** 和 **常规** 四个标签页。所有设置在更改时立即生效。应用会串行处理更改，后端按字段原子合并；某项保存失败时只回滚该项并提供**重试**。可通过账号选择器旁的铅笔编辑别名：停止输入 500 毫秒后或离开输入框时保存。别名优先；否则依次显示服务身份、已保存的 profile 或服务名称。已有的用户自定义账号名称会保留。
- 在 **菜单栏** 选择服务/项目、进行中/已完成和每区 1–10 行。项目始终按最新 `updatedAt` 从新到旧排列；没有项目置顶或失败优先排序。macOS 中乌鸦图标与其他菜单栏应用之间的顺序由在系统菜单栏按住 Command 拖动控制；crowline 不保证应用优先级。
- 在 **通知** 中，每个紧凑项目行选择 **关闭**、**仅我的运行** 或 **所有运行**，再选择 **仅失败**、**所有结果** 或 **自定义** 结果。新规则默认包含成功、失败和已取消结果，已有规则会保留原来的选择。自定义会保持结果编辑器打开，并始终至少保留一个结果。搜索、服务筛选，以及只应用到明确选中项目的批量操作可帮助修改多个规则。通知规则与显示筛选相互独立。启动后首次观察只建立静默基线，不会补发历史结果通知。
- 服务状态会显示需要登录、缺少 CLI、连接需要检查、部分结果或正在查询。请在 连接设置中重新登录，安装提示 CLI 后重新连接；错误时检查网络与账号权限。部分/错误后显示的结果可能已过期。
- **登录时启动 Crowline** 为可选项，会立即修改 OS 设置。**自动检查更新** 的偏好默认开启。应用版本显示在 **常规** 的“关于”中。

超过 24 小时的排队/运行/等待审批不会标记为失败，只会隐藏；Vercel `BLOCKED` 也会排除。未知状态和读取错误单独显示。crowline 仅供查询，不会重跑工作流、部署、取消、更改基础设施或执行用户提供的命令。

通知依赖定期查询和各服务提供的时间戳。首次查到的结果若比最新事件早10分钟以上，可能不会触发通知。记录过多需要清理时，也会优先避免重复通知，因此部分延迟结果可能被跳过。完整部署记录请以各服务的历史记录为准。

## 更新、数据和限制

仓库包含手动触发工作流，目标是创建签名桌面草稿发布和 updater 元数据。但当前构建没有 updater 公钥或已发布版本配置，因此会如实显示应用内更新不可用。这里不声称存在公开公钥、签名制品或公开发布。自动检查默认开启也不会在发布路径配置并发布之前提供更新。

GitHub/Vercel 认证流程管理凭据，不会复制到应用设置。AWS 使用选定的配置文件，不保存密钥。Bitbucket 邮箱和 API 令牌保存在系统凭据存储中。设置存于 OS 应用数据中的 `io.crowline.desktop/settings.json`，新增 CLI 配置也保留在该目录；活动缓存和登录状态在内存中。有活动任务时约每 30 秒轮询，空闲时约每 120 秒，出错后变慢。

超时、速率限制、部分列表和分页限制显示在 UI 中。后台 Vercel SAML 重新认证无法打开浏览器。随附 CLI 依赖有已知安全公告，包含传递 Go 模块的完整二进制漏洞验证尚未完成；见[安全审查](docs/security-review.md)。

这仍是早期开发软件。现有证据包括合成浏览器测试、macOS Apple Silicon app/DMG 构建与面板可访问性，以及此前 macOS 上 GitHub/Vercel 的检查。原生托盘/下拉/设置完整操作、Windows 运行时、真实 AWS 访问和新增账号浏览器登录仍未验证。

## 开发检查

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

这些是当前检查命令，不声称固定测试数量或当前通过结果。

## 许可证

crowline 使用 [MIT License](LICENSE)。helper 工具版本和许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，打包声明位于 `tools/`。乌鸦图标来源见[品牌说明](docs/brand.md)。
