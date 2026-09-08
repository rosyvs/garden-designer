import { useMemo, useRef, useImperativeHandle, forwardRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { PerspectiveCamera } from 'three';
import { DoubleSide, RepeatWrapping, Shape, SRGBColorSpace, TextureLoader } from 'three';
import { isInBed } from './layoutEngines';
import type { PlantInstance, Point } from './layoutEngines';

// Cache decoded+cropped textures by src+zoom so identical plant-type images
// (many instances of the same type) share one GPU upload instead of
// reloading/recropping it per-instance. Keyed by zoom too since repeat/offset
// live on the Texture itself, not the material — two different zoom levels
// of the same source image can't share one Texture object.
const textureCache = new Map<string, ReturnType<TextureLoader['load']>>();
const loadPlantTexture = (src: string, zoom: number) => {
  const key = `${src}|${zoom}`;
  let tex = textureCache.get(key);
  if (!tex) {
    tex = new TextureLoader().load(src);
    // Photos are stored sRGB-encoded; without this the renderer treats them
    // as linear data and everything comes out noticeably darker/duller than
    // the source image (and than the plain `color` fill on other plants).
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = tex.wrapT = RepeatWrapping;
    const repeat = 1 / zoom;
    tex.repeat.set(repeat, repeat);
    tex.offset.set((1 - repeat) / 2, (1 - repeat) / 2);
    textureCache.set(key, tex);
  }
  return tex;
};

export type CameraPreset = 'top' | 'isometric' | 'front' | 'reset';

export interface Garden3DHandle {
  setView: (preset: CameraPreset) => void;
}

interface Garden3DProps {
  bedWidth: number;
  bedHeight: number;
  bedPolygon: Point[] | null;
  activePlants: PlantInstance[];
}

// Maps bed-space (x, y) — origin top-left, x right, y down — onto the XZ
// ground plane centered at the world origin, matching the 2D view's framing.
const toWorld = (x: number, y: number, bedWidth: number, bedHeight: number): [number, number] => [
  x - bedWidth / 2,
  y - bedHeight / 2,
];

function Plant({ plant, bedWidth, bedHeight, bedPolygon }: { plant: PlantInstance; bedWidth: number; bedHeight: number; bedPolygon: Point[] | null }) {
  const [wx, wz] = toWorld(plant.x, plant.y, bedWidth, bedHeight);
  const footprint = Math.max(plant.spread, 0.1);
  const height = Math.max(plant.height, 0.1);
  const radius = footprint / 2;
  const isOutOfBounds = !plant.locked && !isInBed(plant.x, plant.y, bedWidth, bedHeight, bedPolygon);
  const imageZoom = plant.imageZoom ?? 4;
  const map = useMemo(() => (plant.image ? loadPlantTexture(plant.image, imageZoom) : null), [plant.image, imageZoom]);
  const opacity = plant.opacity ?? 1;
  // meshStandardMaterial multiplies `color` by `map` — leaving color at the
  // plant's (usually saturated) fill color darkens/tints a photo texture on
  // top of it. White leaves the texture's own colors untouched.
  const materialProps = { color: map ? '#ffffff' : plant.color, map, transparent: opacity < 1, opacity };

  return (
    <group position={[wx, 0, wz]}>
      {isOutOfBounds && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <ringGeometry args={[radius * 0.85, radius * 1.05, 32]} />
          <meshBasicMaterial color="#dc2626" side={DoubleSide} />
        </mesh>
      )}
      {plant.shape === 'cone' ? (
        <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
          <coneGeometry args={[radius, height, 24]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      ) : plant.shape === 'cylinder' ? (
        <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[radius, radius, height, 24]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      ) : (
        <mesh position={[0, height / 2, 0]} scale={[1, height / footprint, 1]} castShadow receiveShadow>
          <sphereGeometry args={[radius, 24, 16]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      )}
    </group>
  );
}

// Ground floor as a THREE.Shape so a custom bed outline is reflected in 3D
// too, not just the bounding-box rectangle. Local shape coords map to the
// XZ ground plane via the same convention as toWorld: local (lx, ly) ->
// world (lx, 0, -ly) after the -90°-about-X rotation applied to the mesh.
const buildGroundShape = (bedWidth: number, bedHeight: number, bedPolygon: Point[] | null): Shape => {
  const shape = new Shape();
  const hw = bedWidth / 2;
  const hh = bedHeight / 2;
  let points: [number, number][];
  if (bedPolygon && bedPolygon.length >= 3) {
    points = bedPolygon.map(v => [v.x - hw, hh - v.y]);
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[(i + 1) % points.length];
      area += ax * by - bx * ay;
    }
    if (area < 0) points.reverse();
  } else {
    points = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  }
  points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  return shape;
};

const Garden3D = forwardRef<Garden3DHandle, Garden3DProps>(({ bedWidth, bedHeight, bedPolygon, activePlants }, ref) => {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const diag = Math.sqrt(bedWidth * bedWidth + bedHeight * bedHeight) || 1;
  const initialDist = diag * 1.3;
  const gridSize = useMemo(() => Math.max(bedWidth, bedHeight), [bedWidth, bedHeight]);
  const groundShape = useMemo(() => buildGroundShape(bedWidth, bedHeight, bedPolygon), [bedWidth, bedHeight, bedPolygon]);

  useImperativeHandle(ref, () => ({
    setView: (preset: CameraPreset) => {
      const controls = controlsRef.current;
      if (!controls) return;
      const camera = controls.object as PerspectiveCamera;
      const dist = diag * 1.3;

      const positions: Record<CameraPreset, [number, number, number]> = {
        top: [0.0001, dist * 1.15, 0.0001],
        isometric: [dist * 0.7, dist * 0.65, dist * 0.7],
        front: [0, dist * 0.35, dist * 1.05],
        reset: [dist * 0.7, dist * 0.65, dist * 0.7],
      };

      camera.position.set(...positions[preset]);
      controls.target.set(0, 0, 0);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
      controls.update();
    },
  }), [diag]);

  return (
    <Canvas
      shadows
      camera={{ position: [initialDist * 0.7, initialDist * 0.65, initialDist * 0.7], fov: 45 }}
    >
      <ambientLight intensity={0.7} />
      <directionalLight
        position={[diag * 0.6, diag * 1.2, diag * 0.4]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <shapeGeometry args={[groundShape]} />
        <meshStandardMaterial color="#d6d3d1" side={DoubleSide} />
      </mesh>
      <gridHelper args={[gridSize, gridSize]} position={[0, 0.001, 0]} />

      {activePlants.map(p => (
        <Plant key={p.instanceId} plant={p} bedWidth={bedWidth} bedHeight={bedHeight} bedPolygon={bedPolygon} />
      ))}

      <OrbitControls ref={controlsRef} makeDefault target={[0, 0, 0]} />
      <GizmoHelper alignment="bottom-right" margin={[70, 70]}>
        <GizmoViewport />
      </GizmoHelper>
    </Canvas>
  );
});

Garden3D.displayName = 'Garden3D';

export default Garden3D;
