/**
 * Worker Logic for Game of Life
 * Phase 4: Infinite Grid (Sparse Chunking) + SWAR
 */

// Configuration
const CHUNK_SIZE = 32; // Width/Height of a chunk (matches 32-bit integer)
const BITS = 32;

// State
let chunks = new Map(); // Key: "cx,cy", Value: Uint32Array(32)
let nextChunks = new Map(); // Double buffering for step

// Viewport State (What the user sees)
let viewX = 0;
let viewY = 0;
let viewW = 0; // In cells
let viewH = 0; // In cells

let running = false;
let generation = 0;
let fps = 30;
let timerID = null;

// History (ring buffer)
let historyEnabled = false;
let historyMaxSize = 20;
let history = []; // Array of {chunks: Map, generation: number}

// Age tracking (optional, for visualization)
let ageTrackingEnabled = false;
let cellAges = new Map(); // Key: "x,y", Value: age (generations alive)

// Initialize
self.onmessage = function(e) {
    const { type, payload } = e.data;

    switch(type) {
        case 'init':
            // Payload is viewport dimensions now
            viewW = payload.cols;
            viewH = payload.rows;
            // If first run, seed with interesting default pattern
            if (chunks.size === 0 && !payload.preserve) {
                seedDefaultPattern();
            }
            sendUpdate();
            break;
            
        case 'resize':
             viewW = payload.cols;
             viewH = payload.rows;
             sendUpdate();
             break;
             
        case 'viewportMove':
             viewX = payload.x;
             viewY = payload.y;
             sendUpdate(); // Just re-render viewport
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
            sendUpdate();
            break;

        case 'step':
            running = false;
            if (timerID) clearTimeout(timerID);
            step();
            break;
            
        case 'reverse':
            running = false;
            if (timerID) clearTimeout(timerID);
            if (popHistory()) {
                sendUpdate();
            }
            break;

        case 'setFps':
            fps = payload;
            break;

        case 'setHistory':
            historyEnabled = payload.enabled;
            historyMaxSize = payload.size || 20;
            if (!historyEnabled) {
                history = []; // Free memory
            }
            break;

        case 'setAgeTracking':
            ageTrackingEnabled = payload;
            if (!ageTrackingEnabled) {
                cellAges.clear(); // Free memory
            } else {
                // Initialize ages for existing cells
                initializeAges();
            }
            sendUpdate();
            break;

        case 'setCell':
            // Payload: global absolute idx? Or relative to view?
            // Let's assume UI sends global coordinates now, or we assume UI sends view-relative idx
            // UI sends 'idx' which is flat view index. We convert to global.
            {
                const vx = payload.idx % viewW;
                const vy = Math.floor(payload.idx / viewW);
                setCell(viewX + vx, viewY + vy, payload.val);
                sendUpdate();
            }
            break;

        case 'setCells':
             // Bulk update relative to viewport or global?
             // Let's handle view-relative for paste
             if (payload.updates) {
                 for(let u of payload.updates) {
                     const vx = u.idx % viewW;
                     const vy = Math.floor(u.idx / viewW);
                     setCell(viewX + vx, viewY + vy, u.val);
                 }
                 sendUpdate();
             }
             break;

        case 'clear':
            chunks.clear();
            generation = 0;
            history = [];
            running = false;
            sendUpdate();
            break;

        case 'randomize':
            // Randomize only visible area? Or a fixed area?
            // Infinite random is impossible.
            // Let's randomize the current viewport.
            history = [];
            randomize(payload, true);
            sendUpdate();
            break;
            
        case 'load':
             // Complex: Loading a file into infinite grid.
             // We'll just load it at (0,0) or center of view?
             // For now, clear and load at (0,0).
             chunks.clear();
             if (payload.packed) {
                 // Legacy/Previous format was flat array.
                 // We need to migrate load logic.
                 // Assuming payload.data is the Uint32Array and payload.w/h
                 loadFlatData(payload.data, payload.w, payload.h);
             }
             generation = 0;
             sendUpdate();
             break;
             
        case 'export':
            // Export only active chunks? Or viewport?
            // Let's export active bounding box.
            exportWorld();
            break;
    }
};

// --- Chunk Management ---

function getChunkKey(cx, cy) {
    return `${cx},${cy}`;
}

function getChunk(cx, cy, create = false) {
    const key = getChunkKey(cx, cy);
    let chunk = chunks.get(key);
    if (!chunk && create) {
        chunk = new Uint32Array(CHUNK_SIZE);
        chunks.set(key, chunk);
    }
    return chunk;
}

function setCell(x, y, val) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const lx = (x % CHUNK_SIZE + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = (y % CHUNK_SIZE + CHUNK_SIZE) % CHUNK_SIZE;
    
    const chunk = getChunk(cx, cy, !!val); // Only create if setting to 1
    if (!chunk) return; // Setting 0 on non-existent chunk -> ignore
    
    if (val) {
        chunk[ly] |= (1 << lx);
    } else {
        chunk[ly] &= ~(1 << lx);
        // TODO: Check if chunk is empty and delete?
    }
}

function getCell(x, y) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const lx = (x % CHUNK_SIZE + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = (y % CHUNK_SIZE + CHUNK_SIZE) % CHUNK_SIZE;
    
    const chunk = chunks.get(getChunkKey(cx, cy));
    if (!chunk) return 0;
    
    return (chunk[ly] >>> lx) & 1;
}

function loadFlatData(data, w, h) {
    // Load a flat Uint32Array (stride = w/32) into chunks
    // We assume (0,0) is top-left of this data
    const stride = Math.ceil(w / 32);
    for(let i=0; i<data.length; i++) {
        const word = data[i];
        if (word === 0) continue;
        
        const row = Math.floor(i / stride);
        const colStart = (i % stride) * 32;
        
        for(let b=0; b<32; b++) {
            if ((word >>> b) & 1) {
                setCell(colStart + b, row, 1);
            }
        }
    }
}

function randomize(density = 0.25, viewportOnly = false) {
    if (viewportOnly) {
        // Randomize viewW * viewH cells starting at viewX, viewY
        for (let y = 0; y < viewH; y++) {
            for (let x = 0; x < viewW; x++) {
                 if (Math.random() < density) {
                     setCell(viewX + x, viewY + y, 1);
                 } else {
                     setCell(viewX + x, viewY + y, 0);
                 }
            }
        }
    }
}

// Default pattern: Gosper glider gun + some oscillators
function seedDefaultPattern() {
    // Gosper glider gun (classic, fires gliders SE)
    const gosper = [
        [1,5],[1,6],[2,5],[2,6],  // Left block
        [11,5],[11,6],[11,7],[12,4],[12,8],[13,3],[13,9],[14,3],[14,9],
        [15,6],[16,4],[16,8],[17,5],[17,6],[17,7],[18,6],
        [21,3],[21,4],[21,5],[22,3],[22,4],[22,5],[23,2],[23,6],
        [25,1],[25,2],[25,6],[25,7],
        [35,3],[35,4],[36,3],[36,4]  // Right block
    ];
    
    // Place gun at center-ish of viewport
    const ox = 5;
    const oy = 5;
    for (let [x, y] of gosper) {
        setCell(ox + x, oy + y, 1);
    }
    
    // Add a pulsar (period-3 oscillator) offset to the right
    const pulsar = [
        [2,4],[2,5],[2,6],[2,10],[2,11],[2,12],
        [4,2],[4,7],[4,9],[4,14],
        [5,2],[5,7],[5,9],[5,14],
        [6,2],[6,7],[6,9],[6,14],
        [7,4],[7,5],[7,6],[7,10],[7,11],[7,12],
        [9,4],[9,5],[9,6],[9,10],[9,11],[9,12],
        [10,2],[10,7],[10,9],[10,14],
        [11,2],[11,7],[11,9],[11,14],
        [12,2],[12,7],[12,9],[12,14],
        [14,4],[14,5],[14,6],[14,10],[14,11],[14,12]
    ];
    
    const px = 50;
    const py = 20;
    for (let [x, y] of pulsar) {
        setCell(px + x, py + y, 1);
    }
    
    // Add a pentadecathlon (period-15) below
    const pentadecathlon = [
        [0,1],[1,0],[1,2],[2,0],[2,2],[3,1],[4,1],[5,1],[6,1],
        [7,0],[7,2],[8,0],[8,2],[9,1]
    ];
    
    const pdx = 20;
    const pdy = 30;
    for (let [x, y] of pentadecathlon) {
        setCell(pdx + x, pdy + y, 1);
    }
}

function exportWorld() {
    // 1. Find bounding box by scanning all live cells
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const liveCells = [];
    
    for (let [key, chunk] of chunks) {
        const [cx, cy] = key.split(',').map(Number);
        const x0 = cx * CHUNK_SIZE;
        const y0 = cy * CHUNK_SIZE;
        
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
            const word = chunk[ly];
            if (word === 0) continue;
            
            for (let lx = 0; lx < 32; lx++) {
                if ((word >>> lx) & 1) {
                    const gx = x0 + lx;
                    const gy = y0 + ly;
                    liveCells.push([gx, gy]);
                    minX = Math.min(minX, gx);
                    maxX = Math.max(maxX, gx);
                    minY = Math.min(minY, gy);
                    maxY = Math.max(maxY, gy);
                }
            }
        }
    }
    
    if (liveCells.length === 0) return;
    
    // 2. Normalize to (0,0) origin
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    
    // Build a grid for RLE encoding
    const grid = new Array(h).fill(null).map(() => new Array(w).fill(false));
    for (let [x, y] of liveCells) {
        grid[y - minY][x - minX] = true;
    }
    
    // 3. Generate RLE
    let rle = `#C Exported from Life Engine\nx = ${w}, y = ${h}, rule = B3/S23\n`;
    
    for (let y = 0; y < h; y++) {
        let x = 0;
        let rowRle = '';
        
        while (x < w) {
            const alive = grid[y][x];
            let count = 1;
            
            // Count run length
            while (x + count < w && grid[y][x + count] === alive) {
                count++;
            }
            
            // Skip trailing dead cells
            if (!alive && x + count >= w) {
                break;
            }
            
            const char = alive ? 'o' : 'b';
            rowRle += (count > 1 ? count : '') + char;
            x += count;
        }
        
        // End of row: $ or ! for last row
        if (y < h - 1) {
            rle += rowRle + '$';
        } else {
            rle += rowRle + '!';
        }
        
        // Line wrap for readability (every ~70 chars)
        if (rle.length > 70 && y < h - 1) {
            rle += '\n';
        }
    }
    
    self.postMessage({
        type: 'exportData',
        payload: { rle, w, h }
    });
}

// --- History Management ---

function cloneChunks() {
    const copy = new Map();
    for (let [key, chunk] of chunks) {
        copy.set(key, new Uint32Array(chunk));
    }
    return copy;
}

function pushHistory() {
    if (!historyEnabled) return;
    
    history.push({
        chunks: cloneChunks(),
        generation: generation
    });
    
    // Ring buffer: trim oldest if over limit
    if (history.length > historyMaxSize) {
        history.shift();
    }
}

function popHistory() {
    if (!historyEnabled || history.length === 0) return false;
    
    const state = history.pop();
    chunks = state.chunks;
    generation = state.generation;
    return true;
}

// --- Simulation ---

function step() {
    pushHistory();
    nextChunks = new Map();
    
    // Set of keys to process: All active chunks + their neighbors
    const toProcess = new Set();
    
    for (let [key] of chunks) {
        const [cx, cy] = key.split(',').map(Number);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                toProcess.add(getChunkKey(cx + dx, cy + dy));
            }
        }
    }
    
    for (let key of toProcess) {
        const [cx, cy] = key.split(',').map(Number);
        
        // Get 3x3 neighborhood of chunks
        // We need access to rows above/below and bits left/right.
        // Since chunks are 32-wide, "bits left/right" means neighbor chunks.
        
        // Optimization: Only strictly need neighbor chunks if cells are on edge?
        // SWAR is row-based.
        // To compute next state of Chunk(cx, cy), we need:
        // - Chunk(cx, cy-1) (Bottom row)
        // - Chunk(cx, cy+1) (Top row)
        // - Chunk(cx-1, cy) (Right col)
        // - Chunk(cx+1, cy) (Left col)
        //And diagonals.
        
        // Wait, if Chunk(cx, cy) is empty, can it become alive?
        // Only if neighbors have life.
        // If we are processing 'key' because it's in 'toProcess', it means a neighbor (or self) has life.
        
        const C = chunks.get(getChunkKey(cx, cy)) || new Uint32Array(CHUNK_SIZE);
        const N = chunks.get(getChunkKey(cx, cy - 1));
        const S = chunks.get(getChunkKey(cx, cy + 1));
        const W = chunks.get(getChunkKey(cx - 1, cy));
        const E = chunks.get(getChunkKey(cx + 1, cy));
        
        // Diagonals (needed for corner bits)
        const NW = chunks.get(getChunkKey(cx - 1, cy - 1));
        const NE = chunks.get(getChunkKey(cx + 1, cy - 1));
        const SW = chunks.get(getChunkKey(cx - 1, cy + 1));
        const SE = chunks.get(getChunkKey(cx + 1, cy + 1));
        
        // If all are missing/empty, skip
        // (Optimization check omitted for brevity, but `toProcess` logic handles most)
        
        const nextChunk = new Uint32Array(CHUNK_SIZE);
        let active = false;
        
        // Iterate Rows in Chunk
        for (let y = 0; y < CHUNK_SIZE; y++) {
            // Current Word
            const c_row = C[y];
            
            // North Row
            let n_row;
            if (y > 0) n_row = C[y - 1];
            else n_row = N ? N[CHUNK_SIZE - 1] : 0;
            
            // South Row
            let s_row;
            if (y < CHUNK_SIZE - 1) s_row = C[y + 1];
            else s_row = S ? S[0] : 0;
            
            // For East/West neighbors, we need the bits from adjacent chunks
            
            // West Word (Left side)
            const w_chunk_row = W ? W[y] : 0;
            // We need bit 31 of w_chunk_row to be bit -1 of our row.
            
            // East Word (Right side)
            const e_chunk_row = E ? E[y] : 0;
            // We need bit 0 of e_chunk_row to be bit 32 of our row.
            
            // Build neighbor vectors
            // center: c_row
            
            // shiftRight(curr, left_neighbor_word)
            const shiftRight = (curr, left) => (curr << 1) | (left >>> 31);
            const shiftLeft  = (curr, right) => (curr >>> 1) | (right << 31);
            
            const w = shiftRight(c_row, w_chunk_row);
            const e = shiftLeft(c_row, e_chunk_row);
            
            // North Neighbors
            // We need the north row's west/east bits too!
            // That's why we fetched NW/NE chunks.
            let n_w_word, n_e_word;
            if (y > 0) {
                n_w_word = W ? W[y - 1] : 0;
                n_e_word = E ? E[y - 1] : 0;
            } else {
                n_w_word = NW ? NW[CHUNK_SIZE - 1] : 0;
                n_e_word = NE ? NE[CHUNK_SIZE - 1] : 0;
            }
            const n = n_row;
            const nw = shiftRight(n_row, n_w_word);
            const ne = shiftLeft(n_row, n_e_word);
            
            // South Neighbors
            let s_w_word, s_e_word;
            if (y < CHUNK_SIZE - 1) {
                s_w_word = W ? W[y + 1] : 0;
                s_e_word = E ? E[y + 1] : 0;
            } else {
                s_w_word = SW ? SW[0] : 0;
                s_e_word = SE ? SE[0] : 0;
            }
            const s = s_row;
            const sw = shiftRight(s_row, s_w_word);
            const se = shiftLeft(s_row, s_e_word);
            
            // SWAR Logic (Copy-pasted from previous efficient implementation)
            const s0 = n ^ s; const c0 = n & s;
            const s1 = w ^ e; const c1 = w & e;
            const s2 = nw ^ sw; const c2 = nw & sw;
            const s3 = ne ^ se; const c3 = ne & se;
            
            const s01 = s0 ^ s1; const c01 = s0 & s1;
            const s23 = s2 ^ s3; const c23 = s2 & s3;
            const total0 = s01 ^ s23; 
            const carry_s_raw = s01 & s23;

            // Sum Group A (carries from bit 0 stage)
            const sum_A = c01 ^ c23 ^ carry_s_raw;
            const carry_A = (c01 & c23) | (c01 & carry_s_raw) | (c23 & carry_s_raw);

            // Sum Group B (carries from input stage)
            const c01_x = c0 ^ c1; const c01_a = c0 & c1;
            const c23_x = c2 ^ c3; const c23_a = c2 & c3;
            const sum_B = c01_x ^ c23_x;
            const carry_B = (c01_x & c23_x) | c01_a | c23_a;

            // Final Sums
            const total1 = sum_A ^ sum_B;
            const carry_AB = sum_A & sum_B;
            const total2 = carry_A ^ carry_B ^ carry_AB;
            
            const two_or_three = (~total2) & total1;

            const nextState = two_or_three & (total0 | c_row);
            
            if (nextState !== 0) active = true;
            nextChunk[y] = nextState;
        }
        
        if (active) {
            nextChunks.set(key, nextChunk);
        }
    }
    
    // Update ages if tracking enabled
    if (ageTrackingEnabled) {
        updateAges(nextChunks);
    }
    
    chunks = nextChunks;
    generation++;
    sendUpdate();
}

// Age tracking functions
function initializeAges() {
    cellAges.clear();
    for (let [key, chunk] of chunks) {
        const [cx, cy] = key.split(',').map(Number);
        const x0 = cx * CHUNK_SIZE;
        const y0 = cy * CHUNK_SIZE;
        
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
            const word = chunk[ly];
            if (word === 0) continue;
            for (let lx = 0; lx < 32; lx++) {
                if ((word >>> lx) & 1) {
                    cellAges.set(`${x0 + lx},${y0 + ly}`, 1);
                }
            }
        }
    }
}

function updateAges(newChunks) {
    const newAges = new Map();
    
    for (let [key, chunk] of newChunks) {
        const [cx, cy] = key.split(',').map(Number);
        const x0 = cx * CHUNK_SIZE;
        const y0 = cy * CHUNK_SIZE;
        
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
            const word = chunk[ly];
            if (word === 0) continue;
            for (let lx = 0; lx < 32; lx++) {
                if ((word >>> lx) & 1) {
                    const cellKey = `${x0 + lx},${y0 + ly}`;
                    const oldAge = cellAges.get(cellKey) || 0;
                    newAges.set(cellKey, oldAge + 1);
                }
            }
        }
    }
    
    cellAges = newAges;
}

function sendUpdate() {
    // Render Viewport to Uint32Array
    // viewW is width in cells.
    // stride = ceil(viewW / 32)
    const stride = Math.ceil(viewW / 32);
    const buffer = new Uint32Array(stride * viewH);
    let pop = 0;

    // We iterate the Viewport, not the chunks
    // For each row in viewport:
    //   Global Y = viewY + row
    //   Iterate cols... this is tricky with bit alignment.
    
    // Optimization:
    // Iterate chunks that intersect the viewport.
    // Copy relevant data to buffer.
    
    // 1. Identify visible chunks range
    const startCx = Math.floor(viewX / CHUNK_SIZE);
    const endCx = Math.floor((viewX + viewW) / CHUNK_SIZE);
    const startCy = Math.floor(viewY / CHUNK_SIZE);
    const endCy = Math.floor((viewY + viewH) / CHUNK_SIZE);
    
    for (let cy = startCy; cy <= endCy; cy++) {
        for (let cx = startCx; cx <= endCx; cx++) {
            const chunk = chunks.get(getChunkKey(cx, cy));
            if (!chunk) continue;
            
            // Calculate intersection
            // Global coords of chunk
            const chunkX = cx * CHUNK_SIZE;
            const chunkY = cy * CHUNK_SIZE;
            
            // Overlap with view
            const intersectX = Math.max(viewX, chunkX);
            const intersectY = Math.max(viewY, chunkY);
            const intersectW = Math.min(viewX + viewW, chunkX + CHUNK_SIZE) - intersectX;
            const intersectH = Math.min(viewY + viewH, chunkY + CHUNK_SIZE) - intersectY;
            
            if (intersectW <= 0 || intersectH <= 0) continue;
            
            // Copy loop
            for (let y = 0; y < intersectH; y++) {
                const globalY = intersectY + y;
                const srcY = globalY - chunkY; // 0..31
                const word = chunk[srcY];
                if (word === 0) continue;
                
                const destY = globalY - viewY;
                
                // We have a word at chunk-local srcY.
                // We need to copy bits from [intersectX..intersectX+intersectW]
                // srcX start = intersectX - chunkX; (0..31)
                
                const srcXStart = intersectX - chunkX;
                
                // We need to place these bits into buffer at destY
                // Buffer has 'stride' words per row.
                // Destination X start = intersectX - viewX;
                
                const destXStart = intersectX - viewX;
                
                // Bit-by-bit copy (slow but reliable for now)
                // TODO: Optimize with bit shifting/masking for bulk copy
                for (let k = 0; k < intersectW; k++) {
                    const bitPos = srcXStart + k;
                    if ((word >>> bitPos) & 1) {
                         pop++; // Stats
                         const targetX = destXStart + k;
                         const targetWordIdx = destY * stride + Math.floor(targetX / 32);
                         const targetBit = targetX % 32;
                         buffer[targetWordIdx] |= (1 << targetBit);
                    }
                }
            }
        }
    }
    
    // Also need total population?
    // The above loop only counts visible population.
    // To count total population, we need to iterate all chunks.
    // Let's just show Visible Population for now? Or iterate all chunks cheaply?
    // Let's iterate all chunks for stats.
    let totalPop = 0;
    for(let c of chunks.values()) {
        for(let w of c) {
             if(w) {
                 // Count set bits
                 let n = w;
                 while(n > 0) { n &= (n-1); totalPop++; }
             }
        }
    }

    // Build age buffer if age tracking enabled
    let ageBuffer = null;
    if (ageTrackingEnabled) {
        ageBuffer = new Uint8Array(viewW * viewH);
        for (let vy = 0; vy < viewH; vy++) {
            for (let vx = 0; vx < viewW; vx++) {
                const gx = viewX + vx;
                const gy = viewY + vy;
                const age = cellAges.get(`${gx},${gy}`) || 0;
                // Clamp to 255
                ageBuffer[vy * viewW + vx] = Math.min(age, 255);
            }
        }
    }

    const payload = {
        grid: buffer,
        generation: generation,
        pop: totalPop,
        running: running,
        packed: true
    };
    
    const transferables = [buffer.buffer];
    
    if (ageBuffer) {
        payload.ages = ageBuffer;
        transferables.push(ageBuffer.buffer);
    }

    self.postMessage({ type: 'update', payload }, transferables);
}

function loop() {
    if (!running) return;
    const start = performance.now();
    step();
    const end = performance.now();
    const elapsed = end - start;
    const targetInterval = 1000 / fps;
    const delay = Math.max(0, targetInterval - elapsed);
    timerID = setTimeout(loop, delay);
}
