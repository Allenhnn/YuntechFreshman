import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  type Material,
  type Scene,
} from 'three';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';

/**
 * Card-sensor boom barriers where campus roads meet 龍潭路, after the site photo: a yellow
 * hazard-striped housing on each kerb, each lifting a red-and-white half boom with a red sign
 * (one per lane, meeting in the middle), lamps that go green when open, flexible yellow bollards,
 * a teal-and-white crossing on the 龍潭路 side and a yellow box marking under the booms.
 * With a student card in the bag the booms lift when the player comes within OPEN_R and drop
 * once they are past CLOSE_R; without one they stay down (blocking the road) and the reader says why.
 */
interface GateSpot {
  /** Centre of the road under the booms and the road direction (unit-free). */
  x: number;
  z: number;
  dx: number;
  dz: number;
  width: number;
  /** Which way along (dx, dz) 龍潭路 lies: the crossing is painted on that side. */
  toward: 1 | -1;
}

const SPOTS: readonly GateSpot[] = [
  { x: 168.6, z: -141.5, dx: 0.14, dz: 1, width: 8, toward: 1 }, // 龍潭路 × the road north past 雲泰表演廳
  { x: 174.1, z: -112.1, dx: 0.18, dz: 0.98, width: 8, toward: -1 }, // 龍潭路 × the same road heading south, 4.5 m past the zebra at (173.3, −116.5)
  { x: -44.2, z: -55.3, dx: 0.173, dz: 0.985, width: 8, toward: -1 }, // 龍潭路 × the road south past 技職大樓, 4.5 m past the zebra at (−45, −59.7)
  { x: -49.9, z: -89.1, dx: -0.162, dz: -0.987, width: 8, toward: -1 }, // 龍潭路 × the same road heading north (past the service-road branch)
];

const OPEN_R = 5;
const CLOSE_R = 8;
const NO_CARD_R = 3.5;
const LIFT_SPEED = 2.2; // rad / s
const BOOM_Y = 1.0;

export type GateEvent = 'opened' | 'noCard';

export interface SensorGates {
  /** Per frame; returns what happened this frame (for a toast / sound). */
  update(dt: number, time: number, px: number, pz: number, hasCard: boolean): GateEvent | null;
  dispose(): void;
}

export function createSensorGates(scene: Scene, physics: RAPIER.World, tracker: ResourceTracker): SensorGates {
  const tex = (w: number, h: number, paint: (g: CanvasRenderingContext2D) => void, repeat = false): CanvasTexture => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (g) paint(g);
    const t = tracker.texture(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
    return t;
  };
  const stripe = tex(256, 16, (g) => {
    for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#f7f5ee' : '#d22b26'; g.fillRect(k * 32, 0, 32, 16); }
  }, true);
  stripe.repeat.set(1.5, 1);
  const hazard = tex(64, 128, (g) => {
    g.fillStyle = '#f2c21b';
    g.fillRect(0, 0, 64, 128);
    g.fillStyle = '#1b1b1b';
    for (let y = -64; y < 128; y += 32) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(64, y + 32); g.lineTo(64, y + 48); g.lineTo(0, y + 16); g.closePath(); g.fill();
    }
    g.fillStyle = '#f2c21b';
    g.fillRect(0, 20, 64, 80); // plain yellow middle, stripes top and bottom
  });
  const signTex = tex(128, 80, (g) => {
    g.fillStyle = '#d22b26';
    g.fillRect(0, 0, 128, 80);
    g.strokeStyle = '#fff';
    g.lineWidth = 5;
    g.strokeRect(5, 5, 118, 70);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = "900 26px system-ui, 'PingFang TC', sans-serif";
    g.fillText('請刷卡', 64, 30);
    g.font = '800 15px system-ui, sans-serif';
    g.fillText('CARD ONLY', 64, 58);
  });
  const crossTex = tex(128, 16, (g) => {
    for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#eef2ee' : '#4fb7a6'; g.fillRect(k * 16, 0, 16, 16); }
  }, true);
  const std = (o: ConstructorParameters<typeof MeshStandardMaterial>[0]): MeshStandardMaterial => tracker.material(new MeshStandardMaterial(o));
  const boomMat = std({ map: stripe, roughness: 0.4, emissive: 0x330000, emissiveIntensity: 0.4 });
  const housingMat = std({ map: hazard, roughness: 0.45, metalness: 0.15 });
  const capMat = std({ color: 0x2b2e33, roughness: 0.5 });
  const signMat = std({ map: signTex, roughness: 0.5, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.15 });
  const bollardMat = std({ color: 0xf2b21b, roughness: 0.5 });
  const reflectMat = std({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.35 });
  const ledOff = std({ color: 0xd22b26, emissive: 0xff2a1f, emissiveIntensity: 1.2 });
  const ledOn = std({ color: 0x2fb35a, emissive: 0x2fff6a, emissiveIntensity: 1.2 });
  const crossMat = std({ map: crossTex, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const yellowLine = (std({ color: 0xf2c21b, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));

  const gates = SPOTS.map((s) => {
    const len = Math.hypot(s.dx, s.dz);
    const ux = s.dx / len, uz = s.dz / len; // along the road
    const nx = -uz, nz = ux; // across it
    const half = s.width / 2;
    const root = new Group();
    // Local frame: +x across the road (booms), +z along it.
    root.position.set(s.x, 0, s.z);
    root.rotation.y = -Math.atan2(nz, nx); // local +x → (nx, nz)
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: Material, parent: Group = root): Mesh => {
      const mesh = new Mesh(tracker.geometry(new BoxGeometry(w, h, d)), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const leds: Mesh[] = [];
    const pivots: { g: Group; dir: 1 | -1 }[] = [];
    const H = half + 0.55; // housing centre off the road centre
    const boomLen = half + 0.35;
    for (const side of [-1, 1] as const) {
      const hx = side * H;
      box(0.55, 1.2, 0.5, hx, 0.6, 0, housingMat);
      box(0.6, 0.08, 0.55, hx, 1.24, 0, capMat);
      leds.push(box(0.3, 0.14, 0.3, hx, 1.36, 0, ledOff));
      // Boom from this housing to the middle of the road.
      const pivot = new Group();
      pivot.position.set(hx, BOOM_Y, 0);
      root.add(pivot);
      const dir = (-side) as 1 | -1; // toward the centre
      box(boomLen, 0.12, 0.12, dir * (boomLen / 2 + 0.25), 0, 0, boomMat, pivot);
      box(0.08, 0.16, 0.16, dir * (boomLen + 0.25), 0, 0, reflectMat, pivot); // tip
      // Red sign hanging under the boom, both faces.
      for (const f of [-1, 1]) {
        const sign = new Mesh(tracker.geometry(new PlaneGeometry(0.62, 0.39)), signMat);
        sign.position.set(dir * (boomLen * 0.55 + 0.25), -0.3, f * 0.07);
        if (f < 0) sign.rotation.y = Math.PI;
        pivot.add(sign);
      }
      pivots.push({ g: pivot, dir });
      // Flexible bollards in front of and behind the housing.
      for (const z of [-1.3, 1.3]) {
        const b = new Mesh(tracker.geometry(new CylinderGeometry(0.08, 0.1, 0.8, 10).translate(0, 0.4, 0)), bollardMat);
        b.position.set(hx, 0, z);
        b.castShadow = true;
        root.add(b);
        const band = new Mesh(tracker.geometry(new CylinderGeometry(0.085, 0.085, 0.08, 10)), reflectMat);
        band.position.set(hx, 0.62, z);
        root.add(band);
      }
    }
    // Card reader on a post before the right-hand housing (approaching from 龍潭路).
    const side2 = -s.toward; // local +z runs against (dx, dz)
    const rz = side2 * 1.9;
    box(0.12, 1.1, 0.12, H, 0.55, rz, capMat);
    box(0.3, 0.38, 0.12, H, 1.25, rz, capMat);
    leds.push(box(0.14, 0.06, 0.02, H, 1.35, rz + side2 * 0.07, ledOff));

    // Road paint: yellow box under the booms, teal-and-white crossing toward 龍潭路.
    const flat = (w: number, d: number, x: number, z: number, m: Material, y = 0.04): void => {
      const mesh = new Mesh(tracker.geometry(new PlaneGeometry(w, d).rotateX(-Math.PI / 2)), m);
      mesh.position.set(x, y, z);
      mesh.receiveShadow = true;
      root.add(mesh);
    };
    const BOX_D = 5;
    for (const z of [-BOX_D / 2, BOX_D / 2]) flat(s.width, 0.18, 0, z, yellowLine);
    for (const x of [-half + 0.09, half - 0.09]) flat(0.18, BOX_D, x, 0, yellowLine);
    const crossing = new Mesh(tracker.geometry(new PlaneGeometry(s.width, 3).rotateX(-Math.PI / 2)), crossMat);
    crossTex.repeat.set(s.width / 2, 1);
    crossing.position.set(0, 0.045, side2 * 4.5); // over the white zebra the road markings paint there
    crossing.receiveShadow = true;
    root.add(crossing);
    scene.add(root);

    const q = { x: 0, y: Math.sin(root.rotation.y / 2), z: 0, w: Math.cos(root.rotation.y / 2) };
    const collider = tracker.collider(physics.createCollider(
      RAPIER.ColliderDesc.cuboid(half + 0.2, 0.8, 0.15).setTranslation(s.x, 0.8, s.z).setRotation(q),
    ));
    const housings = ([-1, 1] as const).map((side) => tracker.collider(physics.createCollider(
      RAPIER.ColliderDesc.cuboid(0.3, 0.65, 0.27).setTranslation(s.x + nx * side * H, 0.65, s.z + nz * side * H).setRotation(q),
    )));
    return { s, root, pivots, leds, collider, housings, angle: 0, open: false };
  });

  let lastNoCard = -Infinity;
  return {
    update(dt, time, px, pz, hasCard) {
      let event: GateEvent | null = null;
      for (const g of gates) {
        const d = Math.hypot(px - g.s.x, pz - g.s.z);
        if (!g.open && d < OPEN_R && hasCard) {
          g.open = true;
          g.collider.setEnabled(false);
          for (const l of g.leds) l.material = ledOn;
          event = 'opened';
        } else if (g.open && d > CLOSE_R) {
          g.open = false;
          g.collider.setEnabled(true);
          for (const l of g.leds) l.material = ledOff;
        } else if (!g.open && !hasCard && d < NO_CARD_R && time - lastNoCard > 4) {
          lastNoCard = time;
          event = 'noCard';
        }
        const target = g.open ? Math.PI * 0.46 : 0;
        g.angle += Math.max(-LIFT_SPEED * dt, Math.min(LIFT_SPEED * dt, target - g.angle));
        // Each boom tips up away from the road centre.
        for (const p of g.pivots) p.g.rotation.z = p.dir * g.angle;
      }
      return event;
    },
    dispose() {
      for (const g of gates) {
        physics.removeCollider(g.collider, false);
        for (const h of g.housings) physics.removeCollider(h, false);
        g.root.removeFromParent();
      }
    },
  };
}
