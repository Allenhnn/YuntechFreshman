import { CanvasTexture, Color, CylinderGeometry, DoubleSide, Group, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry, RepeatWrapping, SRGBColorSpace, TextureLoader, TorusGeometry, Vector3, type Scene } from 'three';
import type { ResourceTracker } from '../core/resources';
import { mulberry32 } from '../core/math';

/**
 * 學生活動中心北面廣場（使用者照片 2026-11-24，重新建模，不沿用舊模型）：簷口橫幅、紅磚廣場（台階前）與右側往樓梯塔那片灰色地磚、
 * 花台裡的紅色朱蕉、花台前兩台腳踏車。量體、台階、花台在 campus/activityComplex.ts。
 * Root frame = activityComplex.ts `frame(128.18,168.83,93.01,175.11)`: local +x = a (east end → west), +z = −o (out to the plaza).
 */
export function addActivityEntrance(scene: Scene, tracker: ResourceTracker) {
  const root = new Group();
  root.name = 'Student Activity Center north entrance';
  root.position.set(128.18, 0, 168.83);
  root.rotation.y = Math.atan2(-6.28, -35.17);
  const random = mulberry32(296668597);
  const E = 32.3; // west end of the portico (activityComplex.ts)

  // Banner on the fascia.
  const banner = new TextureLoader().load(new URL('./activity-entrance-sign.webp', import.meta.url).href);
  banner.colorSpace = SRGBColorSpace;
  const sign = new Mesh(new PlaneGeometry(E - 0.2, 1.5), new MeshStandardMaterial({ map: banner, roughness: 1 }));
  sign.position.set(E / 2, 9.5, 29.07);
  root.add(sign);

  /** A paver texture: `colours` per brick, `w` × `h` px bricks, running bond. */
  const paverTexture = (base: string, colours: readonly string[], w: number, h: number, rx: number, ry: number): CanvasTexture => {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 512, 256);
    for (let row = 0; row < 256 / h; row++) {
      for (let col = -1; col < 512 / w + 1; col++) {
        ctx.fillStyle = colours[Math.floor(random() * colours.length)]!;
        ctx.fillRect(col * w + (row % 2) * (w / 2), row * h, w - 2, h - 2);
      }
    }
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(rx, ry);
    return t;
  };
  // Red brick in front of the stair and planter; grey pavers on the right, toward the stair tower.
  const brick = new Mesh(new PlaneGeometry(E + 3, 25), new MeshStandardMaterial({ map: paverTexture('#6e4a3e', ['#9a5f4c', '#8f5545', '#a5685a', '#94604f'], 64, 32, 22, 30), roughness: 1 }));
  brick.rotation.x = -Math.PI / 2;
  brick.position.set(E / 2 - 1.5, 0.079, 31.2 + 12.5);
  brick.receiveShadow = true;
  root.add(brick);
  const grey = new Mesh(new PlaneGeometry(16, 20), new MeshStandardMaterial({ map: paverTexture('#55585a', ['#7b7e7f', '#727577', '#83868a', '#6c6f71'], 48, 48, 10, 12), roughness: 1 }));
  grey.rotation.x = -Math.PI / 2;
  grey.position.set(E + 8, 0.081, 30.8 + 10);
  grey.receiveShadow = true;
  root.add(grey);

  // Red cordylines in the planter: clusters of narrow pointed leaves behind the hedge.
  const leaf = new PlaneGeometry(1, 1, 1, 2);
  const pos = leaf.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setX(i, pos.getX(i) * (y === 0 ? 1 : .06));
    pos.setZ(i, y * y * .65);
  }
  leaf.computeVertexNormals();
  const perRow = 34, rows = 2, perPlant = 9;
  const plants = new InstancedMesh(leaf, new MeshStandardMaterial({ side: DoubleSide, roughness: .9 }), rows * perRow * perPlant);
  const transform = new Object3D(), tint = new Color();
  let index = 0;
  for (let plant = 0; plant < rows * perRow; plant++) {
    const x = 17.8 + (plant % perRow) * ((E - 18.5) / perRow), z = 28.6 + Math.floor(plant / perRow) * .5;
    for (let k = 0; k < perPlant; k++) {
      const yaw = random() * Math.PI * 2, spread = .25 + random() * .18;
      transform.position.set(x + Math.sin(yaw) * spread, 1.35 + random() * .45, z + Math.cos(yaw) * spread);
      transform.rotation.set(.4 + random() * .55, yaw, 0, 'YXZ');
      transform.scale.set(.19 + random() * .1, .95 + random() * .45, 1);
      transform.updateMatrix();
      plants.setMatrixAt(index, transform.matrix);
      plants.setColorAt(index++, tint.set(['#632839', '#873747', '#59303b', '#9c4e56'][Math.floor(random() * 4)]!));
    }
  }
  root.add(plants);

  // Two bikes parked in front of the planter (照片).
  const tyre = new MeshStandardMaterial({ color: 0x292724 }), tube = new CylinderGeometry(.024, .024, 1, 6);
  const rim = new TorusGeometry(.34, .035, 6, 24), axis = new Vector3(0, 1, 0);
  for (const [x, z, yaw, paint] of [[27.6, 31.1, .12, 0xd9d9d4], [29.4, 31.2, -.1, 0x2b2b2b]] as const) {
    const bike = new Group(), enamel = new MeshStandardMaterial({ color: paint });
    bike.position.set(x, .09, z); bike.rotation.y = yaw + Math.PI / 2;
    for (const wx of [-.56, .56]) {
      const wheel = new Mesh(rim, tyre); wheel.position.set(wx, .35, 0); bike.add(wheel);
    }
    const bar = (ax: number, ay: number, bx: number, by: number, material = enamel) => {
      const d = new Vector3(bx - ax, by - ay, 0), mesh = new Mesh(tube, material);
      mesh.position.set((ax + bx) / 2, (ay + by) / 2, 0); mesh.scale.y = d.length();
      mesh.quaternion.setFromUnitVectors(axis, d.normalize()); bike.add(mesh);
    };
    bar(-.56, .35, -.18, .84); bar(-.56, .35, 0, .4); bar(0, .4, -.18, .84);
    bar(-.18, .84, .37, .82); bar(0, .4, .37, .82); bar(.56, .35, .33, 1.02);
    bar(-.31, .88, -.07, .88, tyre); bar(.24, 1.03, .45, 1.03, tyre);
    root.add(bike);
  }
  scene.add(tracker.object(root));
}
