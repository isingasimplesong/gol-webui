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
        this.stride = 0; // 32-bit words per row
        this.lastGrid = null; // Uint32Array
        
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
        
        // UI Loop
        this.renderLoop = this.renderLoop.bind(this);
        requestAnimationFrame(this.renderLoop);
    }

    resize() {
        this.canvas.width = this.canvas.parentElement.clientWidth;
        this.canvas.height = this.canvas.parentElement.clientHeight;
        this.cols = Math.floor(this.canvas.width / CONF.cellSize);
        this.rows = Math.floor(this.canvas.height / CONF.cellSize);
        this.stride = Math.ceil(this.cols / 32);
        
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
        // Convert TypedArray to normal array for JSON
        const exportObj = {
            w: data.w,
            h: data.h,
            packed: true,
            data: Array.from(data.data) 
        };
        
        const blob = new Blob([JSON.stringify(exportObj)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gol_packed_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast("Exported");
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

        // Live Cells (Optimized Rendering)
        this.ctx.fillStyle = CONF.liveColor;
        const sz = CONF.cellSize > 1 ? CONF.cellSize - 1 : 1;

        // Iterate words
        for (let i = 0; i < this.lastGrid.length; i++) {
            const word = this.lastGrid[i];
            if (word === 0) continue; // Skip empty words

            const wordRow = Math.floor(i / this.stride); // y
            const wordColStart = (i % this.stride) * 32; // x start

            // Iterate bits in word
            for (let bit = 0; bit < 32; bit++) {
                if ((word >>> bit) & 1) {
                    const x = (wordColStart + bit) * CONF.cellSize;
                    const y = wordRow * CONF.cellSize;
                    
                    // Check bounds (padding bits might be out of view)
                    if (x < this.canvas.width && y < this.canvas.height) {
                        this.ctx.fillRect(x, y, sz, sz);
                    }
                }
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

const actions = {
    togglePlay: () => ui.worker.postMessage({ type: ui.isRunning ? 'stop' : 'start' }),
    step: () => ui.worker.postMessage({ type: 'step' }),
    reverse: () => ui.worker.postMessage({ type: 'reverse' }),
    clear: () => ui.worker.postMessage({ type: 'clear' }),
    randomize: () => ui.worker.postMessage({ type: 'randomize' }),
    setFps: (val) => {
        document.getElementById('speed-range').value = val;
        document.getElementById('speed-label').innerText = `${val} FPS`;
        ui.worker.postMessage({ type: 'setFps', payload: val });
    },
    setZoom: (val) => {
        document.getElementById('zoom-label').innerText = `${val}px`;
        CONF.cellSize = parseInt(val);
        ui.resize();
    },
    rotate: () => {
        rotateCurrentPattern();
        document.querySelector('[data-mode="paste"]').click();
    },
    toggleSidebar: () => {
        document.getElementById('sidebar').classList.toggle('collapsed');
        setTimeout(() => ui.resize(), 350); 
    }
};

// Button Bindings
document.getElementById('panel-toggle').onclick = actions.toggleSidebar;
document.getElementById('btn-play').onclick = actions.togglePlay;
document.getElementById('btn-step').onclick = actions.step;
document.getElementById('btn-rev-step').onclick = actions.reverse;
document.getElementById('btn-clear').onclick = actions.clear;
document.getElementById('btn-rand').onclick = actions.randomize;

document.getElementById('speed-range').oninput = (e) => {
    actions.setFps(parseInt(e.target.value));
};

document.getElementById('zoom-range').oninput = (e) => {
    actions.setZoom(parseInt(e.target.value));
};

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

document.getElementById('btn-rotate').onclick = actions.rotate;

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
    const idx = ui.idx(x,y); // This is flat index (y * cols + x)

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

window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    switch(e.key) {
        case ' ': e.preventDefault(); actions.togglePlay(); break;
        case 'ArrowRight': actions.step(); break;
        case 'ArrowLeft': actions.reverse(); break;
        case 'c': case 'C': actions.clear(); break;
        case 'r': case 'R': actions.rotate(); break;
        case '[': {
            const current = parseInt(document.getElementById('speed-range').value);
            actions.setFps(Math.max(1, current - 5));
        } break;
        case ']': {
            const current = parseInt(document.getElementById('speed-range').value);
            actions.setFps(Math.min(60, current + 5));
        } break;
        case '/': if (e.ctrlKey) toggleHelp(); break;
        case 'Escape': document.getElementById('help-modal').classList.remove('show'); break;
        case 'Tab': e.preventDefault(); actions.toggleSidebar(); break;
    }
});

function toggleHelp() {
    document.getElementById('help-modal').classList.toggle('show');
}

const toast = (txt, isError = false) => {
    const el = document.getElementById('msg');
    el.innerText = txt;
    el.style.borderColor = isError ? CONF.error : CONF.liveColor;
    el.style.opacity = 1;
    setTimeout(() => el.style.opacity = 0, 2000);
};

// Storage Logic
document.getElementById('btn-save').onclick = () => {
    const name = document.getElementById('save-name').value || 'Untitled';
    if (!ui.lastGrid) return;
    
    const state = {
        timestamp: Date.now(),
        w: ui.cols,
        h: ui.rows,
        packed: true,
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

        let bufferToSend;

        // Check if data is packed (Uint32) or legacy (Uint8)
        if (state.packed) {
            // Exact match on dimensions?
            if (state.w === ui.cols && state.h === ui.rows) {
                bufferToSend = new Uint32Array(state.data);
            } else {
                // Harder to resize packed data on the fly in UI.
                // For now, we just fail or reset.
                // Or we can implement a basic resize here.
                toast("Dim Mismatch", true);
                return;
            }
        } else {
            // Legacy import (unpacked 0/1)
            // We must pack it before sending to worker
            // Or implement logic to pack.
            // Since we don't want to duplicate packing logic, let's just send 
            // a message to worker saying "loadLegacy"?
            // But worker expects Uint32Array.
            
            // Let's implement a simple packer here for compatibility
            const stride = Math.ceil(state.w / 32);
            const packed = new Uint32Array(stride * state.h);
            
            for(let i=0; i<state.data.length; i++) {
                if(state.data[i]) {
                    const x = i % state.w;
                    const y = Math.floor(i / state.w);
                    
                    // Handle resize/centering if needed
                    // For now assume direct mapping or center
                    const destX = x + Math.floor((ui.cols - state.w)/2);
                    const destY = y + Math.floor((ui.rows - state.h)/2);
                    
                    if (destX >= 0 && destX < ui.cols && destY >= 0 && destY < ui.rows) {
                         const destStride = Math.ceil(ui.cols / 32);
                         const wordIdx = destY * destStride + Math.floor(destX / 32);
                         const bit = destX % 32;
                         packed[wordIdx] |= (1 << bit);
                    }
                }
            }
            bufferToSend = packed;
        }
        
        ui.worker.postMessage({ 
            type: 'load', 
            payload: bufferToSend 
        });
        toast("Loaded");
    } catch (e) {
        console.error(e);
        toast("Load Failed", true);
    }
}
