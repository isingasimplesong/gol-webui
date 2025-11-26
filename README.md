# Life Engine

A high-performance, infinite-grid implementation of Conway's Game of Life with a Nord-themed interface.

## Features

### Core Simulation
- **Infinite grid**: Sparse chunk-based storage allows exploration in any direction
- **SWAR optimization**: Bitwise parallel computation for fast generation steps
- **Web Worker**: Simulation runs in background thread, keeping UI responsive

### Time Control
- Play/Pause with adjustable speed (1-60 FPS)
- Single-step forward
- **History buffer**: Optional step-backward with configurable buffer size (5-100 steps)

### Visualization
- **Cell colors**: Choose from 8 Nord palette colors
- **Age gradient**: Dynamic coloring based on cell age (newborn -> ancient)
- Adjustable zoom (2-40px per cell)
- Grid lines (auto-hidden at small zoom)
- Viewport panning (drag with Move tool or pan to explore infinite space)

### Tools
- **Draw**: Click/drag to create cells
- **Erase**: Click/drag to remove cells
- **Move**: Pan the viewport
- **Paste**: Place predefined patterns (Glider, LWSS, Pulsar, Gosper Gun, Block, Beehive)
- **Rotate**: Rotate selected pattern 90°

### Import/Export
Supports multiple formats:
- **RLE** (Run Length Encoded): Standard Life pattern format, compatible with Golly and LifeWiki
- **Macrocell** (.mc): Golly's compressed quadtree format for large patterns
- **JSON**: Internal format

Export produces standard RLE files.

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

Or simply open `public/index.html` in a browser.

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
Golly's quadtree format for large patterns. Download patterns from:
- [LifeWiki](https://conwaylife.com/wiki/)
- [copy.sh/life](https://copy.sh/life/examples/)

## Tech Stack

- Vanilla JS (ES6+)
- HTML5 Canvas
- Web Workers
- Nord color palette
- Nginx (Docker)

## Resources

- [LifeWiki](https://conwaylife.com/wiki/) - Pattern encyclopedia
- [Golly](https://golly.sourceforge.io/) - Desktop Life simulator
- [copy.sh/life](https://copy.sh/life/) - Another web implementation

## License

MIT
