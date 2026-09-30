# Design

## Source of truth
Status: Active. Updated: 2026-09-30. Surfaces: macOS tray panel, dashboard, service connections, panel preferences.
Evidence: App.tsx/App.css, Connections.tsx, AccountPicker.tsx, styles/connections.css, preferences.css, responsive.css and panel.css; existing Playwright tests; user's tray screenshot and reported inconsistent controls/scrolling. No previous design contract or external pixel baseline exists.

## Brand
Crowline is a quiet, precise personal deployment monitor. Dark neutral surfaces, recognizable platform logos, restrained status colors. Avoid decorative workspace concepts and invented capabilities.

## Product goals
Recognize running deployments quickly; connect existing local sessions; select monitored targets confidently. Make partial results visible immediately. No deployment mutations, remote account administration, or workspace-management layer. Local connection slots remain supported.
Success: users can understand connection prerequisites, choose targets and save; controls align; outside clicks dismiss the tray.

## Personas and jobs
An individual developer checks deployments while working and occasionally opens the dashboard to inspect history or configure monitoring.

## Information architecture
Tray: compact running/recent activity and dashboard entry. Dashboard: service filters, account/time/search filters, activity and history. Connections: choose service, verify session, select targets, save. Preferences: select tray content. No workspace navigation until a real workspace model exists.

## Design principles
Show actionable information first. Explain prerequisites where the action occurs. Preserve partial results and explicit failures. Use one primary scrolling content region per surface; avoid nested catalog/body scrolling.

## Visual language
Keep existing dark color tokens. Use a shared 4px spacing scale (4, 8, 12, 16, 24, 32). Standard controls are 36px high; explicitly compact tray controls may be 28px. Standard radius 8px, cards/dialogs 12px. Body text 13px with at least 1.5 line height; help text at least 12px. Match input, select, search and button heights. Use platform logos plus accessible names, never color alone. No smooth scrolling or decorative motion; respect reduced motion.

## Components
src/styles/base.css owns shared tokens and base controls and is imported by App.css; surface CSS consumes them. Reuse buttons, fields, icon buttons, status messages and empty states. Dialog is a bounded flex column with stable header/footer and one scrolling body. Service picker, prerequisites and target selection share that body. Focus, hover, disabled, loading and error states remain distinguishable.

## Accessibility
Target WCAG AA contrast; visible keyboard focus; native form controls with labels; dialog naming and Escape dismissal; tab semantics only for actual panels. Buttons retain accessible names in compact navigation. Do not communicate status solely with color. Scroll areas must work with keyboard and trackpad.

## Responsive behavior
Desktop dashboard keeps sidebar; compact widths collapse navigation text and wrap filters without clipping. Dialog fits viewport with stable save/close actions. Avoid horizontal scrolling and shrinking form text to fit. Tray keeps its intentional compact density.

## Interaction states
Loading retains useful previous/partial results and indicates pending work. Empty target lists explain discovery/select steps. Disconnected or unsupported services explain prerequisites and available actions. Failures and partial failures remain visible; no empty-success substitution. Saving preserves selections from other windows.

## Content voice
Concise Korean instructions, concrete service/account/target terminology. Describe local session reuse and read-only behavior. Explain active 24-hour scope and history separately. Never claim an unsupported integration is connected.

## Implementation constraints
Tauri 2, React, TypeScript, existing CSS and native dialogs. No new UI framework. Backend concurrency stays bounded with existing refresh generation guards and credential boundaries. Validate with typecheck, unit tests, build, targeted layout/interaction E2E, Rust checks, and packaged native app inspection.

## Open questions
- [ ] Owner: user. Future workspace management is not defined; omit it until a concrete job requires it.
- [ ] Owner: maintainer. Mobile provider support remains limited to documented working capabilities; this UI pass does not expand provider authentication.
