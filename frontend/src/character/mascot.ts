import {
  CapsuleGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { BODY_REST_Y, LEAF_TILTS, type PoseJoints } from './pose';
import { FACE_ATLAS, FACE_PATCH } from './faceAtlas';

/**
 * Procedural placeholder of the campus mascot (round white head, three leaf sprouts,
 * green tank top with orange trim, black shorts). Proportions match the final GLB spec:
 * feet at origin, facing +Z, ~1.32 m to the top of the head, 1 unit = 1 m.
 *
 * This builder is the single source for both the offline placeholder GLB bake and the
 * runtime fallback when no GLB can be loaded. Meshes that should get an ink outline are
 * flagged with `userData.outline` (exported as glTF node extras); hulls are added later
 * by `addOutlines` so loaded and procedural models share one code path.
 */

export const JOINT_NAMES = {
  root: 'mascot',
  body: 'body',
  head: 'head',
  armL: 'armL',
  armR: 'armR',
  legL: 'legL',
  legR: 'legR',
  leaves: ['leaf0', 'leaf1', 'leaf2'],
  face: 'face',
} as const;

export interface MascotMaterials {
  color(hex: number): Material;
  /** Material carrying the face atlas (transparent, blink via map offset). */
  face(): Material;
}

export interface GeometrySink {
  geometry<T extends BufferGeometry>(g: T): T;
}

const COLORS = {
  skin: 0xfbfbf8,
  shirt: 0x1f8f4a,
  trim: 0xf08a24,
  shorts: 0x26262b,
  leafGreen: 0x2e9e3e,
  leafBlue: 0x2c6fd6,
  leafYellow: 0xf2c230,
} as const;

export function createMascot(materials: MascotMaterials, sink: GeometrySink): Group {
  const geo = <T extends BufferGeometry>(g: T): T => sink.geometry(g);
  const sphere = geo(new SphereGeometry(1, 32, 20));
  const lowSphere = geo(new SphereGeometry(1, 16, 10));

  const part = (name: string, g: BufferGeometry, mat: Material, outline: boolean, shadow = true): Mesh => {
    const mesh = new Mesh(g, mat);
    mesh.name = name;
    mesh.castShadow = shadow;
    if (outline) mesh.userData.outline = true;
    return mesh;
  };
  const joint = (name: string): Group => {
    const g = new Group();
    g.name = name;
    return g;
  };

  const root = joint(JOINT_NAMES.root);
  const body = joint(JOINT_NAMES.body);
  body.position.y = BODY_REST_Y;
  root.add(body);

  // Legs (pivot at hip).
  const legGeo = geo(new CapsuleGeometry(0.075, 0.16, 4, 10));
  for (const [name, side] of [[JOINT_NAMES.legL, 1], [JOINT_NAMES.legR, -1]] as const) {
    const g = joint(name);
    g.position.set(0.1 * side, 0, 0);
    const leg = part(`${name}_mesh`, legGeo, materials.color(COLORS.skin), true);
    leg.position.y = -0.155;
    g.add(leg);
    body.add(g);
  }

  // Shorts + tank top (hips at body origin).
  const shorts = part('shorts', geo(new CylinderGeometry(0.19, 0.21, 0.14, 24)), materials.color(COLORS.shorts), true);
  shorts.position.y = 0.04;
  const torso = part('torso', geo(new CylinderGeometry(0.165, 0.2, 0.27, 24)), materials.color(COLORS.shirt), true);
  torso.position.y = 0.23;
  const hem = part('hem', geo(new CylinderGeometry(0.203, 0.205, 0.035, 24)), materials.color(COLORS.trim), false);
  hem.position.y = 0.11;
  const collar = part('collar', geo(new TorusGeometry(0.15, 0.022, 8, 24)), materials.color(COLORS.trim), false);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.36;
  const badge = part('badge', geo(new CircleGeometry(0.055, 20)), materials.color(COLORS.skin), false, false);
  badge.position.set(0, 0.24, 0.186);
  badge.rotation.x = -0.12;
  body.add(shorts, torso, hem, collar, badge);

  // Arms (pivot at shoulder, resting slightly spread like the reference pose).
  const armGeo = geo(new CapsuleGeometry(0.06, 0.18, 4, 10));
  for (const [name, side] of [[JOINT_NAMES.armL, 1], [JOINT_NAMES.armR, -1]] as const) {
    const g = joint(name);
    g.position.set(0.19 * side, 0.32, 0);
    g.rotation.z = 0.35 * side;
    const arm = part(`${name}_mesh`, armGeo, materials.color(COLORS.skin), true);
    arm.position.y = -0.14;
    const hand = part(`${name}_hand`, lowSphere, materials.color(COLORS.skin), true);
    hand.scale.setScalar(0.078);
    hand.position.y = -0.28;
    g.add(arm, hand);
    body.add(g);
  }

  // Head (pivot at neck) + face decal.
  const head = joint(JOINT_NAMES.head);
  head.position.y = 0.36;
  body.add(head);
  const skull = part('skull', sphere, materials.color(COLORS.skin), true);
  skull.scale.setScalar(0.34);
  skull.position.y = 0.3;
  head.add(skull);

  const faceGeo = geo(
    new SphereGeometry(FACE_PATCH.radius, 40, 20, FACE_PATCH.phiStart, FACE_PATCH.phiLength, FACE_PATCH.thetaStart, FACE_PATCH.thetaLength),
  );
  // The patch covers one atlas frame; blinking shifts the map's U offset by one frame.
  const uv = faceGeo.attributes.uv;
  if (uv) for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) / FACE_ATLAS.frames);
  const face = part(JOINT_NAMES.face, faceGeo, materials.face(), false, false);
  face.position.y = 0.3;
  face.renderOrder = 1;
  head.add(face);

  // Three leaf sprouts on top of the head.
  const leafSpecs = [
    { color: COLORS.leafGreen, length: 1.1, x: -0.035 },
    { color: COLORS.leafBlue, length: 1.25, x: 0 },
    { color: COLORS.leafYellow, length: 0.85, x: 0.035 },
  ];
  leafSpecs.forEach((spec, i) => {
    const pivot = joint(JOINT_NAMES.leaves[i] ?? `leaf${i}`);
    pivot.position.set(spec.x, 0.62, 0);
    pivot.rotation.z = LEAF_TILTS[i] ?? 0;
    const leaf = part(`leaf${i}_mesh`, lowSphere, materials.color(spec.color), true);
    leaf.scale.set(0.035, 0.11 * spec.length, 0.014);
    leaf.position.y = 0.1 * spec.length;
    pivot.add(leaf);
    head.add(pivot);
  });

  return root;
}

/** Resolves the named joints of a mascot hierarchy (procedural or loaded). Returns null if any is missing. */
export function findMascotJoints(root: Object3D): PoseJoints | null {
  const get = (name: string): Object3D | undefined => root.getObjectByName(name);
  const body = get(JOINT_NAMES.body);
  const head = get(JOINT_NAMES.head);
  const armL = get(JOINT_NAMES.armL);
  const armR = get(JOINT_NAMES.armR);
  const legL = get(JOINT_NAMES.legL);
  const legR = get(JOINT_NAMES.legR);
  const [l0, l1, l2] = JOINT_NAMES.leaves.map(get);
  if (!body || !head || !armL || !armR || !legL || !legR || !l0 || !l1 || !l2) return null;
  return { body, head, armL, armR, legL, legR, leaves: [l0, l1, l2] };
}
