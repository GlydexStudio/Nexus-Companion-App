/**
 * Nexus Audio Engine
 *
 * Single source of truth for playback timing.
 * The lip-sync clock is always derived from the exact Web Audio playback clock
 * (or HTMLAudioElement.currentTime for the fallback path).
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.source = null;
    this.gain = null;
    this.analyser = null;
    this.fallbackEl = null;
    this.playing = false;
    this.onPrepared = null;
    this.onPlaybackStarted = null;
    this.onEnded = null;
    this._token = 0;
    this._startedAt = 0;
    this._bufferDuration = 0;
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
      this.analyser.smoothingTimeConstant = 0.12;
      this.analyser.connect(this.gain);
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  get sampleRate() { return this.ctx ? this.ctx.sampleRate : 44100; }

  get currentTime() {
    if (this.source && this.ctx) {
      const t = Math.max(0, (this.ctx.currentTime - this._startedAt) * this._playbackRate);
      return Math.min(t, this._bufferDuration || t);
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
      buffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
    } catch (_) {
      return this._playFallback(base64, volume, rate, token);
    }
    if (token !== this._token) return false;

    try {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = Math.max(0.6, Math.min(1.6, Number(rate) || 1));
      this._playbackRate = src.playbackRate.value;
      this._bufferDuration = buffer.duration;
      this.gain.gain.value = Math.max(0, Math.min(1, Number(volume) || 0));
      src.connect(this.analyser);

      // Lip-sync attaches before playback starts, so no beginning frames are missed.
      if (typeof this.onPrepared === 'function') {
        try { this.onPrepared(this.analyser, this.sampleRate, this._bufferDuration); } catch (_) {}
      }

      src.onended = () => {
        if (token !== this._token) return;
        this.playing = false;
        this.source = null;
        if (this.onEnded) this.onEnded();
      };

      this._startedAt = ctx.currentTime;
      src.start(0);
      this.source = src;
      this.playing = true;
      if (this.onPlaybackStarted) this.onPlaybackStarted();
      return true;
    } catch (_) {
      return this._playFallback(base64, volume, rate, token);
    }
  }

  _playFallback(base64, volume, rate, token) {
    try {
      const el = new Audio('data:audio/mpeg;base64,' + base64);
      el.volume = Math.max(0, Math.min(1, Number(volume) || 0));
      el.playbackRate = Math.max(0.6, Math.min(1.6, Number(rate) || 1));
      this._playbackRate = el.playbackRate;
      this._bufferDuration = 0;

      // When AudioContext exists, keep the analyser in the fallback path too.
      // This means lip-sync still follows the real waveform instead of a fake oscillator.
      let fallbackAnalyser = null;
      if (this.ctx && this.analyser) {
        try {
          const media = this.ctx.createMediaElementSource(el);
          media.connect(this.analyser);
          fallbackAnalyser = this.analyser;
        } catch (_) {}
      }

      if (typeof this.onPrepared === 'function') {
        try { this.onPrepared(fallbackAnalyser, this.sampleRate, 0); } catch (_) {}
      }

      el.onplay = () => {
        if (token !== this._token) return;
        this.playing = true;
        if (this.onPlaybackStarted) this.onPlaybackStarted();
      };
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
      const promise = el.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {
          if (token !== this._token) return;
          this.playing = false;
          this.fallbackEl = null;
          if (this.onEnded) this.onEnded();
        });
      }
      return true;
    } catch (_) {
      this.playing = false;
      if (this.onEnded) this.onEnded();
      return false;
    }
  }

  getAnalyser() { return this.source ? this.analyser : null; }

  setVolume(v) {
    const vol = Math.max(0, Math.min(1, Number(v) || 0));
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
      try { this.fallbackEl.src = ''; } catch (_) {}
      this.fallbackEl = null;
    }
    this.playing = false;
    this._startedAt = 0;
    this._bufferDuration = 0;
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
