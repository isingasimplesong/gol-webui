/**
 * UI & Render Logic (Main Thread)
 */
const CONF = {
    cellSize: 10,
    gridColor: '#3B4252',
    liveColor: '#A3BE8C',
    deadColor: '#2E3440',
    error: '#BF616A'
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

let CURRENT_PATTERNS = JSON.parse(JSON.stringify(BASE_PATTERNS));

class UI {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.cols = 0;
        this.rows = 0;
        this.lastGrid = null; // Cache for rendering
        
        // Worker
        this.worker = new Worker('worker.js');
        this.worker.onmessage = this.onWorkerMessage.bind(this);

        // State
        this.isRunning = false;
        this.mouse = { x: 0, y: 0, down: false };
        this.mode = 'draw';
        this.selectedPattern = 'glider';

        // Init
        this.resize();
        window.addEventListener('resize', () => this.resize());
        
        // UI Loop (only for ghost patterns and responsiveness, grid updates come from worker)
        this.renderLoop = this.renderLoop.bind(this);
        requestAnimationFrame(this.renderLoop);
    }

    resize() {
        this.canvas.width = this.canvas.parentElement.clientWidth;
        this.canvas.height = this.canvas.parentElement.clientHeight;
        this.cols = Math.floor(this.canvas.width / CONF.cellSize);
        this.rows = Math.floor(this.canvas.height / CONF.cellSize);
        
        // Send new dimensions to worker
        this.worker.postMessage({ 
            type: 'init', 
            payload: { cols: this.cols, rows: this.rows } 
        });
    }

    onWorkerMessage(e) {
        const { type, payload } = e.data;
        if (type === 'update') {
            this.lastGrid = payload.grid;
            this.isRunning = payload.running;
            updateStats(payload.generation, payload.pop);
            updateBtnState(this.isRunning);
            this.draw(); // Trigger draw on update
        } else if (type === 'exportData') {
             this.handleExport(payload);
        }
    }

    idx(x, y) {
        const cx = (x + this.cols) % this.cols;
        const cy = (y + this.rows) % this.rows;
        return cy * this.cols + cx;
    }

    handleExport(data) {
        const blob = new Blob([JSON.stringify(data)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gol_export_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast("Exported to Disk");
    }

    draw() {
        if (!this.lastGrid) return;

        // Clear
        this.ctx.fillStyle = CONF.deadColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Grid Lines
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
        const sz = CONF.cellSize > 1 ? CONF.cellSize - 1 : 1;

        // Render visible grid
        // Note: Rendering logic still happens on main thread, iterating the buffer sent by worker.
        // This is efficient enough for < 1 million cells.
        for (let i = 0; i < this.lastGrid.length; i++) {
            if (this.lastGrid[i] === 1) {
                const x = (i % this.cols) * CONF.cellSize;
                const y = Math.floor(i / this.cols) * CONF.cellSize;
                this.ctx.fillRect(x, y, sz, sz);
            }
        }

        // Ghost Pattern
        if (this.mode === 'paste' && !this.isRunning) {
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

    renderLoop() {
        // Keep checking for mouse interactions or animations independent of worker
        if (!this.isRunning) {
             this.draw();
        }
        requestAnimationFrame(this.renderLoop);
    }
}

/**
 * Interaction & Binding
 */
const canvas = document.getElementById('grid');
const ui = new UI(canvas);
const statDisplay = document.getElementById('stat-display');

function updateStats(gen, pop) {
    statDisplay.innerText = `Gen: ${gen} | Pop: ${pop}`;
}

function updateBtnState(running) {
    const btn = document.getElementById('btn-play');
    btn.innerText = running ? "Pause" : "Play";
    btn.classList.toggle('active', running);
}

// Controls
document.getElementById('btn-play').onclick = () => {
    ui.worker.postMessage({ type: ui.isRunning ? 'stop' : 'start' });
};
document.getElementById('btn-step').onclick = () => {
    ui.worker.postMessage({ type: 'step' });
};
document.getElementById('btn-rev-step').onclick = () => {
    ui.worker.postMessage({ type: 'reverse' });
};
document.getElementById('btn-clear').onclick = () => {
    ui.worker.postMessage({ type: 'clear' });
};
document.getElementById('btn-rand').onclick = () => {
    ui.worker.postMessage({ type: 'randomize' });
};

document.getElementById('speed-range').oninput = (e) => {
    const fps = parseInt(e.target.value);
    document.getElementById('speed-label').innerText = `${fps} FPS`;
    ui.worker.postMessage({ type: 'setFps', payload: fps });
};

// Tools
document.querySelectorAll('.tool-btn').forEach(b => {
    b.onclick = () => {
        document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
        b.classList.add('active');
        ui.mode = b.dataset.mode;
    };
});

document.getElementById('pattern-select').onchange = (e) => {
    ui.selectedPattern = e.target.value;
    CURRENT_PATTERNS[ui.selectedPattern] = JSON.parse(JSON.stringify(BASE_PATTERNS[ui.selectedPattern]));
    document.querySelector('[data-mode="paste"]').click();
};

document.getElementById('btn-rotate').onclick = () => {
    rotateCurrentPattern();
    document.querySelector('[data-mode="paste"]').click();
};

function rotateCurrentPattern() {
    const p = CURRENT_PATTERNS[ui.selectedPattern];
    let minX = Infinity, minY = Infinity;
    const rotated = p.map(([x, y]) => {
        const nx = -y;
        const ny = x;
        if (nx < minX) minX = nx;
        if (ny < minY) minY = ny;
        return [nx, ny];
    });
    const normalized = rotated.map(([x, y]) => [x - minX, y - minY]);
    CURRENT_PATTERNS[ui.selectedPattern] = normalized;
    toast("Rotated");
}

// Mouse Input
canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    ui.mouse.x = e.clientX - rect.left;
    ui.mouse.y = e.clientY - rect.top;
    if (ui.mouse.down) applyTool();
});
canvas.addEventListener('mousedown', e => { ui.mouse.down = true; applyTool(); });
window.addEventListener('mouseup', () => { ui.mouse.down = false; });

function applyTool() {
    const x = Math.floor(ui.mouse.x / CONF.cellSize);
    const y = Math.floor(ui.mouse.y / CONF.cellSize);
    const idx = ui.idx(x,y);

    if (ui.mode === 'draw') {
        ui.worker.postMessage({ type: 'setCell', payload: { idx, val: 1 }});
    } else if (ui.mode === 'erase') {
        ui.worker.postMessage({ type: 'setCell', payload: { idx, val: 0 }});
    } else if (ui.mode === 'paste' && ui.mouse.down) {
        const p = CURRENT_PATTERNS[ui.selectedPattern];
        const updates = [];
        for (let [px, py] of p) {
            const targetIdx = ui.idx(x + px, y + py);
            updates.push({ idx: targetIdx, val: 1 });
        }
        ui.worker.postMessage({ type: 'setCells', payload: { updates }});
        ui.mouse.down = false; 
    }
}

// I/O
const toast = (txt, isError = false) => {
    const el = document.getElementById('msg');
    el.innerText = txt;
    el.style.borderColor = isError ? CONF.error : CONF.liveColor;
    el.style.opacity = 1;
    setTimeout(() => el.style.opacity = 0, 2000);
};

document.getElementById('btn-save').onclick = () => {
    const name = document.getElementById('save-name').value || 'Untitled';
    // Request data from worker for saving? 
    // Actually, we have ui.lastGrid which is the current state!
    // We just need to ensure we have dimensions.
    if (!ui.lastGrid) return;
    
    const state = {
        timestamp: Date.now(),
        w: ui.cols,
        h: ui.rows,
        data: Array.from(ui.lastGrid)
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
    loadFromJSON(raw);
};

document.getElementById('btn-export').onclick = () => {
    ui.worker.postMessage({ type: 'export' });
};

document.getElementById('btn-import-trigger').onclick = () => {
    document.getElementById('file-import').click();
};

document.getElementById('file-import').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => loadFromJSON(ev.target.result);
    reader.readAsText(file);
    e.target.value = ''; 
};

function loadFromJSON(jsonString) {
    try {
        const state = JSON.parse(jsonString);
        if (!state.w || !state.h || !state.data) throw new Error("Invalid Format");

        // Remap logic needs to happen here or in worker?
        // Easier to do in UI thread then send clean buffer to worker
        // OR just send the whole blob to worker and let it deal with it.
        // Worker has 'load' type.
        
        // Let's map it here to match current UI size
        // This duplicates logic but keeps worker "dumb" about resizing centering
        // Actually, let's reuse the logic I wrote before, but apply it to a new buffer
        
        const newGrid = new Uint8Array(ui.cols * ui.rows);
        const limit = Math.min(state.data.length, newGrid.length);
        
        if (state.w === ui.cols && state.h === ui.rows) {
             newGrid.set(state.data);
        } else {
             const offsetX = Math.floor((ui.cols - state.w) / 2);
             const offsetY = Math.floor((ui.rows - state.h) / 2);
             for(let i = 0; i < state.data.length; i++) {
                 if(state.data[i] === 1) {
                     const srcX = i % state.w;
                     const srcY = Math.floor(i / state.w);
                     const destX = srcX + offsetX;
                     const destY = srcY + offsetY;
                     const destIdx = destY * ui.cols + destX;
                     if (destX >= 0 && destX < ui.cols && destY >= 0 && destY < ui.rows) {
                         newGrid[destIdx] = 1;
                     }
                 }
             }
        }
        
        ui.worker.postMessage({ 
            type: 'load', 
            payload: newGrid // Send cleaned, resized buffer
        });
        toast("Loaded");
    } catch (e) {
        console.error(e);
        toast("Load Failed", true);
    }
}
