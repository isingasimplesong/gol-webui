/**
 * Core Logic
 */
const CONF = {
    cellSize: 10,
    gridColor: '#3B4252',
    liveColor: '#A3BE8C',
    deadColor: '#2E3440',
    historyLimit: 200 // Max frames to reverse
};

const PATTERNS = {
    glider: [[0,1],[1,2],[2,0],[2,1],[2,2]],
    lwss: [[0,1],[0,4],[1,0],[2,0],[3,0],[3,4],[4,0],[4,1],[4,2],[4,3]],
    block: [[0,0],[0,1],[1,0],[1,1]],
    beehive: [[0,1],[0,2],[1,0],[1,3],[2,1],[2,2]],
    pulsar: [[2,4],[2,5],[2,6],[2,10],[2,11],[2,12],[4,2],[4,7],[4,9],[4,14],[5,2],[5,7],[5,9],[5,14],[6,2],[6,7],[6,9],[6,14],[7,4],[7,5],[7,6],[7,10],[7,11],[7,12],[9,4],[9,5],[9,6],[9,10],[9,11],[9,12],[10,2],[10,7],[10,9],[10,14],[11,2],[11,7],[11,9],[11,14],[12,2],[12,7],[12,9],[12,14],[14,4],[14,5],[14,6],[14,10],[14,11],[14,12]],
    gosper: [[5,1],[5,2],[6,1],[6,2],[5,11],[6,11],[7,11],[4,12],[8,12],[3,13],[9,13],[3,14],[9,14],[6,15],[4,16],[8,16],[5,17],[6,17],[7,17],[6,18],[3,21],[4,21],[5,21],[3,22],[4,22],[5,22],[2,23],[6,23],[1,25],[2,25],[6,25],[7,25],[3,35],[4,35],[3,36],[4,36]]
};

class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.cols = 0;
        this.rows = 0;
        this.grid = null;
        this.history = []; // Ring buffer logic handled manually
        this.running = false;
        this.generation = 0;
        this.fps = 30;
        this.lastFrame = 0;
        
        this.mouse = { x: 0, y: 0, down: false };
        this.mode = 'draw'; // draw, erase, paste
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
        // Reset grid
        this.grid = new Uint8Array(this.cols * this.rows);
        this.history = [];
        this.draw();
    }

    idx(x, y) {
        // Wrap around logic (Toroidal surface)
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
        // Deep copy current grid to history
        if (this.history.length >= CONF.historyLimit) {
            this.history.shift();
        }
        this.history.push(new Uint8Array(this.grid));
    }

    step() {
        this.saveState();
        const next = new Uint8Array(this.cols * this.rows);
        let changes = false;

        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const i = y * this.cols + x;
                const state = this.grid[i];
                
                // Count neighbors (optimized unrolled loop for 3x3)
                let neighbors = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        neighbors += this.getCell(x+dx, y+dy);
                    }
                }

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
        for (let i = 0; i < this.grid.length; i++) {
            this.grid[i] = Math.random() > 0.85 ? 1 : 0;
        }
        this.generation = 0;
        this.history = []; // Clear history on new start
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
        // Background
        this.ctx.fillStyle = CONF.deadColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Grid Lines (Optional, efficient way)
        this.ctx.strokeStyle = '#353C4A';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        for(let x=0; x<=this.canvas.width; x+=CONF.cellSize) {
            this.ctx.moveTo(x,0); this.ctx.lineTo(x, this.canvas.height);
        }
        for(let y=0; y<=this.canvas.height; y+=CONF.cellSize) {
            this.ctx.moveTo(0,y); this.ctx.lineTo(this.canvas.width, y);
        }
        this.ctx.stroke();

        // Live Cells
        this.ctx.fillStyle = CONF.liveColor;
        for (let i = 0; i < this.grid.length; i++) {
            if (this.grid[i] === 1) {
                const x = (i % this.cols) * CONF.cellSize;
                const y = Math.floor(i / this.cols) * CONF.cellSize;
                // Draw slight padding for aesthetic
                this.ctx.fillRect(x+1, y+1, CONF.cellSize-2, CONF.cellSize-2);
            }
        }

        // Ghost Pattern (if in paste mode)
        if (this.mode === 'paste' && !this.running) {
            this.ctx.fillStyle = 'rgba(136, 192, 208, 0.5)';
            const p = PATTERNS[this.selectedPattern];
            const mx = Math.floor(this.mouse.x / CONF.cellSize);
            const my = Math.floor(this.mouse.y / CONF.cellSize);
            
            for (let [px, py] of p) {
                const tx = (mx + px) * CONF.cellSize;
                const ty = (my + py) * CONF.cellSize;
                this.ctx.fillRect(tx+1, ty+1, CONF.cellSize-2, CONF.cellSize-2);
            }
        }
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
            // If not running, still redraw for mouse interactions (hover effects)
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
    for(let c of game.grid) if(c===1) pop++;
    statDisplay.innerText = `Gen: ${game.generation} | Pop: ${pop}`;
}

function updateBtnState() {
    document.getElementById('btn-play').innerText = game.running ? "Pause" : "Play";
    document.getElementById('btn-play').classList.toggle('active', game.running);
}

// Playback
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
const speedInput = document.getElementById('speed-range');
speedInput.oninput = (e) => {
    game.fps = parseInt(e.target.value);
    document.getElementById('speed-label').innerText = `${game.fps} FPS`;
};

// Tools
document.querySelectorAll('.tool-btn').forEach(b => {
    b.onclick = () => {
        document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
        b.classList.add('active');
        game.mode = b.dataset.mode;
    };
});
document.getElementById('pattern-select').onchange = (e) => {
    game.selectedPattern = e.target.value;
    // Auto switch to paste tool
    document.querySelector('[data-mode="paste"]').click();
};

// Mouse Interaction
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
        // Only paste on single click/tap, not drag
        const p = PATTERNS[game.selectedPattern];
        game.saveState(); // Save before paste
        for (let [px, py] of p) {
            game.setCell(x + px, y + py, 1);
        }
        game.mouse.down = false; // Prevent drag-paste
    }
    game.draw();
    updateStats();
}

// Save/Load
const toast = (txt) => {
    const el = document.getElementById('msg');
    el.innerText = txt;
    el.style.opacity = 1;
    setTimeout(() => el.style.opacity = 0, 2000);
}

document.getElementById('btn-save').onclick = () => {
    const name = document.getElementById('save-name').value || 'Untitled';
    const state = {
        w: game.cols,
        h: game.rows,
        data: Array.from(game.grid) // Convert typed array to standard array
    };
    localStorage.setItem('gol_' + name, JSON.stringify(state));
    toast(`Saved "${name}"`);
};

document.getElementById('btn-load').onclick = () => {
    const name = document.getElementById('save-name').value || 'Untitled';
    const raw = localStorage.getItem('gol_' + name);
    if (!raw) { toast("Save not found"); return; }
    
    const state = JSON.parse(raw);
    // Smart load: if sizes differ, center it
    game.clear();
    // Simple copy for now (assuming standard window size, or truncation)
    // Ideal world: complex centering logic.
    const limit = Math.min(state.data.length, game.grid.length);
    for(let i=0; i<limit; i++) game.grid[i] = state.data[i];
    game.draw();
    toast(`Loaded "${name}"`);
};

// Initial
game.randomize();
