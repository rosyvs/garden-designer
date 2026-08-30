import React, { useState, useRef, useEffect } from 'react';

// Custom hook to persist state in localStorage so edits are remembered
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

const INITIAL_PLANT_TYPES = {
  1: { name: "Bigelow's Tansyaster", color: '#b19cd9', textColor: '#000', defaultSize: 1.5 },
  2: { name: 'Blue Flax', color: '#5c6bc0', textColor: '#fff', defaultSize: 1.5 },
  3: { name: 'Blue Pitcher Sage', color: '#512da8', textColor: '#fff', defaultSize: 2.5 },
  4: { name: 'Pearly Everlasting', color: '#689f38', textColor: '#fff', defaultSize: 1.0 },
  5: { name: 'Prairie Coneflower', color: '#d4e157', textColor: '#000', defaultSize: 1.5 },
  6: { name: 'Rabbitbrush', color: '#fbc02d', textColor: '#000', defaultSize: 3.0 },
  7: { name: 'Rigid Goldenrod', color: '#ffa726', textColor: '#000', defaultSize: 2.0 },
  8: { name: 'Rocky Mountain Gayfeather', color: '#8e24aa', textColor: '#fff', defaultSize: 1.5 },
  9: { name: 'Rocky Mountain Penstemon', color: '#311b92', textColor: '#fff', defaultSize: 1.2 },
  10: { name: 'Showy Fleabane', color: '#ce93d8', textColor: '#000', defaultSize: 1.5 },
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
  const [appState, setAppState] = useState('setup');
  
  // Persistent States
  const [plantTypes, setPlantTypes] = useStickyState(INITIAL_PLANT_TYPES, 'gd_types');
  const [setupWidth, setSetupWidth] = useStickyState("10", 'gd_w');
  const [setupHeight, setSetupHeight] = useStickyState("10", 'gd_h');
  const [allowedOverlap, setAllowedOverlap] = useStickyState("5", 'gd_overlap');
  
  const [plantCounts, setPlantCounts] = useStickyState({
    1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 2, 7: 3, 8: 3, 9: 3, 10: 3
  }, 'gd_counts');
  
  const [plantSizes, setPlantSizes] = useStickyState(
    Object.fromEntries(Object.entries(INITIAL_PLANT_TYPES).map(([k, v]) => [k, v.defaultSize])),
    'gd_sizes'
  );

  // Custom plant form state
  const [customPlantName, setCustomPlantName] = useState("");
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

  const generateLayout = () => {
    const finalWidth = Math.max(4, parseInt(setupWidth) || 10);
    const finalHeight = Math.max(4, parseInt(setupHeight) || 10);
    const overlapMult = 1 - (Math.max(0, Math.min(100, parseInt(allowedOverlap) || 0)) / 100);
    
    setGridWidth(finalWidth);
    setGridHeight(finalHeight);

    let nextId = 1;
    let initialPlants = [];
    let overflowCount = 0;

    // Sort plants by size descending (largest first) for better packing efficiency
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

      // Try random positions inside bed
      for(let attempt = 0; attempt < 300; attempt++) {
        const tryX = r + Math.random() * (finalWidth - size);
        const tryY = r + Math.random() * (finalHeight - size);

        let collision = false;
        for (const p of initialPlants) {
          if (!p.inBed) continue;
          const minDist = (r + p.size/2) * overlapMult;
          const dist = Math.hypot(p.x - tryX, p.y - tryY);
          if (dist < minDist - 0.001) { collision = true; break; }
        }
        
        if (!collision) {
          initialPlants.push({ id: nextId++, type: typeNum, x: tryX, y: tryY, size, inBed: true });
          placed = true;
          break;
        }
      }

      // If it doesn't fit, place outside in an overflow grid
      if (!placed) {
        const overflowSpacing = 2; // ft distance between overflow items
        const cols = Math.max(1, Math.floor(finalWidth / overflowSpacing));
        const row = Math.floor(overflowCount / cols);
        const col = overflowCount % cols;
        
        initialPlants.push({
          id: nextId++,
          type: typeNum,
          x: col * overflowSpacing + r,
          y: finalHeight + r + 1 + (row * overflowSpacing), // Place below the bed
          size,
          inBed: false
        });
        overflowCount++;
      }
    });

    setHasOverflow(overflowCount > 0);
    setPlants(initialPlants);
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
        color: customPlantColor,
        textColor: getContrastYIQ(customPlantColor),
        defaultSize: parseFloat(customPlantSize) || 1.5
      }
    });
    
    setPlantCounts({ ...plantCounts, [newId]: parseInt(customPlantQty) || 1 });
    setPlantSizes({ ...plantSizes, [newId]: customPlantSize });
    setCustomPlantName("");
  };

  // Drag Handlers
  const resolveSingleCollision = (x, y, radius, ignoreId, currentPlants) => {
    let nx = x, ny = y;
    const overlapMult = 1 - (Math.max(0, Math.min(100, parseInt(allowedOverlap) || 0)) / 100);
    
    for (let iter = 0; iter < 3; iter++) {
      currentPlants.forEach(p => {
        if (p.id === ignoreId) return;
        const minDist = (radius + p.size / 2) * overlapMult;
        const dist = Math.hypot(nx - p.x, ny - p.y);
        
        if (dist < minDist) {
          const overlap = minDist - dist;
          // Add a tiny random factor if centers are identical to prevent locking
          const ang = dist === 0 ? Math.random() * Math.PI * 2 : Math.atan2(ny - p.y, nx - p.x);
          nx += Math.cos(ang) * overlap;
          ny += Math.sin(ang) * overlap;
        }
      });
    }
    return { x: nx, y: ny };
  };

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

    const plant = plants.find(p => p.id === draggingId);
    const radius = (plant?.size || 1.5) / 2;

    let { x: resolvedX, y: resolvedY } = resolveSingleCollision(requestedX, requestedY, radius, draggingId, plants);

    // Determine if the user is holding it inside the bed visually
    const isMouseInBed = requestedX > 0 && requestedX < gridWidth && requestedY > 0 && requestedY < gridHeight;
    let inBed = plant.inBed;

    if (isMouseInBed) {
      // Hard constrain to walls if placed inside the bed
      resolvedX = Math.max(radius, Math.min(gridWidth - radius, resolvedX));
      resolvedY = Math.max(radius, Math.min(gridHeight - radius, resolvedY));
      inBed = true;
    } else {
      // Loose bounds if dragged outside
      resolvedX = Math.max(-5, Math.min(gridWidth + 5, resolvedX));
      inBed = false;
    }

    setPlants(plants.map(p => p.id === draggingId ? { ...p, x: resolvedX, y: resolvedY, inBed } : p));
  };

  const handlePointerUp = () => setDraggingId(null);

  const addPlantToDesign = (typeNum) => {
    const newId = plants.length > 0 ? Math.max(...plants.map(p => p.id)) + 1 : 1;
    const size = parseFloat(plantSizes[typeNum]) || plantTypes[typeNum]?.defaultSize || 1.5;
    const radius = size / 2;
    
    // Attempt to drop in center, but resolve physics immediately
    const { x: rx, y: ry } = resolveSingleCollision(gridWidth / 2, gridHeight / 2, radius, null, plants);
    
    // Ensure it doesn't push completely out of bounds immediately
    const nx = Math.max(radius, Math.min(gridWidth - radius, rx));
    const ny = Math.max(radius, Math.min(gridHeight - radius, ry));

    setPlants([...plants, { id: newId, type: typeNum, x: nx, y: ny, size, inBed: true }]);
    setSelectedPlantId(newId);
  };

  const removeSelected = () => {
    if (selectedPlantId !== null) {
      setPlants(plants.filter(p => p.id !== selectedPlantId));
      setSelectedPlantId(null);
    }
  };

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
              <p className="text-sm text-slate-500 mt-1">Configure dimensions and starting plants (edits are automatically remembered)</p>
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
                <p className="text-[10px] text-slate-400 mt-1 leading-tight">Increase if plants get pushed out of the bed.</p>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-end mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Starting Configuration</h2>
                <span className="text-xs text-slate-400">Diameters are in feet</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {Object.keys(plantTypes).map((num) => {
                  const typeNum = parseInt(num);
                  const p = plantTypes[typeNum];
                  return (
                    <div key={typeNum} className="flex flex-col bg-slate-50 p-2.5 rounded-lg border border-slate-200 gap-2">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-7 h-7 rounded-full flex shrink-0 items-center justify-center font-bold text-xs shadow-inner"
                          style={{ backgroundColor: p.color, color: p.textColor }}
                        >
                          {typeNum}
                        </div>
                        <span className="text-[10px] font-medium leading-tight truncate" title={p.name}>{p.name}</span>
                      </div>
                      
                      <div className="w-full space-y-1.5 mt-1">
                        <div className="flex items-center justify-between text-xs">
                          <label className="text-slate-500">Qty:</label>
                          <input
                            type="number"
                            min="0"
                            value={plantCounts[typeNum] || 0}
                            onChange={(e) => setPlantCounts(prev => ({ ...prev, [typeNum]: parseInt(e.target.value) || 0 }))}
                            className="w-12 text-center border border-slate-300 rounded focus:ring-1 focus:ring-emerald-500 outline-none"
                          />
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <label className="text-slate-500">Dia(ft):</label>
                          <input
                            type="number"
                            min="0.1"
                            step="0.1"
                            value={plantSizes[typeNum] || ''}
                            onChange={(e) => setPlantSizes(prev => ({ ...prev, [typeNum]: e.target.value }))}
                            className="w-12 text-center border border-slate-300 rounded focus:ring-1 focus:ring-emerald-500 outline-none"
                          />
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

          <div className="w-full lg:w-80 bg-slate-50 p-6 md:p-8 flex flex-col gap-4 border-t lg:border-t-0 lg:border-l border-slate-200">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-1">Add Custom Plant Type</h2>
            
            <div className="space-y-4 bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
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
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-slate-500 block mb-1">Color</label>
                  <input 
                    type="color" 
                    value={customPlantColor} 
                    onChange={(e) => setCustomPlantColor(e.target.value)}
                    className="w-full h-8 bg-slate-50 border border-slate-300 rounded cursor-pointer"
                  />
                </div>
                <div className="w-20">
                  <label className="text-xs text-slate-500 block mb-1">Dia(ft)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    min="0.1"
                    value={customPlantSize} 
                    onChange={(e) => setCustomPlantSize(e.target.value)}
                    className="w-full px-2 py-1 bg-slate-50 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Initial Qty</label>
                <input 
                  type="number" 
                  min="0"
                  value={customPlantQty} 
                  onChange={(e) => setCustomPlantQty(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
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
  // DESIGN SCREEN
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
        </div>

        {/* Quick Add Palette */}
        <div className="flex items-center gap-1.5 bg-slate-50 p-1.5 rounded-lg border border-slate-200 overflow-x-auto max-w-[40vw]">
          <span className="text-[10px] font-bold text-slate-400 mr-1 uppercase tracking-wider hidden xl:block">Add:</span>
          {Object.keys(plantTypes).map((num) => {
            const p = plantTypes[num];
            return (
              <button
                key={num}
                onClick={() => addPlantToDesign(Number(num))}
                className="w-7 h-7 rounded-full flex shrink-0 items-center justify-center font-bold text-[10px] shadow-sm hover:scale-110 transition-transform"
                style={{ backgroundColor: p.color, color: p.textColor }}
                title={`Add ${p.name} (${plantSizes[num]}ft)`}
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
        <div className="w-48 md:w-64 bg-white border-r border-slate-200 p-4 flex flex-col gap-3 overflow-y-auto hidden sm:flex shrink-0 shadow-sm z-10">
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
                    <span className="text-[10px] text-slate-500">Qty: {countInDesign} | Dia: {plantSizes[num]}ft</span>
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

          <div className="w-full flex justify-center pb-24"> {/* Extra padding bottom for overflow plants */}
            <div 
              ref={gridRef}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              // overflow-visible is crucial here: it allows overflow plants to bleed outside the box
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
                const pInfo = plantTypes[plant.type] || { color: '#ccc', textColor: '#000', name: 'Unknown' };
                const isSelected = plant.id === selectedPlantId;
                const leftPercent = (plant.x / gridWidth) * 100;
                const topPercent = (plant.y / gridHeight) * 100;
                const widthPercent = (plant.size / gridWidth) * 100;

                // Check for physical overlaps with other plants (5% tolerance for floating point rounding)
                const isOverlapping = plants.some(other =>
                  other.id !== plant.id &&
                  Math.hypot(plant.x - other.x, plant.y - other.y) < ((plant.size + other.size) / 2) * 0.95
                );

                return (
                  <div
                    key={plant.id}
                    onPointerDown={(e) => handlePointerDown(e, plant)}
                    title={`${pInfo.name} (${plant.size}ft) - ${plant.inBed ? 'In Bed' : 'Outside Bed'}`}
                    className={`absolute rounded-full flex items-center justify-center font-bold shadow-md cursor-grab active:cursor-grabbing transition-shadow ${
                      isSelected ? 'ring-4 ring-emerald-500 ring-offset-1 z-20' : 'z-10 hover:brightness-105'
                    } ${!plant.inBed ? 'border-2 border-dashed border-red-500' : ''}`}
                    style={{
                      left: `${leftPercent}%`,
                      top: `${topPercent}%`,
                      width: `${widthPercent}%`,
                      aspectRatio: '1 / 1',
                      transform: 'translate(-50%, -50%)',
                      backgroundColor: pInfo.color,
                      color: pInfo.textColor,
                      opacity: !plant.inBed ? 0.5 : (isOverlapping ? 0.75 : 1),
                      mixBlendMode: isOverlapping ? 'multiply' : 'normal',
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