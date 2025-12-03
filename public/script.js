/**
 * UI & Render Logic (Main Thread)
 * 
 * COORDINATE SYSTEMS (see worker.js for full documentation):
 * 
 * - Canvas pixels: raw mouse/render coordinates
 * - Viewport cells: canvas pixels / cellSize, range [0, cols) x [0, rows)
 * - Global cells: viewX + viewport_x, viewY + viewport_y
 * 
 * The UI class manages viewport offset (viewX, viewY) and communicates
 * with the worker using flat viewport indices for cell operations.
 */

// =============================================================================
// VERSION - Update this for each release
// =============================================================================
const APP_VERSION = 'v1.0.3';

// =============================================================================
// CONSTANTS
// =============================================================================
const BITS_PER_WORD = 32;     // Bits in Uint32 word (must match worker)
const SPEED_SLIDER_MAX = 66;  // Max slider value (7-66 maps to 1-60 FPS)

// Color utility for ImageData rendering
function hexToRGB(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
}

// WebGL Renderer (optional, for massive grids)
class WebGLRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false });
        if (!this.gl) {
            console.warn('WebGL not available, falling back to Canvas 2D');
            this.available = false;
            return;
        }
        this.available = true;
        this.program = null;
        this.positionBuffer = null;
        this.init();
    }
    
    init() {
        const gl = this.gl;
        
        // Vertex shader: positions cells
        const vsSource = `
            attribute vec2 a_position;
            uniform vec2 u_resolution;
            uniform vec2 u_offset;
            uniform float u_cellSize;
            
            void main() {
                vec2 pos = (a_position * u_cellSize + u_offset) / u_resolution * 2.0 - 1.0;
                pos.y = -pos.y; // Flip Y
                gl_Position = vec4(pos, 0, 1);
                gl_PointSize = u_cellSize;
            }
        `;
        
        // Fragment shader: colors cells
        const fsSource = `
            precision mediump float;
            uniform vec3 u_color;
            
            void main() {
                gl_FragColor = vec4(u_color, 1.0);
            }
        `;
        
        // Compile shaders
        const vs = this.compileShader(gl.VERTEX_SHADER, vsSource);
        const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSource);
        
        // Link program
        this.program = gl.createProgram();
        gl.attachShader(this.program, vs);
        gl.attachShader(this.program, fs);
        gl.linkProgram(this.program);
        
        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Shader program failed:', gl.getProgramInfoLog(this.program));
            this.available = false;
            return;
        }
        
        // Get attribute/uniform locations
        this.positionLoc = gl.getAttribLocation(this.program, 'a_position');
        this.resolutionLoc = gl.getUniformLocation(this.program, 'u_resolution');
        this.offsetLoc = gl.getUniformLocation(this.program, 'u_offset');
        this.cellSizeLoc = gl.getUniformLocation(this.program, 'u_cellSize');
        this.colorLoc = gl.getUniformLocation(this.program, 'u_color');
        
        // Create position buffer
        this.positionBuffer = gl.createBuffer();
    }
    
    compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }
    
    render(grid, stride, cols, rows, cellSize, liveColor) {
        if (!this.available) return false;
        
        const gl = this.gl;
        
        // Resize canvas if needed
        if (this.canvas.width !== this.canvas.clientWidth || this.canvas.height !== this.canvas.clientHeight) {
            this.canvas.width = this.canvas.clientWidth;
            this.canvas.height = this.canvas.clientHeight;
            gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }
        
        // Clear with dead color
        const deadRGB = hexToRGB(CONF.deadColor);
        gl.clearColor(deadRGB.r / 255, deadRGB.g / 255, deadRGB.b / 255, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        // Build position array from grid
        const positions = [];
        for (let i = 0; i < grid.length; i++) {
            const word = grid[i];
            if (word === 0) continue;
            
            const wordRow = Math.floor(i / stride);
            const wordColStart = (i % stride) * BITS_PER_WORD;
            
            for (let bit = 0; bit < BITS_PER_WORD; bit++) {
                if ((word >>> bit) & 1) {
                    const cellX = wordColStart + bit;
                    const cellY = wordRow;
                    // Center of cell
                    positions.push(cellX + 0.5, cellY + 0.5);
                }
            }
        }
        
        if (positions.length === 0) return true;
        
        // Upload positions
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
        
        // Use program
        gl.useProgram(this.program);
        
        // Set uniforms
        gl.uniform2f(this.resolutionLoc, this.canvas.width, this.canvas.height);
        gl.uniform2f(this.offsetLoc, 0, 0);
        gl.uniform1f(this.cellSizeLoc, cellSize);
        
        const liveRGB = hexToRGB(liveColor);
        gl.uniform3f(this.colorLoc, liveRGB.r / 255, liveRGB.g / 255, liveRGB.b / 255);
        
        // Enable position attribute
        gl.enableVertexAttribArray(this.positionLoc);
        gl.vertexAttribPointer(this.positionLoc, 2, gl.FLOAT, false, 0, 0);
        
        // Draw points
        gl.drawArrays(gl.POINTS, 0, positions.length / 2);
        
        return true;
    }
}

// Age thresholds for color mapping
const AGE_THRESHOLDS = {
    newborn: 0,
    young: 2,
    maturing: 5,
    mature: 10,
    old: 20,
};

const CONF = {
    cellSize: 10,
    cellSizeMin: 2,
    cellSizeMax: 40,
    gridColor: '#3B4252',
    gridLineColor: '#353C4A',
    liveColor: '#A3BE8C',
    deadColor: '#2E3440',
    error: '#BF616A',
    useAgeColor: false,
    useHeatmap: false,
    // Age gradient: young (bright) -> old (dim), indexed by AGE_THRESHOLDS
    ageColors: [
        '#ECEFF4', // 0: newborn (bright white)
        '#A3BE8C', // 1-2: young (green)
        '#8FBCBB', // 3-5: maturing (teal)
        '#88C0D0', // 6-10: mature (frost)
        '#81A1C1', // 11-20: old (blue)
        '#5E81AC', // 21+: ancient (deep blue)
    ]
};

// Heatmap color (intensity 0-255 -> color)
function getHeatmapColor(intensity) {
    if (intensity === 0) return null;
    // Black -> Red -> Yellow -> White gradient
    const r = Math.min(255, intensity * 4);
    const g = Math.min(255, Math.max(0, (intensity - 64) * 2));
    const b = Math.min(255, Math.max(0, (intensity - 192) * 4));
    return `rgb(${r},${g},${b})`;
}

// Pattern Library - RLE-encoded patterns from LifeWiki
// Organized by category for dropdown optgroups
const PATTERN_LIBRARY = {
    'Still Lifes': {
        'Block': 'oo$oo!',
        'Beehive': 'b2o$o2bo$b2o!',
        'Loaf': 'b2o$o2bo$bobo$2bo!',
        'Boat': '2o$obo$bo!',
        'Tub': 'bo$obo$bo!',
        'Ship': '2o$obo$b2o!',
        'Pond': 'b2o$o2bo$o2bo$b2o!',
        'Eater 1': '2o$obo$2bo$2b2o!',
    },
    'Oscillators': {
        'Blinker': '3o!',
        'Toad': 'b3o$3o!',
        'Beacon': '2o$2o$2b2o$2b2o!',
        'Pulsar': '2b3o3b3o2b2$o4bobo4bo$o4bobo4bo$o4bobo4bo$2b3o3b3o2b2$2b3o3b3o2b$o4bobo4bo$o4bobo4bo$o4bobo4bo2$2b3o3b3o!',
        'Pentadecathlon': '2bo4bo2b$2ob4ob2o$2bo4bo!',
        'Clock': '2bo$obo$bobo$bo!',
        'Figure Eight': '3o3b$3o3b$3o3b$3b3o$3b3o$3b3o!',
    },
    'Spaceships': {
        'Glider': 'bo$2bo$3o!',
        'LWSS': 'bo2bo$o4b$o3bo$4o!',
        'MWSS': '3bo$bo3bo$o$o4bo$5o!',
        'HWSS': '3b2o$bo4bo$o$o5bo$6o!',
    },
    'Guns': {
        'Gosper Gun': '24bo$22bobo$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o$2o8bo3bob2o4bobo$10bo5bo7bo$11bo3bo$12b2o!',
        'Simkin Gun': '2o5b2o$2o5b2o2$4b2o$4b2o5$22b2ob2o$21bo5bo$21bo6bo2b2o$21b3o3bo3b2o$26bo4$20b2o$20bo$21b3o$23bo!',
    },
    'Methuselahs': {
        'R-pentomino': 'b2o$2o$bo!',
        'Diehard': '6bob$2o6b$bo3b3o!',
        'Acorn': 'bo$3bo$2o2b3o!',
        'B-heptomino': 'ob2o$3o$bo!',
        'Pi-heptomino': 'b3o$3o$bo!',
        'Thunderbird': 'b3o2$bobo$bobo$bobo!',
    },
    'Misc': {
        'Puffer Train': '3bo$4bo$o3bo$b4o5$3bo$bobo$obo$bo$bo$2o5$3bo$4bo$o3bo$b4o!',
        'Space Rake': '6bo$4bobo$3bo2bo$4b2o2$o$b3o4bo$4bo3bo$4bo2bo$5b2o!',
    }
};

// Convert RLE to coordinate array for paste mode
function rleToCoords(rle) {
    const coords = [];
    let x = 0, y = 0, count = 0;
    
    for (let i = 0; i < rle.length; i++) {
        const char = rle[i];
        if (char >= '0' && char <= '9') {
            count = count * 10 + parseInt(char);
        } else if (char === 'b' || char === '.') {
            x += (count || 1);
            count = 0;
        } else if (char === 'o' || char === '*') {
            const run = count || 1;
            for (let k = 0; k < run; k++) {
                coords.push([x + k, y]);
            }
            x += run;
            count = 0;
        } else if (char === '$') {
            y += (count || 1);
            x = 0;
            count = 0;
        } else if (char === '!') {
            break;
        }
    }
    return coords;
}

// Build pattern cache from library (for paste mode)
let PATTERN_CACHE = {};

function buildPatternCache() {
    PATTERN_CACHE = {};
    for (const [category, patterns] of Object.entries(PATTERN_LIBRARY)) {
        for (const [name, rle] of Object.entries(patterns)) {
            const key = `${category}::${name}`;
            PATTERN_CACHE[key] = rleToCoords(rle);
        }
    }
}

// Current pattern for paste mode (key into PATTERN_CACHE or custom coords)
let currentPatternKey = 'Spaceships::Glider';
let currentPatternCoords = null; // Cache of current pattern coords (may be rotated)

function getCurrentPattern() {
    if (!currentPatternCoords) {
        currentPatternCoords = PATTERN_CACHE[currentPatternKey] 
            ? [...PATTERN_CACHE[currentPatternKey].map(c => [...c])]
            : [[0,0]];
    }
    return currentPatternCoords;
}

function resetCurrentPattern() {
    currentPatternCoords = PATTERN_CACHE[currentPatternKey]
        ? [...PATTERN_CACHE[currentPatternKey].map(c => [...c])]
        : [[0,0]];
}

// Load pattern from library to grid (replaces current pattern)
function loadPatternToGrid(patternKey) {
    const coords = PATTERN_CACHE[patternKey];
    if (!coords || coords.length === 0) {
        toast('Pattern not found', true);
        return;
    }
    
    // Build RLE from coords for loading
    const [category, name] = patternKey.split('::');
    const rle = PATTERN_LIBRARY[category]?.[name];
    if (rle) {
        loadFromRLE(`x = 0, y = 0\n${rle}`);
        ui.viewX = -10;
        ui.viewY = -10;
        ui.worker.postMessage({ type: 'viewportMove', payload: { x: ui.viewX, y: ui.viewY } });
    }
}

// Populate pattern dropdown with optgroups
function populatePatternDropdown() {
    const select = document.getElementById('pattern-select');
    select.innerHTML = '';
    
    for (const [category, patterns] of Object.entries(PATTERN_LIBRARY)) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = category;
        
        for (const name of Object.keys(patterns)) {
            const option = document.createElement('option');
            option.value = `${category}::${name}`;
            option.textContent = name;
            optgroup.appendChild(option);
        }
        
        select.appendChild(optgroup);
    }
    
    // Select Glider by default
    select.value = 'Spaceships::Glider';
}

class UI {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.cols = 0;
        this.rows = 0;
        this.stride = 0; 
        this.lastGrid = null;
        this.lastAges = null;
        this.lastHeatmap = null;
        
        // Viewport State
        this.viewX = 0;
        this.viewY = 0;
        
        // Worker
        this.worker = new Worker('worker.js');
        this.worker.onmessage = this.onWorkerMessage.bind(this);
        this.worker.onerror = this.onWorkerError.bind(this);

        // State
        this.isRunning = false;
        this.mouse = { x: 0, y: 0, down: false, lastX: 0, lastY: 0 };
        this.mode = 'draw';
        
        // Population history for graph
        this.popHistory = [];
        this.popHistoryMax = 100;
        this.lastBbox = null;
        this.currentRule = 'B3/S23';
        
        // WebGL renderer (optional)
        this.webglRenderer = null;
        this.useWebGL = false;

        // Init
        this.resize(true);
        window.addEventListener('resize', () => this.resize(false));
        
        // UI Loop
        this.renderLoop = this.renderLoop.bind(this);
        requestAnimationFrame(this.renderLoop);
    }

    resize(isInit = false) {
        this.canvas.width = this.canvas.parentElement.clientWidth;
        this.canvas.height = this.canvas.parentElement.clientHeight;
        this.cols = Math.floor(this.canvas.width / CONF.cellSize);
        this.rows = Math.floor(this.canvas.height / CONF.cellSize);
        this.stride = Math.ceil(this.cols / BITS_PER_WORD);
        
        // Update viewport size (preserve: true implied for init if not explicit, 
        // but here we use 'resize' type for safety if already running)
        if (this.worker) {
            this.worker.postMessage({ 
                type: isInit ? 'init' : 'resize', 
                payload: { cols: this.cols, rows: this.rows } 
            });
        }
    }

    onWorkerMessage(e) {
        const { type, payload } = e.data;
        if (type === 'update') {
            this.lastGrid = payload.grid;
            this.lastAges = payload.ages || null;
            this.lastHeatmap = payload.heatmap || null;
            this.isRunning = payload.running;
            this.lastBbox = payload.bbox;
            if (payload.rule) this.currentRule = payload.rule;
            
            // Track population history
            this.popHistory.push(payload.pop);
            if (this.popHistory.length > this.popHistoryMax) {
                this.popHistory.shift();
            }
            
            // Update FPS display
            if (payload.fps) {
                updateFpsDisplay(payload.fps.actual, payload.fps.target, payload.chunks, payload.historySize);
            }
            
            updateStats(payload.generation, payload.pop, payload.bbox, this.currentRule);
            updateBtnState(this.isRunning);
            this.draw(); 
        } else if (type === 'exportData') {
             this.handleExport(payload);
        } else if (type === 'ruleChanged') {
            this.currentRule = payload;
            toast(`Rule: ${payload}`);
        } else if (type === 'ruleError') {
            toast(payload, true);
        } else if (type === 'jumpProgress') {
            updateStats(payload.current, '...');
        } else if (type === 'jumpComplete') {
            toast(`Jumped to gen ${payload}`);
        } else if (type === 'jumpError') {
            toast(payload, true);
        }
    }

    onWorkerError(e) {
        console.error('Worker error:', e.message, '\n  at', e.filename, ':', e.lineno);
        toast(`Worker error: ${e.message}`, true);
        this.isRunning = false;
        updateBtnState(false);
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
        const blob = new Blob([data.rle], {type: 'text/plain'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pattern_${Date.now()}.rle`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast("Exported RLE");
    }

    draw() {
        if (!this.lastGrid) return;

        const cellSize = CONF.cellSize;
        const canvasW = this.canvas.width;
        const canvasH = this.canvas.height;
        
        // Try WebGL for small cells (very fast for many cells)
        if (this.useWebGL && cellSize <= 3 && !CONF.useAgeColor && !CONF.useHeatmap) {
            if (!this.webglRenderer) {
                this.webglRenderer = new WebGLRenderer(this.canvas);
            }
            if (this.webglRenderer.available) {
                if (this.webglRenderer.render(this.lastGrid, this.stride, this.cols, this.rows, cellSize, CONF.liveColor)) {
                    // WebGL rendered, draw ghost pattern overlay using 2D context
                    this.drawGhostPattern();
                    return;
                }
            }
        }
        
        // Use ImageData for fast pixel rendering when cell size is small
        // For larger cells with grid lines, use fillRect approach
        if (cellSize <= 3) {
            this.drawImageData();
        } else {
            this.drawFillRect();
        }

        this.drawGhostPattern();
    }
    
    // Draw ghost pattern for paste mode
    drawGhostPattern() {
        const cellSize = CONF.cellSize;
        if (this.mode === 'paste' && !this.isRunning) {
            const sz = cellSize > 1 ? cellSize - 1 : 1;
            this.ctx.fillStyle = 'rgba(136, 192, 208, 0.5)';
            const p = getCurrentPattern();
            const mx = Math.floor(this.mouse.x / cellSize);
            const my = Math.floor(this.mouse.y / cellSize);
            
            for (let [px, py] of p) {
                const tx = (mx + px) * cellSize;
                const ty = (my + py) * cellSize;
                this.ctx.fillRect(tx, ty, sz, sz);
            }
        }
    }

    // Fast rendering using ImageData for small cell sizes
    drawImageData() {
        const cellSize = CONF.cellSize;
        const canvasW = this.canvas.width;
        const canvasH = this.canvas.height;
        
        // Create or reuse ImageData
        if (!this.imageData || this.imageData.width !== canvasW || this.imageData.height !== canvasH) {
            this.imageData = this.ctx.createImageData(canvasW, canvasH);
        }
        const data = this.imageData.data;
        
        // Parse colors once
        const deadRGB = hexToRGB(CONF.deadColor);
        const liveRGB = hexToRGB(CONF.liveColor);
        
        // Fill with dead color
        for (let i = 0; i < data.length; i += 4) {
            data[i] = deadRGB.r;
            data[i + 1] = deadRGB.g;
            data[i + 2] = deadRGB.b;
            data[i + 3] = 255;
        }
        
        // Draw live cells
        for (let i = 0; i < this.lastGrid.length; i++) {
            const word = this.lastGrid[i];
            if (word === 0) continue;
            
            const wordRow = Math.floor(i / this.stride);
            const wordColStart = (i % this.stride) * BITS_PER_WORD;
            
            for (let bit = 0; bit < BITS_PER_WORD; bit++) {
                if ((word >>> bit) & 1) {
                    const cellX = wordColStart + bit;
                    const cellY = wordRow;
                    
                    // Determine color
                    let rgb;
                    if (CONF.useAgeColor && this.lastAges) {
                        const age = this.lastAges[cellY * this.cols + cellX] || 0;
                        rgb = hexToRGB(getAgeColor(age));
                    } else {
                        rgb = liveRGB;
                    }
                    
                    // Fill cell pixels
                    const startX = cellX * cellSize;
                    const startY = cellY * cellSize;
                    const endX = Math.min(startX + cellSize, canvasW);
                    const endY = Math.min(startY + cellSize, canvasH);
                    
                    for (let py = startY; py < endY; py++) {
                        for (let px = startX; px < endX; px++) {
                            const idx = (py * canvasW + px) * 4;
                            data[idx] = rgb.r;
                            data[idx + 1] = rgb.g;
                            data[idx + 2] = rgb.b;
                        }
                    }
                }
            }
        }
        
        this.ctx.putImageData(this.imageData, 0, 0);
    }

    // Traditional fillRect rendering for larger cells with grid lines
    drawFillRect() {
        const cellSize = CONF.cellSize;
        const canvasW = this.canvas.width;
        const canvasH = this.canvas.height;
        
        // Clear
        this.ctx.fillStyle = CONF.deadColor;
        this.ctx.fillRect(0, 0, canvasW, canvasH);
        
        // Draw heatmap background if enabled
        if (CONF.useHeatmap && this.lastHeatmap) {
            for (let cellY = 0; cellY < this.rows; cellY++) {
                for (let cellX = 0; cellX < this.cols; cellX++) {
                    const heat = this.lastHeatmap[cellY * this.cols + cellX];
                    if (heat > 0) {
                        const color = getHeatmapColor(heat);
                        if (color) {
                            this.ctx.fillStyle = color;
                            this.ctx.globalAlpha = 0.5;
                            this.ctx.fillRect(cellX * cellSize, cellY * cellSize, cellSize, cellSize);
                            this.ctx.globalAlpha = 1;
                        }
                    }
                }
            }
        }

        // Grid Lines
        this.ctx.strokeStyle = '#353C4A';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        for (let x = 0; x <= canvasW; x += cellSize) {
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, canvasH);
        }
        for (let y = 0; y <= canvasH; y += cellSize) {
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(canvasW, y);
        }
        this.ctx.stroke();

        // Live Cells
        const sz = cellSize - 1;

        for (let i = 0; i < this.lastGrid.length; i++) {
            const word = this.lastGrid[i];
            if (word === 0) continue;

            const wordRow = Math.floor(i / this.stride);
            const wordColStart = (i % this.stride) * BITS_PER_WORD;

            for (let bit = 0; bit < BITS_PER_WORD; bit++) {
                if ((word >>> bit) & 1) {
                    const cellX = wordColStart + bit;
                    const cellY = wordRow;
                    const x = cellX * cellSize;
                    const y = cellY * cellSize;
                    
                    if (x < canvasW && y < canvasH) {
                        if (CONF.useAgeColor && this.lastAges) {
                            const age = this.lastAges[cellY * this.cols + cellX] || 0;
                            this.ctx.fillStyle = getAgeColor(age);
                        } else {
                            this.ctx.fillStyle = CONF.liveColor;
                        }
                        this.ctx.fillRect(x, y, sz, sz);
                    }
                }
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

// Initialize pattern system
buildPatternCache();
populatePatternDropdown();
resetCurrentPattern();

// Inject version into UI
document.getElementById('app-version').textContent = APP_VERSION;

const ui = new UI(canvas);
const statDisplay = document.getElementById('stat-display');

function updateStats(gen, pop, bbox = null, rule = null) {
    let text = `Gen: ${gen} | Pop: ${pop}`;
    if (bbox) {
        text += ` | ${bbox.w}x${bbox.h}`;
    }
    statDisplay.innerText = text;
    
    // Update population graph if visible
    drawPopGraph();
}

// Population graph
const popGraphCanvas = document.getElementById('pop-graph');
const popGraphCtx = popGraphCanvas.getContext('2d');

function drawPopGraph() {
    const history = ui.popHistory;
    if (history.length < 2) return;
    
    const w = popGraphCanvas.width;
    const h = popGraphCanvas.height;
    const max = Math.max(...history, 1);
    
    popGraphCtx.fillStyle = '#2E3440';
    popGraphCtx.fillRect(0, 0, w, h);
    
    // Draw grid lines
    popGraphCtx.strokeStyle = '#3B4252';
    popGraphCtx.lineWidth = 1;
    for (let y = 0; y < h; y += 10) {
        popGraphCtx.beginPath();
        popGraphCtx.moveTo(0, y);
        popGraphCtx.lineTo(w, y);
        popGraphCtx.stroke();
    }
    
    // Draw population line
    popGraphCtx.strokeStyle = '#A3BE8C';
    popGraphCtx.lineWidth = 1.5;
    popGraphCtx.beginPath();
    
    const step = w / (history.length - 1);
    for (let i = 0; i < history.length; i++) {
        const x = i * step;
        const y = h - (history[i] / max) * (h - 4) - 2;
        if (i === 0) {
            popGraphCtx.moveTo(x, y);
        } else {
            popGraphCtx.lineTo(x, y);
        }
    }
    popGraphCtx.stroke();
    
    // Draw legend at bottom
    popGraphCtx.fillStyle = '#88C0D0';
    popGraphCtx.font = '9px monospace';
    popGraphCtx.fillText(`max: ${max}`, 4, h - 4);
}

// Age color mapping using AGE_THRESHOLDS
function getAgeColor(age) {
    if (age <= AGE_THRESHOLDS.newborn) return CONF.ageColors[0];
    if (age <= AGE_THRESHOLDS.young) return CONF.ageColors[1];
    if (age <= AGE_THRESHOLDS.maturing) return CONF.ageColors[2];
    if (age <= AGE_THRESHOLDS.mature) return CONF.ageColors[3];
    if (age <= AGE_THRESHOLDS.old) return CONF.ageColors[4];
    return CONF.ageColors[5];
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
    setFps: (sliderVal) => {
        // Non-linear mapping: 0-6 = fractional (0.1, 0.2, 0.25, 0.33, 0.5, 0.75, 1)
        // 7-66 = 1-60 FPS
        const fractionalValues = [0.1, 0.2, 0.25, 0.33, 0.5, 0.75, 1];
        let fps, label;
        
        if (sliderVal < fractionalValues.length) {
            fps = fractionalValues[sliderVal];
            label = fps < 1 ? `${fps} FPS (${Math.round(1/fps)}s/step)` : '1 FPS';
        } else {
            fps = sliderVal - fractionalValues.length + 1;
            label = `${fps} FPS`;
        }
        
        document.getElementById('speed-range').value = sliderVal;
        document.getElementById('speed-label').innerText = label;
        ui.worker.postMessage({ type: 'setFps', payload: fps });
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
    }
};

// Bindings
document.getElementById('panel-toggle').onclick = actions.toggleSidebar;
document.getElementById('btn-center').onclick = actions.recenter;
document.getElementById('btn-play').onclick = actions.togglePlay;
document.getElementById('btn-step').onclick = actions.step;
document.getElementById('btn-rev-step').onclick = actions.reverse;
document.getElementById('btn-clear').onclick = actions.clear;
document.getElementById('btn-rand').onclick = actions.randomize;
document.getElementById('btn-jump').onclick = () => {
    const gen = parseInt(document.getElementById('jump-gen').value);
    if (gen > 0) {
        ui.worker.postMessage({ type: 'jumpToGen', payload: gen });
    }
};

document.getElementById('speed-range').oninput = (e) => actions.setFps(parseInt(e.target.value));
document.getElementById('zoom-range').oninput = (e) => actions.setZoom(parseInt(e.target.value));
document.getElementById('density-range').oninput = (e) => {
    document.getElementById('density-label').innerText = `${e.target.value}%`;
};

// History toggle
document.getElementById('history-toggle').onchange = (e) => {
    const enabled = e.target.checked;
    const sizeInput = document.getElementById('history-size');
    const revBtn = document.getElementById('btn-rev-step');
    
    sizeInput.disabled = !enabled;
    revBtn.disabled = !enabled;
    
    ui.worker.postMessage({
        type: 'setHistory',
        payload: { enabled, size: parseInt(sizeInput.value) }
    });
};

document.getElementById('history-size').onchange = (e) => {
    const enabled = document.getElementById('history-toggle').checked;
    if (enabled) {
        ui.worker.postMessage({
            type: 'setHistory',
            payload: { enabled, size: parseInt(e.target.value) }
        });
    }
};

document.querySelectorAll('.tool-btn').forEach(b => {
    b.onclick = () => {
        document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
        b.classList.add('active');
        ui.mode = b.dataset.mode;
    };
});

// Pattern selection resets to base orientation (intentional design choice)
// This avoids confusion when switching patterns mid-rotation
document.getElementById('pattern-select').onchange = (e) => {
    currentPatternKey = e.target.value;
    resetCurrentPattern();
    document.querySelector('[data-mode="paste"]').click();
};
document.getElementById('btn-rotate').onclick = actions.rotate;

// Reset pattern to base orientation
document.getElementById('btn-reset-pattern')?.addEventListener('click', () => {
    resetCurrentPattern();
    toast("Pattern reset");
});

// Load pattern to grid button
document.getElementById('btn-load-pattern')?.addEventListener('click', () => {
    loadPatternToGrid(currentPatternKey);
});

// Color picker
document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.onclick = () => {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        CONF.liveColor = swatch.dataset.color;
    };
});

// Age color toggle
document.getElementById('age-color-toggle').onchange = (e) => {
    CONF.useAgeColor = e.target.checked;
    ui.worker.postMessage({ type: 'setAgeTracking', payload: e.target.checked });
    // Disable heatmap if age is enabled (mutually exclusive)
    if (e.target.checked) {
        document.getElementById('heatmap-toggle').checked = false;
        CONF.useHeatmap = false;
        ui.worker.postMessage({ type: 'setHeatmap', payload: false });
    }
};

// Heatmap toggle
document.getElementById('heatmap-toggle').onchange = (e) => {
    CONF.useHeatmap = e.target.checked;
    ui.worker.postMessage({ type: 'setHeatmap', payload: e.target.checked });
    // Disable age color if heatmap is enabled (mutually exclusive)
    if (e.target.checked) {
        document.getElementById('age-color-toggle').checked = false;
        CONF.useAgeColor = false;
        ui.worker.postMessage({ type: 'setAgeTracking', payload: false });
    }
};

// WebGL toggle
document.getElementById('webgl-toggle').onchange = (e) => {
    ui.useWebGL = e.target.checked;
    if (e.target.checked && !ui.webglRenderer) {
        ui.webglRenderer = new WebGLRenderer(ui.canvas);
        if (!ui.webglRenderer.available) {
            toast('WebGL not available', true);
            e.target.checked = false;
            ui.useWebGL = false;
        } else {
            toast('WebGL enabled');
        }
    }
};

function rotateCurrentPattern() {
    const p = getCurrentPattern();
    let minX = Infinity, minY = Infinity;
    const rotated = p.map(([x, y]) => {
        const nx = -y;
        const ny = x;
        if (nx < minX) minX = nx;
        if (ny < minY) minY = ny;
        return [nx, ny];
    });
    const normalized = rotated.map(([x, y]) => [x - minX, y - minY]);
    currentPatternCoords = normalized;
    toast("Rotated");
}

// RLE Parser (used by unified import)
// Returns { ok: true, coords: [...] } or { ok: false, error: string }
const RLE_MAX_CELLS = 10_000_000;
const RLE_MAX_RUN_LENGTH = 100_000;

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
            // Validate run-length during accumulation
            if (count > RLE_MAX_RUN_LENGTH) {
                return { ok: false, error: `Run length ${count} exceeds maximum (${RLE_MAX_RUN_LENGTH})` };
            }
        } else if (char === 'b') { // Dead cell
            x += (count || 1);
            count = 0;
        } else if (char === 'o') { // Live cell
            const run = count || 1;
            // Check cell limit before adding
            if (coords.length + run > RLE_MAX_CELLS) {
                return { ok: false, error: `Pattern exceeds maximum cell count (${RLE_MAX_CELLS})` };
            }
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
    return { ok: true, coords };
}

// Mouse move handler to track cursor and apply tools / panning
canvas.addEventListener('mousemove', e => {
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
        const p = getCurrentPattern();
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
        case 'ArrowLeft': 
            if (document.getElementById('history-toggle').checked) {
                actions.reverse();
            }
            break;
        case 'c': case 'C': actions.clear(); break;
        case 'r': case 'R': actions.rotate(); break;
        case '[': {
            const current = parseInt(document.getElementById('speed-range').value);
            actions.setFps(Math.max(0, current - 3));
        } break;
        case ']': {
            const current = parseInt(document.getElementById('speed-range').value);
            actions.setFps(Math.min(SPEED_SLIDER_MAX, current + 3));
        } break;
        case '/': if (e.ctrlKey) toggleHelp(); break;
        case 'Escape': document.getElementById('help-modal').classList.remove('show'); break;
        case 'Tab': e.preventDefault(); actions.toggleSidebar(); break;
    }
});

function toggleHelp() {
    document.getElementById('help-modal').classList.toggle('show');
}

// FPS display
const fpsDisplay = document.getElementById('fps-display');
function updateFpsDisplay(actual, target, chunks, historySize = 0) {
    const color = actual >= target * 0.9 ? 'var(--success)' : 
                  actual >= target * 0.5 ? 'var(--warning)' : 'var(--error)';
    let text = `<span style="color:${color}">${actual}</span>/${target} FPS | ${chunks} chunks`;
    if (historySize > 0) {
        text += ` | ${historySize} hist`;
    }
    fpsDisplay.innerHTML = text;
}

const toast = (txt, isError = false) => {
    const el = document.getElementById('msg');
    el.innerText = txt;
    el.style.borderColor = isError ? CONF.error : CONF.liveColor;
    el.style.opacity = 1;
    setTimeout(() => el.style.opacity = 0, 2000);
};

// Rule Selection
document.getElementById('rule-preset').onchange = (e) => {
    const customRow = document.getElementById('custom-rule-row');
    if (e.target.value === 'custom') {
        customRow.style.display = 'flex';
    } else {
        customRow.style.display = 'none';
        ui.worker.postMessage({ type: 'setRule', payload: e.target.value });
    }
};

document.getElementById('btn-apply-rule').onclick = () => {
    const rule = document.getElementById('custom-rule').value.trim();
    if (rule) {
        ui.worker.postMessage({ type: 'setRule', payload: rule });
    }
};

document.getElementById('custom-rule').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('btn-apply-rule').click();
    }
});

// IO
document.getElementById('btn-export').onclick = () => {
    ui.worker.postMessage({ type: 'export' });
};

document.getElementById('btn-import-trigger').onclick = () => {
    document.getElementById('file-import').click();
};

// File size limits
const FILE_SIZE_WARN_MB = 10;
const FILE_SIZE_HARD_LIMIT_MB = 100;

document.getElementById('file-import').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // File size validation
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > FILE_SIZE_HARD_LIMIT_MB) {
        toast(`File too large (${sizeMB.toFixed(1)} MB). Max: ${FILE_SIZE_HARD_LIMIT_MB} MB`, true);
        e.target.value = '';
        return;
    }
    if (sizeMB > FILE_SIZE_WARN_MB) {
        if (!confirm(`Large file (${sizeMB.toFixed(1)} MB). This may take a while. Continue?`)) {
            e.target.value = '';
            return;
        }
    }
    
    const reader = new FileReader();
    reader.onload = (ev) => {
        const content = ev.target.result;
        const ext = file.name.split('.').pop().toLowerCase();
        
        // Detect format: MC, RLE, or JSON
        if (ext === 'mc' || content.startsWith('[M2]')) {
            loadFromMacrocell(content);
        } else if (ext === 'rle' || ext === 'txt' || (content.includes('!') && !content.startsWith('{'))) {
            loadFromRLE(content);
        } else {
            loadFromJSON(content);
        }
    };
    reader.readAsText(file);
    e.target.value = ''; 
};

function loadFromRLE(rleString) {
    try {
        const result = parseRLE(rleString);
        if (!result.ok) {
            toast(result.error, true);
            return;
        }
        const coords = result.coords;
        if (coords.length === 0) throw new Error("No cells found");
        
        // Convert coords to packed format for worker
        // Find bounding box
        let maxX = 0, maxY = 0;
        for (let [x, y] of coords) {
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
        
        const w = maxX + 1;
        const h = maxY + 1;
        const stride = Math.ceil(w / BITS_PER_WORD);
        const data = new Array(stride * h).fill(0);
        
        for (let [x, y] of coords) {
            const wordIdx = y * stride + Math.floor(x / BITS_PER_WORD);
            const bit = x % BITS_PER_WORD;
            data[wordIdx] |= (1 << bit);
        }
        
        ui.worker.postMessage({
            type: 'load',
            payload: { w, h, data, packed: true }
        });
        toast("RLE Loaded");
    } catch (e) {
        console.error(e);
        toast("Invalid RLE", true);
    }
}

const MC_MAX_CELLS = 10_000_000;
const MC_MAX_NODES = 1_000_000;

function loadFromMacrocell(mcString) {
    try {
        const lines = mcString.split('\n');
        const nodes = [null]; // 1-indexed: node 0 = empty
        
        // Parse 8x8 leaf pattern from RLE-like string
        function parseLeaf(rle) {
            const grid = new Array(8).fill(null).map(() => new Array(8).fill(0));
            let x = 0, y = 0;
            let count = 0;
            
            for (let i = 0; i < rle.length; i++) {
                const ch = rle[i];
                if (ch >= '0' && ch <= '9') {
                    count = count * 10 + parseInt(ch);
                } else if (ch === 'b' || ch === '.') {
                    x += (count || 1);
                    count = 0;
                } else if (ch === 'o' || ch === '*') {
                    const run = count || 1;
                    for (let k = 0; k < run; k++) {
                        if (x < 8 && y < 8) grid[y][x] = 1;
                        x++;
                    }
                    count = 0;
                } else if (ch === '$') {
                    y += (count || 1);
                    x = 0;
                    count = 0;
                }
            }
            return { level: 3, grid }; // Level 3 = 2^3 = 8x8 leaf
        }
        
        for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith('[') || line.startsWith('#')) continue;
            
            // Check if it's an internal node (starts with number)
            const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);
            if (match) {
                const level = parseInt(match[1]);
                const nw = parseInt(match[2]);
                const ne = parseInt(match[3]);
                const sw = parseInt(match[4]);
                const se = parseInt(match[5]);
                
                // Validate node references are in bounds
                const currentIdx = nodes.length;
                if (nw < 0 || nw >= currentIdx || ne < 0 || ne >= currentIdx ||
                    sw < 0 || sw >= currentIdx || se < 0 || se >= currentIdx) {
                    throw new Error(`Invalid node reference at node ${currentIdx}: indices must be < ${currentIdx}`);
                }
                
                nodes.push({ level, nw, ne, sw, se });
            } else if (line[0] === '$' || line[0] === '.' || line[0] === '*' || 
                       line[0] === 'o' || line[0] === 'b') {
                // It's a leaf node (8x8 pattern in RLE)
                nodes.push(parseLeaf(line));
            }
            
            // Limit node count to prevent DoS
            if (nodes.length > MC_MAX_NODES) {
                throw new Error(`Node count exceeds maximum (${MC_MAX_NODES})`);
            }
        }
        
        if (nodes.length <= 1) throw new Error("No nodes found");
        
        const coords = [];
        
        // Iterative extraction (avoid stack overflow on deep trees)
        const root = nodes[nodes.length - 1];
        const rootSize = Math.pow(2, root.level);
        const stack = [[nodes.length - 1, 0, 0, rootSize]];
        
        while (stack.length > 0) {
            const [nodeIdx, x, y, size] = stack.pop();
            
            if (nodeIdx === 0) continue;
            
            const node = nodes[nodeIdx];
            if (!node) continue;
            
            if (node.grid) {
                // Leaf node: 8x8 grid
                for (let ly = 0; ly < 8; ly++) {
                    for (let lx = 0; lx < 8; lx++) {
                        if (node.grid[ly][lx]) {
                            coords.push([x + lx, y + ly]);
                            if (coords.length > MC_MAX_CELLS) {
                                throw new Error(`Cell count exceeds maximum (${MC_MAX_CELLS})`);
                            }
                        }
                    }
                }
            } else {
                // Internal node: push quadrants to stack
                const half = size / 2;
                stack.push([node.se, x + half, y + half, half]);
                stack.push([node.sw, x, y + half, half]);
                stack.push([node.ne, x + half, y, half]);
                stack.push([node.nw, x, y, half]);
            }
        }
        
        if (coords.length === 0) throw new Error("No live cells found");
        
        // Normalize to origin
        let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
        for (let [x, y] of coords) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
        
        const w = maxX - minX + 1;
        const h = maxY - minY + 1;
        const stride = Math.ceil(w / BITS_PER_WORD);
        const data = new Array(stride * h).fill(0);
        
        for (let [x, y] of coords) {
            const nx = x - minX;
            const ny = y - minY;
            const wordIdx = ny * stride + Math.floor(nx / BITS_PER_WORD);
            const bit = nx % BITS_PER_WORD;
            data[wordIdx] |= (1 << bit);
        }
        
        ui.worker.postMessage({
            type: 'load',
            payload: { w, h, data, packed: true }
        });
        toast(`Loaded ${coords.length} cells`);
    } catch (e) {
        console.error(e);
        toast(e.message || "Invalid Macrocell", true);
    }
}

function loadFromJSON(jsonString) {
    try {
        const state = JSON.parse(jsonString);
        if (!state.w || !state.h || !state.data) throw new Error("Invalid Format");

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
