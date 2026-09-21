/**
 * Audio Engine - reda MP3-ul primit de la ElevenLabs (base64, prin bridge)
 * prin Web Audio API, ca lip sync-ul sa poata analiza semnalul real.
 *
 * Daca decodarea esueaza, cade pe <audio> simplu; in acest caz lip sync-ul
 * foloseste fallback-ul pe amplitudine simulata, fara sa strice experienta.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.source = null;
    this.gain = null;
    this.analyser = null;
    this.fallbackEl = null;
    this.playing = false;
    this.onEnded = null;
    this._token = 0;
    this._startedAt = 0;
    this._playbackRate = 1;
  }

  ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.gain = this.ctx.createGain();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      // Lower smoothing keeps consonant/vowel changes responsive without
      // making the mouth jitter. The lip-sync engine performs its own
      // perceptual smoothing.
      this.analyser.smoothingTimeConstant = 0.18;
      // IMPORTANT: analyser INAINTE de gain -> lip sync-ul ramane corect
      // chiar si cand utilizatorul da volumul foarte jos sau pe zero.
      this.analyser.connect(this.gain);
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  get sampleRate() { return this.ctx ? this.ctx.sampleRate : 44100; }

  get currentTime() {
    if (this.source && this.ctx) {
      return Math.max(0, (this.ctx.currentTime - this._startedAt) * this._playbackRate);
    }
    return this.fallbackEl ? Math.max(0, this.fallbackEl.currentTime || 0) : 0;
  }

  async play(base64, { volume = 0.9, rate = 1.0 } = {}) {
    this.stop();
    const token = ++this._token;
    const ctx = this.ensureContext();

    if (!ctx) return this._playFallback(base64, volume, rate, token);

    let buffer;
    try {
      const bytes = this._decodeBase64(base64);
      buffer = await ctx.decodeAudioData(bytes.buffer);
    } catch (_) {
      return this._playFallback(base64, volume, rate, token);
    }
    if (token !== this._token) return false;

    try {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = Math.max(0.6, Math.min(1.6, rate));
      this._playbackRate = src.playbackRate.value;
      this.gain.gain.value = Math.max(0, Math.min(1, volume));
      src.connect(this.analyser);
      src.onended = () => {
        if (token !== this._token) return;
        this.playing = false;
        this.source = null;
        if (this.onEnded) this.onEnded();
      };
      src.start(0);
      this._startedAt = this.ctx.currentTime;
      this.source = src;
      this.playing = true;
      return true;
    } catch (_) {
      return this._playFallback(base64, volume, rate, token);
    }
  }

  _playFallback(base64, volume, rate, token) {
    try {
      const el = new Audio('data:audio/mpeg;base64,' + base64);
      el.volume = Math.max(0, Math.min(1, volume));
      el.playbackRate = Math.max(0.6, Math.min(1.6, rate));
      this._playbackRate = el.playbackRate;
      el.onended = () => {
        if (token !== this._token) return;
        this.playing = false;
        this.fallbackEl = null;
        if (this.onEnded) this.onEnded();
      };
      el.onerror = () => {
        if (token !== this._token) return;
        this.playing = false;
        this.fallbackEl = null;
        if (this.onEnded) this.onEnded();
      };
      this.fallbackEl = el;
      this.playing = true;
      el.play().catch(() => {
        this.playing = false;
        this.fallbackEl = null;
        if (this.onEnded) this.onEnded();
      });
      return true;
    } catch (_) {
      this.playing = false;
      if (this.onEnded) this.onEnded();
      return false;
    }
  }

  /** Analyser real doar cand redam prin Web Audio (altfel lip sync pe fallback). */
  getAnalyser() {
    return this.source ? this.analyser : null;
  }

  setVolume(v) {
    const vol = Math.max(0, Math.min(1, v));
    if (this.gain) this.gain.gain.value = vol;
    if (this.fallbackEl) this.fallbackEl.volume = vol;
  }

  stop() {
    this._token++;
    if (this.source) {
      try { this.source.onended = null; this.source.stop(0); } catch (_) {}
      try { this.source.disconnect(); } catch (_) {}
      this.source = null;
    }
    if (this.fallbackEl) {
      try { this.fallbackEl.pause(); } catch (_) {}
      this.fallbackEl = null;
    }
    this.playing = false;
    this._startedAt = 0;
  }

  suspend() {
    this.stop();
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  _decodeBase64(b64) {
    const clean = (b64 || '').replace(/\s/g, '');
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
}
