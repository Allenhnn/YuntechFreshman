import { Vector3, type Camera } from 'three';
import { iconHtml } from '../ui/icons';

/**
 * On-screen guide to the current target (navigation goal, else the main story objective): a tag
 * above the spot when it is in view ("🏁 學生餐廳 · 120 m" with a pointer down), or held on the screen
 * edge with an arrow turned toward it when it is off screen or behind. Plain DOM, positioned every
 * frame (no React re-render).
 */
export interface NavPointer {
  update(camera: Camera, target: { x: number; z: number; name: string; color: string; icon: string } | null, px: number, pz: number, visible: boolean): void;
  dispose(): void;
}

export function createNavPointer(): NavPointer {
  const el = document.createElement('div');
  el.className = 'nav-pointer';
  el.innerHTML = '<div class="np-arrow">▼</div><div class="np-tag"><span class="np-icon"></span><b></b><em></em></div>';
  document.body.append(el);
  const arrow = el.querySelector('.np-arrow') as HTMLElement;
  const icon = el.querySelector('.np-icon') as HTMLElement;
  const name = el.querySelector('b') as HTMLElement;
  const dist = el.querySelector('em') as HTMLElement;
  const v = new Vector3();
  let lastName = '', lastColor = '';
  return {
    update(camera, target, px, pz, visible) {
      if (!target || !visible || Math.hypot(target.x - px, target.z - pz) < 6) { el.style.display = 'none'; return; }
      el.style.display = '';
      if (target.name !== lastName) { name.textContent = target.name; icon.innerHTML = iconHtml(target.icon); lastName = target.name; }
      if (target.color !== lastColor) { el.style.setProperty('--np', target.color); lastColor = target.color; }
      const d = Math.hypot(target.x - px, target.z - pz);
      dist.textContent = d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
      const W = window.innerWidth, H = window.innerHeight;
      v.set(target.x, 3.2, target.z).project(camera);
      const behind = v.z > 1;
      let sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
      if (behind) { sx = W - sx; sy = H - sy; }
      const m = 70, onScreen = !behind && sx > m && sx < W - m && sy > m + 60 && sy < H - m - 60;
      if (onScreen) {
        el.classList.remove('edge');
        arrow.style.transform = '';
        el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
        return;
      }
      // Clamp onto the screen edge along the direction from the centre.
      const cx = W / 2, cy = H / 2;
      let dx = sx - cx, dy = sy - cy;
      if (behind && Math.abs(dy) < 1) dy = 1;
      const k = Math.min((W / 2 - m) / Math.max(1e-3, Math.abs(dx)), (H / 2 - m - 50) / Math.max(1e-3, Math.abs(dy)));
      dx *= k; dy *= k;
      el.classList.add('edge');
      arrow.style.transform = `rotate(${Math.atan2(dy, dx) - Math.PI / 2}rad)`;
      el.style.transform = `translate(${cx + dx}px, ${cy + dy}px) translate(-50%, -50%)`;
    },
    dispose() {
      el.remove();
    },
  };
}
