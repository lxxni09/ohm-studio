/** Hörbare Summer, Lautsprecher, Relais-Klicks und Motorgeräusche (WebAudio) */
import { engine } from './state/store';

let ctx: AudioContext | null = null;
const voices = new Map<string, { osc: OscillatorNode; gain: GainNode }>();
let master: GainNode | null = null;
export let muted = false;

export function setMuted(m: boolean) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.18;
}

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.18;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** einmal pro Frame aufrufen */
export function syncAudio(running: boolean) {
  if (!running) {
    for (const [, v] of voices) {
      v.gain.gain.setTargetAtTime(0, ctx!.currentTime, 0.02);
      v.osc.stop(ctx!.currentTime + 0.1);
    }
    voices.clear();
    return;
  }
  const want = engine.sounds;
  if (!want.size && !voices.size && !engine.clicks.length) return;
  const ac = ensure();
  if (!ac || !master) return;
  for (const [k, v] of voices) {
    if (!want.has(k)) {
      v.gain.gain.setTargetAtTime(0, ac.currentTime, 0.015);
      v.osc.stop(ac.currentTime + 0.08);
      voices.delete(k);
    }
  }
  for (const [k, s] of want) {
    let v = voices.get(k);
    if (!v) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = (['sine', 'square', 'sawtooth', 'triangle'].includes(s.type) ? s.type : 'square') as OscillatorType;
      gain.gain.value = 0;
      osc.connect(gain).connect(master);
      osc.start();
      v = { osc, gain };
      voices.set(k, v);
    }
    v.osc.frequency.setTargetAtTime(Math.min(12000, s.freq), ac.currentTime, 0.005);
    v.gain.gain.setTargetAtTime(Math.min(1, s.vol), ac.currentTime, 0.01);
  }
  for (const _ of engine.clicks.splice(0)) {
    const len = Math.floor(ac.sampleRate * 0.012);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len / 5));
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(master);
    src.start();
  }
}

export function unlockAudio() {
  ensure();
}
