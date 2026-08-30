import React, { useState, useRef, useEffect } from 'react';

// Custom hook to persist state in localStorage
function useStickyState(defaultValue, key) {
  const [value, setValue] = useState(() => {
    const stickyValue = window.localStorage.getItem(key);
    return stickyValue !== null ? JSON.parse(stickyValue) : defaultValue;
  });
  useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue];
}

// Butterfly Haven & standard metadata with float heights (midpoints of ranges) & default shapes
const INITIAL_PLANT_TYPES = {
  1: { name: "Bigelow's Tansyaster", height: 1.5, spread: 1.5, shape: 'cone', color: '#b19cd9', textColor: '#000', defaultSize: 1.5 },
  2: { name: 'Blue Flax', height: 1.5, spread: 1.0, shape: 'sphere', color: '#5c6bc0', textColor: '#fff', defaultSize: 1.5 },
  3: { name: 'Blue Pitcher Sage', height: 3.5, spread: 2.5, shape: 'cylinder', color: '#512da8', textColor: '#fff', defaultSize: 2.5 },
  4: { name: 'Pearly Everlasting', height: 1.5, spread: 1.5, shape: 'sphere', color: '#689f38', textColor: '#fff', defaultSize: 1.0 },
  5: { name: 'Prairie Coneflower', height: 2.0, spread: 1.5, shape: 'cone', color: '#d4e157', textColor: '#000', defaultSize: 1.5 },
  6: { name: 'Rabbitbrush', height: 4.0, spread: 4.0, shape: 'sphere', color: '#fbc02d', textColor: '#000', defaultSize: 3.0 },
  7: { name: 'Rigid Goldenrod', height: 3.5, spread: 1.5, shape: 'cylinder', color: '#ffa726', textColor: '#000', defaultSize: 2.0 },
  8: { name: 'Rocky Mountain Gayfeather', height: 3.0, spread: 1.5, shape: 'cylinder', color: '#8e24aa', textColor: '#fff', defaultSize: 1.5 },
  9: { name: 'Rocky Mountain Penstemon', height: 2.5, spread: 1.5, shape: 'cone', color: '#311b92', textColor: '#fff', defaultSize: 1.2 },
  10: { name: 'Showy Fleabane', height: 1.5, spread: 1.75, shape: 'sphere', color: '#ce93d8', textColor: '#000', defaultSize: 1.5 },
};

const getContrastYIQ = (hexcolor) => {
  if (!hexcolor) return 'black';
  const hex = hexcolor.replace("#", "");
  const r = parseInt(hex.substr(0, 2), 16) || 0;
  const g = parseInt(hex.substr(2, 2), 16) || 0;
  const b = parseInt(hex.substr(4, 2), 16) || 0;
  return (((r * 299) + (g * 587) + (b * 114)) / 1000 >= 128) ? '#000' : '#fff';
};

export default function App() {
  const [appState, setAppState] = useState('setup'); // 'setup', 'design', 'view3d'
  
  // Persistent States
  const [plantTypes, setPlantTypes] = useStickyState(INITIAL_PLANT_TYPES, 'gd_types_v5');
  const [setupWidth, setSetupWidth] = useStickyState("10", 'gd_w_v5');
  const [setupHeight, setSetupHeight] = useStickyState("10", 'gd_h_v5');
  const [allowedOverlap, setAllowedOverlap] = useStickyState("5", 'gd_overlap_v5');
  
  const [plantCounts, setPlantCounts] = useStickyState({
    1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 2, 7: 3, 8: 3, 9: 3, 10: 3
  }, 'gd_counts_v5');
  
  const [plantSizes, setPlantSizes] = useStickyState(
    Object.fromEntries(Object.entries(INITIAL_PLANT_TYPES).map(([k, v]) => [k, v.defaultSize])),
    'gd_sizes_v5'
  );

  // Custom plant form state
  const [customPlantName, setCustomPlantName] = useState("");
  const [customPlantHeight, setCustomPlantHeight] = useState("2.0");
  const [customPlantSpread, setCustomPlantSpread] = useState("1.5");
  const [customPlantShape, setCustomPlantShape] = useState("cone");
  const [customPlantColor, setCustomPlantColor] = useState("#4ade80");
  const [customPlantSize, setCustomPlantSize] = useState("1.5");
  const [customPlantQty, setCustomPlantQty] = useState("1");

  // Design State
  const [plants, setPlants] = useState([]);
  const [gridWidth, setGridWidth] = useState(10);
  const [gridHeight, setGridHeight] = useState(10);
  const [showGrid, setShowGrid] = useState(true);
  const [hasOverflow, setHasOverflow] = useState(false);
  
  const [selectedPlantId, setSelectedPlantId] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const gridRef = useRef(null);
  
  // 3D Canvas Ref
  const mountRef = useRef(null);
  const [cameraAngle, setCameraAngle] = useState('elevated'); // 'elevated' or 'side'

  // Physics Solver with Pushing Propagation
  const settlePhysics = (initialPlants, fWidth, fHeight, iterations = 25) => {
    const overlapMult = 1 - (Math.max(0, Math.min(100, parseInt(allowedOverlap) || 0)) / 100);
    let newPlants = JSON.parse(JSON.stringify(initialPlants));
    
    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < newPlants.length; i++) {
        for (let j = i + 1; j < newPlants.length; j++) {
          const p1 = newPlants[i];
          const p2 = newPlants[j];
          
          if (!p1.inBed || !p2.inBed) continue;

          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const dist = Math.hypot(dx, dy);
          const minDist = ((p1.size + p2.size) / 2) * overlapMult;

          if (dist < minDist) {
            const overlap = minDist - dist;
            let nx = 0, ny = 0;
            if (dist === 0) {
              const angle = Math.random() * Math.PI * 2;
              nx = Math.cos(angle);
              ny = Math.sin(angle);
            } else {
              nx = dx / dist;
              ny = dy / dist;
            }

            const totalSize = p1.size + p2.size;
            let pushRatio1 = p2.size / totalSize;
            let pushRatio2 = p1.size / totalSize;

            if (p1.id === draggingId) { pushRatio1 = 0; pushRatio2 = 1; }
            else if (p2.id === draggingId) { pushRatio1 = 1; pushRatio2 = 0; }

            p1.x -= nx * overlap * pushRatio1;
            p1.y -= ny * overlap * pushRatio1;
            p2.x += nx * overlap * pushRatio2;
            p2.y += ny * overlap * pushRatio2;
          }
        }
      }
      
      // Wall constraints for bed plants
      newPlants.forEach(p => {
        if (p.inBed && p.id !== draggingId) {
          const r = p.size / 2;
          p.x = Math.max(r, Math.min(fWidth - r, p.x));
          p.y = Math.max(r, Math.min(fHeight - r, p.y));
        }
      });
    }
    return newPlants;
  };

  const generateLayout = () => {
    const finalWidth = Math.max(4, parseInt(setupWidth) || 10);
    const finalHeight = Math.max(4, parseInt(setupHeight) || 10);
    
    setGridWidth(finalWidth);
    setGridHeight(finalHeight);

    let nextId = 1;
    let initialPlants = [];
    let overflowCount = 0;

    const plantsToPlace = [];
    Object.entries(plantCounts).forEach(([typeStr, count]) => {
      for(let i=0; i<count; i++) plantsToPlace.push(parseInt(typeStr));
    });
    plantsToPlace.sort((a, b) => {
      const sA = parseFloat(plantSizes[a]) || plantTypes[a]?.defaultSize || 1;
      const sB = parseFloat(plantSizes[b]) || plantTypes[b]?.defaultSize || 1;
      return sB - sA;
    });

    plantsToPlace.forEach(typeNum => {
      const size = Math.max(0.1, parseFloat(plantSizes[typeNum]) || plantTypes[typeNum]?.defaultSize || 1.5);
      const r = size / 2;
      let placed = false;

      for(let attempt = 0; attempt < 300; attempt++) {
        const tryX = r + Math.random() * (finalWidth - size);
        const tryY = r + Math.random() * (finalHeight - size);

        let collision = false;
        for (const p of initialPlants) {
          if (!p.inBed) continue;
          const minDist = (r + p.size/2) * 0.95;
          const dist = Math.hypot(p.x - tryX, p.y - tryY);
          if (dist < minDist) { collision = true; break; }
        }
        
        if (!collision) {
          initialPlants.push({ id: nextId++, type: typeNum, x: tryX, y: tryY, size, inBed: true });
          placed = true;
          break;
        }
      }

      if (!placed) {
        const overflowSpacing = 2; 
        const cols = Math.max(1, Math.floor(finalWidth / overflowSpacing));
        const row = Math.floor(overflowCount / cols);
        const col = overflowCount % cols;
        
        initialPlants.push({
          id: nextId++,
          type: typeNum,
          x: col * overflowSpacing + r,
          y: finalHeight + r + 1 + (row * overflowSpacing), 
          size,
          inBed: false
        });
        overflowCount++;
      }
    });

    setHasOverflow(overflowCount > 0);
    setPlants(settlePhysics(initialPlants, finalWidth, finalHeight, 15));
  };

  const handleStartDesign = () => {
    generateLayout();
    setAppState('design');
  };

  const handleAddCustomPlantType = () => {
    if (!customPlantName.trim()) return;
    const newId = Math.max(...Object.keys(plantTypes).map(Number)) + 1;
    
    setPlantTypes({
      ...plantTypes,
      [newId]: {
        name: customPlantName,
        height: parseFloat(customPlantHeight) || 2.0,
        spread: parseFloat(customPlantSpread) || 1.5,
        shape: customPlantShape,
        color: customPlantColor,
        textColor: getContrastYIQ(customPlantColor),
        defaultSize: parseFloat(customPlantSize) || 1.5
      }
    });
    
    setPlantCounts({ ...plantCounts, [newId]: parseInt(customPlantQty) || 1 });
    setPlantSizes({ ...plantSizes, [newId]: customPlantSize });
    setCustomPlantName("");
  };

  // Drag Event Handlers with Pushing Propagation
  const handlePointerDown = (e, plant) => {
    e.stopPropagation();
    setSelectedPlantId(plant.id);
    setDraggingId(plant.id);

    if (gridRef.current) {
      const rect = gridRef.current.getBoundingClientRect();
      const clickX = ((e.clientX - rect.left) / rect.width) * gridWidth;
      const clickY = ((e.clientY - rect.top) / rect.height) * gridHeight;
      setDragOffset({ x: clickX - plant.x, y: clickY - plant.y });
    }
  };

  const handlePointerMove = (e) => {
    if (draggingId === null || !gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    
    let requestedX = ((e.clientX - rect.left) / rect.width) * gridWidth - dragOffset.x;
    let requestedY = ((e.clientY - rect.top) / rect.height) * gridHeight - dragOffset.y;

    const updatedPlants = plants.map(p => {
      if (p.id === draggingId) {
         const radius = p.size / 2;
         const isMouseInBed = requestedX > 0 && requestedX < gridWidth && requestedY > 0 && requestedY < gridHeight;
         let inBed = p.inBed;
         let finalX = requestedX;
         let finalY = requestedY;
     
         if (isMouseInBed) {
           finalX = Math.max(radius, Math.min(gridWidth - radius, finalX));
           finalY = Math.max(radius, Math.min(gridHeight - radius, finalY));
           inBed = true;
         } else {
           finalX = Math.max(-5, Math.min(gridWidth + 5, finalX));
           inBed = false;
         }
         return { ...p, x: finalX, y: finalY, inBed };
      }
      return p;
    });

    setPlants(settlePhysics(updatedPlants, gridWidth, gridHeight, 5));
  };

  const handlePointerUp = () => {
    if (draggingId !== null) {
      setPlants(prev => settlePhysics(prev, gridWidth, gridHeight, 20));
      setDraggingId(null);
    }
  };

  const addPlantToDesign = (typeNum) => {
    const newId = plants.length > 0 ? Math.max(...plants.map(p => p.id)) + 1 : 1;
    const size = parseFloat(plantSizes[typeNum]) || plantTypes[typeNum]?.defaultSize || 1.5;
    
    let tempPlants = [...plants, { id: newId, type: typeNum, x: gridWidth / 2, y: gridHeight / 2, size, inBed: true }];
    tempPlants = settlePhysics(tempPlants, gridWidth, gridHeight, 30);
    
    setPlants(tempPlants);
    setSelectedPlantId(newId);
  };

  const removeSelected = () => {
    if (selectedPlantId !== null) {
      setPlants(plants.filter(p => p.id !== selectedPlantId));
      setSelectedPlantId(null);
    }
  };

  // 3D Scene Effect using Three.js
  useEffect(() => {
    if (appState !== 'view3d' || !mountRef.current) return;

    // Load Three.js dynamically from CDN if needed
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    script.async = true;
    
    script.onload = () => {
      const THREE = window.THREE;
      const container = mountRef.current;
      container.innerHTML = ''; // clear previous

      const width = container.clientWidth;
      const height = container.clientHeight;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf1f5f9);

      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
      if (cameraAngle === 'elevated') {
        camera.position.set(gridWidth / 2, Math.max(gridWidth, gridHeight) * 1.4, Math.max(gridWidth, gridHeight) * 1.1);
        camera.lookAt(gridWidth / 2, 0, gridHeight / 2);
      } else {
        // Side on view (front side angle)
        camera.position.set(gridWidth / 2, 2, gridHeight + Math.max(gridWidth, gridHeight) * 0.9);
        camera.lookAt(gridWidth / 2, 0.5, gridHeight / 2);
      }

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(width, height);
      renderer.shadowMap.enabled = true;
      container.appendChild(renderer.domElement);

      // Lights
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
      scene.add(ambientLight);

      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight.position.set(10, 20, 15);
      dirLight.castShadow = true;
      scene.add(dirLight);

      // Garden Bed Ground Plate
      const groundGeo = new THREE.BoxGeometry(gridWidth, 0.2, gridHeight);
      const groundMat = new THREE.MeshStandardMaterial({ color: 0x3d2817, roughness: 0.8 });
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.position.set(gridWidth / 2 - 0.5, -0.1, gridHeight / 2 - 0.5);
      ground.receiveShadow = true;
      scene.add(ground);

      // Grid helper lines on soil
      const gridHelper = new THREE.GridHelper(Math.max(gridWidth, gridHeight), Math.max(gridWidth, gridHeight), 0x000000, 0x000000);
      gridHelper.position.set(gridWidth / 2 - 0.5, 0.01, gridHeight / 2 - 0.5);
      gridHelper.material.opacity = 0.15;
      gridHelper.material.transparent = true;
      scene.add(gridHelper);

      // Render Plants as Cones, Spheres, or Cylinders
      plants.forEach(plant => {
        if (!plant.inBed) return; // Only render bed plants in 3D
        const pInfo = plantTypes[plant.type] || { height: 2.0, spread: 1.5, shape: 'cone', color: '#4ade80' };
        const plantHeight = pInfo.height || 2.0;
        const plantRadius = (plant.size || pInfo.spread || 1.5) / 2;
        const colorHex = pInfo.color || '#4ade80';

        let geometry;
        const shapeType = pInfo.shape || 'cone';

        if (shapeType === 'sphere') {
          geometry = new THREE.SphereGeometry(plantRadius, 16, 16);
        } else if (shapeType === 'cylinder') {
          geometry = new THREE.CylinderGeometry(plantRadius * 0.8, plantRadius, plantHeight, 16);
        } else {
          // Default to cone
          geometry = new THREE.ConeGeometry(plantRadius, plantHeight, 16);
        }

        const material = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.5 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;

        // Position mapping: Three.js center origin vs Grid origin
        mesh.position.x = plant.x;
        mesh.position.z = plant.y;
        
        if (shapeType === 'sphere') {
          mesh.position.y = plantRadius;
        } else {
          mesh.position.y = plantHeight / 2;
        }

        scene.add(mesh);
      });

      // Animation Loop
      let animationId;
      const animate = () => {
        animationId = requestAnimationFrame(animate);
        renderer.render(scene, camera);
      };
      animate();

      // Window resize handler
      const handleResize = () => {
        if (!container) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener('resize', handleResize);

      return () => {
        cancelAnimationFrame(animationId);
        window.removeEventListener('resize', handleResize);
        if (container) container.innerHTML = '';
      };
    };

    document.head.appendChild(script);
    return () => {
      if (script.parentNode) script.parentNode.removeChild(script);
    };
  }, [appState, cameraAngle, plants, gridWidth, gridHeight]);

  // ---------------------------------------------------------------------------
  // SETUP SCREEN
  // ---------------------------------------------------------------------------
  if (appState === 'setup') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 text-slate-800 p-4 md:p-6 overflow-y-auto">
        <div className="max-w-5xl w-full bg-white rounded-xl shadow-lg border border-slate-200 my-auto flex flex-col lg:flex-row overflow-hidden">
          
          <div className="flex-1 p-6 md:p-8 flex flex-col gap-8 lg:border-r border-slate-100">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Garden Setup</h1>
              <p className="text-sm text-slate-500 mt-1">Configure dimensions, plant heights, spreads, and shape models</p>
            </div>

            <div className="flex flex-col md:flex-row gap-6">
              <div className="flex-1">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">Bed Dimensions (Feet)</h2>
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <label className="text-xs text-slate-500 block mb-1">Width (X)</label>
                    <input 
                      type="number" 
                      value={setupWidth} 
                      onChange={(e) => setSetupWidth(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                  <span className="text-slate-400 mt-5">×</span>
                  <div className="flex-1">
                    <label className="text-xs text-slate-500 block mb-1">Height (Y)</label>
                    <input 
                      type="number" 
                      value={setupHeight} 
                      onChange={(e) => setSetupHeight(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                </div>
              </div>
              <div className="w-full md:w-48">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">Collision Logic</h2>
                <label className="text-xs text-slate-500 block mb-1">Allowed Overlap (%)</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="range" 
                    min="0" max="80" 
                    value={allowedOverlap} 
                    onChange={(e) => setAllowedOverlap(e.target.value)}
                    className="flex-1 accent-emerald-600"
                  />
                  <span className="text-sm font-bold text-slate-700 w-8">{allowedOverlap}%</span>
                </div>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-end mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Plant Metadata & Sizes</h2>
                <span className="text-xs text-slate-400">Dimensions in feet</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.keys(plantTypes).map((num) => {
                  const typeNum = parseInt(num);
                  const p = plantTypes[typeNum];
                  return (
                    <div key={typeNum} className="flex flex-col bg-slate-50 p-3 rounded-lg border border-slate-200 gap-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-6 h-6 rounded-full flex shrink-0 items-center justify-center font-bold text-xs shadow-inner"
                            style={{ backgroundColor: p.color, color: p.textColor }}
                          >
                            {typeNum}
                          </div>
                          <span className="text-xs font-bold leading-tight truncate max-w-[120px]" title={p.name}>{p.name}</span>
                        </div>
                        <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">H: {p.height}ft</span>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-2 mt-1 pt-2 border-t border-slate-200 text-xs">
                        <div>
                          <label className="text-[10px] text-slate-400 block">Qty</label>
                          <input
                            type="number"
                            min="0"
                            value={plantCounts[typeNum] ?? 0}
                            onChange={(e) => setPlantCounts(prev => ({ ...prev, [typeNum]: parseInt(e.target.value) || 0 }))}
                            className="w-full text-center border border-slate-300 rounded focus:ring-1 focus:ring-emerald-500 outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-400 block">Dia(ft)</label>
                          <input
                            type="number"
                            min="0.1"
                            step="0.1"
                            value={plantSizes[typeNum] ?? ''}
                            onChange={(e) => setPlantSizes(prev => ({ ...prev, [typeNum]: e.target.value }))}
                            className="w-full text-center border border-slate-300 rounded focus:ring-1 focus:ring-emerald-500 outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-400 block">Shape</label>
                          <select
                            value={p.shape || 'cone'}
                            onChange={(e) => setPlantTypes({
                              ...plantTypes,
                              [typeNum]: { ...p, shape: e.target.value }
                            })}
                            className="w-full text-[10px] border border-slate-300 rounded bg-white py-1 focus:ring-1 focus:ring-emerald-500 outline-none"
                          >
                            <option value="cone">Cone</option>
                            <option value="sphere">Sphere</option>
                            <option value="cylinder">Cylinder</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            
            <button 
              onClick={handleStartDesign}
              className="w-full mt-auto py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-md transition-colors"
            >
              Generate Design Layout
            </button>
          </div>

          {/* Custom Plant Creator */}
          <div className="w-full lg:w-80 bg-slate-50 p-6 md:p-8 flex flex-col gap-4 border-t lg:border-t-0 lg:border-l border-slate-200">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-1">Add Custom Plant</h2>
            
            <div className="space-y-3 bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Plant Name</label>
                <input 
                  type="text" 
                  value={customPlantName} 
                  onChange={(e) => setCustomPlantName(e.target.value)}
                  placeholder="e.g. Lavender"
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-slate-500 block mb-1">Height (ft)</label>
                  <input 
                    type="number" step="0.5" min="0.5"
                    value={customPlantHeight} 
                    onChange={(e) => setCustomPlantHeight(e.target.value)}
                    className="w-full px-2 py-1 bg-slate-50 border border-slate-300 rounded text-sm outline-none"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-slate-500 block mb-1">Dia (ft)</label>
                  <input 
                    type="number" step="0.1" min="0.1"
                    value={customPlantSize} 
                    onChange={(e) => setCustomPlantSize(e.target.value)}
                    className="w-full px-2 py-1 bg-slate-50 border border-slate-300 rounded text-sm outline-none"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-slate-500 block mb-1">Shape</label>
                  <select
                    value={customPlantShape}
                    onChange={(e) => setCustomPlantShape(e.target.value)}
                    className="w-full px-2 py-1 bg-slate-50 border border-slate-300 rounded text-sm outline-none"
                  >
                    <option value="cone">Cone</option>
                    <option value="sphere">Sphere</option>
                    <option value="cylinder">Cylinder</option>
                  </select>
                </div>
                <div className="w-20">
                  <label className="text-xs text-slate-500 block mb-1">Color</label>
                  <input 
                    type="color" 
                    value={customPlantColor} 
                    onChange={(e) => setCustomPlantColor(e.target.value)}
                    className="w-full h-7 bg-slate-50 border border-slate-300 rounded cursor-pointer"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Initial Qty</label>
                <input 
                  type="number" min="0"
                  value={customPlantQty} 
                  onChange={(e) => setCustomPlantQty(e.target.value)}
                  className="w-full px-3 py-1 bg-slate-50 border border-slate-300 rounded text-sm outline-none"
                />
              </div>
              <button 
                onClick={handleAddCustomPlantType}
                disabled={!customPlantName.trim()}
                className="w-full mt-2 py-2 bg-slate-800 disabled:bg-slate-300 hover:bg-slate-900 text-white text-sm font-bold rounded transition-colors"
              >
                Add to Roster
              </button>
            </div>
          </div>

        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 3D VIEW SCREEN
  // ---------------------------------------------------------------------------
  if (appState === 'view3d') {
    return (
      <div className="flex flex-col h-screen bg-slate-900 text-slate-100 font-sans select-none overflow-hidden">
        {/* Top 3D Toolbar */}
        <div className="bg-slate-800 border-b border-slate-700 p-3 flex items-center justify-between shadow-md z-20 shrink-0">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setAppState('design')}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded transition"
            >
              ← Back to 2D Editor
            </button>
            <h1 className="text-base font-bold text-slate-200">3D Garden Simulation ({gridWidth}' × {gridHeight}')</h1>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setCameraAngle('elevated')}
              className={`px-3 py-1.5 text-xs font-bold rounded transition ${cameraAngle === 'elevated' ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              Elevated View
            </button>
            <button 
              onClick={() => setCameraAngle('side')}
              className={`px-3 py-1.5 text-xs font-bold rounded transition ${cameraAngle === 'side' ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              Side-On View
            </button>
          </div>
        </div>

        {/* 3D Container */}
        <div ref={mountRef} className="flex-1 w-full h-full relative" />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 2D DESIGN SCREEN
  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-screen bg-slate-100 text-slate-800 font-sans select-none overflow-hidden">
      
      {/* Top Toolbar */}
      <div className="bg-white border-b border-slate-200 p-2 flex flex-wrap items-center justify-between gap-2 shadow-sm z-20 shrink-0">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setAppState('setup')}
            className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium rounded transition"
          >
            ← Setup
          </button>
          <div className="text-sm font-bold text-slate-700 hidden sm:block border-l pl-3 border-slate-300">
            {gridWidth}' × {gridHeight}' Bed
          </div>
        </div>

        {/* Action Center */}
        <div className="flex items-center gap-2">
          <button 
            onClick={generateLayout}
            className="px-3 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-800 text-sm font-bold rounded transition"
            title="Re-run physics simulation to generate a new layout"
          >
            🎲 Randomise
          </button>
          <button 
            onClick={() => setAppState('view3d')}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold rounded shadow transition"
          >
            🌲 View in 3D
          </button>
        </div>

        {/* Quick Add Palette */}
        <div className="flex items-center gap-1.5 bg-slate-50 p-1.5 rounded-lg border border-slate-200 overflow-x-auto max-w-[35vw]">
          <span className="text-[10px] font-bold text-slate-400 mr-1 uppercase tracking-wider hidden xl:block">Add:</span>
          {Object.keys(plantTypes).map((num) => {
            const p = plantTypes[num];
            return (
              <button
                key={num}
                onClick={() => addPlantToDesign(Number(num))}
                className="w-7 h-7 rounded-full flex shrink-0 items-center justify-center font-bold text-[10px] shadow-sm hover:scale-110 transition-transform"
                style={{ backgroundColor: p.color, color: p.textColor }}
                title={`Add ${p.name} (${plantSizes[num]}ft, H:${p.height}ft)`}
              >
                {num}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer">
            <input 
              type="checkbox" 
              checked={showGrid} 
              onChange={(e) => setShowGrid(e.target.checked)}
              className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
            />
            Grid
          </label>
          <button 
            onClick={removeSelected}
            disabled={selectedPlantId === null}
            className={`px-3 py-1.5 text-xs font-bold rounded transition ${
              selectedPlantId !== null 
                ? 'bg-red-100 text-red-700 hover:bg-red-200' 
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}
          >
            Delete Selected
          </button>
        </div>
      </div>

      {hasOverflow && (
        <div className="bg-amber-100 border-b border-amber-300 text-amber-900 px-4 py-2 text-sm font-medium z-10 shrink-0 flex justify-between items-center">
          <span>⚠️ <strong>Overcrowded:</strong> Some plants couldn't fit and were placed outside the bed.</span>
          <button onClick={() => setAppState('setup')} className="underline hover:text-amber-700">Increase Bed Size or Allowed Overlap (%)</button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        
        {/* Left Sidebar: Plant Key */}
        <div className="w-56 md:w-72 bg-white border-r border-slate-200 p-4 flex flex-col gap-3 overflow-y-auto hidden sm:flex shrink-0 shadow-sm z-10">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b pb-2">Plant Key</h3>
          <div className="flex flex-col gap-2">
            {Object.keys(plantTypes).map((num) => {
              const p = plantTypes[num];
              const countInDesign = plants.filter(plant => plant.type === parseInt(num)).length;
              if (countInDesign === 0) return null; 

              return (
                <div key={num} className="flex items-center gap-3 p-1.5 hover:bg-slate-50 rounded">
                  <div 
                    className="w-6 h-6 rounded-full flex shrink-0 items-center justify-center font-bold text-[10px] shadow-sm"
                    style={{ backgroundColor: p.color, color: p.textColor }}
                  >
                    {num}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-semibold text-slate-700 truncate" title={p.name}>{p.name}</span>
                    <span className="text-[10px] text-slate-500">Qty: {countInDesign} | Dia: {plantSizes[num]}ft | H: {p.height}ft ({p.shape || 'cone'})</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Main Canvas Area */}
        <div className="flex-1 flex flex-col items-center overflow-auto p-4 sm:p-12 min-h-0 relative bg-slate-100">
          
          <div className="text-xs sm:text-sm font-medium text-slate-500 mb-4 shrink-0 uppercase tracking-wide">
            Front Side of Garden
          </div>

          <div className="w-full flex justify-center pb-24">
            <div 
              ref={gridRef}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              className="relative bg-amber-50/70 border-4 border-slate-800 shadow-xl overflow-visible cursor-crosshair touch-none shrink-0"
              style={{
                width: gridWidth >= gridHeight ? 'min(70vw, 700px)' : 'auto',
                height: gridHeight > gridWidth ? 'min(60vh, 600px)' : 'auto',
                aspectRatio: `${gridWidth} / ${gridHeight}`,
              }}
            >
              {/* Grid Background */}
              {showGrid && (
                <div 
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    backgroundImage: `
                      linear-gradient(to right, rgba(0,0,0,0.15) 1px, transparent 1px),
                      linear-gradient(to bottom, rgba(0,0,0,0.15) 1px, transparent 1px)
                    `,
                    backgroundSize: `${100 / gridWidth}% ${100 / gridHeight}%`
                  }}
                />
              )}

              {/* Plant Circles */}
              {plants.map((plant) => {
                const pInfo = plantTypes[plant.type] || { color: '#ccc', textColor: '#000', name: 'Unknown', height: 2.0, shape: 'cone' };
                const isSelected = plant.id === selectedPlantId;
                const isDragging = plant.id === draggingId;
                const leftPercent = (plant.x / gridWidth) * 100;
                const topPercent = (plant.y / gridHeight) * 100;
                const widthPercent = (plant.size / gridWidth) * 100;

                const overlapMult = 1 - (Math.max(0, Math.min(100, parseInt(allowedOverlap) || 0)) / 100);
                const isOverlapping = plants.some(other =>
                  other.id !== plant.id &&
                  Math.hypot(plant.x - other.x, plant.y - other.y) < ((plant.size + other.size) / 2) * overlapMult * 0.95
                );

                return (
                  <div
                    key={plant.id}
                    onPointerDown={(e) => handlePointerDown(e, plant)}
                    title={`${pInfo.name} (${plant.size}ft dia, H:${pInfo.height}ft, ${pInfo.shape || 'cone'}) - ${plant.inBed ? 'In Bed' : 'Outside Bed'}`}
                    className={`absolute rounded-full flex items-center justify-center font-bold shadow-md cursor-grab active:cursor-grabbing transition-shadow ${
                      isSelected ? 'ring-4 ring-emerald-500 ring-offset-1 z-20' : (isDragging ? 'z-30 ring-2 ring-blue-400' : 'z-10 hover:brightness-105')
                    } ${!plant.inBed ? 'border-2 border-dashed border-red-500' : ''}`}
                    style={{
                      left: `${leftPercent}%`,
                      top: `${topPercent}%`,
                      width: `${widthPercent}%`,
                      aspectRatio: '1 / 1',
                      transform: 'translate(-50%, -50%)',
                      backgroundColor: pInfo.color,
                      color: pInfo.textColor,
                      opacity: isDragging ? 0.8 : (!plant.inBed ? 0.5 : (isOverlapping ? 0.75 : 1)),
                      mixBlendMode: isOverlapping && !isDragging ? 'multiply' : 'normal',
                      fontSize: `clamp(10px, ${plant.size * 1.5}vmin, 32px)`
                    }}
                  >
                    {plant.type}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}