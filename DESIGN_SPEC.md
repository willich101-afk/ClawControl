# ClawControl Design Specification

## Aesthetic Direction: Neo-Terminal Elegance

A sophisticated fusion of terminal precision with modern luxury. The interface feels like a high-end development tool—sharp, focused, and powerful—while maintaining warmth through carefully chosen accents and refined typography.

### Core Principles
1. **Monospace Soul**: Primary UI elements use a distinctive monospace font (JetBrains Mono or IBM Plex Mono)
2. **Electric Accents**: Cyan (#00D9FF) as primary accent—feels like terminal glow
3. **Depth Through Darkness**: Rich blacks with subtle blue undertones, not flat
4. **Precision Spacing**: 8px grid system, mathematical harmony
5. **Responsive Glow**: Subtle hover states that feel alive

---

## Color System

### Dark Theme (Default)
```css
--bg-deep: #0a0e14;          /* Deepest background */
--bg-primary: #0d1117;        /* Main content area */
--bg-elevated: #161b22;       /* Cards, sidebars */
--bg-hover: #21262d;          /* Hover states */
--bg-active: #30363d;         /* Active/selected */

--text-primary: #e6edf3;      /* Main text */
--text-secondary: #8b949e;    /* Secondary text */
--text-muted: #484f58;        /* Disabled/placeholder */

--accent-cyan: #00d9ff;       /* Primary accent */
--accent-cyan-dim: #00a3bf;   /* Muted accent */
--accent-purple: #a855f7;     /* Agent/AI indicator */
--accent-green: #22c55e;      /* Success states */
--accent-amber: #f59e0b;      /* Warning/thinking */
--accent-red: #ef4444;        /* Error states */

--border-subtle: rgba(240, 246, 252, 0.1);
--border-default: rgba(240, 246, 252, 0.15);

--glow-cyan: 0 0 20px rgba(0, 217, 255, 0.3);
--glow-purple: 0 0 20px rgba(168, 85, 247, 0.3);
```

### Light Theme
```css
--bg-deep: #ffffff;
--bg-primary: #f6f8fa;
--bg-elevated: #ffffff;
--bg-hover: #f3f4f6;
--bg-active: #e5e7eb;

--text-primary: #1f2937;
--text-secondary: #6b7280;
--text-muted: #9ca3af;

--accent-cyan: #0891b2;
--accent-purple: #7c3aed;

--border-subtle: rgba(0, 0, 0, 0.06);
--border-default: rgba(0, 0, 0, 0.1);
```

---

## Typography

### Font Stack
```css
--font-mono: 'JetBrains Mono', 'IBM Plex Mono', 'Fira Code', monospace;
--font-display: 'Space Grotesk', 'Plus Jakarta Sans', system-ui, sans-serif;
--font-body: 'Inter', system-ui, sans-serif;
```

### Scale
```css
--text-xs: 0.75rem;      /* 12px - timestamps */
--text-sm: 0.875rem;     /* 14px - secondary content */
--text-base: 1rem;       /* 16px - body text */
--text-lg: 1.125rem;     /* 18px - headings */
--text-xl: 1.25rem;      /* 20px - section titles */
--text-2xl: 1.5rem;      /* 24px - page titles */
```

---

## Layout Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  TOP BAR (48px)                                                 │
│  [≡] Session Name         [Thinking: ●━━] [⚙]                  │
├──────────────┬───────────────────────────────┬──────────────────┤
│  LEFT        │                               │  RIGHT PANEL     │
│  SIDEBAR     │      CHAT AREA                │  (Collapsible)   │
│  (280px)     │                               │  (320px)         │
│              │                               │                  │
│  [+ New]     │  ┌─────────────────────────┐  │  ┌────────────┐  │
│              │  │ Agent message           │  │  │ SKILLS     │  │
│  ─────────   │  │ with avatar & time      │  │  │            │  │
│  Sessions:   │  └─────────────────────────┘  │  └────────────┘  │
│  ○ Chat 1    │                               │                  │
│  ● Chat 2    │  ┌─────────────────────────┐  │  ┌────────────┐  │
│  ○ Chat 3    │  │        User message     │  │  │ CRON JOBS  │  │
│              │  │        right-aligned    │  │  │            │  │
│  ─────────   │  └─────────────────────────┘  │  └────────────┘  │
│  Agent:      │                               │                  │
│  [▼ Select]  │                               │                  │
│              │                               │                  │
├──────────────┼───────────────────────────────┼──────────────────┤
│              │  INPUT AREA (80px)            │                  │
│              │  ┌─────────────────────┐ [➤]  │                  │
│              │  │ Type a message...   │      │                  │
│              │  └─────────────────────┘      │                  │
└──────────────┴───────────────────────────────┴──────────────────┘
```

---

## Component Specifications

### 1. Top Bar
- Height: 48px
- Background: `--bg-elevated`
- Border-bottom: 1px `--border-subtle`
- Left: Hamburger menu (mobile) / Session name with edit icon
- Center: Thinking toggle with glowing indicator
- Right: Settings gear icon

**Thinking Toggle:**
```
OFF: [○━━━━━━━━] Thinking
ON:  [━━━━━━━●] Thinking  (cyan glow animation)
```

### 2. Left Sidebar
- Width: 280px (collapsible to 64px on tablet)
- Background: `--bg-elevated`
- Sections:
  - **Logo Area** (64px): ClawControl logo with subtle animation on hover
  - **New Chat Button**: Full-width, cyan accent, icon + text
  - **Sessions List**: Scrollable, grouped by date
  - **Agent Selector**: Dropdown at bottom with avatar preview

**Session Item:**
```
┌────────────────────────────────┐
│ ● Session Title              ✕ │
│   Last message preview...      │
│   2 hours ago                  │
└────────────────────────────────┘
```

### 3. Chat Area
- Background: `--bg-primary`
- Max-width: 900px (centered)
- Padding: 24px

**Message Bubble - Agent:**
```
┌──┐
│🤖│  Agent Name                    10:42 AM
└──┘  ┌─────────────────────────────────────┐
      │ Message content with markdown       │
      │ support, code blocks, and more.     │
      └─────────────────────────────────────┘
```

**Message Bubble - User:**
```
                                    10:43 AM
      ┌─────────────────────────────────────┐
      │ User message aligned to the right   │
      │ with a different background color   │  ┌──┐
      └─────────────────────────────────────┘  │👤│
                                               └──┘
```

### 4. Input Area
- Height: 80px minimum, auto-expand
- Textarea with:
  - Placeholder: "Type a message..."
  - Border-radius: 12px
  - Background: `--bg-elevated`
  - Focus: cyan glow border
- Send button: Circular, cyan accent, arrow icon

### 5. Right Panel (Collapsible)
- Width: 320px
- Toggle button on edge
- Tabs: Skills | Cron Jobs
- Content: Scrollable list with search

**Skill Item:**
```
┌────────────────────────────────┐
│ 🔧 skill-name                  │
│ Brief description of the       │
│ skill functionality...         │
│ ────────────────────────────── │
│ Triggers: /skill, @skill       │
└────────────────────────────────┘
```

---

## Animations & Micro-interactions

### Message Appearance
```css
@keyframes messageSlideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
/* Duration: 200ms, ease-out */
```

### Typing Indicator
```css
@keyframes typingPulse {
  0%, 60%, 100% { opacity: 0.3; }
  30% { opacity: 1; }
}
/* Three dots with staggered animation-delay */
```

### Thinking Toggle Glow
```css
@keyframes thinkingGlow {
  0%, 100% { box-shadow: var(--glow-cyan); }
  50% { box-shadow: 0 0 30px rgba(0, 217, 255, 0.5); }
}
```

### Sidebar Hover
```css
.session-item:hover {
  background: var(--bg-hover);
  transform: translateX(4px);
  transition: all 150ms ease;
}
```

---

## Responsive Breakpoints

```css
/* Desktop */
@media (min-width: 1200px) {
  /* Full layout with all panels */
}

/* Tablet */
@media (min-width: 768px) and (max-width: 1199px) {
  /* Sidebar: 64px icons only */
  /* Right panel: hidden by default */
}

/* Mobile */
@media (max-width: 767px) {
  /* Full-screen chat */
  /* Sidebar: overlay drawer */
  /* Right panel: overlay drawer */
}
```

---

## Special States

### Empty Chat
Centered illustration with:
- ClawControl logo (large, subtle)
- "Start a conversation" text
- Quick action buttons: "New Chat", "Load Session"

### Loading/Streaming
- Skeleton pulse animation for loading
- Cursor blink at end of streaming text
- Progress indicator for long operations

### Error State
- Red accent border
- Error icon with message
- Retry button

---

## Accessibility

- Minimum contrast ratio: 4.5:1 for text
- Focus indicators: 2px cyan outline
---

## File Structure

```
src/
├── components/              # React components
│   ├── ChatArea.tsx
│   ├── InputArea.tsx
│   ├── RightPanel.tsx
│   ├── Sidebar.tsx
│   ├── TopBar.tsx
│   ├── SettingsModal.tsx
│   ├── CertErrorModal.tsx
│   ├── SkillDetailView.tsx
│   ├── CronJobDetailView.tsx
│   ├── AgentDetailView.tsx
│   └── index.ts
├── lib/
│   ├── openclaw-client.ts   # WebSocket client
│   └── openclaw-client.test.ts
├── store/
│   └── index.ts             # Zustand state management
├── styles/
│   └── index.css            # Main stylesheet (variables, themes, components)
├── test/
│   └── setup.ts             # Vitest test setup
├── App.tsx                  # Main app component
├── main.tsx                 # Vite entry point
└── vite-env.d.ts            # Vite type declarations

electron/
├── main.ts                  # Electron main process
└── preload.ts               # Preload script (IPC bridge)

build/
└── icon.png                 # App icon

scripts/
└── test-connection.js       # Connection testing utility
```
