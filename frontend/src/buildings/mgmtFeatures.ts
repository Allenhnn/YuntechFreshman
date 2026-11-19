import {
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type Scene,
} from 'three';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { HandBuiltBuilding } from './buildingWorld';

/**
 * 管理學院 features from the photos that the floor-plan pipeline can't express:
 *  - the curved east end of 管理一館's 智慧商務中心 block (1F–2F): a washed-stone half cylinder
 *    with dark ribbon windows, wrapped round the stepped rooms of the traced plan;
(The courtyard in the crook of 管理二館's L is mgmtCourtyard.ts.)
 * Everything is laid out in each building's plan frame.
 */
const FH = 3.6;

function planGroup(scene: Scene, b: HandBuiltBuilding, name: string): Group {
  const [ox, oz] = b.planToWorld(0, 0), [px, pz] = b.planToWorld(1, 0);
  const g = new Group();
  g.name = name;
  g.position.set(ox, 0, oz);
  g.rotation.y = -Math.atan2(pz - oz, px - ox); // local +x = plan +X, local +z = plan +Y
  scene.add(g);
  return g;
}

function canvas(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void, tracker: ResourceTracker): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) paint(g);
  const t = tracker.texture(new CanvasTexture(c));
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** One storey of washed stone with a dark ribbon window (1.15–2.45 m) and mullions every 1.2 m. */
function ribbonStorey(g: CanvasRenderingContext2D): void {
  const W = 128, H = 256;
  g.fillStyle = '#a9a7a0';
  g.fillRect(0, 0, W, H);
  let s = 5;
  const r = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = ['#7f7d77', '#c9c6be', '#6b6964', '#d8d5cd'][i % 4]!;
    g.globalAlpha = 0.25 + r() * 0.35;
    g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
  }
  g.globalAlpha = 1;
  const y = (m: number): number => H - (m / FH) * H; // canvas y of a height above the storey floor
  g.fillStyle = '#26303a';
  g.fillRect(0, y(2.45), W, y(1.15) - y(2.45));
  g.fillStyle = 'rgba(160,190,210,0.35)';
  g.fillRect(0, y(2.45), W, (y(1.15) - y(2.45)) * 0.35);
  g.fillStyle = '#1a1c1e';
  g.fillRect(0, y(2.47), W, 3); // head
  g.fillRect(0, y(1.15), W, 4); // sill
  g.fillRect(W / 2 - 2, y(2.45), 4, y(1.15) - y(2.45)); // mullion
  g.fillStyle = '#8f8d86';
  g.fillRect(0, H - 6, W, 6); // slab line
}

export function createMgmtFeatures(scene: Scene, physics: RAPIER.World, tracker: ResourceTracker, ma: HandBuiltBuilding | undefined): { dispose(): void } {
  const colliders: RAPIER.Collider[] = [];
  const groups: Group[] = [];
  const solidAt = (b: HandBuiltBuilding, x: number, y: number, z: number, hw: number, hh: number, hd: number, yaw = 0): void => {
    const [wx, wz] = b.planToWorld(x, z);
    const [ox, oz] = b.planToWorld(0, 0), [px, pz] = b.planToWorld(1, 0);
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.atan2(pz - oz, px - ox) + yaw);
    colliders.push(tracker.collider(physics.createCollider(
      RAPIER.ColliderDesc.cuboid(hw, hh, hd).setTranslation(wx, y, wz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    )));
  };
  const concrete = tracker.material(new MeshStandardMaterial({ color: 0xc4c2bb, roughness: 0.85 }));

  // --- 管理一館: curved east end of the 101 / 201 block. -------------------------------------------
  if (ma) {
    const g = planGroup(scene, ma, 'MA curved end');
    groups.push(g);
    const C = { x: 55, z: 56 }, R = 8, H = 2 * FH; // matches CURVE_C / CURVE_R in scripts/floorplan/handbuilt/ma.py
    const tex = canvas(128, 256, ribbonStorey, tracker);
    const arc = Math.PI;
    tex.repeat.set(Math.round((arc * R) / 1.2), 2); // a mullion bay every ~1.2 m, one texture row per storey
    const wall = tracker.material(new MeshStandardMaterial({ map: tex, roughness: 0.8, side: DoubleSide }));
    // Three's cylinder puts θ = 0 on +Z; θ ∈ [0, π] is the +X half (the plan's east end).
    const shell = new Mesh(tracker.geometry(new CylinderGeometry(R, R, H, 64, 1, true, 0, arc)), wall);
    shell.position.set(C.x, H / 2, C.z);
    shell.castShadow = shell.receiveShadow = true;
    g.add(shell);
    const parapet = new Mesh(tracker.geometry(new CylinderGeometry(R + 0.05, R + 0.05, 0.9, 64, 1, true, 0, arc)), concrete);
    parapet.material = tracker.material(new MeshStandardMaterial({ color: 0xa9a7a0, roughness: 0.9, side: DoubleSide }));
    parapet.position.set(C.x, H + 0.45, C.z);
    g.add(parapet);
    const roof = new Mesh(tracker.geometry(new CircleGeometry(R, 64, Math.PI / 2, -arc).rotateX(-Math.PI / 2)), tracker.material(new MeshStandardMaterial({ color: 0xbdbab3, roughness: 0.95, side: DoubleSide })));
    roof.position.set(C.x, H + 0.02, C.z);
    roof.receiveShadow = true;
    g.add(roof);
    // A slab edge at 2F.
    const band = new Mesh(tracker.geometry(new CylinderGeometry(R + 0.08, R + 0.08, 0.3, 64, 1, true, 0, arc)), tracker.material(new MeshStandardMaterial({ color: 0x8f8d86, roughness: 0.9, side: DoubleSide })));
    band.position.set(C.x, FH, C.z);
    g.add(band);
    // Collision: tangent boxes round the arc.
    const SEG = 16;
    for (let i = 0; i < SEG; i++) {
      const th = ((i + 0.5) / SEG) * arc;
      const x = C.x + R * Math.sin(th), z = C.z + R * Math.cos(th);
      solidAt(ma, x, H / 2, z, ((arc * R) / SEG) / 2 + 0.05, H / 2, 0.15, th);
    }
  }

  return {
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      for (const g of groups) g.removeFromParent();
    },
  };
}
