# T4 Code Customizations & Locked Features

> **Single source of truth for T4 Code (`imetn/t4code`) fork customizations.**
>
> Every module listed below has been **designed, verified, and finalized (`Locked`)** for T4 Code.
> Upstream (`pingdotgg/t3code`) fixes and features are welcome, **but upstream merges, cherry-picks, and refactors MUST NEVER silently overwrite, regress, or drop any locked behavior below.**

## Fork Merge & Release Protocol

1. **Protect locked behavior by default.**
   - Before merging or porting any upstream PR, run `vp run check:t4-locks` (or inspect this file) to see if any locked module is touched.
   - When resolving conflicts in a locked module, **preserve T4 Code's finalized UI, copy, layout, and semantics** and graft only the orthogonal upstream fix/feature around them.
   - If you believe an upstream change is genuinely better and should **replace** a locked T4 customization, **stop and present a side-by-side comparison to the user for explicit approval first.** Never silently replace it.
2. **Release from latest `main` only.**
   - Every macOS Desktop (`v0.1.12-t4.x`) and iOS/Android Mobile release MUST be built from the latest `main` branch after all user-confirmed changes (especially confirmed UI changes) have been landed and verified on `main`.
   - Never release from an unmerged side branch or stale commit that omits recently confirmed UI work.
3. **Keep this manifest current.**
   - Whenever the user confirms and finalizes a new custom feature or UI redesign, append or update its entry here in the same commit.

---

## Locked Modules Registry

Each entry uses `<!-- t4-lock: <id> -->` and explicit path prefixes/files so `scripts/check-t4-locks.ts` can detect touches automatically without duplicating lists.

### 1. Model Selector Redesign (Web / Desktop & Mobile)

<!-- t4-lock: model-selector -->

- **Status**: `Locked` (finalized in `4ee8ae85e6`, toolbar refinement in `521aa66f91`)
- **Surfaces**: Web, Desktop, Mobile (iOS & Android)
- **Protected Paths**:
  - `apps/web/src/components/chat/ComposerModelEffort.tsx`
  - `apps/web/src/components/chat/ModelPickerContent.tsx`
  - `apps/web/src/components/chat/ModelPickerSidebar.tsx`
  - `apps/web/src/components/chat/ModelListRow.tsx`
  - `apps/web/src/components/chat/ProviderModelPicker.tsx`
  - `apps/web/src/components/settings/FavoriteModelsSection.tsx`
  - `apps/web/src/index.css`
  - `apps/mobile/src/features/threads/MobileReasoningPowerSlider.tsx`
  - `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx`
  - `apps/mobile/src/features/threads/ThreadSettingsRows.shared.tsx`
  - `apps/mobile/src/features/settings/FavoriteModelsSection.tsx`
  - `apps/mobile/src/components/ComposerModelControl.tsx`
  - `apps/mobile/src/components/ComposerToolbar.tsx`
- **Non-Negotiable Invariants**:
  - **Web / Desktop**:
    - Grounded `h-12` top horizontal provider & favorites header (`bg-accent/55 dark:bg-foreground/4`) with a recessed segmented pill rail (`bg-foreground/6`), elevated active pill (`bg-popover shadow-xs`, `text-xs font-semibold`), and grounded circular search button visually bookending the matching bottom deck.
    - Selected model rows show a crisp checkmark and semibold label with **NO persistent gray background fill** (`selectedFill={false}`); compact `min-h-8` / `13px` row density inside an adaptive-height list (tight on short lists with zero dead gap, expanding smoothly up to `max-h-80` / `320px` for ~9 visible rows).
    - Favorite star toggle on every model row, plus cross-provider Favorites tab ordered by `ServerSettings.favorites` with **NO drag handles or reorder controls inside the model picker popup**; cross-provider favorite model reordering lives in **Settings → Providers** (`FavoriteModelsSection.tsx`, `@dnd-kit` drag handles + arrow buttons) and syncs across devices.
    - Unified quiet bottom control deck (`bg-accent/45 dark:bg-foreground/4`) housing the slim `24px` **Capsule Reasoning Power Slider** with `18px` circular dot thumb (NOT vertical bar), airy luminous cobalt gradient, pure circular drifting white starfield dots whose density & speed scale with reasoning level (no sparkle icon or scratch lines), and **NO sparkle/star AI-slop icon** in front of the Reasoning label (even on Ultra/Max).
    - No redundant text badge next to `Reasoning` when level labels are already shown beneath the slider.
    - Compact **Standard / Fast** mode toggle positioned inline with the Reasoning header (replacing depth text labels), and extra model options (such as `Cyber Access · Standard`) share the single bottom footer row alongside the right-aligned Permissions menu (`ComposerPickerFooter`).
  - **Mobile (iOS & Android)**:
    - Compact half-sheet (`ThreadSettingsSheet`, `detent: 0.58`, `maxDetent: 0.9`) with **zero nested boxes / zero capsule-inside-capsule nesting** on a single native Liquid Glass plane with a readability scrim tint (`rgba(15,15,20,0.68)` dark / `rgba(248,248,251,0.80)` light), generous `22pt` horizontal insets, and crisp `0.5pt` hairline dividers.
    - Aligned `34pt` top header row (`Choose model` title on left + bare ghost `magnifyingglass` and `ellipsis` icon buttons on right at the same line height, no redundant active-model subtitle), followed by a flat single-layer horizontal provider & favorites tab strip (`18pt` icons, elevated active pill with `13.5px` semibold label).
    - Direct checkmark-only model list (`38pt` rows, `14.5px` typography, high-contrast `text-foreground/90` unselected labels) with **NO selected-row background box or shadow** (only bold foreground text + right-side `✓` checkmark, legible `0.72` favorite star opacity on unselected rows).
    - PC-aligned bottom controls: `Reasoning` header row showing level count (`X / Y`) + inline `Std / Fast` switcher, standalone full-width `28pt` Capsule Reasoning Power Slider (`22pt` circular thumb, detent dots hidden behind fill, pure circular drifting starfield dots without sparkle/scratch artifacts), and a single unified bottom footer row carrying provider-specific extra options (such as GPT `Cyber Access`) on the left and the `Runtime` (`完全访问 ⌄`) menu pill on the right.
    - Cross-provider Favorites tab follows `ServerSettings.favorites` order cleanly without reorder mode inside the model picker sheet; cross-provider favorite reordering lives in **Settings → Providers** (`apps/mobile/src/features/settings/FavoriteModelsSection.tsx`, using `SettingsDragHandle` + Reanimated smooth shift + haptics) synced live with Desktop/Web.
    - Composer model pill (`ThreadComposer` + `ComposerModelControl`) always displays the active model name and reasoning effort both when empty and when typing (`iconOnly={false}`), while preserving the simplified mobile composer toolbar (`521aa66f91`).

### 2. Project Todos Center (`/todos`), MCP Tools & Full-Screen Calendar / Timeline

<!-- t4-lock: project-todos -->

- **Status**: `Locked` (`adbde2be0d`, `1b2de0c332`)
- **Surfaces**: Server, Contracts, Client Runtime, Web, Desktop
- **Protected Paths**:
  - `packages/contracts/src/t4/projectTodo.ts`
  - `packages/client-runtime/src/t4/projectTodos.ts`
  - `apps/server/src/t4/todo/`
  - `apps/server/src/t4/mcp/`
  - `apps/server/src/t4/persistence/`
  - `apps/web/src/components/t4/todo/`
  - `apps/web/src/state/projectTodos.ts`
  - `apps/web/src/routes/_chat.todos.tsx`
- **Non-Negotiable Invariants**:
  - Isolated per-project todos & pinned notes with dedicated MCP tools (`project_todo_list`, `project_todo_read`, `project_todo_add`, `project_todo_update`), full-screen month calendar view, timeline view, and native header integration.

### 3. Task Board (`/board`) Split-Pane Chat, Utility Shortcuts & Citation Badges

<!-- t4-lock: task-board -->

- **Status**: `Locked` (`52017e3524`, `55f2e2fc28`, `1b2de0c332`)
- **Surfaces**: Web, Desktop, Contracts, Shared
- **Protected Paths**:
  - `apps/web/src/components/board/TaskBoardPage.tsx`
  - `apps/web/src/components/board/TaskBoardThreadPane.tsx`
  - `apps/web/src/components/chat/draftAssistantCitations.ts`
  - `apps/web/src/components/sidebar/SidebarChrome.tsx`
- **Non-Negotiable Invariants**:
  - Left main sidebar stays untouched (never auto-collapsed) when opening a Task Board card.
  - Clicking a Task Board card keeps 1 column docked on the left (~1/4 board width with status-tinted active column tabs) rendering session cards directly with each column's semantic status color tint (`info` blue / `warning` amber / `accent` neutral / `success` emerald) on card fills, borders, and selected rings—without an outer column card wrapper or duplicate column header (while the full 4-column board view preserves tinted column card containers with `bg-card` session cards)—and turns the right 3-column area into a pure-chat split view (`ThreadDetailsPanel` / `会话详情` and right-panel sheet hidden by default on open, toggleable on demand without mutating full-view state), with "Expand to full thread", card corner clipping fix, and persistent citation badges.
  - Bottom sidebar utility icons expose customizable toggle shortcuts (`settings.open` `⌘,`, `board.open` `⌘⌥K`, `todos.open` `⌘⌥T`, `pullRequests.open` `⌘⌥P`, `issues.open` `⌘⇧I` / `Ctrl+Alt+I`, `usage.open` `⌘U`) in tooltips and Command Palette, and pressing `Esc` from any utility/modal mode (`/board`, `/todos`, `/pull-requests`, `/issues`, `/workflows`, `/settings`, `/usage`) returns cleanly to the normal chat view.

### 4. Telegram-Style Cross-Device Composer Draft Sync

<!-- t4-lock: synced-drafts -->

- **Status**: `Locked` (`7cebf14129`, `d8568a32d7`)
- **Surfaces**: Server, Contracts, Client Runtime, Web, Mobile
- **Protected Paths**:
  - `apps/server/src/t4/drafts/`
  - `apps/mobile/src/state/syncedDrafts.ts`
  - `apps/mobile/src/state/use-composer-drafts.ts`
- **Non-Negotiable Invariants**:
  - Cross-device draft sync across Web/Desktop/Mobile and local draft highlight badges in the mobile thread list.

### 5. Mobile Chat List Sort/Grouping, PR Tab Toggle, Centered Tab Dock & Nowdex iOS Widgets

<!-- t4-lock: mobile-navigation-widgets -->

- **Status**: `Locked` (`25fc8b6449`, `d8568a32d7`, `521aa66f91`, `d4684baffd`, `e66c166e8f`)
- **Surfaces**: Mobile (iOS & Android), Native Swift Widgets
- **Protected Paths**:
  - `apps/mobile/src/features/threads/threadListSort.ts`
  - `apps/mobile/src/features/threads/threadListV2.ts`
  - `apps/mobile/src/features/threads/thread-list-v2-items.tsx`
  - `apps/mobile/src/features/home/ThreadListFilters.tsx`
  - `apps/mobile/src/features/home/home-list-filter-menu.ts`
  - `apps/mobile/src/features/layout/workspace/WorkspaceNativeTabs.ios.tsx`
  - `apps/mobile/src/features/layout/workspace/WorkspaceTabDock.ios.tsx`
  - `apps/mobile/src/features/layout/workspace/navigation-tabs.ts`
  - `apps/mobile/src/features/layout/workspace/navigation-tab-order.ts`
  - `apps/mobile/modules/`
  - `apps/mobile/src/widgets/SubscriptionUsage.tsx`
  - `apps/mobile/src/widgets/subscriptionUsageSnapshot.ts`
  - `apps/mobile/plugins/withWidgetLogoAsset.cjs`
- **Non-Negotiable Invariants**:
  - Custom mobile chat list sort/grouping options (`Group by status`, collapsible `Group by project` folders with per-project quick `+` button and persisted collapse state, and `No grouping`), collapsible headers for every status group (`Completed`, `Working`, `Other`, `Snoozed`, `Settled`) with persisted state, toggleable PR tab, centered iOS tab dock (`T3SidebarTabBarView.swift`).
  - Nowdex-style multi-provider pace-aware iOS widgets with Claude reset countdown, Antigravity own Gemini weekly quota lock, `100%` non-truncation layout (`521aa66f91`), and inline-slot uniform `2pt` same-color vertical pace marker with soft translucent same-color deficit segments when burning ahead of pace.

### 6. Compact 2-Column Usage Limits, Pace Curve, Provider Order & Apple HIG T4 Tray

<!-- t4-lock: usage-and-tray -->

- **Status**: `Locked` (`356d25280e`, `e66c166e8f`, `bcb0a0ea21`, `dd28dfa4c7`, `6e52b043cb`)
- **Surfaces**: Web, Desktop, Mobile
- **Protected Paths**:
  - `apps/web/src/components/usage/UsageLimitsPooled.tsx`
  - `apps/web/src/components/usage/usageLimitHistory.ts`
  - `apps/web/src/components/usage/usagePagePreferences.ts`
  - `apps/web/src/components/settings/ProviderSettingsPanel.tsx`
  - `apps/web/src/components/settings/providerInstanceOrder.logic.ts`
  - `apps/mobile/src/features/usage/UsageLimitsPooled.tsx`
  - `apps/desktop/src/window/DesktopTray.ts`
- **Non-Negotiable Invariants**:
  - Compact 2-column Usage Limits grid with pace curve on Web/Desktop, iPadOS 2-column Compact / Standard view switcher (`usageLimitsViewMode`, defaulting to Compact in both portrait & landscape, intentionally omitting the pace curve on iOS), per-provider window visibility menu, provider drag-reordering in Settings & Usage Limits, close-to-tray background agent continuity, and Apple HIG T4 monochrome tray icon.

### 7. Configurable Agent Message Sender Note (`agentMessageSenderNote`)

<!-- t4-lock: agent-sender-note -->

- **Status**: `Locked` (`eb5c4b60e0`)
- **Surfaces**: Contracts, Server, Web, Mobile
- **Protected Paths**:
  - `apps/mobile/src/features/settings/components/AgentMessageSenderNoteSettings.tsx`
  - `packages/contracts/src/settings.ts`
- **Non-Negotiable Invariants**:
  - `agentMessageSenderNote` defaults to `{ mode: "off" }` so cross-thread / MCP / scheduled-task agent messages do not inject `[T3 Code: ...]` unless explicitly set to `default` or `custom`; user remote-device `sentFrom` notices remain intact.

### 8. Sidebar Environment Filter Chips, Top Working Shelf & Custom Environment Label

<!-- t4-lock: sidebar-and-env-label -->

- **Status**: `Locked` (`9d5c798776`, `52017e3524`, `b8bf51abbc`, `fa9b4b08e9`, `cab4e6760d`)
- **Surfaces**: Web, Server
- **Protected Paths**:
  - `apps/server/src/environment/ServerEnvironment.ts`
  - `apps/web/src/components/Sidebar.tsx`
- **Non-Negotiable Invariants**:
  - Runtime-readable custom `environmentLabel` from `settings.json` in `ServerEnvironment.ts`.
  - Pinned `All` tab, icon-labeled drag-to-reorder environment filter chips with horizontal scroll fade, and top `Working` sidebar shelf.

### 9. Quote Images from Chat Context Menu & Dashboard Project Icons

<!-- t4-lock: media-quote-and-dashboard-icons -->

- **Status**: `Locked` (`a6f0c3f3af`, `d9d16589aa`)
- **Surfaces**: Web, Mobile, Shared
- **Protected Paths**:
  - `apps/mobile/src/components/ProjectFavicon.tsx`
  - `apps/mobile/src/state/mediaActions.ts`
  - `apps/web/src/components/media/MediaActions.tsx`
  - `packages/shared/src/dashboardIcons.ts`
- **Non-Negotiable Invariants**:
  - Right-click / long-press "Quote image" into composer across Web and Mobile.
  - `dashboard-icon` project icon rendering (`DashboardProjectFavicon`) preserved alongside upstream nested-project icon fallbacks.

### 10. T4 Code Branding, Zero Telemetry, Self-Hosted Relay, Tailscale & Release Pipeline

<!-- t4-lock: branding-relay-release -->

- **Status**: `Locked` (`6ffb6bf2bb`, `423d89db8d`, `45e2f0c3e3`, `636f49cf17`, `cab4e6760d`, `e494bd6756`, `a6f0c3f3af`, `81bc87bef3`, `f204780d7b`, `adffeac32f`)
- **Surfaces**: All surfaces, Server, Desktop, Mobile, Release Scripts
- **Protected Paths**:
  - `apps/web/src/branding.ts`
  - `apps/desktop/src/updates/DesktopUpdates.ts`
  - `apps/desktop/src/updates/DesktopRemoteUpdates.ts`
  - `apps/server/src/cloud/npmRelease.ts`
  - `scripts/release-t4.ts`
  - `.github/workflows/release-t4.yml`
  - `apps/mobile/app.config.ts`
  - `apps/server/src/environment/ServerEnvironment.ts`
- **Non-Negotiable Invariants**:
  - **T4 Code / T4 Connect branding** (`com.frameflowtech.t4code`, `imetn/t4code` GitHub Releases auto-update feed, sticky update floor fix).
  - **Automatic Desktop Updates (`autoUpdateMode`, default `"auto"`)**: 30-minute poll + wake-from-sleep check, immediate background auto-download, fine-grained 1%/500ms download progress with live speed & byte totals, immediate connecting/restarting states (`installing: true`), idle direct restart + inline progress bar in Settings → About, active in-app & OS notifications with 1-minute countdown warning, seamless silent install on screen-lock or 10-minute idle, and 2-hour forced deadline fallback (guarded by `notAppliedVersion` loop prevention), configurable in Settings → About (`Automatic` / `Download & notify` / `Manual`).
  - **Zero telemetry / analytics** — never re-enable upstream OTLP/analytics/telemetry endpoints or PostHog/Sentry reporting.
  - **Self-hosted Relay & Reverse Proxy**: custom relay URL + custom Clerk publishable key / CLI OAuth client ID + live latency verification + `https` reverse-proxy issuer normalization + private-network HTTP peer linking + fail-closed relay allowlist.
  - **Tailscale auto-discovery & sign-in** (`tailnetSignIn` capability).
  - **Signed & notarized macOS releases** via `scripts/release-t4.ts` (`Developer ID Application` + `xcrun stapler validate` + `spctl`).

### 11. Antigravity & ACP Stability Guards

<!-- t4-lock: antigravity-acp -->

- **Status**: `Locked` (`7bc53945ab`, `0ced2f8be8`, `8b77e00612`, `6cb37b532b`, `2a9e74993e`, `1925582ea7`)
- **Surfaces**: Server, `packages/provider-acp`
- **Protected Paths**:
  - `packages/provider-acp/src/server/adapter.ts`
  - `apps/server/src/provider/Drivers/AntigravitySkills.ts`
  - `apps/server/src/provider/AntigravityProvider.ts`
- **Non-Negotiable Invariants**:
  - Flavor-gated, callback-permit-synchronized steer decline (`flavor.promptRefusedWhileAgentWaits`) in `packages/provider-acp/src/server/adapter.ts` — do not downgrade to an unsynchronized or unconditional check.
  - ToS-compliant opt-in `agy` CLI quota checks, keychain login visibility, wake latch stability, and session reopen after settings rebuild.

### 12. Right-Sidebar Context Breakdown & Connectors Management

<!-- t4-lock: thread-context-connectors -->

- **Status**: `Locked`
- **Surfaces**: Contracts, Client Runtime, Server, Providers (`Claude`, `Codex`, `Kiro`, `core`), Web, Desktop
- **Protected Paths**:
  - `apps/server/src/mcpApps/ThreadInspector.ts`
  - `apps/web/src/components/chat/ThreadDetailsContext.tsx`
  - `apps/web/src/components/chat/ThreadDetailsContext.logic.ts`
  - `apps/web/src/components/chat/ThreadDetailsConnectors.tsx`
  - `apps/web/src/components/chat/useThreadInspector.ts`
  - `apps/web/src/components/chat/ThreadDetailsPanel.tsx`
- **Non-Negotiable Invariants**:
  - Right-sidebar `Context` section displays a multi-segment color-coded context bar, interactive breakdown rows (Messages, MCP tools, System prompt, Skills, Memory files, deferred tools, Autocompact buffer, Free space), and expandable MCP tools / Memory files detail lists powered by `provider.thread.inspect`.
  - Right-sidebar `Connectors` row opens the connector management view with per-server status, reconnect (`provider.mcp.reconnect`), enable/disable toggle (`provider.mcp.toggle`), and OAuth sign-in actions.

### 13. Mobile Stacked Multi-Photo Deck in Chat Feed

<!-- t4-lock: mobile-stacked-photo-deck -->

- **Status**: `Locked`
- **Surfaces**: Mobile
- **Protected Paths**:
  - `apps/mobile/src/features/threads/StackedPhotoDeck.tsx`
  - `apps/mobile/src/features/threads/stacked-photo-deck.ts`
  - `apps/mobile/src/features/threads/ThreadFeed.tsx`
- **Non-Negotiable Invariants**:
  - Multi-image user messages (`>= 2` images) render by default as an interactive stacked photo deck with up to 3 layered cards, horizontal swipe cycling with haptic feedback, single-tap full-screen gallery preview, and a left-side `Expand N` (`展开 N`) pill that toggles into an expanded 2/3-column photo grid with a `Collapse` (`收起`) button.

### 14. Global Hidden Scrollbars (Web / Desktop)

<!-- t4-lock: global-hidden-scrollbars -->

- **Status**: `Locked`
- **Surfaces**: Web, Desktop
- **Protected Paths**:
  - `apps/web/src/components/ui/scroll-area.tsx`
  - `apps/web/src/index.css`
- **Non-Negotiable Invariants**:
  - Native scrollbars are hidden globally (`scrollbar-width: none`, `::-webkit-scrollbar { display: none; width: 0; height: 0 }`, `--app-scrollbar-width: 0px`) across all scrollable containers, and `ScrollArea`'s overlay `ScrollBar` stays invisible (`pointer-events-none opacity-0`) during idle, hover, and scroll while preserving full scrolling behavior and Base UI thumb geometry.

