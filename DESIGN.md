# Design

## Source of truth
Status: Active. Updated: 2026-09-30. Surfaces: macOS tray panel, dashboard, and Settings.
Evidence: App.tsx/App.css, Connections.tsx, AccountPicker.tsx, styles/connections.css, preferences.css, responsive.css and panel.css; existing Playwright tests; user's tray screenshot and reported inconsistent controls/scrolling. No previous design contract or external pixel baseline exists.

## Brand
Crowline is a quiet, precise personal deployment monitor. Dark neutral surfaces, recognizable platform logos, restrained status colors. Avoid decorative workspace concepts and invented capabilities.

## Product goals
Recognize running deployments quickly; connect existing local sessions; select monitored targets confidently. Make partial results visible immediately. No deployment mutations, remote account administration, or workspace-management layer. Local connection slots remain supported.
Success: users can understand connection prerequisites, choose targets and save; controls align; outside clicks dismiss the tray.

## Personas and jobs
An individual developer checks deployments while working and occasionally opens the dashboard to inspect history or configure monitoring.

## Information architecture
Tray: compact running/recent activity and dashboard entry. Dashboard: service filters, account/time/search filters, activity and history. The sidebar has one Settings entry with Connections, Notifications, Menu bar, and General tabs. Connections contains the visible service catalog, connection guide, account verification, and target selection; keep the catalog expanded, per user preference. Menu bar selects tray content. General contains language, login startup, updates, and About with the app version. No workspace navigation until a real workspace model exists.

## Design principles
Show actionable information first. Explain prerequisites where the action occurs. Preserve partial results and explicit failures. Use one primary scrolling content region per surface; avoid nested catalog/body scrolling.

## Visual language
Keep existing dark color tokens. Use a shared 4px spacing scale (4, 8, 12, 16, 24, 32). Standard controls are 36px high; explicitly compact tray controls may be 28px. Standard radius 8px, cards/dialogs 12px. Body text 13px with at least 1.5 line height; help text at least 12px. Match input, select, search and button heights. Use platform logos plus accessible names, never color alone. Tray status uses a separate 16px icon rather than a tiny logo badge; auxiliary text is at least 12px. No smooth scrolling or decorative motion; respect reduced motion.

## Components
src/styles/base.css owns shared tokens and base controls and is imported by App.css; surface CSS consumes them. Reuse buttons, fields, icon buttons, status messages and empty states. Dialog is a bounded flex column with stable header/footer and one scrolling body. Service picker, prerequisites and target selection share that body. Focus, hover, disabled, loading and error states remain distinguishable.

## Accessibility
Target WCAG AA contrast; visible keyboard focus; native form controls with labels; dialog naming and Escape dismissal; tab semantics only for actual panels. Buttons retain accessible names in compact navigation. Do not communicate status solely with color. Scroll areas must work with keyboard and trackpad.

## Responsive behavior
Desktop dashboard keeps sidebar; compact widths collapse navigation text and wrap filters without clipping. Dialog fits viewport with stable close actions. Avoid horizontal scrolling and shrinking form text to fit. Tray keeps its intentional compact density.

## Interaction states
Loading retains useful previous/partial results and indicates pending work. Empty target lists explain discovery/select steps. Disconnected or unsupported services explain prerequisites and available actions. Failures and partial failures remain visible; no empty-success substitution. Settings apply immediately, with serialized frontend writes and atomic backend field merges. A failed item rolls back independently and exposes retry, without discarding unrelated changes. Account additions/removals apply immediately and say so; removal requires an inline confirmation with account and selected-target count. Account aliases open from the pencil beside the selector and save after 500 ms of inactivity or on blur. Tray shows actor scope and visible/total target count; empty states explain exclusions without hiding errors. Collapse a zero-running dashboard section to a single line.

## Content voice
Natural Korean workplace terminology, with complete English, Japanese and Simplified Chinese catalogs. Use the system language by default and English for unsupported languages; all Chinese system locales use the supported Simplified Chinese catalog. Describe local session reuse and read-only behavior. Explain active 24-hour scope and history separately. Never claim an unsupported integration is connected.

## Preference behavior
Projects always appear newest first by `updatedAt`; there is no project pinning or failure-first ordering. On macOS, the user controls the crow icon's order among other menu-bar apps by Command-dragging it in the system menu bar; crowline provides no app-priority guarantee. Notifications use compact project rows: Off, My runs, or All runs, followed by Failed only, All results, or Custom outcomes. New rules default to successful, failed, and canceled outcomes; existing rules retain their outcomes. Custom keeps its outcome editor open and prevents clearing the final selected outcome. Search, service filtering, and an explicit selected-project bulk apply help edit rules. Notification rules are independent from display filters; unknown actors never match My runs. Notifications start silently with a baseline, do not replay old results, and require system permission. An alias overrides an account name; otherwise use the service identity when available, then the profile or service name, while retaining existing user-supplied names. General places the version in About only, without a logo, tagline, or footer. Automatic update checks never install without a user click, and builds without a signing public key explain why updating is unavailable. Connection health distinguishes unqueried, loading, successful empty results, partial data and failed authentication.

## Implementation constraints
Tauri 2, React, TypeScript, existing CSS and native dialogs. No new UI framework. Backend concurrency stays bounded with existing refresh generation guards and credential boundaries. Validate with typecheck, unit tests, build, targeted layout/interaction E2E, Rust checks, and packaged native app inspection.

## Open questions
- [ ] Owner: user. Future workspace management is not defined; omit it until a concrete job requires it.
- [ ] Owner: maintainer. Mobile provider support remains limited to documented working capabilities; this UI pass does not expand provider authentication.
