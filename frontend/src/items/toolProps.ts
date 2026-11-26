import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, type Scene } from 'three';
import type { ResourceTracker } from '../core/resources';
import type { Interactable } from '../buildings/buildingWorld';

/**
 * 管理一館 工具室 odds and ends: a broom and a mop leaning in the corner of every floor's tool room
 * (can be picked up with E: they go into the bag) and a bucket that stays. A broom or mop used from
 * the bag is put down where you stand (and can be picked up again).
 */
export type ToolId = 'broom' | 'mop';

export interface ToolSpot {
  x: number;
  y: number;
  z: number;
  /** Lean direction (yaw) and which tool. */
  yaw: number;
  tool: ToolId;
}

export interface ToolProps {
  /** Pick-up spots (`tool:<n>`), to be offered with the other E prompts. */
  readonly interactables: Interactable[];
  /** E at `tool:<n>`: the tool it was, now taken out of the world; null if gone. */
  take(id: string): ToolId | null;
  /** Lays a tool down on the floor at (x, y, z). */
  drop(tool: ToolId, x: number, y: number, z: number, yaw: number): void;
  /** A fresh model of a tool (for the hand). */
  makeModel(tool: ToolId): Group;
  dispose(): void;
}

export function createToolProps(scene: Scene, tracker: ResourceTracker, spots: readonly ToolSpot[], buckets: readonly { x: number; y: number; z: number }[]): ToolProps {
  const stickMat = tracker.material(new MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.6 }));
  const bristleMat = tracker.material(new MeshStandardMaterial({ color: 0xd9b84a, roughness: 0.9 }));
  const mopMat = tracker.material(new MeshStandardMaterial({ color: 0xe8e6df, roughness: 1 }));
  const bucketMat = tracker.material(new MeshStandardMaterial({ color: 0x2c6fd6, roughness: 0.5 }));
  const stick = tracker.geometry(new CylinderGeometry(0.016, 0.016, 1.25, 8).translate(0, 0.625 + 0.18, 0));
  const broomHead = tracker.geometry(new CylinderGeometry(0.03, 0.14, 0.22, 10).scale(1, 1, 0.45).translate(0, 0.11, 0));
  const mopHead = tracker.geometry(new CylinderGeometry(0.11, 0.15, 0.2, 12).translate(0, 0.1, 0));
  const bucketGeo = tracker.geometry(new CylinderGeometry(0.16, 0.13, 0.3, 16).translate(0, 0.15, 0));

  const model = (tool: ToolId): Group => {
    const g = new Group();
    g.add(new Mesh(stick, stickMat), new Mesh(tool === 'broom' ? broomHead : mopHead, tool === 'broom' ? bristleMat : mopMat));
    for (const c of g.children) c.castShadow = true;
    return g;
  };
  const props = new Map<string, { tool: ToolId; group: Group }>();
  const interactables: Interactable[] = [];
  let n = 0;
  const place = (tool: ToolId, x: number, y: number, z: number, yaw: number, lying: boolean): void => {
    const id = `tool:${n++}`;
    const g = model(tool);
    g.position.set(x, y, z);
    g.rotation.set(lying ? Math.PI / 2 : 0.18, yaw, 0, 'YXZ'); // leaning on the wall, or lying on the floor
    if (lying) g.position.y += 0.05;
    scene.add(g);
    props.set(id, { tool, group: g });
    interactables.push({ id, prompt: `按 E 拿起${tool === 'broom' ? '掃把' : '拖把'}`, x, y, z, radius: 1.1 });
  };
  for (const s of spots) place(s.tool, s.x, s.y, s.z, s.yaw, false);
  const bucketMeshes = buckets.map((b) => {
    const m = new Mesh(bucketGeo, bucketMat);
    m.position.set(b.x, b.y, b.z);
    m.castShadow = true;
    scene.add(m);
    return m;
  });

  return {
    interactables,
    take(id) {
      const p = props.get(id);
      if (!p) return null;
      p.group.removeFromParent();
      props.delete(id);
      const i = interactables.findIndex((it) => it.id === id);
      if (i >= 0) interactables.splice(i, 1);
      return p.tool;
    },
    makeModel: model,
    drop(tool, x, y, z, yaw) {
      place(tool, x, y, z, yaw, true);
    },
    dispose() {
      for (const p of props.values()) p.group.removeFromParent();
      for (const m of bucketMeshes) m.removeFromParent();
    },
  };
}
