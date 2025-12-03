/**
 * Worker Logic for Game of Life
 * Phase 4: Infinite Grid (Sparse Chunking) + SWAR
 * 
 * Import shared utilities from lib.js
 */
importScripts('lib.js');
const { parseRule: libParseRule, popcount32 } = Lib;

/**
 * COORDINATE SYSTEMS:
 * 
 * 1. Viewport Coordinates (vx, vy)
 *    - Range: [0, viewW) x [0, viewH)
 *    - Origin: top-left of visible canvas area
 *    - Used for: UI interactions, render buffer indexing
 * 
 * 2. Global Coordinates (x, y)
 *    - Range: Z x Z (infinite integer grid)
 *    - Origin: (0, 0) is world center
 *    - Used for: cell storage, pattern placement
 * 
 * 3. Chunk Coordinates (cx, cy)
 *    - Derived: cx = floor(x / CHUNK_SIZE), cy = floor(y / CHUNK_SIZE)
 *    - Key format: "cx,cy" string
 *    - Used for: sparse Map indexing
 * 
 * 4. Local Coordinates (lx, ly)
 *    - Range: [0, CHUNK_SIZE) x [0, CHUNK_SIZE)
 *    - Derived: lx = x mod CHUNK_SIZE, ly = y mod CHUNK_SIZE
 *    - Used for: bit/row indexing within a chunk
 * 
 * TRANSFORMS:
 *    Viewport -> Global:  (x, y) = (viewX + vx, viewY + vy)
 *    Global -> Chunk:     (cx, cy) = (floor(x/32), floor(y/32))
 *    Global -> Local:     (lx, ly) = (x mod 32, y mod 32) with negative handling
 *    Chunk+Local -> Global: (x, y) = (cx * 32 + lx, cy * 32 + ly)
 * 
 * CHUNK STORAGE:
 *    Each chunk is Uint32Array(32), where:
 *    - chunk[ly] is a 32-bit word representing row ly
 *    - Bit lx of chunk[ly] represents cell at local (lx, ly)
 *    - Bit 0 is leftmost, bit 31 is rightmost
 */

// Configuration
const CONFIG = {
    CHUNK_SIZE: 32,      // Width/Height of a chunk (matches 32-bit integer)
    BITS_PER_WORD: 32,   // Bits per Uint32 word
    FPS_MIN: 1,
    FPS_MAX: 60,
    FPS_DEFAULT: 30,
    HISTORY_MIN: 5,
    HISTORY_MAX: 100,
    HISTORY_DEFAULT: 20,
    HEATMAP_BOOST: 5,    // Activity increment per state change
};

// Cellular Automaton Rules (Life-like: B.../S...)
// Default: Conway's Game of Life (B3/S23)
let birthRule = [false, false, false, true, false, false, false, false, false]; // B3
let survivalRule = [false, false, true, true, false, false, false, false, false]; // S23
let currentRuleString = 'B3/S23';

// Rule presets
const RULE_PRESETS = {
    'B3/S23': { name: 'Conway Life', birth: [3], survival: [2, 3] },
    'B36/S23': { name: 'HighLife', birth: [3, 6], survival: [2, 3] },
    'B2/S': { name: 'Seeds', birth: [2], survival: [] },
    'B3/S012345678': { name: 'Life without Death', birth: [3], survival: [0,1,2,3,4,5,6,7,8] },
    'B3/S12345': { name: 'Maze', birth: [3], survival: [1,2,3,4,5] },
    'B368/S245': { name: 'Morley', birth: [3,6,8], survival: [2,4,5] },
    'B1357/S1357': { name: 'Replicator', birth: [1,3,5,7], survival: [1,3,5,7] },
    'B35678/S5678': { name: 'Diamoeba', birth: [3,5,6,7,8], survival: [5,6,7,8] },
    'B4678/S35678': { name: 'Anneal', birth: [4,6,7,8], survival: [3,5,6,7,8] },
    'B34/S34': { name: '34 Life', birth: [3,4], survival: [3,4] },
};

// parseRule imported from lib.js as libParseRule

// Set rule from string
function setRule(ruleStr) {
    const parsed = libParseRule(ruleStr);
    if (parsed) {
        birthRule = parsed.birth;
        survivalRule = parsed.survival;
        currentRuleString = ruleStr.toUpperCase();
        return true;
    }
    return false;
}

// Aliases for frequently used values
const CHUNK_SIZE = CONFIG.CHUNK_SIZE;
const BITS = CONFIG.BITS_PER_WORD;

// State
let chunks = new Map(); // Key: "cx,cy", Value: Uint32Array(32)

// Viewport State (What the user sees)
let viewX = 0;
let viewY = 0;
let viewW = 0; // In cells
let viewH = 0; // In cells

let running = false;
let generation = 0;
let fps = 30;
let timerID = null;

// Running population counter (avoids full scan each frame)
let totalPopulation = 0;

// Chunk-level bounding box (approximate, updated incrementally)
// Tracks min/max chunk coordinates - actual bbox is chunk_coord * CHUNK_SIZE
let bboxMinCx = Infinity, bboxMaxCx = -Infinity;
let bboxMinCy = Infinity, bboxMaxCy = -Infinity;
let bboxDirty = true; // Forces recalculation when chunks are modified outside step()

// History (ring buffer with delta encoding)
// Each entry stores only chunks that changed from the previous state
let historyEnabled = false;
let historyMaxSize = 20;
let history = []; // Array of {delta: Map<key, {old: Uint32Array|null, new: Uint32Array|null}>, generation, population}

// Age tracking (optional, for visualization)
// Uses parallel chunk structure: Map<"cx,cy", Uint8Array(1024)> where 1024 = 32x32 cells
let ageTrackingEnabled = false;
let ageChunks = new Map(); // Key: "cx,cy", Value: Uint8Array(1024) - ages capped at 255

// Heatmap tracking (activity frequency)
let heatmapEnabled = false;
let heatmapChunks = new Map(); // Key: "cx,cy", Value: Uint8Array(1024) - activity count capped at 255
let heatmapDecayCounter = 0;
const HEATMAP_DECAY_INTERVAL = 10; // Decay every N steps

// Message handlers registry
const messageHandlers = {
    init(payload) {
        viewW = payload.cols;
        viewH = payload.rows;
        if (chunks.size === 0 && !payload.preserve) {
            seedDefaultPattern();
            recalculateTotalPopulation();
        }
        sendUpdate();
    },
    
    resize(payload) {
        viewW = payload.cols;
        viewH = payload.rows;
        sendUpdate();
    },
    
    viewportMove(payload) {
        viewX = payload.x;
        viewY = payload.y;
        sendUpdate();
    },
    
    start() {
        if (!running) {
            running = true;
            loop();
        }
    },
    
    stop() {
        running = false;
        if (timerID) clearTimeout(timerID);
        sendUpdate();
    },
    
    step() {
        running = false;
        if (timerID) clearTimeout(timerID);
        step();
    },
    
    reverse() {
        running = false;
        if (timerID) clearTimeout(timerID);
        if (popHistory()) {
            sendUpdate();
        }
    },
    
    setFps(payload) {
        fps = payload;
    },
    
    setHistory(payload) {
        historyEnabled = payload.enabled;
        historyMaxSize = payload.size || 20;
        if (!historyEnabled) {
            history = [];
        }
    },
    
    setAgeTracking(payload) {
        ageTrackingEnabled = payload;
        if (!ageTrackingEnabled) {
            ageChunks.clear();
        } else {
            initializeAges();
        }
        sendUpdate();
    },
    
    setHeatmap(payload) {
        heatmapEnabled = payload;
        if (!heatmapEnabled) {
            heatmapChunks.clear();
        }
        sendUpdate();
    },
    
    setCell(payload) {
        // UI sends 'idx' as flat view index, convert to global
        const vx = payload.idx % viewW;
        const vy = Math.floor(payload.idx / viewW);
        setCell(viewX + vx, viewY + vy, payload.val);
        bboxDirty = true;
        sendUpdate();
    },
    
    setCells(payload) {
        if (payload.updates) {
            for (let u of payload.updates) {
                const vx = u.idx % viewW;
                const vy = Math.floor(u.idx / viewW);
                setCell(viewX + vx, viewY + vy, u.val);
            }
            bboxDirty = true;
            sendUpdate();
        }
    },
    
    clear() {
        chunks.clear();
        ageChunks.clear();
        generation = 0;
        totalPopulation = 0;
        bboxDirty = true;
        history = [];
        running = false;
        sendUpdate();
    },
    
    randomize(payload) {
        chunks.clear();
        ageChunks.clear();
        history = [];
        randomize(payload, true);
        recalculateTotalPopulation();
        bboxDirty = true;
        sendUpdate();
    },
    
    load(payload) {
        chunks.clear();
        ageChunks.clear();
        if (payload.packed) {
            loadFlatData(payload.data, payload.w, payload.h);
        }
        generation = 0;
        recalculateTotalPopulation();
        bboxDirty = true;
        sendUpdate();
    },
    
    export() {
        exportWorld();
    },
    
    setRule(payload) {
        if (setRule(payload)) {
            self.postMessage({ type: 'ruleChanged', payload: currentRuleString });
        } else {
            self.postMessage({ type: 'ruleError', payload: 'Invalid rule format' });
        }
    },
    
    getPresets() {
        self.postMessage({ type: 'presets', payload: RULE_PRESETS });
    },
    
    jumpToGen(payload) {
        const targetGen = payload;
        if (targetGen <= generation) {
            self.postMessage({ type: 'jumpError', payload: 'Can only jump forward' });
            return;
        }
        const steps = targetGen - generation;
        const wasHistoryEnabled = historyEnabled;
        historyEnabled = false;
        
        for (let i = 0; i < steps; i++) {
            stepSilent();
            if (i > 0 && i % 1000 === 0) {
                self.postMessage({ 
                    type: 'jumpProgress', 
                    payload: { current: generation, target: targetGen }
                });
            }
        }
        
        historyEnabled = wasHistoryEnabled;
        sendUpdate();
        self.postMessage({ type: 'jumpComplete', payload: generation });
    }
};

// Message dispatcher
self.onmessage = function(e) {
    const { type, payload } = e.data;
    const handler = messageHandlers[type];
    if (handler) {
        handler(payload);
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
        // Check if chunk is now empty and delete it
        if (isChunkEmpty(chunk)) {
            chunks.delete(getChunkKey(cx, cy));
        }
    }
}

function isChunkEmpty(chunk) {
    for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] !== 0) return false;
    }
    return true;
}

/**
 * Copy bits from a source word to destination buffer using word-aligned operations.
 * 
 * @param {number} srcWord - Source 32-bit word
 * @param {number} srcBitStart - Start bit position in source (0-31)
 * @param {number} bitCount - Number of bits to copy (1-32)
 * @param {Uint32Array} destBuffer - Destination buffer
 * @param {number} destRowOffset - Word offset for start of destination row
 * @param {number} destBitStart - Start bit position in destination row
 * @returns {number} Population count of copied bits
 */
function copyBitsToBuffer(srcWord, srcBitStart, bitCount, destBuffer, destRowOffset, destBitStart) {
    // Extract relevant bits from source
    // Create mask of 'bitCount' 1-bits, shifted to srcBitStart
    // Handle bitCount=32: (1 << 32) === 1 in JS due to 32-bit overflow, use >>> trick
    const baseMask = bitCount >= 32 ? 0xFFFFFFFF : (1 << bitCount) - 1;
    const extractedBits = (srcWord >>> srcBitStart) & baseMask;
    
    if (extractedBits === 0) return 0;
    
    // Calculate destination word(s)
    const destWordIdx = destRowOffset + (destBitStart >>> 5); // destBitStart / 32
    const destBitOffset = destBitStart & 31; // destBitStart % 32
    
    // Check if bits span two destination words
    const bitsInFirstWord = BITS - destBitOffset;
    
    if (bitCount <= bitsInFirstWord) {
        // All bits fit in one destination word
        destBuffer[destWordIdx] |= (extractedBits << destBitOffset);
    } else {
        // Bits span two destination words
        destBuffer[destWordIdx] |= (extractedBits << destBitOffset);
        destBuffer[destWordIdx + 1] |= (extractedBits >>> bitsInFirstWord);
    }
    
    return popcount32(extractedBits);
}

// popcount32 imported from lib.js

function countChunkPopulation(chunk) {
    let pop = 0;
    for (let i = 0; i < chunk.length; i++) {
        if (chunk[i]) pop += popcount32(chunk[i]);
    }
    return pop;
}

function recalculateTotalPopulation() {
    totalPopulation = 0;
    for (const chunk of chunks.values()) {
        totalPopulation += countChunkPopulation(chunk);
    }
}

// Recalculate chunk-level bbox from scratch (O(chunks))
function recalculateBbox() {
    bboxMinCx = Infinity;
    bboxMaxCx = -Infinity;
    bboxMinCy = Infinity;
    bboxMaxCy = -Infinity;
    
    for (const key of chunks.keys()) {
        const [cx, cy] = key.split(',').map(Number);
        if (cx < bboxMinCx) bboxMinCx = cx;
        if (cx > bboxMaxCx) bboxMaxCx = cx;
        if (cy < bboxMinCy) bboxMinCy = cy;
        if (cy > bboxMaxCy) bboxMaxCy = cy;
    }
    bboxDirty = false;
}

// Update bbox from new chunks map (after step)
function updateBboxFromChunks(newChunks) {
    bboxMinCx = Infinity;
    bboxMaxCx = -Infinity;
    bboxMinCy = Infinity;
    bboxMaxCy = -Infinity;
    
    for (const key of newChunks.keys()) {
        const [cx, cy] = key.split(',').map(Number);
        if (cx < bboxMinCx) bboxMinCx = cx;
        if (cx > bboxMaxCx) bboxMaxCx = cx;
        if (cy < bboxMinCy) bboxMinCy = cy;
        if (cy > bboxMaxCy) bboxMaxCy = cy;
    }
    bboxDirty = false;
}

// Get approximate bounding box (chunk-aligned, fast)
function getApproxBbox() {
    if (bboxDirty) recalculateBbox();
    if (bboxMinCx === Infinity) return null; // No chunks
    
    return {
        x: bboxMinCx * CHUNK_SIZE,
        y: bboxMinCy * CHUNK_SIZE,
        w: (bboxMaxCx - bboxMinCx + 1) * CHUNK_SIZE,
        h: (bboxMaxCy - bboxMinCy + 1) * CHUNK_SIZE
    };
}

function garbageCollectChunks() {
    const toDelete = [];
    for (const [key, chunk] of chunks) {
        if (isChunkEmpty(chunk)) {
            toDelete.push(key);
        }
    }
    for (const key of toDelete) {
        chunks.delete(key);
    }
    return toDelete.length;
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
    // Load a flat Uint32Array (stride = w/BITS) into chunks
    // We assume (0,0) is top-left of this data
    const stride = Math.ceil(w / BITS);
    for(let i=0; i<data.length; i++) {
        const word = data[i];
        if (word === 0) continue;
        
        const row = Math.floor(i / stride);
        const colStart = (i % stride) * BITS;
        
        for(let b=0; b<BITS; b++) {
            if ((word >>> b) & 1) {
                setCell(colStart + b, row, 1);
            }
        }
    }
    garbageCollectChunks();
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
        garbageCollectChunks();
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
            
            for (let lx = 0; lx < BITS; lx++) {
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
    let rle = `#C Exported from Life Engine\nx = ${w}, y = ${h}, rule = ${currentRuleString}\n`;
    let lineLen = 0;
    const MAX_LINE_LEN = 70;
    
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
            const token = (count > 1 ? count : '') + char;
            
            // Line wrap before adding token if it would exceed limit
            if (lineLen + token.length > MAX_LINE_LEN && lineLen > 0) {
                rle += '\n';
                lineLen = 0;
            }
            
            rowRle += token;
            lineLen += token.length;
            x += count;
        }
        
        // End of row: $ or ! for last row
        const terminator = (y < h - 1) ? '$' : '!';
        
        // Line wrap before terminator if needed
        if (lineLen + 1 > MAX_LINE_LEN && lineLen > 0) {
            rle += '\n';
            lineLen = 0;
        }
        
        rle += rowRle + terminator;
        lineLen += 1;
    }
    
    self.postMessage({
        type: 'exportData',
        payload: { rle, w, h }
    });
}

// --- History Management (Delta-based) ---

// Clone a single chunk
function cloneChunk(chunk) {
    return chunk ? new Uint32Array(chunk) : null;
}

// Build delta: compare old chunks with new chunks
// Returns Map<key, {old: Uint32Array|null, new: Uint32Array|null}>
function buildDelta(oldChunks, newChunks) {
    const delta = new Map();
    const allKeys = new Set([...oldChunks.keys(), ...newChunks.keys()]);
    
    for (const key of allKeys) {
        const oldChunk = oldChunks.get(key);
        const newChunk = newChunks.get(key);
        
        // Check if chunks are different
        let changed = false;
        if (!oldChunk && newChunk) {
            changed = true;
        } else if (oldChunk && !newChunk) {
            changed = true;
        } else if (oldChunk && newChunk) {
            for (let i = 0; i < CHUNK_SIZE; i++) {
                if (oldChunk[i] !== newChunk[i]) {
                    changed = true;
                    break;
                }
            }
        }
        
        if (changed) {
            delta.set(key, {
                old: cloneChunk(oldChunk),
                new: cloneChunk(newChunk)
            });
        }
    }
    
    return delta;
}

// Apply delta in reverse (go back in time)
function applyDeltaReverse(delta) {
    for (const [key, change] of delta) {
        if (change.old) {
            chunks.set(key, new Uint32Array(change.old));
        } else {
            chunks.delete(key);
        }
    }
}

// Temporary storage for pre-step state (used by pushHistory)
let preStepChunks = null;
let preStepGeneration = 0;
let preStepPopulation = 0;

function capturePreStepState() {
    if (!historyEnabled) return;
    preStepChunks = new Map();
    for (const [key, chunk] of chunks) {
        preStepChunks.set(key, new Uint32Array(chunk));
    }
    preStepGeneration = generation;
    preStepPopulation = totalPopulation;
}

function pushHistoryDelta() {
    if (!historyEnabled || !preStepChunks) return;
    
    const delta = buildDelta(preStepChunks, chunks);
    
    // Only push if something changed
    if (delta.size > 0) {
        history.push({
            delta: delta,
            generation: preStepGeneration,
            population: preStepPopulation
        });
        
        // Ring buffer: trim oldest if over limit
        if (history.length > historyMaxSize) {
            history.shift();
        }
    }
    
    preStepChunks = null;
}

function popHistory() {
    if (!historyEnabled || history.length === 0) return false;
    
    const state = history.pop();
    applyDeltaReverse(state.delta);
    generation = state.generation;
    totalPopulation = state.population;
    bboxDirty = true;
    return true;
}

// --- Simulation ---

/**
 * Compute next generation using SWAR bitwise neighbor counting.
 * Pure simulation logic - no side effects on history/age/heatmap.
 * 
 * @param {Map<string, Uint32Array>} currentChunks - Current state
 * @returns {Map<string, Uint32Array>} - Next generation state
 */
function computeNextGeneration(currentChunks) {
    const result = new Map();
    
    // Set of keys to process: All active chunks + their neighbors
    const toProcess = new Set();
    
    for (let [key] of currentChunks) {
        const [cx, cy] = key.split(',').map(Number);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                toProcess.add(getChunkKey(cx + dx, cy + dy));
            }
        }
    }
    
    // Helper functions for bit shifting across chunk boundaries
    const shiftRight = (curr, left) => (curr << 1) | (left >>> 31);
    const shiftLeft  = (curr, right) => (curr >>> 1) | (right << 31);
    
    for (let key of toProcess) {
        const [cx, cy] = key.split(',').map(Number);
        
        // Get 3x3 neighborhood of chunks
        const C = currentChunks.get(getChunkKey(cx, cy)) || new Uint32Array(CHUNK_SIZE);
        const N = currentChunks.get(getChunkKey(cx, cy - 1));
        const S = currentChunks.get(getChunkKey(cx, cy + 1));
        const W = currentChunks.get(getChunkKey(cx - 1, cy));
        const E = currentChunks.get(getChunkKey(cx + 1, cy));
        const NW = currentChunks.get(getChunkKey(cx - 1, cy - 1));
        const NE = currentChunks.get(getChunkKey(cx + 1, cy - 1));
        const SW = currentChunks.get(getChunkKey(cx - 1, cy + 1));
        const SE = currentChunks.get(getChunkKey(cx + 1, cy + 1));
        
        const nextChunk = new Uint32Array(CHUNK_SIZE);
        let active = false;
        
        for (let y = 0; y < CHUNK_SIZE; y++) {
            const c_row = C[y];
            
            // North/South rows (handle chunk boundaries)
            const n_row = y > 0 ? C[y - 1] : (N ? N[CHUNK_SIZE - 1] : 0);
            const s_row = y < CHUNK_SIZE - 1 ? C[y + 1] : (S ? S[0] : 0);
            
            // West/East words from neighbor chunks
            const w_chunk_row = W ? W[y] : 0;
            const e_chunk_row = E ? E[y] : 0;
            
            // Shifted neighbors (horizontal)
            const w = shiftRight(c_row, w_chunk_row);
            const e = shiftLeft(c_row, e_chunk_row);
            
            // North row's west/east neighbors
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
            
            // South row's west/east neighbors
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
            
            // SWAR neighbor counting: parallel addition of 8 neighbor bits
            // Result: 4-bit count (total0-total3) per cell position
            const s0 = n ^ s; const c0 = n & s;
            const s1 = w ^ e; const c1 = w & e;
            const s2 = nw ^ sw; const c2 = nw & sw;
            const s3 = ne ^ se; const c3 = ne & se;
            
            const s01 = s0 ^ s1; const c01 = s0 & s1;
            const s23 = s2 ^ s3; const c23 = s2 & s3;
            const total0 = s01 ^ s23;
            const carry_s_raw = s01 & s23;
            
            const sum_A = c01 ^ c23 ^ carry_s_raw;
            const carry_A = (c01 & c23) | (c01 & carry_s_raw) | (c23 & carry_s_raw);
            
            const c01_x = c0 ^ c1; const c01_a = c0 & c1;
            const c23_x = c2 ^ c3; const c23_a = c2 & c3;
            const sum_B = c01_x ^ c23_x;
            const carry_B = (c01_x & c23_x) | c01_a | c23_a;
            
            const total1 = sum_A ^ sum_B;
            const carry_AB = sum_A & sum_B;
            const total2 = carry_A ^ carry_B ^ carry_AB;
            const total3 = (carry_A & carry_B) | (carry_A & carry_AB) | (carry_B & carry_AB);
            
            // Build masks for each neighbor count (0-8)
            const n0 = ~total3 & ~total2 & ~total1 & ~total0;
            const n1 = ~total3 & ~total2 & ~total1 & total0;
            const n2 = ~total3 & ~total2 & total1 & ~total0;
            const n3 = ~total3 & ~total2 & total1 & total0;
            const n4 = ~total3 & total2 & ~total1 & ~total0;
            const n5 = ~total3 & total2 & ~total1 & total0;
            const n6 = ~total3 & total2 & total1 & ~total0;
            const n7 = ~total3 & total2 & total1 & total0;
            const n8 = total3 & ~total2 & ~total1 & ~total0;
            
            // Apply birth/survival rules
            let birthMask = 0, survivalMask = 0;
            if (birthRule[0]) birthMask |= n0;
            if (birthRule[1]) birthMask |= n1;
            if (birthRule[2]) birthMask |= n2;
            if (birthRule[3]) birthMask |= n3;
            if (birthRule[4]) birthMask |= n4;
            if (birthRule[5]) birthMask |= n5;
            if (birthRule[6]) birthMask |= n6;
            if (birthRule[7]) birthMask |= n7;
            if (birthRule[8]) birthMask |= n8;
            
            if (survivalRule[0]) survivalMask |= n0;
            if (survivalRule[1]) survivalMask |= n1;
            if (survivalRule[2]) survivalMask |= n2;
            if (survivalRule[3]) survivalMask |= n3;
            if (survivalRule[4]) survivalMask |= n4;
            if (survivalRule[5]) survivalMask |= n5;
            if (survivalRule[6]) survivalMask |= n6;
            if (survivalRule[7]) survivalMask |= n7;
            if (survivalRule[8]) survivalMask |= n8;
            
            // Next state: birth (dead & birthMask) | survival (alive & survivalMask)
            const nextState = (~c_row & birthMask) | (c_row & survivalMask);
            
            if (nextState !== 0) active = true;
            nextChunk[y] = nextState;
        }
        
        if (active) {
            result.set(key, nextChunk);
        }
    }
    
    return result;
}

function step() {
    capturePreStepState();
    
    const nextState = computeNextGeneration(chunks);
    
    // Update ages if tracking enabled
    if (ageTrackingEnabled) {
        updateAges(nextState);
    }
    
    // Update heatmap if enabled
    if (heatmapEnabled) {
        updateHeatmap(chunks, nextState);
    }
    
    // Update population counter and bbox
    let newPop = 0;
    for (const chunk of nextState.values()) {
        newPop += countChunkPopulation(chunk);
    }
    totalPopulation = newPop;
    updateBboxFromChunks(nextState);
    
    chunks = nextState;
    generation++;
    
    // Push delta to history (after chunks is updated)
    pushHistoryDelta();
    
    sendUpdate();
}

// Age tracking functions using parallel chunk structure
// Each age chunk is a Uint8Array(1024) for 32x32 cells, indexed as [ly * 32 + lx]

function getAgeChunk(cx, cy, create = false) {
    const key = getChunkKey(cx, cy);
    let ageChunk = ageChunks.get(key);
    if (!ageChunk && create) {
        ageChunk = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
        ageChunks.set(key, ageChunk);
    }
    return ageChunk;
}

function initializeAges() {
    ageChunks.clear();
    for (let [key, chunk] of chunks) {
        const [cx, cy] = key.split(',').map(Number);
        const ageChunk = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
        
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
            const word = chunk[ly];
            if (word === 0) continue;
            for (let lx = 0; lx < BITS; lx++) {
                if ((word >>> lx) & 1) {
                    ageChunk[ly * CHUNK_SIZE + lx] = 1;
                }
            }
        }
        ageChunks.set(key, ageChunk);
    }
}

function updateAges(newChunks) {
    const newAgeChunks = new Map();
    
    for (let [key, chunk] of newChunks) {
        const [cx, cy] = key.split(',').map(Number);
        const oldAgeChunk = ageChunks.get(key);
        const newAgeChunk = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
        
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
            const word = chunk[ly];
            if (word === 0) continue;
            for (let lx = 0; lx < BITS; lx++) {
                if ((word >>> lx) & 1) {
                    const idx = ly * CHUNK_SIZE + lx;
                    const oldAge = oldAgeChunk ? oldAgeChunk[idx] : 0;
                    // Cap at 255 (Uint8 max)
                    newAgeChunk[idx] = oldAge < 255 ? oldAge + 1 : 255;
                }
            }
        }
        newAgeChunks.set(key, newAgeChunk);
    }
    
    ageChunks = newAgeChunks;
}

function getCellAge(x, y) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const lx = (x % CHUNK_SIZE + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = (y % CHUNK_SIZE + CHUNK_SIZE) % CHUNK_SIZE;
    
    const ageChunk = ageChunks.get(getChunkKey(cx, cy));
    if (!ageChunk) return 0;
    return ageChunk[ly * CHUNK_SIZE + lx];
}

// Heatmap functions - track state changes (births + deaths)
function updateHeatmap(oldChunks, newChunks) {
    const allKeys = new Set([...oldChunks.keys(), ...newChunks.keys()]);
    
    for (const key of allKeys) {
        const oldChunk = oldChunks.get(key);
        const newChunk = newChunks.get(key);
        
        // Get or create heatmap chunk
        let heatChunk = heatmapChunks.get(key);
        if (!heatChunk) {
            heatChunk = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
            heatmapChunks.set(key, heatChunk);
        }
        
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
            const oldWord = oldChunk ? oldChunk[ly] : 0;
            const newWord = newChunk ? newChunk[ly] : 0;
            const changed = oldWord ^ newWord; // XOR = bits that changed
            
            if (changed === 0) continue;
            
            for (let lx = 0; lx < BITS; lx++) {
                if ((changed >>> lx) & 1) {
                    const idx = ly * CHUNK_SIZE + lx;
                    // Increment activity count (cap at 255)
                    if (heatChunk[idx] < 255) {
                        heatChunk[idx] += CONFIG.HEATMAP_BOOST;
                        if (heatChunk[idx] > 255) heatChunk[idx] = 255;
                    }
                }
            }
        }
    }
    
    // Periodic decay
    heatmapDecayCounter++;
    if (heatmapDecayCounter >= HEATMAP_DECAY_INTERVAL) {
        heatmapDecayCounter = 0;
        for (const [key, heatChunk] of heatmapChunks) {
            let hasValue = false;
            for (let i = 0; i < heatChunk.length; i++) {
                if (heatChunk[i] > 0) {
                    heatChunk[i] = Math.max(0, heatChunk[i] - 1);
                    if (heatChunk[i] > 0) hasValue = true;
                }
            }
            if (!hasValue) {
                heatmapChunks.delete(key);
            }
        }
    }
}

function sendUpdate() {
    // Render Viewport to Uint32Array
    // viewW is width in cells.
    // stride = ceil(viewW / BITS)
    const stride = Math.ceil(viewW / BITS);
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
                
                // Optimized word-aligned bit copy
                pop += copyBitsToBuffer(word, srcXStart, intersectW, buffer, destY * stride, destXStart);
            }
        }
    }
    
    // Use running population counter (maintained incrementally during step/load/etc)

    // Build age buffer if age tracking enabled (using chunk-aligned extraction)
    let ageBuffer = null;
    if (ageTrackingEnabled) {
        ageBuffer = new Uint8Array(viewW * viewH);
        
        // Iterate age chunks that intersect viewport (same logic as cell buffer)
        for (let cy = startCy; cy <= endCy; cy++) {
            for (let cx = startCx; cx <= endCx; cx++) {
                const ageChunk = ageChunks.get(getChunkKey(cx, cy));
                if (!ageChunk) continue;
                
                const chunkX = cx * CHUNK_SIZE;
                const chunkY = cy * CHUNK_SIZE;
                
                const intersectX = Math.max(viewX, chunkX);
                const intersectY = Math.max(viewY, chunkY);
                const intersectW = Math.min(viewX + viewW, chunkX + CHUNK_SIZE) - intersectX;
                const intersectH = Math.min(viewY + viewH, chunkY + CHUNK_SIZE) - intersectY;
                
                if (intersectW <= 0 || intersectH <= 0) continue;
                
                for (let y = 0; y < intersectH; y++) {
                    const globalY = intersectY + y;
                    const srcY = globalY - chunkY;
                    const destY = globalY - viewY;
                    
                    for (let x = 0; x < intersectW; x++) {
                        const globalX = intersectX + x;
                        const srcX = globalX - chunkX;
                        const destX = globalX - viewX;
                        
                        ageBuffer[destY * viewW + destX] = ageChunk[srcY * CHUNK_SIZE + srcX];
                    }
                }
            }
        }
    }

    // Use chunk-level approximate bounding box (O(1) instead of O(population))
    const boundingBox = getApproxBbox();

    const payload = {
        grid: buffer,
        generation: generation,
        pop: totalPopulation,
        running: running,
        packed: true,
        bbox: boundingBox,
        rule: currentRuleString,
        fps: { actual: actualFps, target: fps },
        chunks: chunks.size,
        historySize: history.length,
    };
    
    const transferables = [buffer.buffer];
    
    if (ageBuffer) {
        payload.ages = ageBuffer;
        transferables.push(ageBuffer.buffer);
    }
    
    // Build heatmap buffer if enabled
    let heatmapBuffer = null;
    if (heatmapEnabled) {
        heatmapBuffer = new Uint8Array(viewW * viewH);
        
        for (let cy = startCy; cy <= endCy; cy++) {
            for (let cx = startCx; cx <= endCx; cx++) {
                const heatChunk = heatmapChunks.get(getChunkKey(cx, cy));
                if (!heatChunk) continue;
                
                const chunkX = cx * CHUNK_SIZE;
                const chunkY = cy * CHUNK_SIZE;
                
                const intersectX = Math.max(viewX, chunkX);
                const intersectY = Math.max(viewY, chunkY);
                const intersectW = Math.min(viewX + viewW, chunkX + CHUNK_SIZE) - intersectX;
                const intersectH = Math.min(viewY + viewH, chunkY + CHUNK_SIZE) - intersectY;
                
                if (intersectW <= 0 || intersectH <= 0) continue;
                
                for (let y = 0; y < intersectH; y++) {
                    const globalY = intersectY + y;
                    const srcY = globalY - chunkY;
                    const destY = globalY - viewY;
                    
                    for (let x = 0; x < intersectW; x++) {
                        const globalX = intersectX + x;
                        const srcX = globalX - chunkX;
                        const destX = globalX - viewX;
                        
                        heatmapBuffer[destY * viewW + destX] = heatChunk[srcY * CHUNK_SIZE + srcX];
                    }
                }
            }
        }
        
        payload.heatmap = heatmapBuffer;
        transferables.push(heatmapBuffer.buffer);
    }

    self.postMessage({ type: 'update', payload }, transferables);
}

// Silent step for generation jumping (no sendUpdate, no history, no age/heatmap)
function stepSilent() {
    const nextState = computeNextGeneration(chunks);
    
    // Update population counter
    let newPop = 0;
    for (const chunk of nextState.values()) {
        newPop += countChunkPopulation(chunk);
    }
    totalPopulation = newPop;
    
    chunks = nextState;
    generation++;
}

// FPS tracking
let lastFrameTime = 0;
let frameCount = 0;
let actualFps = 0;
let fpsUpdateTime = 0;

function loop() {
    if (!running) return;
    const start = performance.now();
    
    // Calculate actual FPS
    frameCount++;
    if (start - fpsUpdateTime >= 1000) {
        actualFps = frameCount;
        frameCount = 0;
        fpsUpdateTime = start;
    }
    
    step();
    const end = performance.now();
    const elapsed = end - start;
    const targetInterval = 1000 / fps;
    const delay = Math.max(0, targetInterval - elapsed);
    timerID = setTimeout(loop, delay);
}
