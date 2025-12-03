/**
 * lib.js - Pure utility functions for Life Engine
 * 
 * Extracted for:
 * - Unit testing (can be imported in Node/Vitest)
 * - Code sharing between main thread and worker
 * 
 * Usage:
 * - Browser main thread: <script src="lib.js"></script> (exposes window.Lib)
 * - Worker: importScripts('lib.js') (exposes self.Lib)
 * - ES Module / Node: import { parseRLE, ... } from './lib.js'
 */

(function(exports) {
    'use strict';

    // =============================================================================
    // CONSTANTS
    // =============================================================================
    
    const RLE_MAX_CELLS = 10_000_000;
    const RLE_MAX_RUN_LENGTH = 100_000;

    // =============================================================================
    // COLOR UTILITIES
    // =============================================================================

    /**
     * Convert hex color string to RGB object.
     * @param {string} hex - Hex color (e.g., "#A3BE8C" or "A3BE8C")
     * @returns {{r: number, g: number, b: number}}
     */
    function hexToRGB(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 0, g: 0, b: 0 };
    }

    // =============================================================================
    // RLE PARSING
    // =============================================================================

    /**
     * Parse RLE (Run Length Encoded) pattern string.
     * 
     * RLE format:
     * - 'b' or '.': dead cell
     * - 'o' or '*': live cell
     * - '$': end of row
     * - '!': end of pattern
     * - digits: run count (applies to next cell/row token)
     * - Lines starting with '#' or 'x =' are metadata/headers
     * 
     * @param {string} str - RLE string
     * @returns {{ok: true, coords: [number, number][]} | {ok: false, error: string}}
     */
    function parseRLE(str) {
        const lines = str.split('\n');
        let data = '';
        
        // Strip headers/comments
        for (let line of lines) {
            line = line.trim();
            if (line.startsWith('#') || line.startsWith('x =') || line.startsWith('x=')) continue;
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
            } else if (char === 'b' || char === '.') { // Dead cell
                x += (count || 1);
                count = 0;
            } else if (char === 'o' || char === '*') { // Live cell
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
            // Ignore whitespace and unknown characters
        }
        return { ok: true, coords };
    }

    /**
     * Convert RLE string to coordinate array (simpler version without validation).
     * Used for pattern library loading where patterns are known-good.
     * 
     * @param {string} rle - RLE pattern string (just the pattern, no headers)
     * @returns {[number, number][]} Array of [x, y] coordinates
     */
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

    /**
     * Convert coordinate array to RLE string.
     * 
     * @param {[number, number][]} coords - Array of [x, y] live cell coordinates
     * @returns {string} RLE-encoded pattern string
     */
    function coordsToRLE(coords) {
        if (coords.length === 0) return '!';
        
        // Find bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of coords) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        
        const w = maxX - minX + 1;
        const h = maxY - minY + 1;
        
        // Build grid
        const grid = new Array(h).fill(null).map(() => new Array(w).fill(false));
        for (const [x, y] of coords) {
            grid[y - minY][x - minX] = true;
        }
        
        // Generate RLE
        let rle = '';
        const MAX_LINE_LEN = 70;
        let lineLen = 0;
        
        for (let y = 0; y < h; y++) {
            let x = 0;
            
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
                
                // Line wrap
                if (lineLen + token.length > MAX_LINE_LEN && lineLen > 0) {
                    rle += '\n';
                    lineLen = 0;
                }
                
                rle += token;
                lineLen += token.length;
                x += count;
            }
            
            // End of row
            const terminator = (y < h - 1) ? '$' : '!';
            if (lineLen + 1 > MAX_LINE_LEN && lineLen > 0) {
                rle += '\n';
                lineLen = 0;
            }
            rle += terminator;
            lineLen += 1;
        }
        
        return rle;
    }

    // =============================================================================
    // RULE PARSING
    // =============================================================================

    /**
     * Parse Life-like rule string (B.../S... format).
     * 
     * Examples:
     * - "B3/S23" - Conway's Game of Life
     * - "B36/S23" - HighLife
     * - "B2/S" - Seeds
     * - "B3/S012345678" - Life without Death
     * 
     * @param {string} ruleStr - Rule string in B/S format
     * @returns {{birth: boolean[], survival: boolean[]} | null} Parsed rule or null if invalid
     */
    function parseRule(ruleStr) {
        const birth = [false, false, false, false, false, false, false, false, false];
        const survival = [false, false, false, false, false, false, false, false, false];
        
        const match = ruleStr.toUpperCase().match(/B(\d*)\/S(\d*)/);
        if (!match) return null;
        
        const birthDigits = match[1] || '';
        const survivalDigits = match[2] || '';
        
        for (const d of birthDigits) {
            const n = parseInt(d);
            if (n >= 0 && n <= 8) birth[n] = true;
        }
        for (const d of survivalDigits) {
            const n = parseInt(d);
            if (n >= 0 && n <= 8) survival[n] = true;
        }
        
        return { birth, survival };
    }

    /**
     * Validate a rule string.
     * 
     * @param {string} ruleStr - Rule string to validate
     * @returns {boolean} True if valid
     */
    function isValidRule(ruleStr) {
        return parseRule(ruleStr) !== null;
    }

    /**
     * Normalize a rule string to canonical format (e.g., "b3/s23" -> "B3/S23").
     * 
     * @param {string} ruleStr - Rule string
     * @returns {string | null} Normalized rule string or null if invalid
     */
    function normalizeRule(ruleStr) {
        const parsed = parseRule(ruleStr);
        if (!parsed) return null;
        
        let b = '', s = '';
        for (let i = 0; i <= 8; i++) {
            if (parsed.birth[i]) b += i;
            if (parsed.survival[i]) s += i;
        }
        return `B${b}/S${s}`;
    }

    // =============================================================================
    // BIT OPERATIONS
    // =============================================================================

    /**
     * Population count (Hamming weight) for 32-bit integer.
     * Counts the number of 1-bits in the integer.
     * 
     * Uses the parallel bit-counting algorithm (SWAR).
     * 
     * @param {number} n - 32-bit integer
     * @returns {number} Number of 1-bits (0-32)
     */
    function popcount32(n) {
        n = n - ((n >>> 1) & 0x55555555);
        n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
        return (((n + (n >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
    }

    // =============================================================================
    // EXPORTS
    // =============================================================================

    exports.hexToRGB = hexToRGB;
    exports.parseRLE = parseRLE;
    exports.rleToCoords = rleToCoords;
    exports.coordsToRLE = coordsToRLE;
    exports.parseRule = parseRule;
    exports.isValidRule = isValidRule;
    exports.normalizeRule = normalizeRule;
    exports.popcount32 = popcount32;
    
    // Constants
    exports.RLE_MAX_CELLS = RLE_MAX_CELLS;
    exports.RLE_MAX_RUN_LENGTH = RLE_MAX_RUN_LENGTH;

})(typeof exports !== 'undefined' ? exports : (typeof self !== 'undefined' ? (self.Lib = {}) : (window.Lib = {})));
