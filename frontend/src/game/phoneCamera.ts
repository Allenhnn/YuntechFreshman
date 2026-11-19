import {
  Box3,
  BoxGeometry,
  CapsuleGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Shape,
  ShapeGeometry,
  Quaternion,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
  WebGLRenderTarget,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';
import type { ResourceTracker } from '../core/resources';

/**
 * Phone camera mode: first person, both arms holding the phone up in the middle of the view, its
 * screen a live viewfinder. The rear camera sees what the player faces; the front camera (selfie)
 * looks back at the character. Photos are rendered at 720 × 1280 and returned as JPEG blobs.
 */
export interface PhoneCamera {
  /** Start from the character's facing (rotY). */
  enter(facing: number): void;
  exit(): void;
  look(dxPixels: number, dyPixels: number): void;
  /** Character facing for this frame (rotY). */
  readonly facing: number;
  /** Places the main camera at the eyes, renders the viewfinder; the character is hidden from the main view. */
  frame(feet: Vector3, model: Object3D, selfie: boolean): void;
  capture(feet: Vector3, model: Object3D, selfie: boolean): Promise<Blob | null>;
}

const VIEW_W = 360, VIEW_H = 640;
const SHOT_W = 720, SHOT_H = 1280;
/** Phone (in the view camera's frame: −z forward). */
const PHONE = { x: 0, y: -0.035, z: -0.33, w: 0.12, h: 0.21 };
/** How far in front of the eyes the selfie lens sits (an arm's length). */
const SELFIE_REACH = 1.15;
const LOOK_SPEED = 0.004;

export function createPhoneCamera(scene: Scene, renderer: WebGLRenderer, view: PerspectiveCamera, tracker: ResourceTracker): PhoneCamera {
  let yaw = 0, pitch = 0;
  let eyeHeight = 0;
  const lens = new PerspectiveCamera(68, VIEW_W / VIEW_H, 0.05, 2000);
  const rt = new WebGLRenderTarget(VIEW_W, VIEW_H);
  rt.texture.colorSpace = SRGBColorSpace;
  const shot = new WebGLRenderTarget(SHOT_W, SHOT_H);
  shot.texture.colorSpace = SRGBColorSpace;

  // Arms and phone, carried with the view camera. The phone is a titanium-framed slab with rounded
  // corners, a black bezel, a rounded screen and a dynamic island; both hands grip its lower sides
  // from behind with only the thumbs on the front, forearms running out to the bottom corners.
  const hold = new Group();
  hold.name = 'phone camera';
  hold.visible = false;
  const skin = tracker.material(new MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.65 }));
  const frameMat = tracker.material(new MeshStandardMaterial({ color: 0xc8b89f, roughness: 0.35, metalness: 0.75 }));
  const black = tracker.material(new MeshStandardMaterial({ color: 0x050506, roughness: 0.25, metalness: 0.2 }));
  const screen = tracker.material(new MeshBasicMaterial({ map: rt.texture, toneMapped: false }));
  const rounded = (w: number, h: number, r: number): Shape => {
    const s = new Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return s;
  };
  /** Flat rounded rectangle facing +z with UVs spanning 0..1. */
  const panel = (w: number, h: number, r: number): ShapeGeometry => {
    const g = new ShapeGeometry(rounded(w, h, r), 8);
    const pos = g.getAttribute('position'), uv = g.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
    return g;
  };
  const T = 0.008; // body thickness
  const phone = new Group();
  phone.position.set(PHONE.x, PHONE.y, PHONE.z);
  const R = PHONE.w * 0.17;
  phone.add(new Mesh(tracker.geometry(new ExtrudeGeometry(rounded(PHONE.w, PHONE.h, R), { depth: T, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0012, bevelSegments: 2, curveSegments: 10 }).translate(0, 0, -T / 2)), frameMat));
  const bezel = new Mesh(tracker.geometry(panel(PHONE.w - 0.003, PHONE.h - 0.003, R - 0.0015)), black);
  bezel.position.z = T / 2 + 0.0016;
  const glass = new Mesh(tracker.geometry(panel(PHONE.w - 0.011, PHONE.h - 0.011, R - 0.005)), screen);
  glass.position.z = T / 2 + 0.0019;
  const island = new Mesh(tracker.geometry(panel(PHONE.w * 0.3, 0.0085, 0.0042)), black);
  island.position.set(0, PHONE.h / 2 - 0.013, T / 2 + 0.0022);
  phone.add(bezel, glass, island);
  // Side buttons: action + volume on the left, power on the right.
  for (const [x, y, h] of [[-1, 0.06, 0.012], [-1, 0.035, 0.02], [-1, 0.008, 0.02], [1, 0.03, 0.032]] as const) {
    const b = new Mesh(tracker.geometry(new BoxGeometry(0.0022, h, 0.004)), frameMat);
    b.position.set(x * (PHONE.w / 2 + 0.0018), y, 0);
    phone.add(b);
  }
  hold.add(phone);
  const up = new Vector3(0, 1, 0);
  const handY = PHONE.y - PHONE.h * 0.22;
  for (const side of [-1, 1]) {
    // Palm and fingers behind the phone's side edge, just showing round it.
    const palm = new Mesh(tracker.geometry(new SphereGeometry(0.026, 16, 12)), skin);
    palm.position.set(side * (PHONE.w / 2 - 0.004), handY, PHONE.z - 0.016);
    palm.scale.set(0.9, 1.45, 0.75);
    // Thumb resting on the front bezel, angled up and in, clear of the screen's middle.
    const thumbLen = 0.026;
    const thumb = new Mesh(tracker.geometry(new CapsuleGeometry(0.0085, thumbLen, 6, 10)), skin);
    thumb.position.set(side * (PHONE.w / 2 - 0.006), handY + 0.012, PHONE.z + T / 2 + 0.006);
    thumb.rotation.z = side * 0.55;
    // Forearm from the wrist out to the bottom corner of the view.
    const wrist = new Vector3(side * (PHONE.w / 2 + 0.004), handY - 0.03, PHONE.z - 0.02);
    const elbow = new Vector3(side * 0.2, -0.34, -0.16);
    const len = wrist.distanceTo(elbow);
    const arm = new Mesh(tracker.geometry(new CapsuleGeometry(0.019, len, 6, 12)), skin);
    arm.position.copy(wrist).add(elbow).multiplyScalar(0.5);
    arm.quaternion.setFromUnitVectors(up, wrist.clone().sub(elbow).normalize());
    hold.add(palm, thumb, arm);
  }
  scene.add(hold);

  const dir = new Vector3(), eye = new Vector3(), at = new Vector3(), q = new Quaternion();
  const place = (feet: Vector3, model: Object3D, selfie: boolean): void => {
    if (!eyeHeight) {
      const box = new Box3().setFromObject(model);
      eyeHeight = Math.max(0.6, (box.max.y - box.min.y) * 0.72);
    }
    dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    eye.set(feet.x, feet.y + eyeHeight, feet.z);
    view.position.copy(eye);
    view.lookAt(at.copy(eye).add(dir));
    hold.position.copy(eye);
    hold.quaternion.copy(view.quaternion);
    if (selfie) {
      lens.position.copy(eye).addScaledVector(dir, SELFIE_REACH);
      lens.lookAt(eye);
    } else {
      lens.position.copy(eye).addScaledVector(dir, 0.1);
      lens.quaternion.copy(view.quaternion);
    }
  };
  const renderLens = (target: WebGLRenderTarget, model: Object3D, selfie: boolean): void => {
    hold.visible = false;
    model.visible = selfie; // the rear lens sits at the eyes, inside the head
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, lens);
    renderer.setRenderTarget(prev);
    hold.visible = true;
    model.visible = false;
  };

  return {
    enter(facing) {
      yaw = facing;
      pitch = 0;
      hold.visible = true;
    },
    exit() {
      hold.visible = false;
    },
    look(dx, dy) {
      yaw -= dx * LOOK_SPEED;
      pitch = Math.max(-1.2, Math.min(1.2, pitch - dy * LOOK_SPEED));
    },
    get facing() {
      return yaw;
    },
    frame(feet, model, selfie) {
      place(feet, model, selfie);
      renderLens(rt, model, selfie);
    },
    async capture(feet, model, selfie) {
      place(feet, model, selfie);
      q.copy(lens.quaternion);
      lens.aspect = SHOT_W / SHOT_H;
      lens.updateProjectionMatrix();
      renderLens(shot, model, selfie);
      lens.aspect = VIEW_W / VIEW_H;
      lens.updateProjectionMatrix();
      const px = new Uint8Array(SHOT_W * SHOT_H * 4);
      renderer.readRenderTargetPixels(shot, 0, 0, SHOT_W, SHOT_H, px);
      const c = document.createElement('canvas');
      c.width = SHOT_W;
      c.height = SHOT_H;
      const g = c.getContext('2d');
      if (!g) return null;
      const img = g.createImageData(SHOT_W, SHOT_H);
      // GL rows run bottom-up.
      for (let y = 0; y < SHOT_H; y++) img.data.set(px.subarray((SHOT_H - 1 - y) * SHOT_W * 4, (SHOT_H - y) * SHOT_W * 4), y * SHOT_W * 4);
      g.putImageData(img, 0, 0);
      return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.9));
    },
  };
}
