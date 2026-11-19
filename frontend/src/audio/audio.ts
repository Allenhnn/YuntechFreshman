export type Sfx = 'click' | 'open' | 'close' | 'coin' | 'jump' | 'land';

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
