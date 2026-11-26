/**
 * The two restaurants in 員生餐廳 (學生餐廳 1F): 猩猩複合式餐飲 and 猴子食堂. Their names, what they
 * serve and the logos painted on their storefront signs (always open: no opening hours).
 */
export type RestaurantId = 'gorilla' | 'monkey';

export interface Restaurant {
  name: string;
  /** Short name on the sign's second line. */
  sub: string;
  serves: string;
  /** Storefront colours: main, accent, ink. */
  color: string;
  accent: string;
  ink: string;
}

export const RESTAURANTS: Readonly<Record<RestaurantId, Restaurant>> = {
  gorilla: {
    name: '猩猩複合式餐飲',
    sub: '員生餐廳',
    serves: '早午餐・咖啡・飲料・點心',
    color: '#2f4a3a',
    accent: '#f2c230',
    ink: '#fffdf4',
  },
  monkey: {
    name: '猴子食堂',
    sub: '員生餐廳',
    serves: '炒飯・炒麵・水餃・湯麵乾麵・湯品・小菜',
    color: '#b5562b',
    accent: '#ffe0b2',
    ink: '#fffdf4',
  },
};

/** Logo: a round badge with the animal's face (drawn, not an emoji), size × size at (cx, cy). */
export function paintLogo(g: CanvasRenderingContext2D, id: RestaurantId, cx: number, cy: number, size: number): void {
  const r = size / 2;
  const R = RESTAURANTS[id];
  g.save();
  g.translate(cx, cy);
  // Badge ring.
  g.fillStyle = R.accent;
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = R.color;
  g.beginPath(); g.arc(0, 0, r * 0.86, 0, Math.PI * 2); g.fill();
  const ink = '#2a2420';
  if (id === 'gorilla') {
    // Gorilla: dark round head with a heavy brow, a pale muzzle, a coffee cup below.
    g.fillStyle = '#3b3633';
    g.beginPath(); g.arc(-r * 0.5, -r * 0.12, r * 0.16, 0, Math.PI * 2); g.arc(r * 0.5, -r * 0.12, r * 0.16, 0, Math.PI * 2); g.fill(); // ears
    g.beginPath(); g.ellipse(0, -r * 0.08, r * 0.5, r * 0.52, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c9a98a';
    g.beginPath(); g.ellipse(0, -r * 0.14, r * 0.34, r * 0.22, 0, 0, Math.PI * 2); g.fill(); // face
    g.beginPath(); g.ellipse(0, r * 0.14, r * 0.3, r * 0.2, 0, 0, Math.PI * 2); g.fill(); // muzzle
    g.fillStyle = '#3b3633';
    g.fillRect(-r * 0.36, -r * 0.3, r * 0.72, r * 0.08); // brow
    g.fillStyle = ink;
    g.beginPath(); g.arc(-r * 0.14, -r * 0.13, r * 0.05, 0, Math.PI * 2); g.arc(r * 0.14, -r * 0.13, r * 0.05, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(-r * 0.07, r * 0.08, r * 0.04, r * 0.03, 0, 0, Math.PI * 2); g.ellipse(r * 0.07, r * 0.08, r * 0.04, r * 0.03, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = ink; g.lineWidth = r * 0.04;
    g.beginPath(); g.arc(0, r * 0.14, r * 0.13, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
    // Cup with steam.
    g.fillStyle = R.ink;
    g.fillRect(-r * 0.18, r * 0.46, r * 0.36, r * 0.22);
    g.strokeStyle = R.ink; g.lineWidth = r * 0.05;
    g.beginPath(); g.arc(r * 0.22, r * 0.57, r * 0.07, -Math.PI / 2, Math.PI / 2); g.stroke();
  } else {
    // Monkey: brown head with big round ears, a peach heart-shaped face, chopsticks and a bowl.
    g.fillStyle = '#7a4a2a';
    g.beginPath(); g.arc(-r * 0.56, -r * 0.08, r * 0.2, 0, Math.PI * 2); g.arc(r * 0.56, -r * 0.08, r * 0.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f4c7a1';
    g.beginPath(); g.arc(-r * 0.56, -r * 0.08, r * 0.11, 0, Math.PI * 2); g.arc(r * 0.56, -r * 0.08, r * 0.11, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#7a4a2a';
    g.beginPath(); g.arc(0, -r * 0.1, r * 0.46, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f4c7a1';
    g.beginPath(); g.arc(-r * 0.14, -r * 0.16, r * 0.17, 0, Math.PI * 2); g.arc(r * 0.14, -r * 0.16, r * 0.17, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(0, r * 0.08, r * 0.3, r * 0.2, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = ink;
    g.beginPath(); g.arc(-r * 0.13, -r * 0.16, r * 0.05, 0, Math.PI * 2); g.arc(r * 0.13, -r * 0.16, r * 0.05, 0, Math.PI * 2); g.fill();
    g.strokeStyle = ink; g.lineWidth = r * 0.04;
    g.beginPath(); g.arc(0, r * 0.04, r * 0.14, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    // Bowl and chopsticks.
    g.fillStyle = R.ink;
    g.beginPath(); g.ellipse(0, r * 0.52, r * 0.3, r * 0.16, 0, 0, Math.PI); g.fill();
    g.strokeStyle = R.accent; g.lineWidth = r * 0.04;
    g.beginPath(); g.moveTo(r * 0.05, r * 0.5); g.lineTo(r * 0.34, r * 0.28); g.moveTo(r * 0.12, r * 0.52); g.lineTo(r * 0.4, r * 0.32); g.stroke();
  }
  g.restore();
}
