import { useMemo, useRef, useImperativeHandle, forwardRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { PerspectiveCamera } from 'three';
import { DoubleSide } from 'three';
import type { PlantInstance } from './layoutEngines';

export type CameraPreset = 'top' | 'isometric' | 'front' | 'reset';

export interface Garden3DHandle {
  setView: (preset: CameraPreset) => void;
}

interface Garden3DProps {
  bedWidth: number;
  bedHeight: number;
  activePlants: PlantInstance[];
}

// Maps bed-space (x, y) — origin top-left, x right, y down — onto the XZ
// ground plane centered at the world origin, matching the 2D view's framing.
const toWorld = (x: number, y: number, bedWidth: number, bedHeight: number): [number, number] => [
  x - bedWidth / 2,
  y - bedHeight / 2,
];

function Plant({ plant, bedWidth, bedHeight }: { plant: PlantInstance; bedWidth: number; bedHeight: number }) {
  const [wx, wz] = toWorld(plant.x, plant.y, bedWidth, bedHeight);
  const footprint = Math.max(plant.spread, 0.1);
  const height = Math.max(plant.height, 0.1);
  const radius = footprint / 2;
  const isOutOfBounds = plant.x < 0 || plant.x > bedWidth || plant.y < 0 || plant.y > bedHeight;

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
          <meshStandardMaterial color={plant.color} />
        </mesh>
      ) : (
        <mesh position={[0, height / 2, 0]} scale={[1, height / footprint, 1]} castShadow receiveShadow>
          <sphereGeometry args={[radius, 24, 16]} />
          <meshStandardMaterial color={plant.color} />
        </mesh>
      )}
    </group>
  );
}

const Garden3D = forwardRef<Garden3DHandle, Garden3DProps>(({ bedWidth, bedHeight, activePlants }, ref) => {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const diag = Math.sqrt(bedWidth * bedWidth + bedHeight * bedHeight) || 1;
  const initialDist = diag * 1.3;
  const gridSize = useMemo(() => Math.max(bedWidth, bedHeight), [bedWidth, bedHeight]);

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
        <planeGeometry args={[bedWidth, bedHeight]} />
        <meshStandardMaterial color="#d6d3d1" />
      </mesh>
      <gridHelper args={[gridSize, gridSize]} position={[0, 0.001, 0]} />

      {activePlants.map(p => (
        <Plant key={p.instanceId} plant={p} bedWidth={bedWidth} bedHeight={bedHeight} />
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
