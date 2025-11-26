# Life Engine - Technical Roadmap

Based on comprehensive code review findings. Organized by priority and estimated effort.

---

## Phase 1: Critical Fixes (v1.1)

**Goal**: Fix correctness bugs that break core functionality
**Timeline**: 1-2 days
**Status**: Not started

### 1.1 Macrocell Import Parser

- [ ] **Fix level mismatch** (`script.js:596`)
  - Change `level: 4` → `level: 3` for 8x8 leaf nodes
  - Add test with known Macrocell pattern (e.g., Caterpillar from LifeWiki)
  - Verify `rootSize` calculation produces correct dimensions

### 1.2 RLE Export

- [ ] **Fix line wrapping logic** (`worker.js:382-384`)
  - Track current line length separately from total RLE string length
  - Wrap at 70 characters per line (RLE convention)
  - Test export → import roundtrip for large patterns
  - Validate output with Golly or external RLE parser

### 1.3 Worker Error Handling

- [ ] **Add `onerror` handler** (`script.js:49-50`)
  - Catch worker exceptions and display toast with error message
  - Log full stack trace to console for debugging
  - Consider fallback to main-thread simulation on worker failure

### 1.4 Memory Leak: Empty Chunks

- [ ] **Implement chunk garbage collection** (`worker.js:206-208`)
  - After cell erasure, check if chunk is empty: `chunk.every(w => w === 0)`
  - Delete empty chunks from `chunks` Map
  - Run GC after bulk operations (clear, randomize, file load)
  - Add metric: track chunk count in stats display

---

## Phase 2: Performance Optimization (v1.2)

**Goal**: Make age tracking and large patterns usable
**Timeline**: 3-5 days
**Status**: Not started

### 2.1 Age Tracking Redesign

**Current**: O(viewport) string allocations per frame → unusable

**Options**:

- [ ] **Option A: Parallel chunk structure** (recommended)
  - Store `ageChunks: Map<string, Uint8Array(1024)>` (32×32 = 1024 cells)
  - Update ages during `step()`, aligned with cell chunks
  - Extract viewport ages using same bit-copy logic as main grid
  - Memory: ~1KB per active chunk vs current unbounded string Map

- [ ] **Option B: Live-cells-only Map with numeric keys**
  - Use `Map<number, number>` where key is `(y << 16) | x` (assumes coords < 64k)
  - Faster than string keys, but still O(live cells) iteration
  - Simpler implementation, acceptable for <100k live cells

- [ ] **Benchmark both approaches** with 500k cell pattern

### 2.2 Viewport Rendering

- [ ] **Replace bit-by-bit copy with word-aligned algorithm** (`worker.js:702-709`)

  ```
  Pseudocode:
  1. Handle unaligned left edge (bit-by-bit for first partial word)
  2. Copy aligned middle words with bitwise shift/mask
  3. Handle unaligned right edge (bit-by-bit for last partial word)
  ```

  - Expected speedup: 5-10× for large viewports
  - Profile before/after with 1920×1080 viewport

- [ ] **Canvas rendering: Batch draw calls** (`script.js:153-179`)
  - **Option A**: Use `Path2D`, batch all cells into single stroke
  - **Option B**: Use `ImageData`, write pixels directly
  - **Option C**: Pre-render chunks to offscreen canvases, composite
  - Benchmark all three, likely Option B for best performance
  - Target: 60 FPS with 10k visible cells

### 2.3 Population Counting

- [ ] **Maintain running population counter** (`worker.js:722-730`)
  - Add `let totalPopulation = 0` to worker global state
  - During `step()`, count population delta: new cells - old cells
  - Increment/decrement `totalPopulation` instead of full scan
  - Recalculate on load/randomize to resync
  - Validate correctness with full scan in debug builds

- [ ] **Optional: Use faster popcount**
  - Lookup table: `const POPCOUNT = new Uint8Array(256)` precomputed
  - Split 32-bit word into 4 bytes, sum lookups
  - Benchmark vs current Kernighan algorithm

---

## Phase 3: Scalability & Robustness (v1.3)

**Goal**: Handle large imported patterns, improve UX edge cases
**Timeline**: 3-4 days
**Status**: Not started

### 3.1 History Buffer Optimization

**Current**: Full world clone per step → megabytes for large patterns

- [ ] **Implement delta-based history** (`worker.js:395-415`)
  - Store only changed chunks per step
  - Structure: `{ generation: N, delta: Map<chunkKey, Uint32Array> }`
  - On reverse: apply delta in reverse
  - Expected memory reduction: 10-100× for sparse updates

- [ ] **Alternative: Structural sharing**
  - Use immutable Map-like structure (e.g., HAMT)
  - Chunks shared between history states if unchanged
  - More complex implementation, evaluate if delta encoding insufficient

### 3.2 File Import Safety

- [ ] **Add file size validation** (`script.js:509-528`)
  - Warn if file > 10 MB, require confirmation
  - Hard limit at 100 MB (prevent browser hang)
  - Show loading spinner for files > 1 MB

- [ ] **Validate Macrocell node indices** (`script.js:599-616`)
  - Check node references are in bounds: `nw/ne/sw/se < nodes.length`
  - Detect cycles (would cause infinite loop in traversal)
  - Show meaningful error message on invalid file

- [ ] **Add parser timeout**
  - Abort RLE/Macrocell parsing if > 5 seconds elapsed
  - Use `performance.now()` checkpoints in loops

### 3.3 Randomize UX Clarification

- [ ] **Clear existing pattern before randomize** (`worker.js:149-151`)
  - Change to: `chunks.clear(); randomize(density, true);`
  - Or add "Overlay" checkbox to let user choose behavior
  - Document choice in UI tooltip

### 3.4 Coordinate System Documentation

- [ ] **Add comprehensive comment block** (top of `worker.js` and `script.js`)

  ```
  Coordinate Systems:
  1. Viewport: (vx, vy) ∈ [0, viewW) × [0, viewH)
  2. Global: (x, y) ∈ ℤ × ℤ (infinite grid)
  3. Chunk: (cx, cy) = (⌊x/32⌋, ⌊y/32⌋)
  4. Local: (lx, ly) = (x mod 32, y mod 32)

  Transforms:
  - Viewport → Global: (x, y) = (viewX + vx, viewY + vy)
  - Global → Chunk: (cx, cy, lx, ly) = (⌊x/32⌋, ⌊y/32⌋, x mod 32, y mod 32)
  ```

- [ ] **Create coordinate utility module** (optional)

  ```javascript
  const Coords = {
    viewportToGlobal(vx, vy, viewX, viewY),
    globalToChunk(x, y),
    chunkToGlobal(cx, cy, lx, ly),
    // ...
  }
  ```

---

## Phase 4: Code Quality & Maintainability (v1.4)

**Goal**: Reduce tech debt, improve developer experience
**Timeline**: 2-3 days
**Status**: Not started

### 4.1 Magic Number Elimination

- [ ] **Define constants in config objects**

  ```javascript
  // worker.js
  const CONFIG = {
    CHUNK_SIZE: 32,
    BITS_PER_WORD: 32,
    FPS_MIN: 1,
    FPS_MAX: 60,
    HISTORY_MIN: 5,
    HISTORY_MAX: 100,
  };

  // script.js
  const AGE_THRESHOLDS = {
    newborn: 0,
    young: 2,
    maturing: 5,
    mature: 10,
    old: 20,
  };
  ```

- [ ] **Replace raw numbers with named constants** throughout codebase

### 4.2 Pattern Rotation Consistency

- [ ] **Decide on behavior** (`script.js:319, 339-351`)
  - **Option A**: Persist rotation across pattern switches (remove line 319 reset)
  - **Option B**: Always reset to base pattern on switch (remove mutation, rotate copy)
  - Document choice in comment

- [ ] **Add "Reset Pattern" button** to revert to unrotated base

### 4.3 CSS Refactoring

- [ ] **Use CSS variables for layout** (`style.css:17, 28`)

  ```css
  :root {
    --sidebar-width: 320px;
  }
  aside { width: var(--sidebar-width); }
  .sidebar-inner { width: var(--sidebar-width); }
  ```

- [ ] **Extract magic numbers**: transition durations, shadows, borders

### 4.4 Docker Compose Cleanup

- [ ] **Move development volume to override file** (`docker-compose.yml:9-10`)

  ```bash
  # Production: docker compose up
  # Development: docker compose -f docker-compose.yml -f docker-compose.override.yml up
  ```

  - Create `docker-compose.override.yml` with volume mount

### 4.5 Testing Infrastructure (Stretch Goal)

- [ ] **Add test harness for simulation**
  - Load worker in Node.js test environment
  - Unit tests for:
    - SWAR neighbor counting (known patterns: blinker, toad, beacon)
    - Chunk coordinate transforms (negative coords, boundaries)
    - RLE parser (edge cases: trailing dead cells, large run counts)
    - Macrocell parser (simple quadtree, deep nesting)
  - Test framework: Mocha/Chai or Vitest

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

| Item | Severity | Effort | Phase |
|------|----------|--------|-------|
| Empty chunk leak | High | Low | 1.4 |
| Age tracking O(n) | Critical | Medium | 2.1 |
| History full clone | High | Medium | 3.1 |
| Magic numbers | Low | Low | 4.1 |
| No tests | Medium | High | 4.5 |

### Browser Compatibility Matrix

| Feature | Chrome | Firefox | Safari | Edge | Notes |
|---------|--------|---------|--------|------|-------|
| Web Workers | ✓ | ✓ | ✓ | ✓ | Universal |
| Transferables | ✓ | ✓ | ✓ | ✓ | Universal |
| Canvas 2D | ✓ | ✓ | ✓ | ✓ | Universal |
| WebGL (future) | ✓ | ✓ | ✓ | ✓ | Fallback needed for old Safari |
