// ─────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────
const GRID_SIZE = 60;
const WATER_CHANNEL_SIZE = 2;
const NUM_ISLANDS_PER_SIDE = 2;
const ISLAND_SIZE_LAND = (GRID_SIZE - (WATER_CHANNEL_SIZE * (NUM_ISLANDS_PER_SIDE - 1))) / NUM_ISLANDS_PER_SIDE;

const INITIAL_TREES = 50;
const MAX_TREE_AGE = 100;
const MAX_TREE_HEIGHT = 10;
const INITIAL_HEALTH = 100;
const MAX_HEALTH = 100;
const WATER_REGEN_RATE = 0.05;
const NUTRIENT_REGEN_RATE = 0.05;
const MAX_CELL_RESOURCE = 100;
const MUTATION_RATE = 0.1;
const MUTATION_MAGNITUDE = 0.2;

const GENE_GROWTH_RATE = 0;
const GENE_WATER_EFFICIENCY = 1;
const GENE_NUTRIENT_EFFICIENCY = 2;
const GENE_SEED_ABUNDANCE = 3;
const GENE_SHADE_TOLERANCE = 4;
const GENOME_SIZE = 5;

const FLASH_DURATION = 500;

// ─────────────────────────────────────────────
//  Isometric projection settings
// ─────────────────────────────────────────────
// Each logical grid cell maps to an isometric tile.
// Tile dimensions (in canvas pixels).
const ISO_TW = 14;          // tile width  (diamond x-span)
const ISO_TH = 7;           // tile height (diamond y-span)
const ISO_MAX_PILLAR = 28;  // max canvas-px height for a full-height tree pillar

// Convert grid (col, row) → canvas (cx, cy) for the TOP-LEFT corner of the tile top face.
function isoProject(col, row) {
  const cx = (col - row) * (ISO_TW / 2);
  const cy = (col + row) * (ISO_TH / 2);
  return { cx, cy };
}

// ─────────────────────────────────────────────
//  Canvas setup
// ─────────────────────────────────────────────
const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');

// The grid spans from (0,0) to (GRID_SIZE-1, GRID_SIZE-1).
// Compute required canvas size by projecting all four corners.
function computeCanvasSize() {
  const corners = [
    isoProject(0, 0),
    isoProject(GRID_SIZE - 1, 0),
    isoProject(0, GRID_SIZE - 1),
    isoProject(GRID_SIZE - 1, GRID_SIZE - 1),
  ];
  const xs = corners.map(c => c.cx);
  const ys = corners.map(c => c.cy);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs) + ISO_TW;
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys) + ISO_TH + ISO_MAX_PILLAR;
  return { width: maxX - minX, height: maxY - minY, offsetX: -minX, offsetY: -minY + ISO_MAX_PILLAR };
}

const { width: CW, height: CH, offsetX: OX, offsetY: OY } = computeCanvasSize();
canvas.width = CW;
canvas.height = CH;

// ─────────────────────────────────────────────
//  Simulation state
// ─────────────────────────────────────────────
let grid = [];
let cellResources = [];
let trees = [];
let generation = 0;
let isRunning = false;
let simulationInterval;
let nextTreeId = 0;
let GENERATION_TIME = 200;
let MIGRATION_PERCENTAGE = 0.1;
let MIGRATION_INTERVAL = 50;
let REPLACEMENT_STRATEGY = 'leastFitted';
let MIGRATION_START_GENERATION = 200;

// Flash map: key "col,row" → { endTime }
const flashMap = new Map();

// ─────────────────────────────────────────────
//  DOM references
// ─────────────────────────────────────────────
const startButton = document.getElementById('startButton');
const pauseButton = document.getElementById('pauseButton');
const resetButton = document.getElementById('resetButton');
const generationCountSpan = document.getElementById('generationCount');
const populationCountSpan = document.getElementById('populationCount');
const migrationRateSlider = document.getElementById('migrationRateSlider');
const migrationRateValueSpan = document.getElementById('migrationRateValue');
const migrationIntervalSlider = document.getElementById('migrationIntervalSlider');
const migrationIntervalValueSpan = document.getElementById('migrationIntervalValue');
const speedSlider = document.getElementById('speedSlider');
const speedValueSpan = document.getElementById('speedValue');
const autostopCheckbox = document.getElementById('autostopCheckbox');
const stopConditionDropdown = document.getElementById('stopConditionDropdown');
const migrationStartGenDropdown = document.getElementById('migrationStartGenDropdown');
const replacementStrategyDropdown = document.getElementById('replacementStrategyDropdown');
const islandHealthList = document.getElementById('island-health-list');
const tooltip = document.getElementById('tooltip');

// ─────────────────────────────────────────────
//  Color helpers
// ─────────────────────────────────────────────
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0)*255), Math.round(f(8)*255), Math.round(f(4)*255)];
}

function treeHsl(fitness, height) {
  const f = Math.min(120, fitness);
  let hue;
  if (f <= 90) hue = (f / 90) * 35;
  else hue = 35 + ((f - 90) / 30) * 85;
  const sat = 80;
  const lit = 40 + Math.round(height / MAX_TREE_HEIGHT * 20);
  return { hue, sat, lit };
}

function shade(hue, sat, lit, factor) {
  // darken for side faces
  return `hsl(${hue},${sat}%,${Math.max(0, lit * factor)}%)`;
}

// ─────────────────────────────────────────────
//  Isometric draw primitives
// ─────────────────────────────────────────────
function drawTileTop(cx, cy, fillStyle, strokeStyle) {
  ctx.beginPath();
  ctx.moveTo(cx + ISO_TW / 2, cy);
  ctx.lineTo(cx + ISO_TW, cy + ISO_TH / 2);
  ctx.lineTo(cx + ISO_TW / 2, cy + ISO_TH);
  ctx.lineTo(cx, cy + ISO_TH / 2);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 0.4;
    ctx.stroke();
  }
}

function drawPillar(cx, cy, pillarH, topColor, hue, sat, lit) {
  if (pillarH <= 0) return;
  const ty = cy - pillarH;

  // Left face (darker)
  ctx.beginPath();
  ctx.moveTo(cx, cy + ISO_TH / 2);
  ctx.lineTo(cx, ty + ISO_TH / 2);
  ctx.lineTo(cx + ISO_TW / 2, ty + ISO_TH);
  ctx.lineTo(cx + ISO_TW / 2, cy + ISO_TH);
  ctx.closePath();
  ctx.fillStyle = shade(hue, sat, lit, 0.55);
  ctx.fill();

  // Right face (medium)
  ctx.beginPath();
  ctx.moveTo(cx + ISO_TW / 2, cy + ISO_TH);
  ctx.lineTo(cx + ISO_TW / 2, ty + ISO_TH);
  ctx.lineTo(cx + ISO_TW, ty + ISO_TH / 2);
  ctx.lineTo(cx + ISO_TW, cy + ISO_TH / 2);
  ctx.closePath();
  ctx.fillStyle = shade(hue, sat, lit, 0.75);
  ctx.fill();

  // Top face
  drawTileTop(cx, ty, topColor, null);
}

// ─────────────────────────────────────────────
//  Tree class
// ─────────────────────────────────────────────
class Tree {
  constructor(id, x, y, genome, age = 0, height = 1, health = INITIAL_HEALTH, storedWater = 0, storedNutrients = 0) {
    this.id = id;
    this.x = x; this.y = y;
    this.genome = genome;
    this.age = age;
    this.height = height;
    this.health = health;
    this.storedWater = storedWater;
    this.storedNutrients = storedNutrients;
    this.isAlive = true;
    this.fitness = 0;
  }

  calculateFitness() {
    this.fitness = (this.age * 0.1) + (this.health * 0.5) + (this.seedAbundance * 100);
    this.fitness = Math.max(0.1, this.fitness);
  }

  get growthRate()         { return 0.05 + this.genome[GENE_GROWTH_RATE] * 0.1; }
  get waterEfficiency()    { return 0.5  + this.genome[GENE_WATER_EFFICIENCY] * 0.5; }
  get nutrientEfficiency() { return 0.5  + this.genome[GENE_NUTRIENT_EFFICIENCY] * 0.5; }
  get seedAbundance()      { return 0.1  + this.genome[GENE_SEED_ABUNDANCE] * 0.4; }
  get shadeTolerance()     { return this.genome[GENE_SHADE_TOLERANCE]; }
  get waterNeed()          { return this.height * 2; }
  get nutrientNeed()       { return this.height * 1.5; }

  consumeResources() {
    const cell = cellResources[this.x][this.y];
    const wc = Math.min(this.waterNeed, cell.water * this.waterEfficiency);
    this.storedWater += wc; cell.water -= wc;
    const nc = Math.min(this.nutrientNeed, cell.nutrients * this.nutrientEfficiency);
    this.storedNutrients += nc; cell.nutrients -= nc;
    const ws = this.storedWater / this.waterNeed;
    const ns = this.storedNutrients / this.nutrientNeed;
    const overall = (ws + ns) / 2;
    if (overall < 0.8)      this.health -= (0.8 - overall) * 20;
    else if (overall > 1.2) this.health += (overall - 1) * 5;
    this.health = Math.max(0, Math.min(MAX_HEALTH, this.health));
    this.storedWater    = Math.max(0, this.storedWater    - this.waterNeed);
    this.storedNutrients = Math.max(0, this.storedNutrients - this.nutrientNeed);
  }

  grow() {
    if (this.health > MAX_HEALTH * 0.75) {
      this.height = Math.min(MAX_TREE_HEIGHT, this.height + this.growthRate);
    }
  }

  reproduce() {
    if (this.age > MAX_TREE_AGE / 5 && Math.random() < this.seedAbundance) {
      const spots = [];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = this.x + dx, ny = this.y + dy;
        if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE && grid[nx][ny] === null)
          spots.push({ x: nx, y: ny });
      }
      if (spots.length > 0) {
        const spot = spots[Math.floor(Math.random() * spots.length)];
        const ng = this.genome.map(g =>
          Math.random() < MUTATION_RATE ? Math.max(0, Math.min(1, g + (Math.random() - 0.5) * MUTATION_MAGNITUDE)) : g
        );
        return new Tree(nextTreeId++, spot.x, spot.y, ng, 0, 1, INITIAL_HEALTH);
      }
    }
    return null;
  }

  checkMortality() {
    if (this.health <= 0 || this.age >= MAX_TREE_AGE) { this.isAlive = false; return true; }
    return false;
  }
}

// ─────────────────────────────────────────────
//  Island / grid helpers
// ─────────────────────────────────────────────
const HWS = GRID_SIZE / 2 - WATER_CHANNEL_SIZE / 2;
const HWE = GRID_SIZE / 2 + WATER_CHANNEL_SIZE / 2 - 1;
const VWS = HWS, VWE = HWE; // symmetric

function isWater(x, y) {
  return (x >= HWS && x <= HWE) || (y >= VWS && y <= VWE);
}

function getIslandIndex(x, y) {
  if (isWater(x, y)) return null;
  let ax = x > HWE ? x - WATER_CHANNEL_SIZE : x;
  let ay = y > VWE ? y - WATER_CHANNEL_SIZE : y;
  return Math.floor(ay / ISLAND_SIZE_LAND) * NUM_ISLANDS_PER_SIDE + Math.floor(ax / ISLAND_SIZE_LAND);
}

// ─────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────
function initSimulation() {
  generation = 0;
  trees = []; nextTreeId = 0;
  grid = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null));
  cellResources = Array.from({ length: GRID_SIZE }, (_, i) =>
    Array.from({ length: GRID_SIZE }, (_, j) => {
      const w = isWater(i, j);
      return w
        ? { water: MAX_CELL_RESOURCE * 2, nutrients: MAX_CELL_RESOURCE * 0.1 }
        : { water: MAX_CELL_RESOURCE * 0.8, nutrients: MAX_CELL_RESOURCE * 0.8 };
    })
  );
  // Mark water in grid
  for (let i = 0; i < GRID_SIZE; i++)
    for (let j = 0; j < GRID_SIZE; j++)
      if (isWater(i, j)) grid[i][j] = 'water';

  flashMap.clear();

  MIGRATION_PERCENTAGE = parseFloat(migrationRateSlider.value) / 100;
  migrationRateValueSpan.textContent = `${migrationRateSlider.value}%`;
  MIGRATION_INTERVAL = parseInt(migrationIntervalSlider.value);
  migrationIntervalValueSpan.textContent = `${MIGRATION_INTERVAL} gen`;
  MIGRATION_START_GENERATION = parseInt(migrationStartGenDropdown.value);
  REPLACEMENT_STRATEGY = replacementStrategyDropdown.value;
  setSimulationSpeed(speedSlider.value);

  for (let i = 0; i < INITIAL_TREES; i++) {
    const islandIdx = Math.floor(Math.random() * NUM_ISLANDS_PER_SIDE * NUM_ISLANDS_PER_SIDE);
    addRandomTree(islandIdx);
  }

  renderFrame();
  updateControls();
}

function addRandomTree(targetIslandIndex = null, initialGenome = null, isMigrant = false) {
  let sx = 0, ex = GRID_SIZE - 1, sy = 0, ey = GRID_SIZE - 1;
  if (targetIslandIndex !== null) {
    const row = Math.floor(targetIslandIndex / NUM_ISLANDS_PER_SIDE);
    const col = targetIslandIndex % NUM_ISLANDS_PER_SIDE;
    sx = col * ISLAND_SIZE_LAND + (col === 1 ? WATER_CHANNEL_SIZE : 0);
    ex = sx + ISLAND_SIZE_LAND - 1;
    sy = row * ISLAND_SIZE_LAND + (row === 1 ? WATER_CHANNEL_SIZE : 0);
    ey = sy + ISLAND_SIZE_LAND - 1;
  }
  let attempts = 0;
  const MAX_A = GRID_SIZE * GRID_SIZE;
  while (attempts++ < MAX_A) {
    const x = sx + Math.floor(Math.random() * (ex - sx + 1));
    const y = sy + Math.floor(Math.random() * (ey - sy + 1));
    if (grid[x][y] === null) {
      const genome = initialGenome || Array.from({ length: GENOME_SIZE }, () => Math.random());
      const t = new Tree(nextTreeId++, x, y, genome);
      trees.push(t);
      grid[x][y] = t;
      if (isMigrant) flashMap.set(`${x},${y}`, { endTime: Date.now() + FLASH_DURATION });
      return t;
    }
  }
  return null;
}

// ─────────────────────────────────────────────
//  Simulation step
// ─────────────────────────────────────────────
function updateEcosystem() {
  generation++;

  if (generation >= MIGRATION_START_GENERATION &&
      (generation - MIGRATION_START_GENERATION) % MIGRATION_INTERVAL === 0) {
    handleMigration();
  }

  // Resource regen
  for (let i = 0; i < GRID_SIZE; i++)
    for (let j = 0; j < GRID_SIZE; j++) {
      cellResources[i][j].water    = Math.min(MAX_CELL_RESOURCE, cellResources[i][j].water    + MAX_CELL_RESOURCE * WATER_REGEN_RATE);
      cellResources[i][j].nutrients = Math.min(MAX_CELL_RESOURCE, cellResources[i][j].nutrients + MAX_CELL_RESOURCE * NUTRIENT_REGEN_RATE);
    }

  trees.sort(() => Math.random() - 0.5);
  const newTrees = [], livingTrees = [];
  trees.forEach(tree => {
    if (!tree.isAlive) return;
    tree.age++;
    tree.consumeResources();
    tree.grow();
    const offspring = tree.reproduce();
    if (offspring && grid[offspring.x][offspring.y] === null) {
      newTrees.push(offspring);
      grid[offspring.x][offspring.y] = offspring;
    }
    if (tree.checkMortality()) grid[tree.x][tree.y] = null;
    else livingTrees.push(tree);
  });
  trees = livingTrees.concat(newTrees);

  renderFrame();
  const islandData = updateIslandStats();
  checkAutoStop(islandData);
}

// ─────────────────────────────────────────────
//  Migration
// ─────────────────────────────────────────────
function handleMigration() {
  const numIslands = NUM_ISLANDS_PER_SIDE * NUM_ISLANDS_PER_SIDE;
  const cwMap = { 0: 1, 1: 3, 3: 2, 2: 0 };
  const byIsland = Array.from({ length: numIslands }, () => []);
  trees.forEach(t => {
    if (!t.isAlive) return;
    const idx = getIslandIndex(t.x, t.y);
    if (idx !== null) byIsland[idx].push(t);
  });
  byIsland.forEach(arr => { arr.forEach(t => t.calculateFitness()); arr.sort((a, b) => b.fitness - a.fitness); });

  const newMigrants = [];
  for (let src = 0; src < numIslands; src++) {
    const srcTrees = byIsland[src]; if (!srcTrees.length) continue;
    const dst = cwMap[src];
    const dstTrees = byIsland[dst];
    const nMig = Math.ceil(srcTrees.length * MIGRATION_PERCENTAGE);
    const top = srcTrees.slice(0, nMig);
    const nReplace = Math.ceil(dstTrees.length * MIGRATION_PERCENTAGE);
    if (dstTrees.length > 0 && nReplace > 0) {
      let victims;
      if (REPLACEMENT_STRATEGY === 'random') {
        victims = [...dstTrees].sort(() => Math.random() - 0.5).slice(0, nReplace);
      } else {
        dstTrees.forEach(t => t.calculateFitness());
        victims = [...dstTrees].sort((a, b) => a.fitness - b.fitness).slice(0, nReplace);
      }
      victims.forEach((victim, i) => {
        victim.isAlive = false;
        grid[victim.x][victim.y] = null;
        const parent = top[i % top.length];
        const ng = parent.genome.map(g =>
          Math.random() < MUTATION_RATE ? Math.max(0, Math.min(1, g + (Math.random() - 0.5) * MUTATION_MAGNITUDE)) : g
        );
        const nt = new Tree(nextTreeId++, victim.x, victim.y, ng);
        newMigrants.push(nt);
        grid[nt.x][nt.y] = nt;
        flashMap.set(`${nt.x},${nt.y}`, { endTime: Date.now() + FLASH_DURATION });
      });
    } else if (dstTrees.length === 0) {
      top.forEach(parent => {
        const ng = parent.genome.map(g =>
          Math.random() < MUTATION_RATE ? Math.max(0, Math.min(1, g + (Math.random() - 0.5) * MUTATION_MAGNITUDE)) : g
        );
        addRandomTree(dst, ng, true);
      });
    }
  }
  trees = trees.filter(t => t.isAlive).concat(newMigrants);
}

// ─────────────────────────────────────────────
//  Rendering
// ─────────────────────────────────────────────
function renderFrame() {
  ctx.clearRect(0, 0, CW, CH);

  const now = Date.now();

  // Draw in painter's order: top rows first, then bottom rows.
  // Isometric painter's order: iterate rows 0→N then cols 0→N within each row.
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const { cx: rawCx, cy: rawCy } = isoProject(c, r);
      const cx = rawCx + OX;
      const cy = rawCy + OY;

      const cell = grid[c][r];
      const res  = cellResources[c][r];

      if (cell === 'water') {
        // Animated shimmer: slight brightness pulse
        const shimmer = 0.5 + 0.06 * Math.sin(now / 600 + c * 0.3 + r * 0.2);
        drawTileTop(cx, cy, `rgba(30,80,200,${shimmer})`, 'rgba(60,120,255,0.4)');
      } else if (cell instanceof Tree) {
        cell.calculateFitness();
        const { hue, sat, lit } = treeHsl(cell.fitness, cell.height);
        const pillarH = (cell.height / MAX_TREE_HEIGHT) * ISO_MAX_PILLAR;
        const opacity = 0.55 + 0.45 * (cell.health / MAX_HEALTH);

        const flashing = flashMap.has(`${c},${r}`) && flashMap.get(`${c},${r}`).endTime > now;
        const topColor = flashing
          ? `rgba(255,255,255,${opacity})`
          : `hsla(${hue},${sat}%,${lit}%,${opacity})`;

        // Ground tile beneath pillar
        drawTileTop(cx, cy, `hsla(${hue},${sat}%,${Math.max(0,lit-18)}%,0.6)`, null);
        drawPillar(cx, cy, pillarH, topColor, hue, sat, lit);
      } else {
        // Empty land — color by nutrients/water
        const nf = res.nutrients / MAX_CELL_RESOURCE;
        const wf = res.water    / MAX_CELL_RESOURCE;
        const g  = Math.round(80 + nf * 40);
        const b  = Math.round(wf * 30);
        drawTileTop(cx, cy, `rgb(30,${g},${b})`, 'rgba(0,0,0,0.08)');
      }
    }
  }

  // Clean stale flash entries
  flashMap.forEach((v, k) => { if (v.endTime <= now) flashMap.delete(k); });

  // HUD
  generationCountSpan.textContent = generation;
  populationCountSpan.textContent = trees.length;
}

// ─────────────────────────────────────────────
//  Stats
// ─────────────────────────────────────────────
function updateIslandStats() {
  const numIslands = NUM_ISLANDS_PER_SIDE * NUM_ISLANDS_PER_SIDE;
  const data = Array.from({ length: numIslands }, () => ({ totalHealth: 0, totalFitness: 0, count: 0 }));
  trees.forEach(t => {
    if (!t.isAlive) return;
    const idx = getIslandIndex(t.x, t.y);
    if (idx !== null) {
      t.calculateFitness();
      data[idx].totalHealth  += t.health;
      data[idx].totalFitness += t.fitness;
      data[idx].count++;
    }
  });
  const frag = document.createDocumentFragment();
  data.forEach((d, i) => {
    const div = document.createElement('div');
    div.className = 'island-stat-item';
    const h = d.count > 0 ? (d.totalHealth  / d.count).toFixed(1) : '0.0';
    const f = d.count > 0 ? (d.totalFitness / d.count).toFixed(1) : '0.0';
    div.innerHTML = `Island ${i + 1}: <span>H:${h}%</span> <b>F:${f}</b> (${d.count})`;
    frag.appendChild(div);
  });
  islandHealthList.innerHTML = '';
  islandHealthList.appendChild(frag);
  return data;
}

function checkAutoStop(islandData) {
  if (!autostopCheckbox.checked) return;
  const cond = stopConditionDropdown.value;
  let stop = false;
  if (cond === 'allFitness100') stop = islandData.every(d => d.count > 0 && d.totalFitness / d.count >= 100);
  else if (cond === 'generation500')  stop = generation >= 500;
  else if (cond === 'generation1000') stop = generation >= 1000;
  if (stop) pauseSimulation();
}

// ─────────────────────────────────────────────
//  Controls
// ─────────────────────────────────────────────
function startSimulation() {
  if (!isRunning) {
    isRunning = true;
    if (simulationInterval) clearInterval(simulationInterval);
    simulationInterval = setInterval(updateEcosystem, GENERATION_TIME);
    updateControls();
  }
}

function pauseSimulation() {
  if (isRunning) {
    isRunning = false;
    clearInterval(simulationInterval);
    updateControls();
  }
}

function resetSimulation() {
  pauseSimulation();
  initSimulation();
}

function updateControls() {
  startButton.disabled = isRunning;
  pauseButton.disabled = !isRunning;
}

function setSimulationSpeed(val) {
  GENERATION_TIME = 1000 / parseInt(val);
  const v = parseInt(val);
  speedValueSpan.textContent = v < 7 ? 'Slow' : v < 14 ? 'Medium' : 'Fast';
  if (isRunning) {
    clearInterval(simulationInterval);
    simulationInterval = setInterval(updateEcosystem, GENERATION_TIME);
  }
}

// ─────────────────────────────────────────────
//  Tooltip on hover
// ─────────────────────────────────────────────
function canvasToGrid(mouseX, mouseY) {
  // Invert the isometric projection to find the closest grid cell.
  // Compensate for canvas CSS scaling.
  const rect = canvas.getBoundingClientRect();
  const scaleX = CW / rect.width;
  const scaleY = CH / rect.height;
  const px = mouseX * scaleX - OX;
  const py = mouseY * scaleY - OY;
  // col = (px/tw + py/th) / 2
  // row = (py/th - px/tw) / 2
  const col = Math.round((px / (ISO_TW / 2) + py / (ISO_TH / 2)) / 2);
  const row = Math.round((py / (ISO_TH / 2) - px / (ISO_TW / 2)) / 2);
  return { col, row };
}

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const { col, row } = canvasToGrid(mx, my);

  if (col < 0 || col >= GRID_SIZE || row < 0 || row >= GRID_SIZE) {
    tooltip.style.display = 'none';
    return;
  }

  const cell = grid[col][row];
  if (cell instanceof Tree) {
    cell.calculateFitness();
    tooltip.textContent =
      `X:${col}  Y:${row}\n` +
      `Age: ${cell.age}\n` +
      `Height: ${cell.height.toFixed(2)}\n` +
      `Health: ${cell.health.toFixed(1)}\n` +
      `Fitness: ${cell.fitness.toFixed(1)}\n` +
      `Water: ${cell.storedWater.toFixed(1)}\n` +
      `Nutrients: ${cell.storedNutrients.toFixed(1)}\n` +
      `Genome: [${cell.genome.map(g => g.toFixed(2)).join(', ')}]`;
    tooltip.style.display = 'block';
    tooltip.style.left = (mx + 12) + 'px';
    tooltip.style.top  = (my - 10) + 'px';
  } else if (cell === 'water') {
    const r = cellResources[col][row];
    tooltip.textContent = `Water cell\nX:${col}  Y:${row}\nWater: ${r.water.toFixed(1)}`;
    tooltip.style.display = 'block';
    tooltip.style.left = (mx + 12) + 'px';
    tooltip.style.top  = (my - 10) + 'px';
  } else {
    tooltip.style.display = 'none';
  }
});

canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

// ─────────────────────────────────────────────
//  Event listeners
// ─────────────────────────────────────────────
startButton.addEventListener('click', startSimulation);
pauseButton.addEventListener('click', pauseSimulation);
resetButton.addEventListener('click', resetSimulation);

migrationRateSlider.addEventListener('input', e => {
  MIGRATION_PERCENTAGE = parseFloat(e.target.value) / 100;
  migrationRateValueSpan.textContent = `${e.target.value}%`;
});
migrationIntervalSlider.addEventListener('input', e => {
  MIGRATION_INTERVAL = parseInt(e.target.value);
  migrationIntervalValueSpan.textContent = `${MIGRATION_INTERVAL} gen`;
});
speedSlider.addEventListener('input', e => setSimulationSpeed(parseInt(e.target.value)));
migrationStartGenDropdown.addEventListener('change', e => {
  MIGRATION_START_GENERATION = parseInt(e.target.value);
});
replacementStrategyDropdown.addEventListener('change', e => {
  REPLACEMENT_STRATEGY = e.target.value;
});

// ─────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────
initSimulation();
