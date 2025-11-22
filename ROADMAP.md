# Project Roadmap: Conway's Time Machine

This document outlines the strategic development plan for the Game of Life WebUI project. The goal is to evolve the project from a functional prototype into a high-performance, architecturally robust application adhering to Unix philosophy and modern web standards.

## Phase 1: UX & Input Efficiency (The "Vim" Treatment)
**Goal:** Make the interface faster to use without touching the core engine.

- [ ] **Keyboard Shortcuts**
    - `Space`: Pause/Play
    - `Right Arrow`: Step forward
    - `Left Arrow`: Step backward
    - `R`: Rotate pattern
    - `C`: Clear grid
    - `[` / `]`: Control simulation speed
- [ ] **Responsive Canvas**
    - Implement non-destructive resizing (retain grid state when window resizes).
- [ ] **Ghost Pattern Preview**
    - Render "ghost" of selected pattern/rotation under cursor before clicking.

## Phase 2: Architecture Decoupling (The "Sysadmin" Approach)
**Goal:** Separate concerns. The UI should observe the engine, not run it.

- [x] **Web Worker Implementation**
    - Move `Game` simulation logic to `worker.js`.
    - Implement message-passing protocol between UI and Worker.
    - Ensure 60FPS UI rendering independent of simulation speed.
- [ ] **OffscreenCanvas (Optional)**
    - Move rendering logic to worker if strictly necessary for performance.

## Phase 3: Algorithmic Optimization (The "Computer Scientist" Approach)
**Goal:** Drastically increase performance and memory efficiency.

- [ ] **Bitwise Parallelism**
    - Switch from `Uint8Array` to `Uint32Array`.
    - Implement bitwise operations for neighbor counting (32 cells at once).
- [ ] **WASM Backend**
    - Port core logic to Go (TinyGo) or Rust.
    - Compile to WebAssembly for near-native performance.

## Phase 4: The "Infinite" Vision
**Goal:** Support the true mathematical concept of an infinite grid.

- [ ] **Sparse Storage**
    - Replace fixed arrays with Hash Maps or Quadtrees (Hashlife).
- [ ] **Viewport Management**
    - Implement Pan and Zoom controls.
- [ ] **Standard Formats**
    - Support RLE and Life 1.05 file import/export.

## Current Todo List (Immediate)

- [ ] Create `worker.js` file.
- [ ] Refactor `script.js` to offload simulation loop to worker.
- [ ] Implement `postMessage` bridge for:
    - `step` / `loop`
    - `resize`
    - `setCell` / `paste`
    - `export` / `import`
- [ ] Verify feature parity (History, Tools, Save/Load) after refactor.
