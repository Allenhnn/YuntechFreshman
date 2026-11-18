import {
  Box3,
  BoxGeometry,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
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

  // Arms and phone, carried with the view camera.
  const hold = new Group();
  hold.name = 'phone camera';
  hold.visible = false;
  const skin = tracker.material(new MeshStandardMaterial({ color: 0xf6f5f0, roughness: 0.6 }));
  const body = tracker.material(new MeshStandardMaterial({ color: 0x1d1f23, roughness: 0.35, metalness: 0.4 }));
  const screen = tracker.material(new MeshBasicMaterial({ map: rt.texture, toneMapped: false }));
  const phone = new Group();
  phone.position.set(PHONE.x, PHONE.y, PHONE.z);
  phone.add(new Mesh(tracker.geometry(new BoxGeometry(PHONE.w, PHONE.h, 0.012)), body));
  const glass = new Mesh(tracker.geometry(new PlaneGeometry(PHONE.w - 0.008, PHONE.h - 0.012)), screen);
  glass.position.z = 0.0065;
  phone.add(glass);
  hold.add(phone);
  const up = new Vector3(0, 1, 0);
  for (const side of [-1, 1]) {
    // Upper arm from the bottom corner of the view to a round hand gripping the phone's edge.
    const hand = new Vector3(side * (PHONE.w / 2 + 0.006), PHONE.y - PHONE.h / 2 + 0.05, PHONE.z + 0.012);
    const shoulder = new Vector3(side * 0.2, -0.36, -0.1);
    const len = hand.distanceTo(shoulder);
    const arm = new Mesh(tracker.geometry(new CapsuleGeometry(0.022, len, 6, 12)), skin);
    arm.position.copy(hand).add(shoulder).multiplyScalar(0.5);
    arm.quaternion.setFromUnitVectors(up, hand.clone().sub(shoulder).normalize());
    const fist = new Mesh(tracker.geometry(new SphereGeometry(0.026, 16, 12)), skin);
    fist.position.copy(hand);
    fist.scale.set(0.75, 1.15, 0.9);
    hold.add(arm, fist);
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
