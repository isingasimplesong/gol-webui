# Life Engine - Development To-Do List

## V1 Improvements

### P0 - Critical (Do First)

- [x] **Eliminate `step()`/`stepSilent()` duplication** (worker.js)
  - [x] Extract SWAR logic into `computeNextGeneration(chunks) -> nextChunks`
  - [x] Refactor `step()` to call it + handle history/age/heatmap
  - [x] Refactor `stepSilent()` to call it directly

- [x] **Input validation for file imports** (script.js)
  - [x] Add max cell count limit (10M) in `parseRLE()`
  - [x] Validate run-length counts before processing
  - [x] Check node references in `loadFromMacrocell()`
  - [x] Return structured errors instead of throwing
  - [x] Test with malicious RLE like `999999999o!`

- [x] **Optimize bounding box calculation** (worker.js)
  - [x] Maintain bbox incrementally during `step()`
  - [x] Track min/max of active chunk coordinates
  - [x] Compute exact bbox lazily only on export

### P1 - High Priority

- [ ] **Viewport extraction bulk copy** (worker.js)
  - [ ] Replace bit-by-bit copy with word-aligned bulk copy
  - [ ] Direct word copy when `srcXStart % 32 == destXStart % 32`
  - [ ] Shift and OR adjacent words otherwise

- [ ] **Replace magic numbers with constants**
  - [ ] `32` → `CHUNK_SIZE` / `BITS` (scattered throughout)
  - [ ] `66` slider max (script.js)
  - [ ] `5` heatmap boost (worker.js)
  - [ ] `10` decay interval (worker.js)

- [ ] **Consistent coordinate naming convention**
  - [ ] Define: `vx,vy` = viewport, `gx,gy` = global, `cx,cy` = chunk, `lx,ly` = local
  - [ ] Document convention in header comment
  - [ ] Rename mixed variables: `vx/vy`, `x/y`, `cellX/cellY`, `gx/gy`

- [ ] **Message handler registry** (worker.js)
  - [ ] Replace switch statement with handler object lookup
  - [ ] Test all message types still work

### P2 - Medium Priority

- [ ] **Chunk key optimization** (worker.js)
  - [ ] Replace string keys `"3,-2"` with numeric `((cx & 0xFFFF) << 16) | (cy & 0xFFFF)`
  - [ ] Eliminate `split(',').map(Number)` parsing
  - [ ] Benchmark GC improvement

- [ ] **ImageData rendering cache** (script.js)
  - [ ] Cache `hexToRGB()` results when colors change
  - [ ] Don't recompute every frame

- [ ] **Error handling improvements**
  - [ ] Return status/error objects from functions
  - [ ] Validate message payloads (NaN, negative, non-integer)
  - [ ] Fix silent failures in `setCell()` (worker.js)
  - [ ] Add validation on `jumpToGen` payload

- [ ] **Clipboard paste support**
  - [ ] Ctrl+V to paste RLE patterns directly from clipboard

### P3 - Low Priority / Polish

- [ ] **Incremental dirty chunk tracking** (worker.js)
  - [ ] Maintain dirty chunk set incrementally
  - [ ] Avoid rebuilding full set each step

- [ ] **History memory optimization** (worker.js)
  - [ ] Implement copy-on-write semantics
  - [ ] Only clone chunks that will be modified

- [ ] **URL state persistence**
  - [ ] Save viewport position, zoom, rule via URL hash
  - [ ] Optional: encode small pattern in RLE for sharing

- [ ] **Performance stats overlay**
  - [ ] Memory usage (chunk count, estimated bytes)
  - [ ] Step time breakdown (simulation vs rendering)

- [ ] **Touch support for mobile**
  - [ ] touchstart/touchmove for drawing
  - [ ] Two-finger drag for panning
  - [ ] Pinch for zooming

- [ ] **Cleanup legacy code**
  - [ ] Remove `packed: true` flag if unused (worker.js)
  - [ ] Clean up unused `viewportOnly` branch in `randomize()` (worker.js)
  - [ ] Fix `order: -1` CSS hack (style.css) with proper flexbox direction

---

## V2 Roadmap (Major Refactor)

### Architecture

- [ ] **Modularize codebase** (ES modules)
  - [ ] Create `public/js/main.js` - entry point, event wiring
  - [ ] Create `public/js/ui.js` - UI class, sidebar controls
  - [ ] Create `public/js/renderer.js` - Canvas2D + WebGL rendering
  - [ ] Create `public/js/patterns.js` - pattern library, RLE parsing
  - [ ] Create `public/js/io.js` - import/export logic
  - [ ] Create `public/worker/worker.js` - entry point, message handler
  - [ ] Create `public/worker/simulation.js` - core step logic
  - [ ] Create `public/worker/chunks.js` - chunk management
  - [ ] Create `public/worker/history.js` - history/delta logic
  - [ ] Create `public/worker/rules.js` - rule parsing, presets

- [ ] **Build system** (optional)
  - [ ] Evaluate esbuild/Vite for bundling
  - [ ] Or use `<script type="module">` for vanilla approach

### Testing

- [ ] **Unit tests for core algorithms**
  - [ ] Test SWAR neighbor counting logic
  - [ ] Test RLE parsing with edge cases
  - [ ] Test coordinate transforms
  - [ ] Test rule parsing (B.../S... format)
  - [ ] Verify glider at gen N matches expected state

- [ ] **Integration tests**
  - [ ] File import/export roundtrip
  - [ ] Pattern placement + simulation correctness
  - [ ] History forward/backward consistency
  - [ ] Setup Playwright or Puppeteer

### Advanced Features

- [ ] **WebGL renderer improvements** (script.js)
  - [ ] Implement instanced rendering for cells
  - [ ] Persistent vertex buffer, update only changed regions
  - [ ] Evaluate texture-based rendering (cell state as texture)

- [ ] **Selection tool**
  - [ ] Rectangle selection UI
  - [ ] Copy selection as RLE
  - [ ] Move selection
  - [ ] Delete selection
  - [ ] Rotate selection

- [ ] **Multiple viewports / split view**

- [ ] **Pattern search/download from LifeWiki API**

### Documentation

- [ ] **Code documentation**
  - [ ] JSDoc for all public functions
  - [ ] Inline comments for SWAR bit manipulation
  - [ ] Architecture decision records (ADR)

- [ ] **User documentation**
  - [ ] Keyboard shortcut reference card (printable)
  - [ ] Pattern creation tutorial
  - [ ] Custom rule guide
