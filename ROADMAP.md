# Life Engine - Technical Roadmap

Based on comprehensive code review findings. Organized by priority and estimated effort.

---

## Phase 1: Critical Fixes (v1.1)

**Goal**: Fix correctness bugs that break core functionality
**Timeline**: 1-2 days
**Status**: ✅ Completed

### 1.1 Macrocell Import Parser

- [x] **Fix level mismatch** (`script.js:717`)
  - Changed `level: 4` → `level: 3` for 8x8 leaf nodes
  - Verified `rootSize` calculation produces correct dimensions

### 1.2 RLE Export

- [x] **Fix line wrapping logic** (`worker.js:349-398`)
  - Track current line length separately from total RLE string length
  - Wrap at 70 characters per line (RLE convention)

### 1.3 Worker Error Handling

- [x] **Add `onerror` handler** (`script.js:105-110`)
  - Catch worker exceptions and display toast with error message
  - Log full stack trace to console for debugging

### 1.4 Memory Leak: Empty Chunks

- [x] **Implement chunk garbage collection** (`worker.js:213-241`)
  - `isChunkEmpty()` function checks if chunk is all zeros
  - `garbageCollectChunks()` deletes empty chunks
  - GC runs after bulk operations (clear, randomize, file load)

---

## Phase 2: Performance Optimization (v1.2)

**Goal**: Make age tracking and large patterns usable
**Timeline**: 3-5 days
**Status**: ✅ Completed

### 2.1 Age Tracking Redesign

- [x] **Implemented Option A: Parallel chunk structure** (`worker.js:694-743`)
  - Store `ageChunks: Map<string, Uint8Array(1024)>` (32×32 = 1024 cells)
  - Update ages during `step()`, aligned with cell chunks
  - Extract viewport ages using same logic as main grid
  - Memory: ~1KB per active chunk vs previous unbounded string Map

### 2.2 Viewport Rendering

- [x] **Canvas rendering: ImageData-based** (`script.js:142-270`)
  - Implemented Option B: Use `ImageData`, write pixels directly
  - Used for small cells (≤3px), ~5-10x speedup
  - Falls back to fillRect for larger cells (better quality)

### 2.3 Population Counting

- [x] **Maintain running population counter** (`worker.js:213-259`)
  - Added `let totalPopulation = 0` to worker global state
  - `popcount32()` function for efficient bit counting
  - Incremental updates during `step()`: new cells - old cells
  - Recalculate on load/randomize to resync

---

## Phase 3: Scalability & Robustness (v1.3)

**Goal**: Handle large imported patterns, improve UX edge cases
**Timeline**: 3-4 days
**Status**: ✅ Completed

### 3.1 History Buffer Optimization

- [x] **Implement delta-based history** (`worker.js:497-563`)
  - Store only changed chunks per step
  - Structure: `{ generation, changedChunks: Map<chunkKey, {before, after}> }`
  - On reverse: restore `before` state for each changed chunk
  - Memory reduction: 10-100× for sparse updates

### 3.2 File Import Safety

- [x] **Add file size validation** (`script.js:611-648`)
  - Warn if file > 10 MB, require confirmation
  - Hard limit at 100 MB (prevent browser hang)

- [x] **Validate Macrocell node indices** (`script.js:724-732`)
  - Check node references are in bounds: `nw/ne/sw/se < nodes.length`
  - Show meaningful error message on invalid file

### 3.3 Randomize UX Clarification

- [x] **Clear existing pattern before randomize** (`worker.js:153-161`)
  - Changed to: `chunks.clear(); ageChunks.clear();` before randomizing

### 3.4 Coordinate System Documentation

- [x] **Add comprehensive comment block** (top of `worker.js` and `script.js`)
  - Documented viewport, global, chunk, and local coordinate systems
  - Documented transforms between coordinate systems

---

## Phase 4: Code Quality & Maintainability (v1.4)

**Goal**: Reduce tech debt, improve developer experience
**Timeline**: 2-3 days
**Status**: ✅ Completed (except 4.5 stretch goal)

### 4.1 Magic Number Elimination

- [x] **Define constants in config objects**
  - `CONFIG` object in `worker.js` with `CHUNK_SIZE`, `BITS_PER_WORD`, `FPS_*`, `HISTORY_*`
  - `AGE_THRESHOLDS` in `script.js` for cell age coloring

### 4.2 Pattern Rotation Consistency

- [x] **Decided on behavior**: Reset rotation on pattern switch
  - Documented rotation behavior in comments
- [x] **Added "Reset Pattern" button** (`index.html:86`) to revert to unrotated base

### 4.3 CSS Refactoring

- [x] **Use CSS variables for layout** (`style.css`)
  - `--sidebar-width: 320px`
  - `--transition-duration: 0.2s`
  - `--shadow-default` for box shadows

### 4.4 Docker Compose Cleanup

- [x] **Move development volume to override file**
  - Created `docker-compose.override.yml` with volume mount
  - Production: `docker compose up`
  - Development: `docker compose up` (override auto-loaded)

### 4.5 Testing Infrastructure (Stretch Goal)

- [ ] **Add test harness for simulation** (deferred)
  - Unit tests for SWAR, RLE parser, Macrocell parser
  - Test framework: Vitest recommended

---

## Phase 5: New Features (v2.0)

**Goal**: Extend functionality based on user requests
**Timeline**: TBD
**Status**: Backlog

### 5.1 Advanced Simulation

- [ ] **Custom CA rules** (currently hardcoded B3/S23)
  - UI: text input for rule string (e.g., "B36/S23" for HighLife)
  - Parser: validate rule format
  - Worker: parameterize `step()` with birth/survival conditions
  - Preset dropdown: Conway, HighLife, Seeds, Maze, etc.

- [ ] **Variable speed playback**
  - Allow fractional FPS (e.g., 0.5 FPS = one step per 2 seconds)
  - Useful for slow-evolving patterns

- [ ] **Generation jumping**
  - "Skip to generation N" input
  - Fast-forward simulation in worker without rendering intermediate states

### 5.2 Pattern Library

- [ ] **Built-in pattern browser**
  - Sidebar tab with categorized patterns (oscillators, spaceships, guns, etc.)
  - Thumbnails using offscreen canvas
  - Source: Embed subset of LifeWiki patterns as RLE strings

### 5.3 Analysis Tools

- [ ] **Pattern info overlay**
  - Bounding box dimensions
  - Population over time graph
  - Period detection for oscillators
  - Speed detection for spaceships

- [ ] **Heatmap mode**
  - Color cells by activity (birth/death frequency)
  - Useful for finding unstable regions

### 5.4 Rendering Enhancements

- [ ] **WebGL renderer** (for massive grids)
  - Vertex shader per cell
  - Instanced rendering
  - Expected: 100× speedup for dense patterns
  - Fallback to Canvas 2D if WebGL unavailable

- [ ] **Shader effects**
  - Bloom/glow for cells
  - Fade-out animation on death
  - Configurable visual style (retro, neon, minimal)

---

## Non-Functional Improvements

### Performance Monitoring

- [ ] **Add FPS counter overlay**
  - Show actual vs target FPS
  - Highlight when simulation can't keep up

- [ ] **Memory usage display**
  - Chunk count, history buffer size
  - Warn if approaching browser limits (~2GB)

### Accessibility

- [ ] **Keyboard navigation for UI**
  - Tab through controls (currently only works on native inputs)
  - Arrow keys for sidebar sections

- [ ] **Screen reader support**
  - ARIA labels for buttons/inputs
  - Announce generation/population updates

- [ ] **High contrast mode**
  - Alternative color palette for visual impairments
  - Increase grid line visibility

### Internationalization

- [ ] **Multi-language support**
  - Extract all UI strings to `i18n.js`
  - Add French translation (given user preference)
  - Language selector in sidebar

### Documentation

- [ ] **Architecture diagram**
  - Illustrate main thread ↔ worker communication
  - Data flow for render loop

- [ ] **API documentation**
  - Worker message protocol
  - Pattern format specifications

- [ ] **Contributing guide**
  - Setup instructions for development
  - Code style guidelines
  - How to add new patterns

---

## Metrics & Success Criteria

### Performance Targets (v1.2+)

- **Simulation**: 60 FPS with 10k live cells (currently ~30 FPS)
- **Rendering**: 60 FPS with 5k visible cells (currently ~20 FPS)
- **Memory**: <100 MB for 1M live cells with 20-step history
- **Import**: Parse 1 MB RLE file in <500ms

### Quality Gates (v1.3+)

- Zero known correctness bugs
- Test coverage >80% for core simulation logic
- All TODOs in code resolved or tracked in issues
- No console errors or warnings in production build

### User Experience (v1.4+)

- No UI freeze/stutter during normal use
- Clear error messages for all failure modes
- Keyboard shortcuts work for 100% of features
- Mobile-responsive (optional, not current priority)

---

## Decision Log

### Open Questions

- [ ] Should age tracking be disabled by default until optimized?  --> yes
- [ ] Support mobile touch input (draw with finger)? --> no
- [ ] Add server-side pattern storage (requires backend)? --> no
- [ ] Implement WASM version of simulation for 10× speedup? --> yes

### Deferred Features

- **Undo/Redo**: Complex to implement with infinite grid, low ROI
- **Pattern search**: Requires pattern database, out of scope
- **GPU compute (WebGPU)**: Browser support still limited (2024)

---

## Maintenance Notes

### Technical Debt Tracker

| Item | Severity | Effort | Phase | Status |
|------|----------|--------|-------|--------|
| Empty chunk leak | High | Low | 1.4 | ✅ Fixed |
| Age tracking O(n) | Critical | Medium | 2.1 | ✅ Fixed |
| History full clone | High | Medium | 3.1 | ✅ Fixed |
| Magic numbers | Low | Low | 4.1 | ✅ Fixed |
| No tests | Medium | High | 4.5 | Deferred |

### Browser Compatibility Matrix

| Feature | Chrome | Firefox | Safari | Edge | Notes |
|---------|--------|---------|--------|------|-------|
| Web Workers | ✓ | ✓ | ✓ | ✓ | Universal |
| Transferables | ✓ | ✓ | ✓ | ✓ | Universal |
| Canvas 2D | ✓ | ✓ | ✓ | ✓ | Universal |
| WebGL (future) | ✓ | ✓ | ✓ | ✓ | Fallback needed for old Safari |
