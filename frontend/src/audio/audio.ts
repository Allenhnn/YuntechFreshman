export type Sfx = 'click' | 'open' | 'close' | 'coin' | 'jump' | 'land' | 'robbed' | 'hit' | 'thud' | 'bell' | 'buzz';

/** Recorded sounds (public/sounds/): a random take of the list plays each time. */
const SAMPLES: Partial<Record<Sfx, readonly string[]>> = {
  robbed: ['robbed.m4a'],
  hit: ['hit1.m4a', 'hit2.m4a', 'hit3.m4a'],
};

export interface AudioBus {
  /** Creates / resumes the AudioContext; call from a user gesture. */
  unlock(): void;
  setVolumes(master: number, sfx: number): void;
  play(sfx: Sfx, intensity?: number): void;
  dispose(): void;
}

interface Tone {
  type: OscillatorType;
  from: number;
  to: number;
  duration: number;
  gain: number;
  delay?: number;
}

/** Tiny procedural sound set so the volume settings are audible before real assets exist. */
const SOUNDS: Readonly<Record<Sfx, readonly Tone[]>> = {
  click: [{ type: 'triangle', from: 880, to: 660, duration: 0.05, gain: 0.25 }],
  open: [{ type: 'sine', from: 520, to: 880, duration: 0.09, gain: 0.25 }],
  close: [{ type: 'sine', from: 760, to: 440, duration: 0.09, gain: 0.22 }],
  coin: [
    { type: 'square', from: 988, to: 988, duration: 0.07, gain: 0.12 },
    { type: 'square', from: 1319, to: 1319, duration: 0.16, gain: 0.12, delay: 0.07 },
  ],
  jump: [{ type: 'sine', from: 300, to: 620, duration: 0.14, gain: 0.25 }],
  land: [{ type: 'triangle', from: 180, to: 70, duration: 0.12, gain: 0.35 }],
  robbed: [],
  hit: [],
  // School bell: ding-dong-ding-dong.
  bell: [
    { type: 'sine', from: 784, to: 784, duration: 0.55, gain: 0.22 },
    { type: 'sine', from: 659, to: 659, duration: 0.55, gain: 0.22, delay: 0.55 },
    { type: 'sine', from: 698, to: 698, duration: 0.55, gain: 0.22, delay: 1.1 },
    { type: 'sine', from: 523, to: 523, duration: 0.9, gain: 0.22, delay: 1.65 },
  ],
  // A phone vibrating on the desk: three low rattling pulses.
  buzz: [
    { type: 'square', from: 110, to: 104, duration: 0.32, gain: 0.16 },
    { type: 'square', from: 110, to: 104, duration: 0.32, gain: 0.16, delay: 0.5 },
    { type: 'square', from: 110, to: 104, duration: 0.32, gain: 0.16, delay: 1.0 },
  ],
  // A body hitting a car / the ground: a low knock with a short rattle.
  thud: [
    { type: 'triangle', from: 140, to: 45, duration: 0.22, gain: 0.5 },
    { type: 'square', from: 90, to: 60, duration: 0.08, gain: 0.12, delay: 0.03 },
  ],
};

/**
 * Master → SFX bus. Oscillator nodes are one-shot by Web Audio design (cheap, collected by the
 * audio thread), so they are created per sound rather than pooled.
 */
export function createAudioBus(): AudioBus {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let sfxBus: GainNode | null = null;
  let volumes = { master: 0.8, sfx: 0.8 };
  const buffers = new Map<string, AudioBuffer | null>();
  /** Last start per sound: a voice line does not restart over itself. */
  const playing = new Map<Sfx, number>();
  const load = (c: AudioContext): void => {
    for (const file of Object.values(SAMPLES).flat()) {
      if (buffers.has(file)) continue;
      buffers.set(file, null);
      void fetch(`${import.meta.env.BASE_URL}sounds/${file}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => c.decodeAudioData(b))
        .then((buf) => { buffers.set(file, buf); })
        .catch((err: unknown) => console.warn(`[audio] ${file}`, err));
    }
  };

  const apply = (): void => {
    if (!ctx || !master || !sfxBus) return;
    master.gain.setTargetAtTime(volumes.master, ctx.currentTime, 0.02);
    sfxBus.gain.setTargetAtTime(volumes.sfx, ctx.currentTime, 0.02);
  };

  return {
    unlock() {
      if (!ctx) {
        ctx = new AudioContext();
        master = ctx.createGain();
        sfxBus = ctx.createGain();
        sfxBus.connect(master).connect(ctx.destination);
        apply();
        load(ctx);
      }
      if (ctx.state === 'suspended') void ctx.resume();
    },
    setVolumes(m, s) {
      volumes = { master: m, sfx: s };
      apply();
    },
    play(sfx, intensity = 1) {
      if (!ctx || !sfxBus || ctx.state !== 'running') return;
      const t0 = ctx.currentTime;
      const takes = SAMPLES[sfx];
      if (takes) {
        const ready = takes.map((f) => buffers.get(f)).filter((b): b is AudioBuffer => !!b);
        const buf = ready[Math.floor(Math.random() * ready.length)];
        if (!buf || t0 - (playing.get(sfx) ?? -Infinity) < buf.duration * 0.8) return;
        playing.set(sfx, t0);
        const src = ctx.createBufferSource();
        const env = ctx.createGain();
        src.buffer = buf;
        env.gain.value = Math.min(1.5, intensity);
        src.connect(env).connect(sfxBus);
        src.start(t0);
        return;
      }
      for (const tone of SOUNDS[sfx]) {
        const start = t0 + (tone.delay ?? 0);
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = tone.type;
        osc.frequency.setValueAtTime(tone.from, start);
        osc.frequency.exponentialRampToValueAtTime(tone.to, start + tone.duration);
        env.gain.setValueAtTime(0.0001, start);
        env.gain.exponentialRampToValueAtTime(tone.gain * intensity, start + 0.008);
        env.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);
        osc.connect(env).connect(sfxBus);
        osc.start(start);
        osc.stop(start + tone.duration + 0.02);
      }
    },
    dispose() {
      void ctx?.close();
      ctx = null;
    },
  };
}
