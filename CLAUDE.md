# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start development server with hot reload
npm run build:win    # Build for Windows (from Windows)
npm run build:mac    # Build for macOS (from macOS)
npm run test         # Run tests in watch mode
npm run test:run     # Run tests once
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint
```

## Architecture

ClawControl is an Electron desktop client for OpenClaw AI assistant. The app uses a three-process architecture:

### Process Structure
- **Main Process** (`electron/main.ts`): Electron main process, handles window creation and IPC
- **Preload** (`electron/preload.ts`): Bridge between main and renderer, exposes `window.electronAPI`
- **Renderer** (`src/`): React application

### Core Data Flow
1. **OpenClawClient** (`src/lib/openclaw-client.ts`): Custom WebSocket client implementing a frame-based JSON-RPC protocol (v3). Handles connection, authentication, and real-time message streaming.
2. **Zustand Store** (`src/store/index.ts`): Central state management with persistence. All app state flows through here.
3. **Components**: React components consume store state via `useStore()` hook.

### Protocol Details
The OpenClaw protocol uses typed frames:
- `req`: Outgoing requests with `method` and `params`
- `res`: Responses with `ok` boolean and `payload`/`error`
- `event`: Server-pushed events like `chat`, `agent`, `connect.challenge`

Key RPC methods: `sessions.list`, `sessions.spawn`, `chat.send`, `chat.history`, `agents.list`, `skills.status`, `cron.list`

### Component Layout
```
App
├── Sidebar          # Session list, collapsible
├── main-content
│   ├── TopBar       # Agent selector, theme toggle, settings
│   ├── ChatArea     # Message display with markdown support
│   ├── InputArea    # Message input with thinking mode toggle
│   ├── SkillDetailView  # Full skill details when selected
│   └── CronJobDetailView
├── RightPanel       # Skills/Crons tabs
└── Modals          # SettingsModal, CertErrorModal
```

### State Persistence
The Zustand store persists to localStorage (`clawcontrol-storage`): theme, serverUrl, authMode, gatewayToken, sidebarCollapsed, thinkingEnabled.
