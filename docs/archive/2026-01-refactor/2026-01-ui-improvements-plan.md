# UI Improvements Plan - Herakles Terminal

**Date:** January 2026
**Status:** Planning
**Scope:** Window headers, typography, settings, artifact UX

---

## Overview

This plan addresses four key UI improvement areas to enhance readability, professionalism, and user experience.

| Goal | Current State | Target State |
|------|---------------|--------------|
| A. Window headers | 36px tall, basic controls | 28px slim, refined controls |
| B. Typography | JetBrains Mono, 14px base | Inter UI + mono, larger tasks |
| C. Lightning toggle | Toolbar button, off by default | Settings tab, on by default |
| D. Artifact UX | Click-only fullscreen | Hover preview + enhanced fullscreen |

---

## A. Slim Window Title Bar

### Current Implementation
- **Height:** 36px (`--window-header-height`)
- **Location:** `src/client/components/SplitView/SplitView.tsx:835-912`
- **Elements:** Status dot, title, minimize button, close button
- **Styling:** Gradient backgrounds with border accents

### Proposed Changes

#### 1. Reduce Header Height: 36px → 28px
```css
/* src/client/styles/terminal.css */
:root {
  --window-header-height: 28px;  /* was 36px */
}
```

#### 2. Compact Control Buttons
| Element | Current | Proposed |
|---------|---------|----------|
| Button padding | `p-2` (8px) | `p-1.5` (6px) |
| Icon size | `w-4 h-4` (16px) | `w-3.5 h-3.5` (14px) |
| Button spacing | `gap-2` | `gap-1.5` |
| Status dot | 8px | 6px |

#### 3. Refined Title Styling
```tsx
// Current
<span className="text-base transition-colors">

// Proposed
<span className="text-[13px] font-medium tracking-tight transition-colors">
```

#### 4. Simplified Header Structure
```
Current:  [dot] [title                    ] [min] [close]
Proposed: [dot] [title           ] [actions] [min] [close]
```

Where `[actions]` is an optional slot for future window-specific actions.

### Files to Modify
1. `src/client/styles/terminal.css` - CSS variable
2. `src/client/components/SplitView/SplitView.tsx` - Header markup (lines 835-912)

### Implementation Steps
1. [ ] Update `--window-header-height` to 28px
2. [ ] Reduce button padding from p-2 to p-1.5
3. [ ] Reduce icon sizes from w-4 h-4 to w-3.5 h-3.5
4. [ ] Adjust status dot size from 8px to 6px
5. [ ] Update title font to 13px with font-medium
6. [ ] Test window interactions (minimize, close, drag, resize)
7. [ ] Verify edit mode still works for window renaming

---

## B. Typography Improvements

### Current Implementation
- **Font Family:** `'JetBrains Mono', 'Fira Code', monospace`
- **Base Size:** 14px terminal, varies for UI
- **Location:** `src/shared/constants.ts:22-28`, CSS files
- **Task Panel:** Hard to read, small font

### Proposed Changes

#### 1. Dual Font System
```css
/* UI text - readable sans-serif */
--font-ui: 'Inter', 'SF Pro Display', system-ui, sans-serif;

/* Code/terminal - monospace */
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
```

#### 2. Font Size Scale
| Element | Current | Proposed | Purpose |
|---------|---------|----------|---------|
| Terminal text | 14px | 14px | Keep for terminal |
| Task list items | ~12px | 14px | Better readability |
| Task headers | ~13px | 15px | Clear hierarchy |
| Window titles | 16px | 13px | Compact |
| Settings labels | 13px | 14px | Readable |
| Tooltips | 12px | 13px | Legible |
| Panel headers | 14px | 15px | Clear sections |

#### 3. Font Weight Adjustments
```css
/* Use medium weight for UI labels */
.ui-label { font-weight: 500; }

/* Use regular for body text */
.ui-body { font-weight: 400; }

/* Use semibold for emphasis */
.ui-emphasis { font-weight: 600; }
```

#### 4. Line Height Optimization
```css
/* Tighter for UI */
.ui-compact { line-height: 1.4; }

/* Normal for readable text */
.ui-readable { line-height: 1.6; }
```

### TodoPanel Specific Changes
**File:** `src/client/components/TodoPanel/TodoPanel.tsx`

```tsx
// Task content - larger, more readable
<span className="text-[14px] font-ui text-[#e4e4e7]">
  {todo.content}
</span>

// Task status badge
<span className="text-[12px] font-medium uppercase tracking-wide">
  {status}
</span>

// Panel header
<h3 className="text-[15px] font-semibold text-white tracking-tight">
  Tasks
</h3>
```

### Files to Modify
1. `src/client/styles/terminal-base.css` - Add font variables
2. `src/shared/constants.ts` - Update font definitions
3. `src/client/components/TodoPanel/TodoPanel.tsx` - Task font sizes
4. `src/client/components/SidePanel/SettingsPanel.tsx` - Label sizes
5. `src/client/App.tsx` - Import Inter font
6. `index.html` - Add Inter font link

### Font Loading
```html
<!-- index.html -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
```

### Implementation Steps
1. [ ] Add Inter font to index.html
2. [ ] Define --font-ui and --font-mono CSS variables
3. [ ] Update terminal-base.css with font scale
4. [ ] Update TodoPanel task items to 14px
5. [ ] Update TodoPanel headers to 15px
6. [ ] Apply font-ui to non-terminal UI elements
7. [ ] Test readability across all panels
8. [ ] Verify terminal font unchanged (mono)

---

## C. Lightning Default + Settings Migration

### Current Implementation
- **Location:** Toolbar in `App.tsx:1098-1112`
- **Default:** OFF (`showLightning: false`)
- **Toggle:** Button in top toolbar

### Proposed Changes

#### 1. Change Default to ON
```tsx
// src/client/App.tsx
const [showLightning, setShowLightning] = useState(true);
```

#### 2. Persist in Preferences
```tsx
// Add to preferences state
interface Preferences {
  // ...existing
  showLightning: boolean;
}

// Default
const defaultPreferences: Preferences = {
  // ...existing
  showLightning: true,
};
```

#### 3. Remove from Toolbar
Delete lines 1098-1112 in App.tsx (lightning toggle button).

#### 4. Add to Settings CONFIG Tab
**File:** `src/client/components/SidePanel/SettingsPanel.tsx`

Add new section in CONFIG tab after "Theme" setting:

```tsx
{/* Lightning Effect */}
<div className="flex items-center justify-between py-3 border-b border-[#1a1a1e]">
  <div className="flex flex-col gap-0.5">
    <span className="text-[14px] font-medium text-[#e4e4e7]">
      Lightning Effect
    </span>
    <span className="text-[12px] text-[#71717a]">
      Animated header accent
    </span>
  </div>
  <button
    onClick={() => updatePreference('showLightning', !preferences.showLightning)}
    className={`relative w-11 h-6 rounded-full transition-colors ${
      preferences.showLightning
        ? 'bg-[#00d4ff]'
        : 'bg-[#27272a]'
    }`}
  >
    <div className={`absolute w-4 h-4 rounded-full bg-white shadow top-1 transition-transform ${
      preferences.showLightning ? 'translate-x-6' : 'translate-x-1'
    }`} />
  </button>
</div>
```

### Files to Modify
1. `src/client/App.tsx` - Remove toolbar button, update default
2. `src/client/components/SidePanel/SettingsPanel.tsx` - Add toggle
3. `src/shared/types.ts` - Add to preferences interface
4. LocalStorage handling for persistence

### Implementation Steps
1. [ ] Add `showLightning` to preferences interface
2. [ ] Set default value to `true`
3. [ ] Add toggle switch to Settings CONFIG tab
4. [ ] Remove lightning button from toolbar (App.tsx)
5. [ ] Ensure preference persists to localStorage
6. [ ] Test toggle functionality
7. [ ] Verify lightning renders on initial load

---

## D. Artifact UX Improvements

### Current Implementation
- **Click:** Opens fullscreen viewer
- **Hover:** None
- **Fullscreen:** Basic modal with zoom controls
- **Location:** `src/client/components/Canvas/`

### Proposed Changes

#### 1. Hover Preview Tooltip

Add a preview popup that appears on hover over artifact cards:

```tsx
// New component: src/client/components/Canvas/ArtifactPreview.tsx
interface ArtifactPreviewProps {
  artifact: Artifact;
  position: { x: number; y: number };
  visible: boolean;
}

const ArtifactPreview: React.FC<ArtifactPreviewProps> = ({
  artifact,
  position,
  visible
}) => {
  if (!visible) return null;

  return (
    <div
      className="fixed z-[90] pointer-events-none animate-fade-in"
      style={{
        left: position.x + 16,
        top: position.y,
        maxWidth: 400,
        maxHeight: 300,
      }}
    >
      <div className="bg-[#0f0f14] border border-[#27272a] rounded-lg shadow-2xl overflow-hidden">
        {/* Mini header */}
        <div className="px-3 py-2 border-b border-[#1a1a1e] flex items-center gap-2">
          <span className="text-[12px] font-medium text-[#00d4ff]">
            {artifact.title || 'Artifact'}
          </span>
          <span className="text-[10px] text-[#52525b] uppercase">
            {artifact.type}
          </span>
        </div>

        {/* Preview content - scaled down */}
        <div className="p-3 max-h-[240px] overflow-hidden">
          <div className="transform scale-[0.85] origin-top-left">
            <ArtifactRenderer artifact={artifact} preview />
          </div>
        </div>

        {/* Hint */}
        <div className="px-3 py-1.5 bg-[#0a0a0f] border-t border-[#1a1a1e]">
          <span className="text-[10px] text-[#52525b]">
            Click to expand
          </span>
        </div>
      </div>
    </div>
  );
};
```

#### 2. Artifact Card Hover State

Update `CanvasPanel.tsx` artifact cards:

```tsx
<div
  className="artifact-card group cursor-pointer transition-all duration-200
             hover:border-[#00d4ff]/30 hover:shadow-[0_0_20px_rgba(0,212,255,0.1)]
             hover:translate-y-[-2px]"
  onMouseEnter={(e) => showPreview(artifact, e)}
  onMouseLeave={() => hidePreview()}
  onClick={() => openFullscreen(artifact)}
>
  {/* Card content */}
</div>
```

#### 3. Enhanced Fullscreen Viewer

**File:** `src/client/components/Canvas/FullscreenViewer.tsx`

##### 3a. Smoother Animations
```tsx
// Entry animation
<div className="fixed inset-0 z-[100] animate-fade-in">
  <div className="absolute inset-0 bg-black/90 backdrop-blur-md" />
  <div className="relative w-full h-full flex items-center justify-center p-8
                  animate-scale-in">
    {/* Content */}
  </div>
</div>

// CSS animations
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes scale-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.animate-fade-in { animation: fade-in 0.15s ease-out; }
.animate-scale-in { animation: scale-in 0.2s ease-out; }
```

##### 3b. Improved Header Layout
```
┌──────────────────────────────────────────────────────────────┐
│ [Icon] Title                    [Zoom -][100%][+] [Copy][X]  │
└──────────────────────────────────────────────────────────────┘
```

- Cleaner icon + title grouping
- Zoom controls centered
- Actions (copy, close) right-aligned
- Reduce header height: 48px → 40px

##### 3c. Content Area Improvements
```tsx
<div className="flex-1 overflow-auto p-6 scrollbar-thin">
  {/* Centered content with max-width */}
  <div className="mx-auto max-w-4xl">
    {/* Artifact renderer with proper padding */}
    <div className="bg-[#0a0a0f] rounded-lg p-6 border border-[#1a1a1e]">
      <ArtifactRenderer artifact={artifact} />
    </div>
  </div>
</div>
```

##### 3d. Keyboard Shortcuts Bar (Bottom)
```tsx
<div className="h-10 px-4 flex items-center justify-center gap-6
                border-t border-[#1a1a1e] bg-[#07070c]">
  <Shortcut keys="Esc" action="Close" />
  <Shortcut keys="Ctrl+C" action="Copy" />
  <Shortcut keys="+" action="Zoom in" />
  <Shortcut keys="-" action="Zoom out" />
  <Shortcut keys="0" action="Reset zoom" />
</div>
```

##### 3e. Mobile Optimization
```tsx
// Swipe to close
const handleTouchStart = (e: TouchEvent) => { ... };
const handleTouchMove = (e: TouchEvent) => { ... };
const handleTouchEnd = (e: TouchEvent) => {
  if (swipeDistance > 100) {
    onClose();
  }
};
```

#### 4. Preview/Code Toggle Enhancement
```tsx
// Segmented control style
<div className="flex bg-[#0a0a0f] rounded-lg p-0.5 border border-[#1a1a1e]">
  <button
    className={`px-3 py-1 text-[12px] rounded-md transition-all ${
      mode === 'preview'
        ? 'bg-[#00d4ff]/15 text-[#00d4ff]'
        : 'text-[#71717a] hover:text-white'
    }`}
    onClick={() => setMode('preview')}
  >
    Preview
  </button>
  <button
    className={`px-3 py-1 text-[12px] rounded-md transition-all ${
      mode === 'code'
        ? 'bg-[#00d4ff]/15 text-[#00d4ff]'
        : 'text-[#71717a] hover:text-white'
    }`}
    onClick={() => setMode('code')}
  >
    Source
  </button>
</div>
```

### Files to Modify
1. `src/client/components/Canvas/ArtifactPreview.tsx` - New component
2. `src/client/components/Canvas/FullscreenViewer.tsx` - Enhanced viewer
3. `src/client/components/SidePanel/CanvasPanel.tsx` - Hover handlers
4. `src/client/styles/terminal.css` - Animations

### Implementation Steps
1. [ ] Create ArtifactPreview component
2. [ ] Add hover handlers to artifact cards
3. [ ] Implement preview positioning logic
4. [ ] Add entry/exit animations to fullscreen
5. [ ] Redesign fullscreen header (40px, cleaner)
6. [ ] Add segmented control for preview/code
7. [ ] Style content area with proper spacing
8. [ ] Add keyboard shortcuts bar
9. [ ] Test hover preview positioning edge cases
10. [ ] Test animations performance
11. [ ] Mobile swipe-to-close

---

## Implementation Order

### Phase 1: Quick Wins (Low Risk)
1. **C. Lightning default** - Change default to true, add to settings
2. **B. Font loading** - Add Inter font to index.html

### Phase 2: Typography (Medium Risk)
3. **B. CSS variables** - Define font-ui, font-mono
4. **B. TodoPanel fonts** - Increase task text size
5. **B. Settings fonts** - Update label sizes

### Phase 3: Window Headers (Medium Risk)
6. **A. Header height** - Reduce to 28px
7. **A. Button sizing** - Compact controls
8. **A. Title styling** - 13px font-medium

### Phase 4: Artifact UX (Higher Complexity)
9. **D. Hover preview** - New component + positioning
10. **D. Fullscreen animations** - Entry/exit effects
11. **D. Fullscreen layout** - Header + content redesign
12. **D. Mobile support** - Swipe gestures

---

## Testing Checklist

### Visual Regression
- [ ] Window headers render correctly at 28px
- [ ] Fonts display properly (Inter for UI, mono for terminal)
- [ ] Lightning toggles correctly from settings
- [ ] Artifact hover shows preview
- [ ] Fullscreen opens with smooth animation

### Functional Testing
- [ ] Window minimize/close still works
- [ ] Window title editing works
- [ ] Window resize handles work
- [ ] Terminal text remains unchanged
- [ ] Settings persist to localStorage
- [ ] Lightning preference persists
- [ ] Artifact preview positions correctly
- [ ] Fullscreen zoom controls work
- [ ] Keyboard shortcuts work in fullscreen

### Responsive Testing
- [ ] Mobile: Headers scale properly
- [ ] Mobile: Fonts readable
- [ ] Mobile: Artifact preview hidden (touch)
- [ ] Mobile: Fullscreen swipe-to-close works

### Performance
- [ ] No jank during hover preview
- [ ] Smooth fullscreen animations
- [ ] Font loading doesn't block render

---

## Rollback Plan

Each phase can be reverted independently:

1. **Lightning:** Restore toolbar button, revert default
2. **Typography:** Remove Inter font import, revert CSS variables
3. **Headers:** Restore 36px height, original button sizes
4. **Artifacts:** Remove ArtifactPreview, revert FullscreenViewer

Git branches:
```bash
git checkout -b ui/window-headers
git checkout -b ui/typography
git checkout -b ui/lightning-settings
git checkout -b ui/artifact-ux
```

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Header height | 28px (22% reduction) |
| Task text size | 14px (readable) |
| Lightning default | ON |
| Hover preview delay | 300ms |
| Fullscreen animation | 200ms |
| Font load time | < 100ms (preconnect) |

---

## Dependencies

- **Inter font** - Google Fonts CDN
- **No new npm packages** - Pure CSS/React implementation
- **Browser support** - Same as current (modern browsers)

---

## Notes

- All changes use existing Tailwind classes where possible
- CSS variables enable future theming flexibility
- Hover preview is desktop-only (pointer devices)
- Mobile uses tap-only interaction pattern
- Animations respect `prefers-reduced-motion`
