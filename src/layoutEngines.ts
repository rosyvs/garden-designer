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
  locked?: boolean;
}

export interface Point {
  x: number;
  y: number;
}

// A bed is either a plain rectangle (bedPolygon absent/null — today's
// behavior) or an arbitrary outline traced by the user, in which case
// bedWidth/bedHeight remain the polygon's bounding box (used for random
// sampling ranges, the 3D plane extent, etc.) while containment/edge-distance
// checks below defer to the true polygon shape.

export const isInBed = (
  x: number,
  y: number,
  bedWidth: number,
  bedHeight: number,
  bedPolygon?: Point[] | null
): boolean => {
  if (!bedPolygon || bedPolygon.length < 3) {
    return x >= 0 && x <= bedWidth && y >= 0 && y <= bedHeight;
  }
  // Standard ray-casting point-in-polygon test.
  let inside = false;
  for (let i = 0, j = bedPolygon.length - 1; i < bedPolygon.length; j = i++) {
    const xi = bedPolygon[i].x, yi = bedPolygon[i].y;
    const xj = bedPolygon[j].x, yj = bedPolygon[j].y;
    const intersects = (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
};

const distToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
};

export const distanceToBedEdge = (
  x: number,
  y: number,
  bedWidth: number,
  bedHeight: number,
  bedPolygon?: Point[] | null
): number => {
  if (!bedPolygon || bedPolygon.length < 3) {
    return Math.min(x, bedWidth - x, y, bedHeight - y);
  }
  let min = Infinity;
  for (let i = 0, j = bedPolygon.length - 1; i < bedPolygon.length; j = i++) {
    const d = distToSegment(x, y, bedPolygon[i].x, bedPolygon[i].y, bedPolygon[j].x, bedPolygon[j].y);
    if (d < min) min = d;
  }
  return min;
};

// Rejection-sample a point inside the bed's true shape (bounding box for a
// plain rectangle). Falls back to the bounding-box centroid if the polygon is
// so thin that random sampling can't find an interior point in time.
export const sampleRandomPointInBed = (
  bedWidth: number,
  bedHeight: number,
  bedPolygon?: Point[] | null
): Point => {
  if (!bedPolygon || bedPolygon.length < 3) {
    return { x: Math.random() * bedWidth, y: Math.random() * bedHeight };
  }
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * bedWidth;
    const y = Math.random() * bedHeight;
    if (isInBed(x, y, bedWidth, bedHeight, bedPolygon)) return { x, y };
  }
  return { x: bedWidth / 2, y: bedHeight / 2 };
};

// Shared by every engine's `generate`: keep locked instances exactly where
// they are (locked count still counts toward each type's total) and only
// scatter fresh random instances for the remainder, with new instanceIds
// seeded above the highest locked one so they never collide.
const seedInstances = (
  plantConfig: PlantType[],
  bedWidth: number,
  bedHeight: number,
  bedPolygon: Point[] | null | undefined,
  lockedPlants: PlantInstance[]
): PlantInstance[] => {
  let uid = lockedPlants.reduce((m, p) => Math.max(m, p.instanceId + 1), 0);
  const instances: PlantInstance[] = [...lockedPlants];
  plantConfig.forEach(pt => {
    const lockedCount = lockedPlants.filter(p => p.id === pt.id).length;
    for (let i = 0; i < pt.count - lockedCount; i++) {
      const { x, y } = sampleRandomPointInBed(bedWidth, bedHeight, bedPolygon);
      instances.push({ ...pt, instanceId: uid++, x, y });
    }
  });
  return instances;
};

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
  // A node is "fixed" — never displaced by collision resolution — if it's
  // the one actively being dragged (its own drag already sets its position)
  // or if the user has locked it in place.
  const isFixed = (n: PlantInstance) => n.instanceId === activeId || !!n.locked;

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
          const iFixed = isFixed(nodes[i]);
          const jFixed = isFixed(nodes[j]);
          if (iFixed && jFixed) continue;

          relaxing = true;
          const overlap = minD - dist;
          const nx = dx / dist;
          const ny = dy / dist;

          if (iFixed) {
            nodes[j].x += nx * overlap;
            nodes[j].y += ny * overlap;
          } else if (jFixed) {
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
// plants back in, or dragging near an edge would fight the user. For a
// custom polygon shape there's no simple axis clamp, so an out-of-shape
// point is instead pulled toward the bounding-box center until it lands
// back inside the true outline. A locked plant is left exactly where it is
// even if that's outside the bed — locking pins a plant unconditionally,
// including ones deliberately parked outside while the user works on the rest.
const clampCentersToBed = (
  nodes: PlantInstance[],
  bedWidth: number,
  bedHeight: number,
  bedPolygon?: Point[] | null
): PlantInstance[] => {
  if (!bedPolygon || bedPolygon.length < 3) {
    return nodes.map(n => n.locked ? n : ({
      ...n,
      x: Math.min(bedWidth, Math.max(0, n.x)),
      y: Math.min(bedHeight, Math.max(0, n.y)),
    }));
  }
  const cx = bedWidth / 2;
  const cy = bedHeight / 2;
  return nodes.map(n => {
    if (n.locked || isInBed(n.x, n.y, bedWidth, bedHeight, bedPolygon)) return n;
    for (let t = 1; t <= 20; t++) {
      const f = 1 - t / 20;
      const x = cx + (n.x - cx) * f;
      const y = cy + (n.y - cy) * f;
      if (isInBed(x, y, bedWidth, bedHeight, bedPolygon)) return { ...n, x, y };
    }
    return { ...n, x: cx, y: cy };
  });
};

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
    bedPolygon: Point[] | null,
    overlapPct: number,
    params: Record<string, number>,
    lockedPlants: PlantInstance[]
  ) => PlantInstance[];
  // Optional: advance the given layout by a single Metropolis-Hastings
  // proposal at a fixed temperature, for engines that support animating
  // their dynamics live rather than only exposing the annealed result.
  step?: (
    plants: PlantInstance[],
    bedWidth: number,
    bedHeight: number,
    bedPolygon: Point[] | null,
    overlapPct: number,
    params: Record<string, number>
  ) => PlantInstance[];
}

const randomRelax: LayoutEngine = {
  id: 'random-relax',
  label: 'Random Scatter + Relax',
  description: 'Scatters plants at random positions, then iteratively pushes overlapping plants apart.',
  getParamDefs: () => [],
  generate: (plantConfig, bedWidth, bedHeight, bedPolygon, overlapPct, _params, lockedPlants) => {
    const instances = seedInstances(plantConfig, bedWidth, bedHeight, bedPolygon, lockedPlants);
    const relaxed = resolveCollisions(null, instances, overlapPct);
    return clampCentersToBed(relaxed, bedWidth, bedHeight, bedPolygon);
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
  bedPolygon: Point[] | null,
  allowedOverlapFactor: number,
  moveScale: number,
  temperature: number,
  repulsionByType: Record<number, number>,
  edgeRepulsion: number
): PlantInstance[] => {
  const n = nodes.length;
  if (n < 2) return nodes;

  const movableIndices = nodes.reduce<number[]>((acc, node, i) => {
    if (!node.locked) acc.push(i);
    return acc;
  }, []);
  if (movableIndices.length === 0) return nodes;
  const idx = movableIndices[Math.floor(Math.random() * movableIndices.length)];
  const angle = Math.random() * Math.PI * 2;
  const newX = nodes[idx].x + Math.cos(angle) * moveScale * Math.random();
  const newY = nodes[idx].y + Math.sin(angle) * moveScale * Math.random();
  if (!isInBed(newX, newY, bedWidth, bedHeight, bedPolygon)) return nodes;

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
    let e = 0;
    if (J !== 0) {
      for (let j = 0; j < n; j++) {
        if (j === idx || nodes[j].id !== self.id) continue;
        const dx = x - nodes[j].x;
        const dy = y - nodes[j].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
        e += J / dist;
      }
    }
    if (edgeRepulsion !== 0) {
      const edgeDist = Math.max(distanceToBedEdge(x, y, bedWidth, bedHeight, bedPolygon), 0.01);
      e += edgeRepulsion / edgeDist;
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
    { key: 'edgeRepulsion', label: 'Edge Repulsion', min: 0, max: 10, step: 0.5, default: 0 },
  ],
  generate: (plantConfig, bedWidth, bedHeight, bedPolygon, overlapPct, params, lockedPlants) => {
    const instances = seedInstances(plantConfig, bedWidth, bedHeight, bedPolygon, lockedPlants);

    // Start from a state that already satisfies the hard overlap constraint
    // so that rejection sampling below never has to dig out of an invalid one.
    let nodes = clampCentersToBed(resolveCollisions(null, instances, overlapPct), bedWidth, bedHeight, bedPolygon);
    if (nodes.length < 2) return nodes;

    const allowedOverlapFactor = 1 - (overlapPct / 100);
    const repulsionByType: Record<number, number> = {};
    plantConfig.forEach(pt => { repulsionByType[pt.id] = params[`repulsion:${pt.id}`] ?? 0; });
    const T0 = params.temperature ?? 1;
    const edgeRepulsion = params.edgeRepulsion ?? 0;
    const iterations = Math.max(2000, nodes.length * 150);
    const bedDiag = Math.sqrt(bedWidth * bedWidth + bedHeight * bedHeight);

    for (let step = 0; step < iterations; step++) {
      const T = T0 * Math.exp((-5 * step) / iterations);
      const moveScale = bedDiag * 0.15 * (T / T0) + bedDiag * 0.01;
      nodes = metropolisPropose(nodes, bedWidth, bedHeight, bedPolygon, allowedOverlapFactor, moveScale, T, repulsionByType, edgeRepulsion);
    }

    return nodes;
  },
  step: (plants, bedWidth, bedHeight, bedPolygon, overlapPct, params) => {
    if (plants.length < 2) return plants;
    const allowedOverlapFactor = 1 - (overlapPct / 100);
    const repulsionByType: Record<number, number> = {};
    plants.forEach(p => { repulsionByType[p.id] = params[`repulsion:${p.id}`] ?? 0; });
    const temperature = params.temperature ?? 1;
    const edgeRepulsion = params.edgeRepulsion ?? 0;
    const bedDiag = Math.sqrt(bedWidth * bedWidth + bedHeight * bedHeight);
    const moveScale = bedDiag * 0.08;
    return metropolisPropose(plants, bedWidth, bedHeight, bedPolygon, allowedOverlapFactor, moveScale, temperature, repulsionByType, edgeRepulsion);
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
  bedPolygon: Point[] | null,
  overlapPct: number,
  tension: number
): PlantInstance[] => {
  const n = plants.length;
  if (n < 2) return plants;

  let sumX = 0;
  let sumY = 0;
  plants.forEach(p => { sumX += p.x; sumY += p.y; });

  const pulled = plants.map(p => {
    if (p.locked) return p;
    const targetX = (sumX - p.x) / (n - 1);
    const targetY = (sumY - p.y) / (n - 1);
    if (!bedPolygon || bedPolygon.length < 3) {
      const x = Math.min(bedWidth, Math.max(0, p.x + (targetX - p.x) * tension));
      const y = Math.min(bedHeight, Math.max(0, p.y + (targetY - p.y) * tension));
      return { ...p, x, y };
    }
    // A custom shape has no simple axis clamp, so a pull step that would
    // leave the true outline is skipped outright rather than clamped onto
    // the (rectangular) bounding box, which could sit outside the shape.
    const nx = p.x + (targetX - p.x) * tension;
    const ny = p.y + (targetY - p.y) * tension;
    return isInBed(nx, ny, bedWidth, bedHeight, bedPolygon) ? { ...p, x: nx, y: ny } : p;
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
  generate: (plantConfig, bedWidth, bedHeight, bedPolygon, overlapPct, params, lockedPlants) => {
    const instances = seedInstances(plantConfig, bedWidth, bedHeight, bedPolygon, lockedPlants);

    let nodes = clampCentersToBed(resolveCollisions(null, instances, overlapPct), bedWidth, bedHeight, bedPolygon);
    if (nodes.length < 2) return nodes;

    const tension = params.tension ?? 0.15;
    const iterations = Math.max(150, nodes.length * 8);
    for (let i = 0; i < iterations; i++) {
      nodes = springStep(nodes, bedWidth, bedHeight, bedPolygon, overlapPct, tension);
    }

    // springStep's collision push-apart (like resolveCollisions everywhere
    // else) doesn't clamp back into the bed, so the one-shot result needs a
    // final clamp — matching randomRelax — even though live stepping via the
    // hold-to-animate button leaves this to the existing out-of-bounds warning.
    return clampCentersToBed(nodes, bedWidth, bedHeight, bedPolygon);
  },
  step: (plants, bedWidth, bedHeight, bedPolygon, overlapPct, params) => {
    const tension = params.tension ?? 0.15;
    return springStep(plants, bedWidth, bedHeight, bedPolygon, overlapPct, tension);
  },
};

export const layoutEngines: LayoutEngine[] = [randomRelax, isingRepulsion, springLayout];
