const fs = require("fs");

const COLS = 40;
const ROWS = 40;
const CELL_SIZE = 6;
const STATE_FILE = "state.json";
const SVG_FILE = "game.svg";
const README_FILE = "README.md";

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
  // Gosper glider gun (top-left corner at 0,0)
  gliderGun: [
    [24,0],[22,1],[24,1],[12,2],[13,2],[20,2],[21,2],[34,2],[35,2],
    [11,3],[15,3],[20,3],[21,3],[34,3],[35,3],[0,4],[1,4],[10,4],
    [16,4],[20,4],[21,4],[0,5],[1,5],[10,5],[14,5],[16,5],[17,5],
    [22,5],[24,5],[10,6],[16,6],[24,6],[11,7],[15,7],[12,8],[13,8],
  ],
};

// --- Seed generation ---
function createSeed() {
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

  // Glider gun — top-left area, will send gliders diagonally across the grid
  placePattern(PATTERNS.gliderGun, 2, 2);

  // Sprinkle ~10% random cells for immediate density
  const rng = mulberry32(42); // deterministic seed
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

  return { iteration: 0, grid, history };
}

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

// Color palette: history popcount 0-8 mapped from cool gray to warm orange
const BG_COLORS = [
  "#a3e0e6", // 0
  "#e7b5ad", // 1
  "#9fc2e7", // 2
  "#bee4ba", // 3
  "#d1b8e2", // 4
  "#95c1ac", // 5
  "#cfc5d6", // 6
  "#d8d4b4", // 7
  "#adcac9", // 8
];

const SYMBOL_COLOR = "#ff8c00";
const SYMBOL_COLOR_DYING = "#dc3545";
const SYMBOL_COLOR_APPEARING = "#00b894";

function regularPolygonPoints(cx, cy, r, sides) {
  const points = [];
  const angleOffset = -Math.PI / 2; // start from top
  for (let i = 0; i < sides; i++) {
    const angle = angleOffset + (2 * Math.PI * i) / sides;
    points.push(
      `${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`
    );
  }
  return points.join(" ");
}

function generateSymbol(x, y, neighborCount, neighborPositions, status) {
  const cx = x * CELL_SIZE + CELL_SIZE / 2;
  const cy = y * CELL_SIZE + CELL_SIZE / 2;
  const r = CELL_SIZE * 0.35;

  let color;
  if (status === "surviving") color = SYMBOL_COLOR;
  else if (status === "dying") color = SYMBOL_COLOR_DYING;
  else color = SYMBOL_COLOR_APPEARING; // appearing

  const opacity = 1;

  switch (neighborCount) {
    case 0:
      // Small centered circle
      return `<circle cx="${cx}" cy="${cy}" r="${r * 0.5}" fill="${color}" opacity="${opacity}"/>`;

    case 1: {
      // Dot offset toward neighbor
      const [dx, dy] = neighborPositions[0];
      const len = Math.sqrt(dx * dx + dy * dy);
      const offsetX = (dx / len) * r * 0.6;
      const offsetY = (dy / len) * r * 0.6;
      return `<circle cx="${(cx + offsetX).toFixed(2)}" cy="${(cy + offsetY).toFixed(2)}" r="${r * 0.45}" fill="${color}" opacity="${opacity}"/>`;
    }

    case 2:
      // Thick line (horizontal)
      return `<line x1="${(cx - r * 0.85).toFixed(2)}" y1="${cy}" x2="${(cx + r * 0.85).toFixed(2)}" y2="${cy}" stroke="${color}" stroke-width="1.2" opacity="${opacity}"/>`;

    case 3: {
      // Triangle — shift down by r/4 to visually center the bounding box
      const triCy = cy + r * 0.25;
      if (status === "appearing") {
        // Slightly smaller radius to compensate for stroke adding visual size
        return `<polygon points="${regularPolygonPoints(cx, triCy, r * 0.85, 3)}" fill="none" stroke="${color}" stroke-width="0.4" opacity="${opacity}"/>`;
      }
      return `<polygon points="${regularPolygonPoints(cx, triCy, r, 3)}" fill="${color}" opacity="${opacity}"/>`;
    }

    case 4:
      // Square
      return `<rect x="${(cx - r * 0.7).toFixed(2)}" y="${(cy - r * 0.7).toFixed(2)}" width="${(r * 1.4).toFixed(2)}" height="${(r * 1.4).toFixed(2)}" fill="${color}" opacity="${opacity}"/>`;

    case 5:
    case 6:
    case 7:
    case 8:
      // Regular polygon (5-8 sides)
      return `<polygon points="${regularPolygonPoints(cx, cy, r, neighborCount)}" fill="${color}" opacity="${opacity}"/>`;

    default:
      return "";
  }
}

function generateSVG(grid, newGrid, history) {
  const width = COLS * CELL_SIZE;
  const height = ROWS * CELL_SIZE;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">\n`;

  // Background rects
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const pc = popcount(history[y][x]);
      const color = BG_COLORS[pc];
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
        svg += generateSymbol(x, y, neighborCount, neighborPositions, status) + "\n";
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

function updateReadme(iteration) {
  const readme = fs.readFileSync(README_FILE, "utf8");
  const now = formatDate(new Date());

  const newContent = `<img src="game.svg" width="100%">

#${iteration} - last updated: ${now}
`;

  fs.writeFileSync(README_FILE, newContent);
}

// --- Main ---
function main() {
  const isSeed = process.argv.includes("--seed");

  let state;
  if (isSeed || !fs.existsSync(STATE_FILE)) {
    console.log("Creating seed state...");
    state = createSeed();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    // Generate SVG for the initial state (use grid as both old and new for first render)
    const svg = generateSVG(state.grid, state.grid, state.history);
    fs.writeFileSync(SVG_FILE, svg);
    updateReadme(state.iteration);
    console.log(`Seed created. Iteration: ${state.iteration}`);
    return;
  }

  state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  const oldGrid = state.grid;
  const newGrid = nextGeneration(oldGrid);
  const newHistory = updateHistory(state.history, newGrid);
  const newIteration = state.iteration + 1;

  const svg = generateSVG(oldGrid, newGrid, newHistory);
  fs.writeFileSync(SVG_FILE, svg);

  const newState = {
    iteration: newIteration,
    grid: newGrid,
    history: newHistory,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(newState));
  updateReadme(newIteration);
  console.log(`Updated to iteration ${newIteration}`);
}

main();
