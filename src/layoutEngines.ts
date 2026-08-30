export interface PlantType {
  id: number;
  name: string;
  height: number;
  spread: number;
  shape: string;
  color: string;
  textColor: string;
  defaultSize: number;
  radius: number;
  count: number;
}

export interface PlantInstance extends PlantType {
  instanceId: number;
  x: number;
  y: number;
}

// Shared by layout engines (initial placement) and manual dragging on the
// design screen, so it lives here rather than inside a single engine.
export const resolveCollisions = (
  activeId: number | null,
  currentPlants: PlantInstance[],
  overlapPct: number
): PlantInstance[] => {
  const nodes = [...currentPlants];
  let relaxing = true;
  let loops = 0;
  const allowedOverlapFactor = 1 - (overlapPct / 100);

  while (relaxing && loops < 20) {
    relaxing = false;
    loops++;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minD = (nodes[i].radius + nodes[j].radius) * allowedOverlapFactor;

        if (dist < minD && dist > 0) {
          relaxing = true;
          const overlap = minD - dist;
          const nx = dx / dist;
          const ny = dy / dist;

          if (nodes[i].instanceId === activeId) {
            nodes[j].x += nx * overlap;
            nodes[j].y += ny * overlap;
          } else if (nodes[j].instanceId === activeId) {
            nodes[i].x -= nx * overlap;
            nodes[i].y -= ny * overlap;
          } else {
            nodes[i].x -= (nx * overlap) / 2;
            nodes[i].y -= (ny * overlap) / 2;
            nodes[j].x += (nx * overlap) / 2;
            nodes[j].y += (ny * overlap) / 2;
          }
        }
      }
    }
  }
  return nodes;
};

// Only used for initial placement — manual rearrangement must never snap
// plants back in, or dragging near an edge would fight the user.
const clampCentersToBed = (
  nodes: PlantInstance[],
  bedWidth: number,
  bedHeight: number
): PlantInstance[] =>
  nodes.map(n => ({
    ...n,
    x: Math.min(bedWidth, Math.max(0, n.x)),
    y: Math.min(bedHeight, Math.max(0, n.y)),
  }));

export interface EngineParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface LayoutEngine {
  id: string;
  label: string;
  description: string;
  getParamDefs: (plantConfig: PlantType[]) => EngineParamDef[];
  generate: (
    plantConfig: PlantType[],
    bedWidth: number,
    bedHeight: number,
    overlapPct: number,
    params: Record<string, number>
  ) => PlantInstance[];
  // Optional: advance the given layout by a single Metropolis-Hastings
  // proposal at a fixed temperature, for engines that support animating
  // their dynamics live rather than only exposing the annealed result.
  step?: (
    plants: PlantInstance[],
    bedWidth: number,
    bedHeight: number,
    overlapPct: number,
    params: Record<string, number>
  ) => PlantInstance[];
}

const randomRelax: LayoutEngine = {
  id: 'random-relax',
  label: 'Random Scatter + Relax',
  description: 'Scatters plants at random positions, then iteratively pushes overlapping plants apart.',
  getParamDefs: () => [],
  generate: (plantConfig, bedWidth, bedHeight, overlapPct, _params) => {
    const instances: PlantInstance[] = [];
    let uid = 0;
    plantConfig.forEach(pt => {
      for (let i = 0; i < pt.count; i++) {
        instances.push({
          ...pt,
          instanceId: uid++,
          x: Math.random() * bedWidth,
          y: Math.random() * bedHeight,
        });
      }
    });
    const relaxed = resolveCollisions(null, instances, overlapPct);
    return clampCentersToBed(relaxed, bedWidth, bedHeight);
  },
};

// One Metropolis-Hastings proposal: pick a random plant, nudge it by up to
// moveScale, reject outright (hard constraint) on going out of bounds or
// violating the allowed-overlap rule, else accept/reject by the change in
// same-species 1/distance repulsion energy at the given temperature. Returns
// the same array reference when the proposal is rejected.
const metropolisPropose = (
  nodes: PlantInstance[],
  bedWidth: number,
  bedHeight: number,
  allowedOverlapFactor: number,
  moveScale: number,
  temperature: number,
  repulsionByType: Record<number, number>
): PlantInstance[] => {
  const n = nodes.length;
  if (n < 2) return nodes;

  const idx = Math.floor(Math.random() * n);
  const angle = Math.random() * Math.PI * 2;
  const newX = nodes[idx].x + Math.cos(angle) * moveScale * Math.random();
  const newY = nodes[idx].y + Math.sin(angle) * moveScale * Math.random();
  if (newX < 0 || newX > bedWidth || newY < 0 || newY > bedHeight) return nodes;

  for (let j = 0; j < n; j++) {
    if (j === idx) continue;
    const other = nodes[j];
    const dx = newX - other.x;
    const dy = newY - other.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minD = (nodes[idx].radius + other.radius) * allowedOverlapFactor;
    if (dist < minD) return nodes;
  }

  const self = nodes[idx];
  const J = repulsionByType[self.id] ?? 0;
  const energyAt = (x: number, y: number) => {
    if (J === 0) return 0;
    let e = 0;
    for (let j = 0; j < n; j++) {
      if (j === idx || nodes[j].id !== self.id) continue;
      const dx = x - nodes[j].x;
      const dy = y - nodes[j].y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      e += J / dist;
    }
    return e;
  };

  const dE = energyAt(newX, newY) - energyAt(self.x, self.y);
  if (dE <= 0 || Math.random() < Math.exp(-dE / Math.max(temperature, 1e-6))) {
    const next = nodes.slice();
    next[idx] = { ...self, x: newX, y: newY };
    return next;
  }
  return nodes;
};

// A 2-spin (Ising-style) graphical model: plants of the same species interact
// via a per-species coupling strength (positive repels, negative clusters
// them together), while the allowed-overlap rule from resolveCollisions is
// enforced as a hard constraint (rejected outright, never merely penalized)
// throughout the annealing run.
const isingRepulsion: LayoutEngine = {
  id: 'ising-repulsion',
  label: 'Spin Model (Repulsion)',
  description: 'Simulated annealing over a 2-spin-style energy model: same-species plants interact by a species-specific coupling strength — positive repels, negative clusters them together — subject to hard no-overlap constraints. Temperature controls how much the layout explores before settling.',
  getParamDefs: (plantConfig) => [
    ...plantConfig.map(pt => ({
      key: `repulsion:${pt.id}`,
      label: `Repulsion — ${pt.name}`,
      min: -10,
      max: 10,
      step: 0.5,
      default: -1,
    })),
    { key: 'temperature', label: 'Temperature', min: 0.05, max: 5, step: 0.05, default: 1 },
  ],
  generate: (plantConfig, bedWidth, bedHeight, overlapPct, params) => {
    const instances: PlantInstance[] = [];
    let uid = 0;
    plantConfig.forEach(pt => {
      for (let i = 0; i < pt.count; i++) {
        instances.push({
          ...pt,
          instanceId: uid++,
          x: Math.random() * bedWidth,
          y: Math.random() * bedHeight,
        });
      }
    });

    // Start from a state that already satisfies the hard overlap constraint
    // so that rejection sampling below never has to dig out of an invalid one.
    let nodes = clampCentersToBed(resolveCollisions(null, instances, overlapPct), bedWidth, bedHeight);
    if (nodes.length < 2) return nodes;

    const allowedOverlapFactor = 1 - (overlapPct / 100);
    const repulsionByType: Record<number, number> = {};
    plantConfig.forEach(pt => { repulsionByType[pt.id] = params[`repulsion:${pt.id}`] ?? 0; });
    const T0 = params.temperature ?? 1;
    const iterations = Math.max(2000, nodes.length * 150);
    const bedDiag = Math.sqrt(bedWidth * bedWidth + bedHeight * bedHeight);

    for (let step = 0; step < iterations; step++) {
      const T = T0 * Math.exp((-5 * step) / iterations);
      const moveScale = bedDiag * 0.15 * (T / T0) + bedDiag * 0.01;
      nodes = metropolisPropose(nodes, bedWidth, bedHeight, allowedOverlapFactor, moveScale, T, repulsionByType);
    }

    return nodes;
  },
  step: (plants, bedWidth, bedHeight, overlapPct, params) => {
    if (plants.length < 2) return plants;
    const allowedOverlapFactor = 1 - (overlapPct / 100);
    const repulsionByType: Record<number, number> = {};
    plants.forEach(p => { repulsionByType[p.id] = params[`repulsion:${p.id}`] ?? 0; });
    const temperature = params.temperature ?? 1;
    const bedDiag = Math.sqrt(bedWidth * bedWidth + bedHeight * bedHeight);
    const moveScale = bedDiag * 0.08;
    return metropolisPropose(plants, bedWidth, bedHeight, allowedOverlapFactor, moveScale, temperature, repulsionByType);
  },
};

// Pull every plant a `tension` fraction of the way toward the centroid of all
// other plants (equivalent, by superposition, to a zero-rest-length linear
// spring between every pair of plants — just computed in O(n) instead of
// O(n^2)), then enforce the hard overlap constraint via resolveCollisions.
const springStep = (
  plants: PlantInstance[],
  bedWidth: number,
  bedHeight: number,
  overlapPct: number,
  tension: number
): PlantInstance[] => {
  const n = plants.length;
  if (n < 2) return plants;

  let sumX = 0;
  let sumY = 0;
  plants.forEach(p => { sumX += p.x; sumY += p.y; });

  const pulled = plants.map(p => {
    const targetX = (sumX - p.x) / (n - 1);
    const targetY = (sumY - p.y) / (n - 1);
    const x = Math.min(bedWidth, Math.max(0, p.x + (targetX - p.x) * tension));
    const y = Math.min(bedHeight, Math.max(0, p.y + (targetY - p.y) * tension));
    return { ...p, x, y };
  });

  return resolveCollisions(null, pulled, overlapPct);
};

const springLayout: LayoutEngine = {
  id: 'spring-layout',
  label: 'Spring Layout',
  description: 'Every plant is pulled toward the others by a global spring force — tension controls how strongly — subject to the same hard no-overlap constraint, producing a tightly packed, cohesive bed.',
  getParamDefs: () => [
    { key: 'tension', label: 'Spring Tension', min: 0.01, max: 1, step: 0.01, default: 0.15 },
  ],
  generate: (plantConfig, bedWidth, bedHeight, overlapPct, params) => {
    const instances: PlantInstance[] = [];
    let uid = 0;
    plantConfig.forEach(pt => {
      for (let i = 0; i < pt.count; i++) {
        instances.push({
          ...pt,
          instanceId: uid++,
          x: Math.random() * bedWidth,
          y: Math.random() * bedHeight,
        });
      }
    });

    let nodes = clampCentersToBed(resolveCollisions(null, instances, overlapPct), bedWidth, bedHeight);
    if (nodes.length < 2) return nodes;

    const tension = params.tension ?? 0.15;
    const iterations = Math.max(150, nodes.length * 8);
    for (let i = 0; i < iterations; i++) {
      nodes = springStep(nodes, bedWidth, bedHeight, overlapPct, tension);
    }

    // springStep's collision push-apart (like resolveCollisions everywhere
    // else) doesn't clamp back into the bed, so the one-shot result needs a
    // final clamp — matching randomRelax — even though live stepping via the
    // hold-to-animate button leaves this to the existing out-of-bounds warning.
    return clampCentersToBed(nodes, bedWidth, bedHeight);
  },
  step: (plants, bedWidth, bedHeight, overlapPct, params) => {
    const tension = params.tension ?? 0.15;
    return springStep(plants, bedWidth, bedHeight, overlapPct, tension);
  },
};

export const layoutEngines: LayoutEngine[] = [randomRelax, isingRepulsion, springLayout];
