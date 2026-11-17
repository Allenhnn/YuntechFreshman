import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { TESTER_SPEEDS, actions, gameStore, useGame } from '../state/store';
import { useApi } from './api';
import { setStreetView, streetViewOn } from '../tools/streetViewSync';

/**
 * Chat box: Enter opens a line at the bottom left; Enter sends, Esc closes. A line starting with
 * "/" is a command (/help lists them); anything else is just shown in the log. Recent lines stay
 * on screen for a while after the box closes.
 */
const SHOW_MS = 10_000;

const HELP = [
  '/help　列出指令',
  '/tester [on|off]　切換測試員模式',
  '/fly [on|off]　飛行（Space 上升、C 下降）',
  '/noclip [on|off]　穿牆（同時飛行）',
  `/speed <${TESTER_SPEEDS.join('|')}>　移動速度倍率`,
  '/streetview [on|off]　Google 街景比對（開發模式）',
  '/clear　清除對話紀錄',
];

/** on / off / toggle from an optional argument; undefined when the argument is not understood. */
function onOff(arg: string | undefined, current: boolean): boolean | undefined {
  if (arg === undefined) return !current;
  if (['on', '1', 'true', '開'].includes(arg)) return true;
  if (['off', '0', 'false', '關'].includes(arg)) return false;
  return undefined;
}

export function runCommand(line: string): void {
  const [cmd = '', ...args] = line.slice(1).trim().split(/\s+/);
  const t = gameStore.getState().tester;
  const needTester = (): boolean => {
    if (t.enabled) return true;
    actions.chat('請先輸入 /tester 開啟測試員模式', 'error');
    return false;
  };
  switch (cmd.toLowerCase()) {
    case 'help':
    case '?':
      for (const h of HELP) actions.chat(h);
      return;
    case 'tester':
    case 'test': {
      const v = onOff(args[0]?.toLowerCase(), t.enabled);
      if (v === undefined) break;
      actions.setTester({ enabled: v });
      actions.chat(v ? '測試員模式：開啟（/fly 飛行、/noclip 穿牆、/speed 速度，F / N / + - 也可以）' : '測試員模式：關閉');
      return;
    }
    case 'fly': {
      if (!needTester()) return;
      const v = onOff(args[0]?.toLowerCase(), t.fly);
      if (v === undefined) break;
      actions.setTester({ fly: v, noclip: v ? t.noclip : false });
      actions.chat(v ? '飛行：開啟（Space 上升、C 下降）' : '飛行：關閉');
      return;
    }
    case 'noclip': {
      if (!needTester()) return;
      const v = onOff(args[0]?.toLowerCase(), t.noclip);
      if (v === undefined) break;
      actions.setTester({ noclip: v });
      actions.chat(v ? '穿牆：開啟（同時開啟飛行）' : '穿牆：關閉（仍在飛行，/fly off 落地）');
      return;
    }
    case 'speed': {
      if (!needTester()) return;
      const n = Number(args[0]);
      if (!TESTER_SPEEDS.includes(n as (typeof TESTER_SPEEDS)[number])) {
        actions.chat(`速度只能是 ${TESTER_SPEEDS.join('、')}`, 'error');
        return;
      }
      actions.setTester({ speed: n });
      actions.chat(`速度 ×${n}`);
      return;
    }
    case 'streetview':
    case 'sv':
    case '街景': {
      const v = onOff(args[0]?.toLowerCase(), streetViewOn());
      if (v === undefined) break;
      const r = setStreetView(v);
      actions.chat(r.message, r.ok ? undefined : 'error');
      return;
    }
    case 'clear':
      actions.clearChat();
      return;
    default:
      actions.chat(`沒有「/${cmd}」這個指令，輸入 /help 查看`, 'error');
      return;
  }
  actions.chat(`看不懂「${line}」，輸入 /help 查看用法`, 'error');
}

/** The input line (modal 'chat'). */
export function ChatBox(): ReactNode {
  const api = useApi();
  const [text, setText] = useState('');
  const [hist, setHist] = useState(-1);
  const sent = useRef<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      api.closeModal();
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const line = text.trim();
      if (line) {
        sent.current = [...sent.current.filter((l) => l !== line), line].slice(-20);
        actions.chat(line, 'me');
        if (line.startsWith('/')) runCommand(line);
      }
      api.closeModal();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // Walk back through what was sent before.
      e.preventDefault();
      const list = sent.current;
      if (!list.length) return;
      const i = hist < 0 ? (e.key === 'ArrowUp' ? list.length - 1 : -1) : hist + (e.key === 'ArrowUp' ? -1 : 1);
      const next = Math.max(-1, Math.min(list.length - 1, i));
      setHist(next);
      setText(next < 0 ? '' : list[next]!);
    }
  };
  return (
    <div className="chat-box interactive">
      <input
        ref={input}
        value={text}
        maxLength={200}
        placeholder="輸入訊息，或 /help 查看指令"
        onChange={(e) => { setText(e.target.value); setHist(-1); }}
        onKeyDown={onKey}
        onBlur={() => api.closeModal()}
      />
    </div>
  );
}

/** Recent lines above the input: all of them while the box is open, the last few for a while after. */
export function ChatLog(): ReactNode {
  const chat = useGame((s) => s.chat);
  const open = useGame((s) => s.modal === 'chat');
  const [, setTick] = useState(0); // re-render when the newest line times out
  useEffect(() => {
    const last = chat[chat.length - 1];
    if (open || !last) return;
    const left = last.at + SHOW_MS - Date.now();
    if (left <= 0) return;
    const id = setTimeout(() => setTick((n) => n + 1), left + 50);
    return () => clearTimeout(id);
  }, [chat, open]);
  const lines = open ? chat.slice(-14) : chat.filter((l) => Date.now() - l.at < SHOW_MS).slice(-6);
  if (!lines.length) return null;
  return (
    <div className={`chat-log${open ? ' open' : ''}`}>
      {lines.map((l) => (
        <div key={l.id} className={`chat-line ${l.from}`}>{l.from === 'me' ? <><b>你</b>　{l.text}</> : l.text}</div>
      ))}
    </div>
  );
}
