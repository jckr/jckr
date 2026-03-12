const fs = require("fs");

const COLS = 40;
const ROWS = 40;
const CELL_SIZE = 6;
const STATE_FILE = "state.json";
const SVG_FILE = "game.svg";
const README_FILE = "README.md";

const RESEED_THRESHOLD = 80; // 5% of 1600 cells

// --- Patterns (relative coordinates of alive cells) ---
const PATTERNS = {
  rpentomino: [
    [0, -1], [1, -1], [-1, 0], [0, 0], [0, 1],
  ],
  acorn: [
    [-3, -1], [-1, 0], [-3, 1], [-2, 1], [0, 1], [1, 1], [2, 1],
  ],
  rabbits: [
    [-3, -1], [-2, -1], [-1, -1], [1, -1], [-3, 0], [0, 1], [2, 1], [3, 1],
  ],
  gliderGun: [
    [24,0],[22,1],[24,1],[12,2],[13,2],[20,2],[21,2],[34,2],[35,2],
    [11,3],[15,3],[20,3],[21,3],[34,3],[35,3],[0,4],[1,4],[10,4],
    [16,4],[20,4],[21,4],[0,5],[1,5],[10,5],[14,5],[16,5],[17,5],
    [22,5],[24,5],[10,6],[16,6],[24,6],[11,7],[15,7],[12,8],[13,8],
  ],
};

// Simple deterministic PRNG (mulberry32)
function mulberry32(seed) {
  let t = seed | 0;
  return function () {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Color utilities ---
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function relativeLuminance([r, g, b]) {
  const srgb = [r, g, b].map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hexToRgb(hex1));
  const l2 = relativeLuminance(hexToRgb(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function generateColors(rng) {
  // Background colors (9, for popcount 0-8): pastel tones spread around color wheel
  const bgColors = [];
  const baseHue = rng() * 360;
  for (let i = 0; i < 9; i++) {
    const hue = baseHue + i * 40 + (rng() - 0.5) * 30;
    const sat = 30 + rng() * 35;
    const lit = 65 + rng() * 20;
    bgColors.push(hslToHex(hue, sat, lit));
  }

  // Symbol colors (3): vivid, well-separated hues
  const symbolHues = [];
  const firstHue = rng() * 360;
  symbolHues.push(firstHue);
  symbolHues.push(firstHue + 120 + (rng() - 0.5) * 40);
  symbolHues.push(firstHue + 240 + (rng() - 0.5) * 40);

  const symbolColors = symbolHues.map((hue) => {
    const sat = 70 + rng() * 20;
    let lit = 40 + rng() * 15;
    let hex = hslToHex(hue, sat, lit);

    // Validate contrast against all bg colors, adjust lightness if needed
    for (let attempt = 0; attempt < 20; attempt++) {
      const minContrast = Math.min(...bgColors.map((bg) => contrastRatio(hex, bg)));
      if (minContrast >= 3.0) break;
      lit = Math.max(15, lit - 3);
      hex = hslToHex(hue, sat, lit);
    }
    return hex;
  });

  return {
    bgColors,
    symbolColor: symbolColors[0],
    symbolColorDying: symbolColors[1],
    symbolColorAppearing: symbolColors[2],
  };
}

// --- Shape distortion ---
function generateShapeParams(rng) {
  const params = {};

  // Polygons: triangle(3), quad(4), pentagon(5), hex(6), heptagon(7), octagon(8)
  // Larger distortion for fewer sides (triangles/quads look more interesting when irregular)
  for (let sides = 3; sides <= 8; sides++) {
    const vertices = [];
    const baseRotation = rng() * 2 * Math.PI;
    // More distortion for fewer sides: tri/quad get ±25°, higher polygons get ±15°
    const maxAngleJitter = sides <= 4 ? (Math.PI / 7.2) : (Math.PI / 12);
    const radiusRange = sides <= 4 ? 0.5 : 0.35; // 0.65-1.35 vs 0.75-1.1
    const radiusBase = sides <= 4 ? 0.65 : 0.825;
    for (let i = 0; i < sides; i++) {
      vertices.push({
        angleOffset: (rng() - 0.5) * 2 * maxAngleJitter,
        radiusMultiplier: radiusBase + rng() * radiusRange,
      });
    }
    params[`polygon_${sides}`] = { baseRotation, vertices };
  }

  // Lines (neighborCount === 2)
  params.line = {
    rotation: rng() * Math.PI,
    lengthMultiplier: 0.6 + rng() * 0.4,
  };

  // Dots/circles (neighborCount === 0 and 1) -> ellipses
  for (const key of ["dot_0", "dot_1"]) {
    const rxMul = 0.7 + rng() * 0.6;
    let ryMul = 0.7 + rng() * 0.6;
    // Constrain so neither axis is <0.5x or >1.5x the other
    const ratio = rxMul / ryMul;
    if (ratio < 0.5) ryMul = rxMul / 0.5;
    else if (ratio > 1.5) ryMul = rxMul / 1.5;
    params[key] = {
      rxMultiplier: rxMul,
      ryMultiplier: ryMul,
      rotation: rng() * 360,
    };
  }

  return params;
}

// --- Seed generation ---
function createSeed(seed) {
  const rng = mulberry32(seed);
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const history = Array.from({ length: ROWS }, () => Array(COLS).fill(0));

  function placePattern(pattern, cx, cy) {
    for (const [dx, dy] of pattern) {
      const x = ((cx + dx) % COLS + COLS) % COLS;
      const y = ((cy + dy) % ROWS + ROWS) % ROWS;
      grid[y][x] = true;
    }
  }

  // Methuselahs in different quadrants
  placePattern(PATTERNS.rpentomino, 10, 10);
  placePattern(PATTERNS.acorn, 30, 30);
  placePattern(PATTERNS.rabbits, 10, 30);
  placePattern(PATTERNS.rpentomino, 30, 10);

  // Glider gun
  placePattern(PATTERNS.gliderGun, 2, 2);

  // Sprinkle ~25% random cells for immediate density
  const targetDensity = 0.25;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!grid[y][x] && rng() < targetDensity) {
        grid[y][x] = true;
      }
    }
  }

  // Set history for initial alive cells
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (grid[y][x]) history[y][x] = 1;
    }
  }

  const colors = generateColors(rng);
  const shapeParams = generateShapeParams(rng);

  return { iteration: 0, grid, history, seed, colors, shapeParams };
}

// --- Game of Life with toroidal wrapping ---
function countNeighbors(grid, x, y) {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = ((x + dx) % COLS + COLS) % COLS;
      const ny = ((y + dy) % ROWS + ROWS) % ROWS;
      if (grid[ny][nx]) count++;
    }
  }
  return count;
}

function getNeighborPositions(grid, x, y) {
  const positions = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = ((x + dx) % COLS + COLS) % COLS;
      const ny = ((y + dy) % ROWS + ROWS) % ROWS;
      if (grid[ny][nx]) positions.push([dx, dy]);
    }
  }
  return positions;
}

function nextGeneration(grid) {
  return grid.map((row, y) =>
    row.map((cell, x) => {
      const n = countNeighbors(grid, x, y);
      return cell ? n === 2 || n === 3 : n === 3;
    })
  );
}

function updateHistory(history, newGrid) {
  return history.map((row, y) =>
    row.map((val, x) => ((val << 1) & 0xff) | (newGrid[y][x] ? 1 : 0))
  );
}

function popcount(n) {
  let count = 0;
  while (n) {
    count += n & 1;
    n >>= 1;
  }
  return count;
}

// --- SVG Generation ---

function distortedPolygonPoints(cx, cy, r, sides, shapeParam) {
  const points = [];
  for (let i = 0; i < sides; i++) {
    const baseAngle = shapeParam.baseRotation + (2 * Math.PI * i) / sides;
    const v = shapeParam.vertices[i];
    const angle = baseAngle + v.angleOffset;
    const vr = r * v.radiusMultiplier;
    points.push(
      `${(cx + vr * Math.cos(angle)).toFixed(2)},${(cy + vr * Math.sin(angle)).toFixed(2)}`
    );
  }
  return points.join(" ");
}

function generateSymbol(x, y, neighborCount, neighborPositions, status, colors, shapeParams) {
  const cx = x * CELL_SIZE + CELL_SIZE / 2;
  const cy = y * CELL_SIZE + CELL_SIZE / 2;
  const r = CELL_SIZE * 0.35;

  let color;
  if (status === "surviving") color = colors.symbolColor;
  else if (status === "dying") color = colors.symbolColorDying;
  else color = colors.symbolColorAppearing;

  switch (neighborCount) {
    case 0: {
      const p = shapeParams.dot_0;
      const rx = (r * 0.5 * p.rxMultiplier).toFixed(2);
      const ry = (r * 0.5 * p.ryMultiplier).toFixed(2);
      return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${color}" transform="rotate(${p.rotation.toFixed(1)}, ${cx}, ${cy})"/>`;
    }

    case 1: {
      const [dx, dy] = neighborPositions[0];
      const len = Math.sqrt(dx * dx + dy * dy);
      const offsetX = (dx / len) * r * 0.6;
      const offsetY = (dy / len) * r * 0.6;
      const ecx = cx + offsetX;
      const ecy = cy + offsetY;
      const p = shapeParams.dot_1;
      const rx = (r * 0.45 * p.rxMultiplier).toFixed(2);
      const ry = (r * 0.45 * p.ryMultiplier).toFixed(2);
      return `<ellipse cx="${ecx.toFixed(2)}" cy="${ecy.toFixed(2)}" rx="${rx}" ry="${ry}" fill="${color}" transform="rotate(${p.rotation.toFixed(1)}, ${ecx.toFixed(2)}, ${ecy.toFixed(2)})"/>`;
    }

    case 2: {
      const p = shapeParams.line;
      const halfLen = r * 0.85 * p.lengthMultiplier;
      const cos = Math.cos(p.rotation);
      const sin = Math.sin(p.rotation);
      return `<line x1="${(cx - halfLen * cos).toFixed(2)}" y1="${(cy - halfLen * sin).toFixed(2)}" x2="${(cx + halfLen * cos).toFixed(2)}" y2="${(cy + halfLen * sin).toFixed(2)}" stroke="${color}" stroke-width="1.2"/>`;
    }

    case 3: {
      const triCy = cy + r * 0.25;
      const sp = shapeParams.polygon_3;
      if (status === "appearing") {
        return `<polygon points="${distortedPolygonPoints(cx, triCy, r * 0.85, 3, sp)}" fill="none" stroke="${color}" stroke-width="0.4"/>`;
      }
      return `<polygon points="${distortedPolygonPoints(cx, triCy, r, 3, sp)}" fill="${color}"/>`;
    }

    case 4: {
      const sp = shapeParams.polygon_4;
      return `<polygon points="${distortedPolygonPoints(cx, cy, r * 0.95, 4, sp)}" fill="${color}"/>`;
    }

    case 5:
    case 6:
    case 7:
    case 8: {
      const sp = shapeParams[`polygon_${neighborCount}`];
      return `<polygon points="${distortedPolygonPoints(cx, cy, r, neighborCount, sp)}" fill="${color}"/>`;
    }

    default:
      return "";
  }
}

function generateSVG(grid, newGrid, history, colors, shapeParams) {
  const width = COLS * CELL_SIZE;
  const height = ROWS * CELL_SIZE;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">\n`;

  // Background rects
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const pc = popcount(history[y][x]);
      const color = colors.bgColors[pc];
      svg += `<rect x="${x * CELL_SIZE}" y="${y * CELL_SIZE}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="${color}"/>\n`;
    }
  }

  // Symbols
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const alive = newGrid[y][x];
      const neighborCount = countNeighbors(newGrid, x, y);
      const neighborPositions = getNeighborPositions(newGrid, x, y);

      let status = null;
      if (alive && (neighborCount === 2 || neighborCount === 3)) {
        status = "surviving";
      } else if (alive) {
        status = "dying";
      } else if (!alive && neighborCount === 3) {
        status = "appearing";
      }

      if (status) {
        svg += generateSymbol(x, y, neighborCount, neighborPositions, status, colors, shapeParams) + "\n";
      }
    }
  }

  svg += `</svg>`;
  return svg;
}

// --- README update ---
function formatDate(date) {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yyyy = date.getFullYear();
  let hours = date.getHours();
  const ampm = hours >= 12 ? "pm" : "am";
  hours = hours % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${mm}-${dd}-${yyyy} ${hours}:${minutes}${ampm}`;
}

function updateReadme(iteration, seed) {
  const now = formatDate(new Date());

  const newContent = `<img src="game.svg" width="100%">

<code>#${iteration} ${seed} ${now}</code>
`;

  fs.writeFileSync(README_FILE, newContent);
}

function countAlive(grid) {
  let count = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (grid[y][x]) count++;
    }
  }
  return count;
}

const WARMUP_TURNS = 8;

function warmUp(state) {
  for (let i = 0; i < WARMUP_TURNS; i++) {
    const oldGrid = state.grid;
    const newGrid = nextGeneration(oldGrid);
    state.history = updateHistory(state.history, newGrid);
    state.grid = newGrid;
    state.iteration++;
  }
  return state;
}

// --- Main ---
function main() {
  const isSeed = process.argv.includes("--seed");

  let state;
  if (isSeed || !fs.existsSync(STATE_FILE)) {
    const seed = Date.now();
    console.log(`Creating seed state (seed: ${seed})...`);
    state = warmUp(createSeed(seed));
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    const svg = generateSVG(state.grid, state.grid, state.history, state.colors, state.shapeParams);
    fs.writeFileSync(SVG_FILE, svg);
    updateReadme(state.iteration, state.seed);
    console.log(`Seed created. Iteration: ${state.iteration}`);
    return;
  }

  state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  const oldGrid = state.grid;
  const newGrid = nextGeneration(oldGrid);
  const aliveCount = countAlive(newGrid);

  if (aliveCount < RESEED_THRESHOLD) {
    const seed = Date.now();
    console.log(`Alive cells (${aliveCount}) below threshold (${RESEED_THRESHOLD}). Re-seeding (seed: ${seed})...`);
    state = warmUp(createSeed(seed));
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    const svg = generateSVG(state.grid, state.grid, state.history, state.colors, state.shapeParams);
    fs.writeFileSync(SVG_FILE, svg);
    updateReadme(state.iteration, state.seed);
    return;
  }

  const newHistory = updateHistory(state.history, newGrid);
  const newIteration = state.iteration + 1;

  const svg = generateSVG(oldGrid, newGrid, newHistory, state.colors, state.shapeParams);
  fs.writeFileSync(SVG_FILE, svg);

  const newState = {
    iteration: newIteration,
    grid: newGrid,
    history: newHistory,
    seed: state.seed,
    colors: state.colors,
    shapeParams: state.shapeParams,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(newState));
  updateReadme(newIteration, state.seed);
  console.log(`Updated to iteration ${newIteration}`);
}

main();
