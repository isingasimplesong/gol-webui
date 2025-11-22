/**
 * Worker Logic for Game of Life
 */
let cols = 0;
let rows = 0;
let grid = null;
let history = [];
const historyLimit = 200;
let running = false;
let generation = 0;
let fps = 30;
let timerID = null;

// Initialize
self.onmessage = function(e) {
    const { type, payload } = e.data;

    switch(type) {
        case 'init':
            cols = payload.cols;
            rows = payload.rows;
            grid = new Uint8Array(cols * rows);
            history = [];
            // If initial data provided (e.g. reload/resize), use it
            if (payload.initialData) {
                grid.set(payload.initialData);
            } else {
                randomize(); // Default start
            }
            sendUpdate();
            break;
            
        case 'resize':
             // Resize logic: strictly reset for now, or complex mapping
             // To keep it simple and robust in this refactor:
             cols = payload.cols;
             rows = payload.rows;
             grid = new Uint8Array(cols * rows);
             history = [];
             sendUpdate();
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
            running = false; // Manual step stops auto-play
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
            if (grid && payload.idx < grid.length) {
                grid[payload.idx] = payload.val;
                sendUpdate();
            }
            break;

        case 'setCells': // Bulk update (for paste)
             if (grid) {
                 const { updates } = payload; // array of {idx, val}
                 for(let u of updates) {
                     if(u.idx < grid.length) grid[u.idx] = u.val;
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
             // Payload is the full data array + dims
             // We assume dimensions are checked or matched in UI before sending,
             // OR we force resize to match load?
             // Let's assume UI handles resizing or mapping, sending us a clean grid buffer
             if (payload.length === grid.length) {
                 saveState();
                 grid.set(payload);
                 generation = 0; // or keep?
                 sendUpdate();
             }
             break;
             
        case 'export':
            // Request for current state
            self.postMessage({
                type: 'exportData',
                payload: {
                    w: cols,
                    h: rows,
                    data: grid // Zero-copy if possible, but here it clones
                }
            });
            break;
    }
};

function idx(x, y) {
    const cx = (x + cols) % cols;
    const cy = (y + rows) % rows;
    return cy * cols + cx;
}

function saveState() {
    if (history.length >= historyLimit) history.shift();
    history.push(grid.slice());
}

function step() {
    saveState();
    const next = new Uint8Array(cols * rows);
    let changes = false;

    // Optimized loop
    for (let y = 0; y < rows; y++) {
        const yRow = y * cols;
        const yPrev = ((y - 1 + rows) % rows) * cols;
        const yNext = ((y + 1) % rows) * cols;

        for (let x = 0; x < cols; x++) {
            const i = yRow + x;
            const state = grid[i];
            
            const xPrev = (x - 1 + cols) % cols;
            const xNext = (x + 1) % cols;

            const neighbors = 
                grid[yPrev + xPrev] + grid[yPrev + x] + grid[yPrev + xNext] +
                grid[yRow  + xPrev] +                     grid[yRow  + xNext] +
                grid[yNext + xPrev] + grid[yNext + x] + grid[yNext + xNext];

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
    for (let i = 0; i < grid.length; i++) {
        grid[i] = Math.random() > 0.85 ? 1 : 0;
    }
    generation = 0;
    history = [];
}

function sendUpdate() {
    // Count pop for stats
    let pop = 0;
    for(let i=0; i<grid.length; i++) if(grid[i]===1) pop++;
    
    self.postMessage({
        type: 'update',
        payload: {
            grid: grid, // Structured clone algorithm handles this efficiently enough
            generation: generation,
            pop: pop,
            running: running
        }
    });
}

function loop() {
    if (!running) return;
    const start = performance.now();
    
    step();
    
    // Self-adjusting timer to target FPS
    const end = performance.now();
    const elapsed = end - start;
    const targetInterval = 1000 / fps;
    const delay = Math.max(0, targetInterval - elapsed);
    
    timerID = setTimeout(loop, delay);
}
