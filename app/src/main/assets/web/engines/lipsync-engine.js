/**
 * Natural Nexus Lip Sync
 *
 * Primary timing source: ElevenLabs character alignment.
 * Audio analysis only controls energy/opening, while text alignment controls
 * WHICH mouth shape is active. This prevents the classic "random vowel loop".
 *
 * No jaw bone exists on the VRoid models, so everything is morph based.
 */

const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'];

const VRM_VISEME_NAMES = {
  aa: ['A', 'aa'],
  ih: ['I', 'ih'],
  ou: ['U', 'ou'],
  ee: ['E', 'ee'],
  oh: ['O', 'oh']
};

const MOUTH_NAMES = {
  large: ['MTH_Large'],
  small: ['MTH_Small'],
  up: ['MTH_Up'],
  down: ['MTH_Down']
};

const OPEN_SCALE = { aa: 1.00, oh: 0.92, ee: 0.84, ih: 0.72, ou: 0.66 };

const BILABIAL = new Set(['m', 'b', 'p']);
const LABIODENTAL = new Set(['f', 'v']);
const FRICATIVE = new Set(['s', 'ș', 'ş', 'j', 'ž', 'z', 'ț', 'ţ', 'c']);

function clamp(v, a = 0, b = 1) { return Math.max(a, Math.min(b, v)); }
function smoothstep(a, b, x) {
  const t = clamp((x - a) / Math.max(0.0001, b - a));
  return t * t * (3 - 2 * t);
}

export class LipSyncEngine {
  constructor(stage = null) {
    this.stage = stage;
    this.analyser = null;
    this.freq = null;
    this.time = null;
    this.sampleRate = 44100;
    this.enabled = true;
    this.talking = false;
    this.alignment = null;
    this.events = [];
    this.weights = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    this._mouth = { large: 0, small: 0, up: 0, down: 0 };
    this._envelope = 0;
    this._energy = 0;
    this._lastTime = 0;
    this._lastIndex = 0;
  }

  setStage(stage) { this.stage = stage || null; }

  attach(analyser, sampleRate) {
    this.analyser = analyser || null;
    if (!analyser) {
      this.freq = null;
      this.time = null;
      this.sampleRate = sampleRate || 44100;
      return;
    }
    this.freq = new Uint8Array(analyser.frequencyBinCount);
    this.time = new Uint8Array(analyser.fftSize);
    this.sampleRate = sampleRate || 44100;
  }

  detach() {
    this.analyser = null;
    this.freq = null;
    this.time = null;
  }

  setTalking(v) { this.talking = !!v; }
  setEnabled(v) { this.enabled = !!v; }

  setAlignment(alignment) {
    this.alignment = alignment || null;
    this.events = [];
    this._lastIndex = 0;
    if (!alignment) return;

    const chars = alignment.characters || [];
    const starts = alignment.character_start_times_seconds || [];
    const ends = alignment.character_end_times_seconds || [];

    for (let i = 0; i < chars.length; i++) {
      const ch = String(chars[i] || '').toLowerCase();
      const start = Number(starts[i]);
      const end = Number(ends[i]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;

      let type = 'silence';
      let viseme = null;
      if ('aăâ'.includes(ch)) { type = 'vowel'; viseme = 'aa'; }
      else if (ch === 'e') { type = 'vowel'; viseme = 'ee'; }
      else if ('iîıy'.includes(ch)) { type = 'vowel'; viseme = 'ih'; }
      else if (ch === 'o') { type = 'vowel'; viseme = 'oh'; }
      else if (ch === 'u') { type = 'vowel'; viseme = 'ou'; }
      else if (BILABIAL.has(ch)) type = 'bilabial';
      else if (LABIODENTAL.has(ch)) type = 'labiodental';
      else if (FRICATIVE.has(ch)) type = 'fricative';
      else if (/^[a-zăâîșşțţjž]$/i.test(ch)) type = 'consonant';

      this.events.push({ start, end, type, viseme, ch });
    }

    this.events.sort((a, b) => a.start - b.start);
  }

  _resolve(candidates) {
    if (!this.stage || typeof this.stage.hasExpression !== 'function') return null;
    for (const name of candidates) if (this.stage.hasExpression(name)) return name;
    return null;
  }

  _write(out, candidates, weight, mode = 'add') {
    if (weight <= 0.001) return;
    const name = this._resolve(candidates);
    if (!name) return;
    const value = clamp(weight);
    if (mode === 'max') out[name] = Math.max(out[name] || 0, value);
    else out[name] = (out[name] || 0) + value;
  }

  _readAudio() {
    if (!this.analyser || !this.time) return { level: 0, mid: 0.35, high: 0.2 };
    this.analyser.getByteTimeDomainData(this.time);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < this.time.length; i++) {
      const x = (this.time[i] - 128) / 128;
      sum += x * x;
      peak = Math.max(peak, Math.abs(x));
    }
    const rms = Math.sqrt(sum / this.time.length);

    let mid = 0.35;
    let high = 0.2;
    if (this.freq) {
      this.analyser.getByteFrequencyData(this.freq);
      const binHz = this.sampleRate / 2 / this.freq.length;
      const band = (lo, hi) => {
        const a = Math.max(1, Math.floor(lo / binHz));
        const b = Math.min(this.freq.length - 1, Math.ceil(hi / binHz));
        let e = 0, n = 0;
        for (let i = a; i <= b; i++) { const m = this.freq[i] / 255; e += m * m; n++; }
        return n ? Math.sqrt(e / n) : 0;
      };
      mid = band(700, 1800);
      high = band(1800, 4200);
    }

    return { level: clamp(rms * 3.8), peak, mid, high };
  }

  _findEvent(time) {
    if (!this.events.length || !Number.isFinite(time)) return null;
    let i = this._lastIndex;
    if (time < this._lastTime) i = 0;
    while (i < this.events.length - 1 && time >= this.events[i].end) i++;
    while (i > 0 && time < this.events[i].start) i--;
    this._lastIndex = i;
    this._lastTime = time;
    const current = this.events[i];
    const prev = i > 0 ? this.events[i - 1] : null;
    const next = i + 1 < this.events.length ? this.events[i + 1] : null;
    return { current, prev, next };
  }

  _eventBlend(time) {
    const found = this._findEvent(time);
    if (!found) return null;
    const { current, prev, next } = found;
    let primary = current;
    let secondary = null;
    let secondaryAmount = 0;
    const edge = 0.045;

    if (current && time < current.start) {
      primary = prev || current;
    }

    if (primary && primary.type === 'vowel') {
      if (next && next.type === 'vowel' && time >= primary.end - edge) {
        secondary = next;
        secondaryAmount = smoothstep(primary.end - edge, primary.end, time);
      } else if (prev && prev.type === 'vowel' && time <= primary.start + edge) {
        secondary = primary;
        primary = prev;
        secondaryAmount = 1 - smoothstep(primary.end, primary.end + edge, time);
      }
    } else if (next && next.type === 'vowel' && time >= current.end - edge) {
      primary = current;
      secondary = next;
      secondaryAmount = smoothstep(current.end - edge, current.end, time);
    }

    return { primary, secondary, secondaryAmount };
  }

  update(dt, out, audioTime = null) {
    const frame = clamp(dt, 0.001, 0.05);
    if (!this.talking || !this.enabled) return this._release(frame, out);

    const audio = this._readAudio();
    const rawPresence = smoothstep(0.012, 0.075, audio.level);
    const attack = 1 - Math.pow(0.0008, frame);
    const release = 1 - Math.pow(0.055, frame);
    const k = rawPresence > this._envelope ? attack : release;
    this._envelope += (rawPresence - this._envelope) * k;
    this._energy += (audio.level - this._energy) * (rawPresence > this._envelope ? 0.36 : 0.16);

    // In quiet portions between phonemes, the mouth should visibly close.
    const voiceEnergy = clamp(this._energy * 1.55);
    const blend = this._eventBlend(Number(audioTime));

    const targets = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    let mouthOpen = 0;
    let mouthKind = 'none';

    if (blend && blend.primary) {
      const e = blend.primary;
      if (e.type === 'vowel' && e.viseme) {
        const coart = blend.secondary && blend.secondary.viseme ? blend.secondaryAmount : 0;
        const primaryWeight = 1 - coart * 0.42;
        const visemeOpen = 0.18 + 0.80 * voiceEnergy;
        const shapedOpen = visemeOpen * (OPEN_SCALE[e.viseme] || 0.8);
        targets[e.viseme] = shapedOpen * primaryWeight;
        if (blend.secondary && blend.secondary.viseme) targets[blend.secondary.viseme] = shapedOpen * 0.42 * coart;
        mouthOpen = shapedOpen;
        mouthKind = shapedOpen > 0.46 ? 'large' : 'small';
      } else if (e.type === 'bilabial') {
        mouthOpen = 0.06 + 0.08 * voiceEnergy;
        mouthKind = 'small';
      } else if (e.type === 'labiodental' || e.type === 'fricative') {
        mouthOpen = 0.09 + 0.12 * voiceEnergy;
        mouthKind = 'small';
      } else if (e.type === 'consonant') {
        mouthOpen = 0.08 + 0.16 * voiceEnergy;
        mouthKind = 'small';
      } else {
        mouthOpen = 0.025 + 0.08 * voiceEnergy;
        mouthKind = 'small';
      }
    } else {
      // No alignment interval: use only the real audio envelope, never a fake oscillator.
      mouthOpen = 0.015 + 0.12 * voiceEnergy;
      mouthKind = mouthOpen > 0.07 ? 'small' : 'none';
    }

    // Stronger A/O opening, softer I/U. Keep a little asymmetry so the face is alive.
    const asym = 1 + Math.sin((Number(audioTime) || 0) * 7.1) * 0.018;
    for (const v of VISEMES) {
      const target = clamp((targets[v] || 0) * asym);
      const rate = target > this.weights[v] ? 1 - Math.pow(0.0025, frame) : 1 - Math.pow(0.025, frame);
      this.weights[v] += (target - this.weights[v]) * rate;
      this._write(out, VRM_VISEME_NAMES[v], this.weights[v]);
    }

    // Secondary lip deformation is intentionally subtle because vowels already shape the mouth.
    const large = mouthKind === 'large' ? clamp(mouthOpen * 0.18) : 0;
    const small = mouthKind === 'small' ? clamp(0.035 + mouthOpen * 0.14) : 0;
    const up = blend?.primary?.viseme === 'ee' || blend?.primary?.viseme === 'ih' ? clamp(mouthOpen * 0.055) : 0;
    const down = blend?.primary?.viseme === 'aa' || blend?.primary?.viseme === 'oh' ? clamp(mouthOpen * 0.035) : 0;

    const layers = [
      ['large', large], ['small', small], ['up', up], ['down', down]
    ];
    for (const [type, target] of layers) {
      const old = this._mouth[type];
      const rate = target > old ? 1 - Math.pow(0.01, frame) : 1 - Math.pow(0.035, frame);
      this._mouth[type] = old + (target - old) * rate;
    }

    this._write(out, MOUTH_NAMES.large, this._mouth.large, 'max');
    this._write(out, MOUTH_NAMES.small, this._mouth.small, 'max');
    this._write(out, MOUTH_NAMES.up, this._mouth.up, 'max');
    this._write(out, MOUTH_NAMES.down, this._mouth.down, 'max');
    return out;
  }

  _release(frame, out) {
    const rate = 1 - Math.pow(0.035, frame);
    this._envelope += (0 - this._envelope) * rate;
    this._energy += (0 - this._energy) * rate;
    for (const v of VISEMES) {
      this.weights[v] += (0 - this.weights[v]) * rate;
      this._write(out, VRM_VISEME_NAMES[v], this.weights[v]);
    }
    for (const k of Object.keys(this._mouth)) {
      this._mouth[k] += (0 - this._mouth[k]) * rate;
    }
    this._write(out, MOUTH_NAMES.large, this._mouth.large, 'max');
    this._write(out, MOUTH_NAMES.small, this._mouth.small, 'max');
    this._write(out, MOUTH_NAMES.up, this._mouth.up, 'max');
    this._write(out, MOUTH_NAMES.down, this._mouth.down, 'max');
    return out;
  }

  reset() {
    this._envelope = 0;
    this._energy = 0;
    this._lastTime = 0;
    this._lastIndex = 0;
    for (const v of VISEMES) this.weights[v] = 0;
    for (const k of Object.keys(this._mouth)) this._mouth[k] = 0;
  }
}
