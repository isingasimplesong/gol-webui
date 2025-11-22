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
        this.stride = 0; 
        this.lastGrid = null;
        
        // Viewport State
        this.viewX = 0;
        this.viewY = 0;
        
        // Worker
        this.worker = new Worker('worker.js');
        this.worker.onmessage = this.onWorkerMessage.bind(this);

        // State
        this.isRunning = false;
        this.mouse = { x: 0, y: 0, down: false, lastX: 0, lastY: 0 };
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
        
        // Update viewport size (preserve: true implied for init if not explicit, 
        // but here we use 'resize' type for safety if already running)
        if (this.worker) {
            this.worker.postMessage({ 
                type: 'resize', 
                payload: { cols: this.cols, rows: this.rows } 
            });
        }
    }

    onWorkerMessage(e) {
        const { type, payload } = e.data;
        if (type === 'update') {
            this.lastGrid = payload.grid;
            this.isRunning = payload.running;
            updateStats(payload.generation, payload.pop);
            updateBtnState(this.isRunning);
            this.draw(); 
        } else if (type === 'exportData') {
             this.handleExport(payload);
        }
    }

    idx(x, y) {
        // Viewport index
        if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return -1;
        return y * this.cols + x;
    }
    
    moveViewport(dx, dy) {
        this.viewX -= dx;
        this.viewY -= dy;
        this.worker.postMessage({
            type: 'viewportMove',
            payload: { x: Math.round(this.viewX), y: Math.round(this.viewY) }
        });
    }

    handleExport(data) {
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
        a.download = `gol_world_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast("Exported World");
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

        // The grid we receive IS the viewport. So we just draw it 1:1.
        for (let i = 0; i < this.lastGrid.length; i++) {
            const word = this.lastGrid[i];
            if (word === 0) continue; 

            const wordRow = Math.floor(i / this.stride); 
            const wordColStart = (i % this.stride) * 32; 

            for (let bit = 0; bit < 32; bit++) {
                if ((word >>> bit) & 1) {
                    const x = (wordColStart + bit) * CONF.cellSize;
                    const y = wordRow * CONF.cellSize;
                    
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
 * Interaction
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
    randomize: () => {
        const density = parseInt(document.getElementById('density-range').value) / 100;
        ui.worker.postMessage({ type: 'randomize', payload: density });
    },
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
    },
    recenter: () => {
        ui.viewX = 0;
        ui.viewY = 0;
        ui.worker.postMessage({
            type: 'viewportMove',
            payload: { x: 0, y: 0 }
        });
        toast("View Centered");
    },
    share: () => {
        const params = new URLSearchParams();
        params.set('x', Math.round(ui.viewX));
        params.set('y', Math.round(ui.viewY));
        params.set('z', CONF.cellSize);
        
        const url = `${window.location.origin}${window.location.pathname}#${params.toString()}`;
        window.history.replaceState(null, null, `#${params.toString()}`);
        
        navigator.clipboard.writeText(url).then(() => {
            toast("Link Copied! 🔗");
        }).catch(() => toast("Copy Failed", true));
    }
};

// Bindings
document.getElementById('panel-toggle').onclick = actions.toggleSidebar;
document.getElementById('btn-center').onclick = actions.recenter;
document.getElementById('btn-share').onclick = actions.share;
document.getElementById('btn-play').onclick = actions.togglePlay;
document.getElementById('btn-step').onclick = actions.step;
document.getElementById('btn-rev-step').onclick = actions.reverse;
document.getElementById('btn-clear').onclick = actions.clear;
document.getElementById('btn-rand').onclick = actions.randomize;

document.getElementById('speed-range').oninput = (e) => actions.setFps(parseInt(e.target.value));
document.getElementById('zoom-range').oninput = (e) => actions.setZoom(parseInt(e.target.value));
document.getElementById('density-range').oninput = (e) => {
    document.getElementById('density-label').innerText = `${e.target.value}%`;
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

// RLE Import Logic
const rleModal = document.getElementById('rle-modal');
const rleInput = document.getElementById('rle-input');

document.getElementById('btn-import-rle').onclick = () => {
    rleInput.value = '';
    rleModal.classList.add('show');
    rleInput.focus();
};

document.getElementById('btn-rle-cancel').onclick = () => {
    rleModal.classList.remove('show');
};

document.getElementById('btn-rle-load').onclick = () => {
    const code = rleInput.value;
    if (!code.trim()) return;

    try {
        const pattern = parseRLE(code);
        if (pattern.length === 0) throw new Error("No cells found");

        // Add to patterns and select it
        CURRENT_PATTERNS['imported'] = pattern;
        
        // Add option if not exists
        const select = document.getElementById('pattern-select');
        if (!select.querySelector('option[value="imported"]')) {
            const opt = document.createElement('option');
            opt.value = 'imported';
            opt.innerText = 'Imported / Custom';
            select.appendChild(opt);
        }
        select.value = 'imported';
        ui.selectedPattern = 'imported';
        
        // Switch to paste mode
        document.querySelector('[data-mode="paste"]').click();
        rleModal.classList.remove('show');
        toast("RLE Loaded - Click to Paste");
    } catch (e) {
        console.error(e);
        toast("Invalid RLE", true);
    }
};

function parseRLE(str) {
    const lines = str.split('\n');
    let data = '';
    
    // Strip headers/comments
    for (let line of lines) {
        line = line.trim();
        if (line.startsWith('#') || line.startsWith('x =')) continue;
        data += line;
    }

    const coords = [];
    let x = 0, y = 0;
    let count = 0;

    for (let i = 0; i < data.length; i++) {
        const char = data[i];
        
        if (char >= '0' && char <= '9') {
            count = count * 10 + parseInt(char);
        } else if (char === 'b') { // Dead cell
            x += (count || 1);
            count = 0;
        } else if (char === 'o') { // Live cell
            const run = count || 1;
            for (let k = 0; k < run; k++) {
                coords.push([x + k, y]);
            }
            x += run;
            count = 0;
        } else if (char === '$') { // Newline
            y += (count || 1);
            x = 0;
            count = 0;
        } else if (char === '!') { // End
            break;
        }
    }
    return coords;
}

// Init from URL
function initFromURL() {
    if (!window.location.hash) return;
    const params = new URLSearchParams(window.location.hash.substring(1));
    
    const x = parseInt(params.get('x'));
    const y = parseInt(params.get('y'));
    const z = parseInt(params.get('z'));

    if (!isNaN(z)) actions.setZoom(z);
    if (!isNaN(x) && !isNaN(y)) {
        ui.viewX = x;
        ui.viewY = y;
        // Delay slightly to ensure worker is ready, though postMessage buffer handles it
        ui.worker.postMessage({
            type: 'viewportMove',
            payload: { x, y }
        });
        toast(`Jumped to (${x}, ${y})`);
    }
}
initFromURL();

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    ui.mouse.x = x;
    ui.mouse.y = y;

    if (ui.mouse.down) {
        if (ui.mode === 'move') {
            const dx = (x - ui.mouse.lastX) / CONF.cellSize;
            const dy = (y - ui.mouse.lastY) / CONF.cellSize;
            ui.moveViewport(dx, dy);
        } else {
            applyTool();
        }
    }
    
    ui.mouse.lastX = x;
    ui.mouse.lastY = y;
});

canvas.addEventListener('mousedown', e => { 
    ui.mouse.down = true; 
    ui.mouse.lastX = ui.mouse.x;
    ui.mouse.lastY = ui.mouse.y;
    if (ui.mode !== 'move') applyTool(); 
});
window.addEventListener('mouseup', () => { ui.mouse.down = false; });

// Wheel Zoom
canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = Math.sign(e.deltaY) * -1;
    const range = document.getElementById('zoom-range');
    let val = parseInt(range.value) + delta;
    val = Math.max(range.min, Math.min(range.max, val));
    range.value = val;
    actions.setZoom(val);
}, { passive: false });

function applyTool() {
    const x = Math.floor(ui.mouse.x / CONF.cellSize);
    const y = Math.floor(ui.mouse.y / CONF.cellSize);
    const idx = ui.idx(x,y);

    if (idx === -1) return;

    if (ui.mode === 'draw') {
        ui.worker.postMessage({ type: 'setCell', payload: { idx, val: 1 }});
    } else if (ui.mode === 'erase') {
        ui.worker.postMessage({ type: 'setCell', payload: { idx, val: 0 }});
    } else if (ui.mode === 'paste' && ui.mouse.down) {
        const p = CURRENT_PATTERNS[ui.selectedPattern];
        const updates = [];
        for (let [px, py] of p) {
            const targetIdx = ui.idx(x + px, y + py);
            if (targetIdx !== -1) updates.push({ idx: targetIdx, val: 1 });
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
        case 'ArrowLeft': actions.reverse(); break; // Will do nothing for now
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

// IO
document.getElementById('btn-save').onclick = () => {
    const name = document.getElementById('save-name').value || 'Untitled';
    if (!ui.lastGrid) return;
    
    // Saving only viewport for LocalStorage (Simpler for now)
    // or we could ask worker to export full world?
    // Let's just save viewport for browser storage to keep it fast.
    const state = {
        timestamp: Date.now(),
        w: ui.cols,
        h: ui.rows,
        packed: true,
        data: Array.from(ui.lastGrid)
    };
    try {
        localStorage.setItem('gol_' + name, JSON.stringify(state));
        toast(`Saved View "${name}"`);
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

        // We send raw data to worker, it handles placement
        ui.worker.postMessage({ 
            type: 'load', 
            payload: state 
        });
        toast("Loaded");
    } catch (e) {
        console.error(e);
        toast("Load Failed", true);
    }
}
