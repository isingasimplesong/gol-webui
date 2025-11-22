/**
 * Core Logic
 */
const CONF = {
    cellSize: 10,
    gridColor: '#3B4252',
    liveColor: '#A3BE8C',
    deadColor: '#2E3440',
    historyLimit: 200
};

// Standard patterns
const BASE_PATTERNS = {
    glider: [[0,1],[1,2],[2,0],[2,1],[2,2]],
    lwss: [[0,1],[0,4],[1,0],[2,0],[3,0],[3,4],[4,0],[4,1],[4,2],[4,3]],
    block: [[0,0],[0,1],[1,0],[1,1]],
    beehive: [[0,1],[0,2],[1,0],[1,3],[2,1],[2,2]],
    pulsar: [[2,4],[2,5],[2,6],[2,10],[2,11],[2,12],[4,2],[4,7],[4,9],[4,14],[5,2],[5,7],[5,9],[5,14],[6,2],[6,7],[6,9],[6,14],[7,4],[7,5],[7,6],[7,10],[7,11],[7,12],[9,4],[9,5],[9,6],[9,10],[9,11],[9,12],[10,2],[10,7],[10,9],[10,14],[11,2],[11,7],[11,9],[11,14],[12,2],[12,7],[12,9],[12,14],[14,4],[14,5],[14,6],[14,10],[14,11],[14,12]],
    gosper: [[5,1],[5,2],[6,1],[6,2],[5,11],[6,11],[7,11],[4,12],[8,12],[3,13],[9,13],[3,14],[9,14],[6,15],[4,16],[8,16],[5,17],[6,17],[7,17],[6,18],[3,21],[4,21],[5,21],[3,22],[4,22],[5,22],[2,23],[6,23],[1,25],[2,25],[6,25],[7,25],[3,35],[4,35],[3,36],[4,36]]
};

// Mutable copy to handle rotation state without destroying originals
let CURRENT_PATTERNS = JSON.parse(JSON.stringify(BASE_PATTERNS));

class Game {
    constructor(canvas) {
        this.canvas = canvas;
        // Alpha: false hints browser to optimize for opaque composition
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.cols = 0;
        this.rows = 0;
        this.grid = null;
        this.history = [];
        this.running = false;
        this.generation = 0;
        this.fps = 30;
        this.lastFrame = 0;
        
        this.mouse = { x: 0, y: 0, down: false };
        this.mode = 'draw'; 
        this.selectedPattern = 'glider';

        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.loop = this.loop.bind(this);
        requestAnimationFrame(this.loop);
    }

    resize() {
        this.canvas.width = this.canvas.parentElement.clientWidth;
        this.canvas.height = this.canvas.parentElement.clientHeight;
        this.cols = Math.floor(this.canvas.width / CONF.cellSize);
        this.rows = Math.floor(this.canvas.height / CONF.cellSize);
        
        // Re-initialize grid safely
        const newGrid = new Uint8Array(this.cols * this.rows);
        
        // Optional: Copy old grid to new if resizing (simple best-effort center crop)
        // For now, we reset to ensure clean state, as mapping old->new is complex with toroidal wrap
        this.grid = newGrid;
        
        this.history = [];
        this.draw();
    }

    idx(x, y) {
        // Inline modulo for positive integers can be: (x % n + n) % n
        // But simpler:
        const cx = (x + this.cols) % this.cols;
        const cy = (y + this.rows) % this.rows;
        return cy * this.cols + cx;
    }

    setCell(x, y, val) {
        this.grid[this.idx(x,y)] = val;
    }

    getCell(x, y) {
        return this.grid[this.idx(x,y)];
    }

    saveState() {
        if (this.history.length >= CONF.historyLimit) {
            this.history.shift();
        }
        // Uint8Array.slice() is fast for cloning
        this.history.push(this.grid.slice());
    }

    step() {
        this.saveState();
        const next = new Uint8Array(this.cols * this.rows);
        const w = this.cols;
        const h = this.rows;
        let changes = false;

        // Performance: Lift constants out of the loop
        // Also iterating with raw index i is often faster, but we need (x,y) for neighbors
        
        for (let y = 0; y < h; y++) {
            const yRow = y * w;
            
            // Pre-calculate neighbor row indices for wrapping
            const yPrev = ((y - 1 + h) % h) * w;
            const yNext = ((y + 1) % h) * w;

            for (let x = 0; x < w; x++) {
                const i = yRow + x;
                const state = this.grid[i];
                
                // Optimized neighbor counting using pre-calc rows + x wrapping
                const xPrev = (x - 1 + w) % w;
                const xNext = (x + 1) % w;

                const neighbors = 
                    this.grid[yPrev + xPrev] + this.grid[yPrev + x] + this.grid[yPrev + xNext] +
                    this.grid[yRow  + xPrev] +                        this.grid[yRow  + xNext] +
                    this.grid[yNext + xPrev] + this.grid[yNext + x] + this.grid[yNext + xNext];

                if (state === 1 && (neighbors < 2 || neighbors > 3)) {
                    next[i] = 0;
                    changes = true;
                } else if (state === 0 && neighbors === 3) {
                    next[i] = 1;
                    changes = true;
                } else {
                    next[i] = state;
                }
            }
        }

        this.grid = next;
        this.generation++;
        updateStats();
    }

    reverse() {
        if (this.history.length > 0) {
            this.grid = this.history.pop();
            this.generation--;
            updateStats();
            this.draw();
        }
    }

    randomize() {
        this.saveState();
        // Using fill and map might be cleaner, but loop is explicit
        for (let i = 0; i < this.grid.length; i++) {
            this.grid[i] = Math.random() > 0.85 ? 1 : 0;
        }
        this.generation = 0;
        this.history = [];
        this.draw();
    }

    clear() {
        this.saveState();
        this.grid.fill(0);
        this.generation = 0;
        this.running = false;
        updateBtnState();
        this.draw();
    }

    draw() {
        // Clear whole canvas
        this.ctx.fillStyle = CONF.deadColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Grid Lines (only if cell size is large enough to matter)
        if (CONF.cellSize >= 4) {
            this.ctx.strokeStyle = '#353C4A';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            const w = this.canvas.width;
            const h = this.canvas.height;
            for(let x=0; x<=w; x+=CONF.cellSize) {
                this.ctx.moveTo(x,0); this.ctx.lineTo(x, h);
            }
            for(let y=0; y<=h; y+=CONF.cellSize) {
                this.ctx.moveTo(0,y); this.ctx.lineTo(w, y);
            }
            this.ctx.stroke();
        }

        // Live Cells
        this.ctx.fillStyle = CONF.liveColor;
        const sz = CONF.cellSize > 1 ? CONF.cellSize - 1 : 1; // 1px gap for aesthetic
        
        for (let i = 0; i < this.grid.length; i++) {
            if (this.grid[i] === 1) {
                // Inverse index calculation
                const x = (i % this.cols) * CONF.cellSize;
                const y = Math.floor(i / this.cols) * CONF.cellSize;
                this.ctx.fillRect(x, y, sz, sz);
            }
        }

        // Ghost Pattern
        if (this.mode === 'paste' && !this.running) {
            this.ctx.fillStyle = 'rgba(136, 192, 208, 0.5)';
            const p = CURRENT_PATTERNS[this.selectedPattern];
            const mx = Math.floor(this.mouse.x / CONF.cellSize);
            const my = Math.floor(this.mouse.y / CONF.cellSize);
            
            for (let [px, py] of p) {
                const tx = (mx + px) * CONF.cellSize;
                const ty = (my + py) * CONF.cellSize;
                this.ctx.fillRect(tx, ty, sz, sz);
            }
        }
    }

    rotateCurrentPattern() {
        const p = CURRENT_PATTERNS[this.selectedPattern];
        // 90 degree rotation: (x, y) -> (-y, x)
        // Then normalize to keep positive coordinates
        let minX = Infinity, minY = Infinity;
        
        const rotated = p.map(([x, y]) => {
            const nx = -y;
            const ny = x;
            if (nx < minX) minX = nx;
            if (ny < minY) minY = ny;
            return [nx, ny];
        });

        // Normalize
        const normalized = rotated.map(([x, y]) => [x - minX, y - minY]);
        
        CURRENT_PATTERNS[this.selectedPattern] = normalized;
        this.draw();
        toast("Rotated");
    }

    loop(timestamp) {
        if (this.running) {
            const elapsed = timestamp - this.lastFrame;
            const interval = 1000 / this.fps;
            
            if (elapsed > interval) {
                this.step();
                this.lastFrame = timestamp - (elapsed % interval);
                this.draw();
            }
        } else {
            this.draw();
        }
        requestAnimationFrame(this.loop);
    }
}

/**
 * UI Binding
 */
const canvas = document.getElementById('grid');
const game = new Game(canvas);
const statDisplay = document.getElementById('stat-display');

function updateStats() {
    let pop = 0;
    for(let i=0; i<game.grid.length; i++) {
        if(game.grid[i]===1) pop++;
    }
    statDisplay.innerText = `Gen: ${game.generation} | Pop: ${pop}`;
}

function updateBtnState() {
    const btn = document.getElementById('btn-play');
    btn.innerText = game.running ? "Pause" : "Play";
    btn.classList.toggle('active', game.running);
}

// Playback Controls
document.getElementById('btn-play').onclick = () => {
    game.running = !game.running;
    game.lastFrame = performance.now();
    updateBtnState();
};
document.getElementById('btn-step').onclick = () => { game.running = false; game.step(); game.draw(); updateBtnState(); };
document.getElementById('btn-rev-step').onclick = () => { game.running = false; game.reverse(); updateBtnState(); };
document.getElementById('btn-clear').onclick = () => game.clear();
document.getElementById('btn-rand').onclick = () => game.randomize();

// Speed
document.getElementById('speed-range').oninput = (e) => {
    game.fps = parseInt(e.target.value);
    document.getElementById('speed-label').innerText = `${game.fps} FPS`;
};

// Tools
document.querySelectorAll('.tool-btn').forEach(b => {
    b.onclick = () => {
        document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
        b.classList.add('active');
        game.mode = b.dataset.mode;
        if (game.mode === 'paste') {
             // If clicking paste, ensure a pattern is selected/visualized
             game.draw();
        }
    };
});

document.getElementById('pattern-select').onchange = (e) => {
    game.selectedPattern = e.target.value;
    // Reset rotation on new pattern select? Optional. 
    // For now, let's reset to base pattern to avoid confusion
    CURRENT_PATTERNS[game.selectedPattern] = JSON.parse(JSON.stringify(BASE_PATTERNS[game.selectedPattern]));
    
    // Auto switch to paste
    document.querySelector('[data-mode="paste"]').click();
};

document.getElementById('btn-rotate').onclick = () => {
    game.rotateCurrentPattern();
    // Ensure we are in paste mode
    document.querySelector('[data-mode="paste"]').click();
};

// Mouse
canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    game.mouse.x = e.clientX - rect.left;
    game.mouse.y = e.clientY - rect.top;
    if (game.mouse.down) applyTool();
});
canvas.addEventListener('mousedown', e => { game.mouse.down = true; applyTool(); });
window.addEventListener('mouseup', () => { game.mouse.down = false; });

function applyTool() {
    const x = Math.floor(game.mouse.x / CONF.cellSize);
    const y = Math.floor(game.mouse.y / CONF.cellSize);
    
    if (game.mode === 'draw') {
        game.setCell(x, y, 1);
    } else if (game.mode === 'erase') {
        game.setCell(x, y, 0);
    } else if (game.mode === 'paste' && game.mouse.down) {
        const p = CURRENT_PATTERNS[game.selectedPattern];
        game.saveState();
        for (let [px, py] of p) {
            game.setCell(x + px, y + py, 1);
        }
        game.mouse.down = false; 
    }
    game.draw();
    updateStats();
}

// Toast Notification
const toast = (txt, isError = false) => {
    const el = document.getElementById('msg');
    el.innerText = txt;
    el.style.borderColor = isError ? CONF.error : CONF.liveColor;
    el.style.opacity = 1;
    setTimeout(() => el.style.opacity = 0, 2000);
};

// Local Storage
document.getElementById('btn-save').onclick = () => {
    const name = document.getElementById('save-name').value || 'Untitled';
    const state = {
        timestamp: Date.now(),
        w: game.cols,
        h: game.rows,
        data: Array.from(game.grid)
    };
    try {
        localStorage.setItem('gol_' + name, JSON.stringify(state));
        toast(`Saved "${name}"`);
    } catch (e) {
        toast("Storage Full!", true);
    }
};

document.getElementById('btn-load').onclick = () => {
    const name = document.getElementById('save-name').value || 'Untitled';
    const raw = localStorage.getItem('gol_' + name);
    if (!raw) { toast("Save not found", true); return; }
    loadState(raw);
};

// File I/O
document.getElementById('btn-export').onclick = () => {
    const state = {
        w: game.cols,
        h: game.rows,
        data: Array.from(game.grid)
    };
    const blob = new Blob([JSON.stringify(state)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gol_export_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast("Exported to Disk");
};

document.getElementById('btn-import-trigger').onclick = () => {
    document.getElementById('file-import').click();
};

document.getElementById('file-import').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (ev) => loadState(ev.target.result);
    reader.readAsText(file);
    e.target.value = ''; // Reset to allow same file load again
};

// Unified Loader with Validation
function loadState(jsonString) {
    try {
        const state = JSON.parse(jsonString);
        
        // Validation
        if (!state.w || !state.h || !state.data || !Array.isArray(state.data)) {
            throw new Error("Invalid Save Format");
        }
        
        game.clear();
        
        // Center the loaded grid
        // We need to handle different aspect ratios or sizes
        const limit = Math.min(state.data.length, game.grid.length);
        
        // If sizes match exactly, fast copy
        if (state.w === game.cols && state.h === game.rows) {
            game.grid.set(state.data);
        } else {
            // Best effort map
             // Center offset
             const offsetX = Math.floor((game.cols - state.w) / 2);
             const offsetY = Math.floor((game.rows - state.h) / 2);

             for(let i = 0; i < state.data.length; i++) {
                 if(state.data[i] === 1) {
                     const srcX = i % state.w;
                     const srcY = Math.floor(i / state.w);
                     
                     const destX = srcX + offsetX;
                     const destY = srcY + offsetY;
                     
                     // Boundary checks
                     if (destX >= 0 && destX < game.cols && destY >= 0 && destY < game.rows) {
                         game.setCell(destX, destY, 1);
                     }
                 }
             }
        }
        
        game.draw();
        toast("Loaded Successfully");
    } catch (e) {
        console.error(e);
        toast("Load Failed: " + e.message, true);
    }
}

// Initial
game.randomize();
