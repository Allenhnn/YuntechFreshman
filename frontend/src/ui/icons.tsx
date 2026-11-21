import type { ReactNode } from 'react';

/**
 * Line icons (24×24, 2 px round strokes) used everywhere the game would otherwise show an emoji.
 * One registry serves three uses: <Icon name> in the UI, <Rich text> that turns the emoji inside a
 * string into icons (toasts, quest text, item data), and drawIcon() for canvas textures and map pins.
 */
const c = (cx: number, cy: number, r: number): string => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const dot = (x: number, y: number): string => `M${x} ${y}h.01`;

export const ICONS = {
  bike: [c(5.5, 16, 3.5), c(18.5, 16, 3.5), 'M5.5 16l4-8h5l4 8M9.5 8l2.5 8M13 5.5h3'],
  bag: ['M7 9a5 5 0 0 1 10 0v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z', 'M9 9V7M15 9V7M9 15h6'],
  cloud: ['M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17.2 9 4.5 4.5 0 0 1 17.5 18z'],
  pin: ['M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z', c(12, 11, 2)],
  home: ['M4 11l8-7 8 7', 'M6 10v10h12V10', 'M10 20v-6h4v6'],
  flag: ['M5 21V4', 'M5 4h12l-2 4 2 4H5'],
  compass: [c(12, 12, 9), 'M15.5 8.5l-2 5-5 2 2-5z'],
  rocket: ['M14 4c3-1 5-1 6 0 1 1 1 3 0 6-1.5 3-4 5-7 6l-5-5c1-3 3-5 6-7z', 'M9 15l-4 4M7 11l-3 1M13 17l-1 3'],
  search: [c(11, 11, 6.5), 'M16 16l5 5'],
  undo: ['M4 12a8 8 0 1 0 3-6.2', 'M4 4v5h5'],
  target: [c(12, 12, 9), c(12, 12, 4)],
  check: ['M5 12.5l4.5 4.5L19 7'],
  checkCircle: [c(12, 12, 9), 'M8 12.5l3 3 5-6'],
  close: ['M6 6l12 12M18 6L6 18'],
  closeCircle: [c(12, 12, 9), 'M9 9l6 6M15 9l-6 6'],
  play: ['M7 5v14l12-7z'],
  sparkle: ['M12 3l2 6 6 3-6 3-2 6-2-6-6-3 6-3z'],
  keyboard: ['M3 7h18v10H3z', dot(7, 11), dot(11, 11), dot(15, 11), dot(19, 11), 'M7 14h10'],
  gear: [c(12, 12, 3), 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1'],
  save: ['M5 4h11l3 3v13H5z', 'M8 4v5h7V4', 'M8 20v-6h8v6'],
  camera: ['M4 8h3l2-3h6l2 3h3v11H4z', c(12, 13, 3.5)],
  selfie: ['M8 3h8v18H8z', c(12, 9, 1.7), 'M9.5 16a2.5 2.5 0 0 1 5 0'],
  image: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 3-3 4 4', dot(15, 9.5)],
  map: ['M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z', 'M9 4v14M15 6v14'],
  flip: ['M4 11a8 8 0 0 1 14-4', 'M18 3v4h-4', 'M20 13a8 8 0 0 1-14 4', 'M6 21v-4h4'],
  flask: ['M9 3h6', 'M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3', 'M8 15h8'],
  phone: ['M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z', 'M11 19h2'],
  book: ['M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z', 'M5 17a3 3 0 0 1 3-3h11'],
  hat: ['M5 15a7 7 0 0 1 14 0', 'M3 15h18l2 2H1z', 'M12 8V6'],
  shirt: ['M8 4l-5 3 2 4 3-1v10h8V10l3 1 2-4-5-3a4 4 0 0 1-8 0z'],
  jacket: ['M8 4l-5 3 2 4 3-1v10h8V10l3 1 2-4-5-3', 'M12 7v14', 'M9 4l3 3 3-3'],
  pants: ['M7 3h10l1 18h-4l-2-10-2 10H6z'],
  socks: ['M9 3h6v9l4 4a3 3 0 0 1-4 4l-7-6a3 3 0 0 1-1-2z', 'M9 7h6'],
  shoes: ['M3 15l3-7h4l2 3 7 2a2 2 0 0 1 2 2v1H3z', 'M10 8l1 3', 'M3 18h19'],
  idcard: ['M3 6h18v12H3z', c(8, 11, 1.5), 'M5.5 15a2.5 2.5 0 0 1 5 0', 'M13 10h5M13 13h4'],
  clipboard: ['M9 4h6v3H9z', 'M7 5H5v16h14V5h-2', 'M9 11h6M9 15h6'],
  bib: ['M8 3l4 3 4-3 3 3-2 3v12H7V9L5 6z', 'M10 12h4'],
  bread: ['M4 10a3 3 0 0 1 3-4h10a3 3 0 0 1 3 4v9H4z', 'M9 13h6'],
  bento: ['M3 7h18v12H3z', 'M3 13h18', 'M12 7v12'],
  bowl: ['M3 11h18a9 9 0 0 1-18 0z', 'M9 3v5M13 3v5M17 3v5'],
  tea: ['M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z', 'M17 10h2a2 2 0 0 1 0 5h-2', 'M8 3v3M12 3v3'],
  cup: ['M7 8h10l-1 13H8z', 'M6 8h12', 'M12 8l2-5h3'],
  bottle: ['M10 3h4v3h-4z', 'M8 9a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z', 'M8 13h8'],
  drop: ['M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z'],
  egg: ['M12 3c4 0 6.5 6 6.5 10a6.5 6.5 0 0 1-13 0C5.5 9 8 3 12 3z'],
  onigiri: ['M12 4l8 14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M9 14h6'],
  clock: [c(12, 13, 8), 'M12 9v4l3 2', 'M4 4l3-1M20 4l-3-1'],
  heart: ['M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z'],
  heartBreak: ['M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z', 'M12 6.5l-2 4 3 2-1 4'],
  trophy: ['M8 4h8v6a4 4 0 0 1-8 0z', 'M8 6H4v2a3 3 0 0 0 4 3', 'M16 6h4v2a3 3 0 0 1-4 3', 'M12 14v4M8 21h8'],
  medal: [c(12, 15, 5), 'M8 3l4 7 4-7'],
  faceSmile: [c(12, 12, 9), 'M8 14a4 4 0 0 0 8 0', dot(9, 9.5), dot(15, 9.5)],
  faceSad: [c(12, 12, 9), 'M8 16a4 4 0 0 1 8 0', dot(9, 10), dot(15, 10)],
  faceSleep: [c(12, 12, 9), 'M8 15h8', 'M8.5 10h2M13.5 10h2'],
  faceShock: [c(12, 12, 9), c(12, 15.5, 1.6), dot(9, 9.5), dot(15, 9.5)],
  moon: ['M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10z'],
  sunset: ['M3 18h18', 'M6 18a6 6 0 0 1 12 0', 'M12 6v3M4.5 10l2 2M19.5 10l-2 2'],
  wave: ['M3 9c3-3 5 3 9 0s6 3 9 0', 'M3 14c3-3 5 3 9 0s6 3 9 0', 'M3 19c3-3 5 3 9 0s6 3 9 0'],
  lotus: ['M12 20c-5 0-8-3-9-8 4 0 7 1 9 4 2-3 5-4 9-4-1 5-4 8-9 8z', 'M12 16c-2-3-2-7 0-11 2 4 2 8 0 11z'],
  bell: ['M6 17v-6a6 6 0 0 1 12 0v6l2 2H4z', 'M10 21h4'],
  lock: ['M6 11h12v10H6z', 'M8 11V8a4 4 0 0 1 8 0v3'],
  ban: [c(12, 12, 9), 'M5.6 5.6l12.8 12.8'],
  cone: ['M3 19h18', 'M5 19V9h14v10', 'M5 12.5h14M5 16h14', 'M7 9V5M17 9V5'],
  eyes: [c(8, 12, 4), c(16, 12, 4), c(8, 12, 1), c(16, 12, 1)],
  bed: ['M3 19V6', 'M3 14h18v5', 'M21 14v-2a3 3 0 0 0-3-3h-8v5', c(6.5, 11.5, 1.5)],
  cart: ['M3 4h3l2 11h10l2-8H7', dot(9, 20), dot(17, 20)],
  run: [c(14, 4.5, 2), 'M9 21l3-6-3-2 3-5 3 2 3 1', 'M12 8l-3 1-2 3'],
  basketball: [c(12, 12, 9), 'M3 12h18M12 3v18', 'M5.5 5.5c3 3 3 10 0 13M18.5 5.5c-3 3-3 10 0 13'],
  volleyball: [c(12, 12, 9), 'M12 3c0 5 3 8 8 9', 'M12 3c-3 3-4 7-2 12', 'M3.5 14c4-1 8 0 11 4'],
  soccer: [c(12, 12, 9), 'M12 8l3 2-1 4h-4l-1-4z', 'M12 3v5M15 10l5-1M14 14l3 4M10 14l-3 4M9 10l-5-1'],
  palette: ['M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2-.5-1 0-2.5 1.5-2.5H17a4 4 0 0 0 4-4 9 9 0 0 0-9-9z', dot(7.5, 11), dot(10, 7.5), dot(14.5, 7.5)],
  guitar: ['M15 9l5-5M18 4l2 2', 'M10.5 10.5a4 4 0 0 0-5.5 5.5 3 3 0 0 0 4 4 4 4 0 0 0 5.5-5.5z', 'M13 13l-2 2'],
  laptop: ['M5 6h14v10H5z', 'M2 20h20l-2-4H4z'],
  chart: ['M4 20V4', 'M4 20h16', 'M8 16v-5M12 16V7M16 16v-8'],
  calendar: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v5M16 3v5'],
  bird: ['M20 5l-3 1c-1-1-3-1-4 0-1 1-2 3-1 5-3 0-6-2-8-5 0 5 2 9 6 10-2 1-3 1-5 1 3 3 8 3 12-1 3-3 4-6 4-9z'],
  shield: ['M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z', 'M9 12l2 2 4-4'],
  mask: ['M3 9h18v5a4 4 0 0 1-4 4h-2l-3-2-3 2H7a4 4 0 0 1-4-4z', dot(8, 12.5), dot(16, 12.5)],
  thumbs: ['M7 11v9H4v-9z', 'M7 11l4-7c2 0 3 1 2.5 3L13 10h6a2 2 0 0 1 2 2.3l-1 6a2 2 0 0 1-2 1.7H7'],
  pray: ['M12 21V9', 'M12 9c-1-3-3-5-5-5l-1 6c0 4 3 7 6 11 3-4 6-7 6-11l-1-6c-2 0-4 2-5 5z'],
  message: ['M4 5h16v11H9l-5 4z'],
  signal: ['M4 20v-3M9 20v-7M14 20V9M19 20V4'],
  battery: ['M3 8h16v8H3z', 'M21 11v2', 'M6 11v2M9 11v2M12 11v2'],
  party: ['M4 20l5-14 9 9z', 'M13 4v3M18 8h3M17 3l-1 2'],
  grad: ['M2 9l10-5 10 5-10 5z', 'M6 11.5V16c3 3 9 3 12 0v-4.5', 'M22 9v6'],
  door: ['M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17', 'M4 21h16', dot(14, 12)],
  user: [c(12, 8, 4), 'M4 21a8 8 0 0 1 16 0'],
  handshake: ['M3 11l5-4 4 3 4-3 5 4', 'M3 11l9 9 9-9', 'M8 14l2 2M11 12l3 3'],
  bolt: ['M13 2L4 14h7l-1 8 9-12h-7z'],
  question: [c(12, 12, 9), 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7', dot(12, 17)],
  burst: ['M12 2l2 6 6-3-3 6 6 2-6 2 3 6-6-3-2 6-2-6-6 3 3-6-6-2 6-2-3-6 6 3z'],
  accessible: [c(12, 5, 1.5), 'M12 8v6h5l2 6', 'M10 10h5', 'M8 14a5 5 0 1 0 7 6'],
  backspace: ['M9 5h11v14H9L3 12z', 'M12 9l5 6M17 9l-5 6'],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICONS;

/** Emoji (and symbol glyphs used as icons) → icon. */
const EMOJI: Record<string, IconName> = {
  '🚲': 'bike', '🎒': 'bag', '☁': 'cloud', '📍': 'pin', '📌': 'pin', '⌂': 'home', '🏠': 'home', '🏁': 'flag', '🚩': 'flag',
  '🧭': 'compass', '🚀': 'rocket', '🔍': 'search', '↺': 'undo', '◎': 'target', '✓': 'check', '✅': 'checkCircle',
  '✕': 'close', '❌': 'closeCircle', '▶': 'play', '✦': 'sparkle', '✨': 'sparkle', '💫': 'sparkle', '⌨': 'keyboard', '⚙': 'gear',
  '💾': 'save', '📷': 'camera', '📸': 'camera', '🤳': 'selfie', '🖼': 'image', '🗺': 'map', '🔄': 'flip', '🧪': 'flask',
  '📱': 'phone', '📚': 'book', '📓': 'book', '🧢': 'hat', '👕': 'shirt', '🧥': 'jacket', '👖': 'pants', '🧦': 'socks', '👟': 'shoes',
  '🪪': 'idcard', '📛': 'idcard', '📋': 'clipboard', '📝': 'clipboard', '🎽': 'bib', '🍞': 'bread', '🍱': 'bento',
  '🍜': 'bowl', '🍲': 'bowl', '🍛': 'bowl', '🍵': 'tea', '☕': 'tea', '🧋': 'cup', '🥤': 'cup', '🥛': 'cup', '🧴': 'bottle',
  '💧': 'drop', '🥚': 'egg', '🍙': 'onigiri', '⏰': 'clock', '⏱': 'clock', '❤': 'heart', '💕': 'heart', '💔': 'heartBreak',
  '🏆': 'trophy', '🏅': 'medal', '😊': 'faceSmile', '🙂': 'faceSmile', '😎': 'faceSmile', '😣': 'faceSad', '😴': 'faceSleep',
  '😱': 'faceShock', '🌙': 'moon', '🌆': 'sunset', '🌊': 'wave', '🪷': 'lotus', '🔔': 'bell', '🔒': 'lock', '🚫': 'ban',
  '🚧': 'cone', '👀': 'eyes', '🫣': 'eyes', '🛏': 'bed', '🛒': 'cart', '🏃': 'run', '🏀': 'basketball', '🏐': 'volleyball',
  '⚽': 'soccer', '🎨': 'palette', '🎸': 'guitar', '💻': 'laptop', '📊': 'chart', '📅': 'calendar', '🐦': 'bird',
  '🦺': 'shield', '🦹': 'mask', '👍': 'thumbs', '🙏': 'pray', '💬': 'message', '📶': 'signal', '🔋': 'battery',
  '🎉': 'party', '🎓': 'grad', '🚪': 'door', '🧑': 'user', '👩': 'user', '🤝': 'handshake', '⚡': 'bolt', '❔': 'question',
  '💥': 'burst', '♿': 'accessible', '⌫': 'backspace',
};

/** Emoji, emoji-style symbols used as icons, their variation selector and skin-tone modifier. */
export const EMOJI_RE = /[\p{Extended_Pictographic}✓✕✦◎⌂↺⌫]️?[\u{1F3FB}-\u{1F3FF}]?/gu;

export function iconOf(emoji: string): IconName | null {
  return EMOJI[emoji.replace(/[️\u{1F3FB}-\u{1F3FF}]/gu, '')] ?? null;
}

/** The text without any emoji (aria labels, tooltips, canvas text). */
export function stripEmoji(text: string): string {
  return text.replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim();
}

export function Icon({ name, size, className }: { name: IconName; size?: number; className?: string }): ReactNode {
  return (
    <svg className={`ico-line${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" width={size ?? '1.15em'} height={size ?? '1.15em'}
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

/** Text whose emoji are shown as line icons (an emoji with no icon is left out). */
export function Rich({ t }: { t: string }): ReactNode {
  if (!EMOJI_RE.test(t)) return t;
  EMOJI_RE.lastIndex = 0;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of t.matchAll(EMOJI_RE)) {
    if (m.index! > last) out.push(t.slice(last, m.index));
    const name = iconOf(m[0]);
    if (name) out.push(<Icon key={m.index} name={name} />);
    last = m.index! + m[0].length;
  }
  if (last < t.length) out.push(t.slice(last));
  return <>{out}</>;
}

/** An icon as an SVG string (DOM code outside React). Emoji or icon names; unknown → empty. */
export function iconHtml(emojiOrName: string): string {
  const name = (emojiOrName in ICONS ? emojiOrName : iconOf(emojiOrName)) as IconName | null;
  if (!name) return '';
  return `<svg class="ico-line" viewBox="0 0 24 24" width="1.15em" height="1.15em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name].map((d) => `<path d="${d}"/>`).join('')}</svg>`;
}

const pathCache = new Map<string, Path2D[]>();
/** Draws a line icon on a canvas, centred at (x, y), `size` px square. */
export function drawIcon(g: CanvasRenderingContext2D, name: IconName, x: number, y: number, size: number, color: string, width = 2): void {
  let paths = pathCache.get(name);
  if (!paths) { paths = ICONS[name].map((d) => new Path2D(d)); pathCache.set(name, paths); }
  g.save();
  g.translate(x - size / 2, y - size / 2);
  g.scale(size / 24, size / 24);
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const p of paths) g.stroke(p);
  g.restore();
}
