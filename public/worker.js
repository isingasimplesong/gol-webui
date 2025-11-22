/**
 * Worker Logic for Game of Life
 * Phase 3: Bitwise Optimization (Uint32Array) + SWAR Parallelism
 */

// State
let cols = 0;
let rows = 0;
let stride = 0; // 32-bit words per row
let grid = null; // Uint32Array
let history = [];
const historyLimit = 500; 
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
            sendUpdate();
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
        case 'setCells':
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
            self.postMessage({
                type: 'exportData',
                payload: {
                    w: cols,
                    h: rows,
                    data: grid,
                    packed: true
                }
            });
            break;
    }
};

function init(w, h, initialData) {
    cols = w;
    rows = h;
    stride = Math.ceil(cols / 32);
    grid = new Uint32Array(stride * rows);
    history = [];
    
    if (initialData) {
        if (initialData instanceof Uint32Array && initialData.length === grid.length) {
            grid.set(initialData);
        } else {
            randomize(); 
        }
    } else {
        randomize();
    }
    sendUpdate();
}

function setCell(flatIdx, val) {
    const x = flatIdx % cols;
    const y = Math.floor(flatIdx / cols);
    const wordIdx = y * stride + Math.floor(x / 32);
    const bitIdx = x % 32;
    if (val) grid[wordIdx] |= (1 << bitIdx);
    else grid[wordIdx] &= ~(1 << bitIdx);
}

function saveState() {
    if (history.length >= historyLimit) history.shift();
    history.push(grid.slice());
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
        // Less dense: ~20% fill instead of 50%
        // Logic: Generate random number, AND it with a mask or threshold?
        // Simplest for 32-bit word: Just rely on JS Math.random per word? 
        // No, that's still uniform.
        // We want fewer bits set.
        
        // Method: Iterate bits? Slow.
        // Method: Construct word from sparse chunks?
        
        // Fast approximation for ~25% density:
        // R1 & R2 (where R is random 32-bit int) -> 25% bits set on average
        
        const r1 = (Math.random() * 4294967296) | 0;
        const r2 = (Math.random() * 4294967296) | 0;
        grid[i] = r1 & r2; 
        
        // For even less (12.5%), use r1 & r2 & r3. 
        // Let's stick to ~25% for a good balance.
    }
    generation = 0;
    history = [];
}

function sendUpdate() {
    let pop = 0;
    for(let i=0; i<grid.length; i++) {
        let n = grid[i];
        while (n > 0) { n &= (n - 1); pop++; }
    }
    const displayGrid = grid.slice(); 
    self.postMessage({
        type: 'update',
        payload: {
            grid: displayGrid, 
            generation: generation,
            pop: pop,
            running: running,
            packed: true
        }
    }, [displayGrid.buffer]);
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

/**
 * Bitwise Parallel Step (SWAR)
 * Calculates 32 cells simultaneously.
 */
function step() {
    saveState();
    const next = new Uint32Array(grid.length);
    
    // Pre-allocate vars to avoid GC? (Not strictly necessary in modern JS engines but good practice)
    
    for (let y = 0; y < rows; y++) {
        // Identify row indices with wrapping
        const yPrev = (y - 1 + rows) % rows;
        const yNext = (y + 1) % rows;
        
        const rowOffset = y * stride;
        const prevOffset = yPrev * stride;
        const nextOffset = yNext * stride;

        for (let i = 0; i < stride; i++) {
            // Column wrapping indices
            const iPrev = (i - 1 + stride) % stride;
            const iNext = (i + 1) % stride;

            // Fetch current 3x3 block of words
            // Center
            const C  = grid[rowOffset + i];
            const W_word = grid[rowOffset + iPrev];
            const E_word = grid[rowOffset + iNext];

            // Top
            const N  = grid[prevOffset + i];
            const NW_word = grid[prevOffset + iPrev];
            const NE_word = grid[prevOffset + iNext];

            // Bottom
            const S  = grid[nextOffset + i];
            const SW_word = grid[nextOffset + iPrev];
            const SE_word = grid[nextOffset + iNext];

            // Calculate neighbors for the 32 bits in 'C'
            // For a bit at pos 'k', its west neighbor is bit 'k-1'. 
            // If k=0, it's bit 31 of the West word.
            
            // Shift logic to align neighbors to the center frame
            const shiftRight = (curr, left) => (curr << 1) | (left >>> 31);
            const shiftLeft  = (curr, right) => (curr >>> 1) | (right << 31);

            // Horizontal neighbors
            const w = shiftRight(C, W_word);
            const e = shiftLeft(C, E_word);
            
            // Vertical neighbors (already aligned)
            const n = N;
            const s = S;
            
            // Diagonal neighbors
            const nw = shiftRight(N, NW_word);
            const ne = shiftLeft(N, NE_word);
            const sw = shiftRight(S, SW_word);
            const se = shiftLeft(S, SE_word);

            // Sum the 8 neighbors using a bitwise adder tree
            // Inputs: w, e, n, s, nw, ne, sw, se
            
            // Layer 1: 8 inputs -> 4 sums (2 bits each: c, s)
            // Half Adders: s = a ^ b; c = a & b;
            
            // Pair 1: n, s
            const s0 = n ^ s; 
            const c0 = n & s;
            
            // Pair 2: w, e
            const s1 = w ^ e;
            const c1 = w & e;
            
            // Pair 3: nw, sw
            const s2 = nw ^ sw;
            const c2 = nw & sw;
            
            // Pair 4: ne, se
            const s3 = ne ^ se;
            const c3 = ne & se;
            
            // Layer 2: Add the four 2-bit numbers (c0,s0) + (c1,s1) + ...
            // This is getting complicated. Let's use a clearer 3-counter logic.
            // We need total sum S.
            // S = (n+s) + (w+e) + (nw+sw) + (ne+se)
            
            // Alternative: Full Adder logic
            // sum2 = a^b^c, carry = (a&b)|(b&c)|(c&a)
            
            // Let's sum s0..s3 (weight 1) and c0..c3 (weight 2)
            
            // Sum s0, s1, s2, s3 (1-bit inputs) -> result bits y1, y0
            // s01 = s0 ^ s1, c01 = s0 & s1
            // s23 = s2 ^ s3, c23 = s2 & s3
            // y0 = s01 ^ s23
            // carry_y = s01 & s23
            // y1 = c01 | c23 | carry_y
            
            const s01 = s0 ^ s1; 
            const c01 = s0 & s1;
            
            const s23 = s2 ^ s3;
            const c23 = s2 & s3;
            
            const sum1_0 = s01 ^ s23; // Bit 0 of sum of s-terms
            const carry_s = (s01 & s23) | c01 | c23; // Carry to bit 1
            
            // Now add the c-terms (weight 2)
            // c0, c1, c2, c3. Sum them -> z2, z1 (since they are weight 2, result is weight 4, 2)
            // But wait, we need to add them to the result of the s-terms.
            
            // Let's simply use the "Sideways Sum" method (efficient for limited depth)
            // Or just straight generic addition.
            
            // Current state:
            // We have sum of weight-1 inputs: `sum1_0` (bit 0), `carry_s` (bit 1)
            // We have 4 weight-2 inputs: c0, c1, c2, c3.
            
            // Let's sum c0, c1, c2, c3 similar to s-terms
            const c01_x = c0 ^ c1;
            const c01_a = c0 & c1; // carry to bit 2 (weight 4)
            
            const c23_x = c2 ^ c3;
            const c23_a = c2 & c3; // carry to bit 2 (weight 4)
            
            const sum2_0 = c01_x ^ c23_x; // bit 1 (weight 2)
            const carry_c = (c01_x & c23_x) | c01_a | c23_a; // bit 2 (weight 4)
            
            // Final Assembly:
            // We have:
            // Weight 1: sum1_0
            // Weight 2: carry_s, sum2_0
            // Weight 4: carry_c
            
            // Total = sum1_0 + (carry_s << 1) + (sum2_0 << 1) + (carry_c << 2)
            //       = sum1_0 + 2*(carry_s + sum2_0) + 4*carry_c
            
            // Bit 0 of total = sum1_0
            const total0 = sum1_0;
            
            // Bit 1 of total = (carry_s ^ sum2_0)
            // Carry from bit 1 = (carry_s & sum2_0)
            const total1 = carry_s ^ sum2_0;
            const carry_total1 = carry_s & sum2_0;
            
            // Bit 2 of total = carry_c + carry_total1
            // We assume sum <= 8, so bit 3 is only set if sum=8 (1000)
            const total2 = carry_c ^ carry_total1;
            
            // Bit 3 = carry_c & carry_total1 (only 1 if sum=8)
            // We don't really need bit 3 because 8 is "die".
            // If sum=8 (1000), total0=0, total1=0, total2=0.
            // If sum=0 (0000), total0=0, total1=0, total2=0.
            // Collision handled.
            
            // Result Logic:
            // Alive if:
            // (C == 1) AND (Neighbors == 2 or 3)
            // (C == 0) AND (Neighbors == 3)
            
            // Neighbors == 2: (total2=0, total1=1, total0=0)
            // Neighbors == 3: (total2=0, total1=1, total0=1)
            
            // Combined: Neighbors is 2 or 3 IF (total2 == 0) AND (total1 == 1)
            // Then we check total0.
            
            // Logic:
            // Next = (total2 == 0) & (total1 == 1) & (total0 | C)
            
            const two_or_three = (~total2) & total1;
            
            next[rowOffset + i] = two_or_three & (total0 | C);
        }
    }
    grid = next;
    generation++;
    sendUpdate();
}
