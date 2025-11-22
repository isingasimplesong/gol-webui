/**
 * Worker Logic for Game of Life
 * Phase 3: Bitwise Optimization (Uint32Array)
 */

// State
let cols = 0;
let rows = 0;
let stride = 0; // 32-bit words per row
let grid = null; // Uint32Array
let history = [];
const historyLimit = 500; // Increased limit due to 8x memory savings
let running = false;
let generation = 0;
let fps = 30;
let timerID = null;

// Initialize
self.onmessage = function(e) {
    const { type, payload } = e.data;

    switch(type) {
        case 'init':
            init(payload.cols, payload.rows, payload.initialData);
            break;
            
        case 'resize':
             // Full reset on resize for simplicity
             init(payload.cols, payload.rows);
             break;

        case 'start':
            if (!running) {
                running = true;
                loop();
            }
            break;

        case 'stop':
            running = false;
            if (timerID) clearTimeout(timerID);
            break;

        case 'step':
            running = false;
            step();
            break;
            
        case 'reverse':
            running = false;
            reverse();
            break;

        case 'setFps':
            fps = payload;
            break;

        case 'setCell':
            if (grid) {
                setCell(payload.idx, payload.val);
                sendUpdate();
            }
            break;

        case 'setCells': // Bulk update
             if (grid && payload.updates) {
                 for(let u of payload.updates) {
                     setCell(u.idx, u.val);
                 }
                 sendUpdate();
             }
             break;

        case 'clear':
            saveState();
            grid.fill(0);
            generation = 0;
            running = false;
            sendUpdate();
            break;

        case 'randomize':
            randomize();
            sendUpdate();
            break;
            
        case 'load':
             if (payload.length === grid.length) {
                 saveState();
                 grid.set(payload);
                 generation = 0;
                 sendUpdate();
             }
             break;
             
        case 'export':
             // For export, we might want to expand to Uint8 for compatibility 
             // or keep compact. Let's keep compact but provide metadata.
            self.postMessage({
                type: 'exportData',
                payload: {
                    w: cols,
                    h: rows,
                    data: grid, // Uint32Array
                    packed: true
                }
            });
            break;
    }
};

function init(w, h, initialData) {
    cols = w;
    rows = h;
    // Calculate stride (width in 32-bit words)
    stride = Math.ceil(cols / 32);
    
    grid = new Uint32Array(stride * rows);
    history = [];
    
    if (initialData) {
        // If loading raw Uint8 data (from old save/resize), we need to pack it
        // If loading Uint32 (packed), set directly
        if (initialData instanceof Uint32Array && initialData.length === grid.length) {
            grid.set(initialData);
        } else {
            // Assume legacy/unpacked data or randomize
            randomize(); 
        }
    } else {
        randomize();
    }
    sendUpdate();
}

// --- Bitwise Helpers ---

// Convert 1D index (from UI usually based on x,y) to (x,y)
// Note: UI sends 'idx' as standard integer index (y * cols + x).
// We need to handle that.
function setCell(flatIdx, val) {
    const x = flatIdx % cols;
    const y = Math.floor(flatIdx / cols);
    
    const wordIdx = y * stride + Math.floor(x / 32);
    const bitIdx = x % 32;
    
    if (val) {
        grid[wordIdx] |= (1 << bitIdx);
    } else {
        grid[wordIdx] &= ~(1 << bitIdx);
    }
}

function getCell(x, y) {
    // Wrap coordinates
    const wx = (x + cols) % cols;
    const wy = (y + rows) % rows;
    
    const wordIdx = wy * stride + Math.floor(wx / 32);
    const bitIdx = wx % 32;
    
    return (grid[wordIdx] >>> bitIdx) & 1;
}

function saveState() {
    if (history.length >= historyLimit) history.shift();
    // Uint32Array slice is efficient
    history.push(grid.slice());
}

function step() {
    saveState();
    const next = new Uint32Array(grid.length);
    
    // Optimization: Access raw buffer for write
    // For now, we stick to per-cell logic but using bit access.
    // TODO: Phase 4 - Implement full bitwise row operations (SWAR)
    
    let changes = false;

    // We still iterate x,y. 
    // This is slower than Uint8Array step due to bit shifts, 
    // BUT we save massive bandwidth on postMessage.
    // Future optimization: Implement 32-cell parallel logic.
    
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            
            // Current State
            const wordIdx = y * stride + (x >>> 5); // x / 32
            const bitIdx = x & 31;                  // x % 32
            const state = (grid[wordIdx] >>> bitIdx) & 1;
            
            // Neighbors
            // We use getCell which handles wrapping
            let neighbors = 0;
            neighbors += getCell(x - 1, y - 1);
            neighbors += getCell(x,     y - 1);
            neighbors += getCell(x + 1, y - 1);
            neighbors += getCell(x - 1, y);
            neighbors += getCell(x + 1, y);
            neighbors += getCell(x - 1, y + 1);
            neighbors += getCell(x,     y + 1);
            neighbors += getCell(x + 1, y + 1);

            let newState = state;
            if (state === 1 && (neighbors < 2 || neighbors > 3)) {
                newState = 0;
                changes = true;
            } else if (state === 0 && neighbors === 3) {
                newState = 1;
                changes = true;
            }
            
            if (newState) {
                next[wordIdx] |= (1 << bitIdx);
            }
        }
    }

    grid = next;
    generation++;
    sendUpdate();
}

function reverse() {
    if (history.length > 0) {
        grid = history.pop();
        generation--;
        sendUpdate();
    }
}

function randomize() {
    saveState();
    grid.fill(0);
    // Randomize 32 bits at a time
    for (let i = 0; i < grid.length; i++) {
        // Random 32-bit integer
        grid[i] = (Math.random() * 4294967296) | 0;
    }
    generation = 0;
    history = [];
}

function sendUpdate() {
    // Count pop
    let pop = 0;
    for(let i=0; i<grid.length; i++) {
        let n = grid[i];
        // Kernighan's algorithm for bit counting
        while (n > 0) {
            n &= (n - 1);
            pop++;
        }
    }
    
    // Send a COPY of the grid, but use Transferable to move the copy efficiently
    // We cannot transfer 'grid' itself because we need it for the next step.
    const displayGrid = grid.slice(); 
    
    self.postMessage({
        type: 'update',
        payload: {
            grid: displayGrid, 
            generation: generation,
            pop: pop,
            running: running,
            packed: true // Signal to UI that this is Uint32Array
        }
    }, [displayGrid.buffer]); // Transfer ownership of the copy
}

function loop() {
    if (!running) return;
    const start = performance.now();
    step();
    const end = performance.now();
    const elapsed = end - start;
    const targetInterval = 1000 / fps;
    const delay = Math.max(0, targetInterval - elapsed);
    
    // Use setTimeout for consistent loop, or requestAnimationFrame logic if in worker?
    // setTimeout is fine for worker.
    timerID = setTimeout(loop, delay);
}
