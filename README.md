# Life Engine

A high-performance, infinite-grid implementation of Conway's Game of Life with a polished web UI

## Features

### Core Simulation

- **Infinite grid**: Sparse chunk-based storage allows exploration in any direction
- **SWAR optimization**: Bitwise parallel computation for fast generation steps
- **Web Worker**: Simulation runs in background thread, keeping UI responsive
- **Custom CA rules**: 10 presets (Conway, HighLife, Seeds, Maze, etc.) + custom B.../S... rules

### Time Control

- Play/Pause with adjustable speed (0.1-60 FPS, including fractional speeds)
- Single-step forward/backward
- **Generation jumping**: Skip to any future generation instantly
- **History buffer**: Optional step-backward with configurable buffer size (5-100 steps)

### Visualization

- **Cell colors**: Choose from 8 colors
- **Age gradient**: Dynamic coloring based on cell age (newborn -> ancient)
- **Activity heatmap**: Visualize birth/death frequency
- **WebGL renderer**: Optional GPU acceleration for small cell sizes
- Adjustable zoom (2-40px per cell)
- Grid lines (auto-hidden at small zoom)
- Viewport panning (drag with Move tool)
- **Population graph**: Real-time history visualization
- **FPS counter**: Actual vs target FPS with chunk/history stats

### Tools

- **Draw**: Click/drag to create cells
- **Erase**: Click/drag to remove cells
- **Move**: Pan the viewport
- **Paste**: Place patterns from library (click to place)
- **Load**: Load pattern directly to grid
- **Rotate**: Rotate selected pattern 90°

### Pattern Library

30+ built-in patterns organized by category:

- Still Lifes (Block, Beehive, Loaf, Boat, etc.)
- Oscillators (Blinker, Toad, Pulsar, Pentadecathlon, etc.)
- Spaceships (Glider, LWSS, MWSS, HWSS)
- Guns (Gosper Gun, Simkin Gun)
- Methuselahs (R-pentomino, Acorn, Diehard, etc.)

### Import/Export

Supports multiple formats:

- **RLE** (Run Length Encoded): Standard Life pattern format, compatible with Golly and LifeWiki
- **Macrocell** (.mc): Golly's compressed quadtree format for large patterns (import only)

Export produces standard RLE files with current rule.

### Randomize

Fill viewport with random cells at configurable density (5-95%).

## Usage

### Docker (Recommended)

```bash
docker compose up -d
```

Access at `http://localhost:8088`

### Local

```bash
cd public
python3 -m http.server 8088
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause |
| `→` | Step forward |
| `←` | Step backward (requires History enabled) |
| `C` | Clear grid |
| `R` | Rotate pattern |
| `[` / `]` | Decrease/Increase speed |
| `Tab` | Toggle sidebar |
| `Ctrl+/` | Show help |
| `Esc` | Close modals |
| `Scroll` | Zoom in/out |

## File Formats

### RLE Import/Export

Standard format used by most Life programs:

```
#C Comment
x = 3, y = 3, rule = B3/S23
bo$2bo$3o!
```

### Macrocell Import

Golly's quadtree format for large patterns.

## Resources

- [LifeWiki](https://conwaylife.com/wiki/) - Pattern encyclopedia
- [Golly](https://golly.sourceforge.io/) - Desktop Life simulator
- [copy.sh/life](https://copy.sh/life/) - Another web implementation
