/**
 * Nexus Lip Sync Engine
 *
 * VRM 0.x / VRoid compatible lip-sync.
 *
 * Important pentru modelele Nexus / Lyra / Dante:
 * - NU există jaw bone => nu folosim jawOpen.
 * - Vocalele reale sunt morph-uri A / I / U / E / O.
 * - Indicii morph-urilor NU sunt hardcodati.
 * - Dacă stage-ul expune hasExpression(), motorul preferă numele
 *   reale VRM și cade înapoi pe aliasurile semantice.
 *
 * Nexus / Lyra:
 *   A/I/U/E/O -> morph targets vocale
 *
 * Dante:
 *   aceleași vocale, dar indexurile diferă.
 *
 * ElevenLabs alignment:
 *   este folosit atunci când există.
 * Spectral analysis:
 *   fallback pentru situațiile în care alignment-ul nu este disponibil.
 */

const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'];

const VRM_VISEME_NAMES = {
  aa: ['A', 'aa'],
  ih: ['I', 'ih'],
  ou: ['U', 'ou'],
  ee: ['E', 'ee'],
  oh: ['O', 'oh']
};

const VRM_MOUTH_NAMES = {
  large: ['MTH_Large'],
  small: ['MTH_Small'],
  up: ['MTH_Up'],
  down: ['MTH_Down']
};

export class LipSyncEngine {
  constructor(stage = null) {
    this.stage = stage;

    this.analyser = null;
    this.freq = null;
    this.time = null;
    this.sampleRate = 44100;

    this.enabled = true;
    this.talking = false;

    this.openness = 0;
    this.energy = 0;
    this.lowEnergy = 0;
    this.midEnergy = 0;
    this.highEnergy = 0;

    this.weights = {
      aa: 0,
      ih: 0,
      ou: 0,
      ee: 0,
      oh: 0
    };

    this._lastCentroid = 1200;
    this._fallbackTime = 0;

    this.alignment = null;
    this._alignedVowels = [];
    this._lastAlignedViseme = null;
  }

  setStage(stage) {
    this.stage = stage || null;
  }

  attach(analyser, sampleRate) {
    this.analyser = analyser || null;

    if (!analyser) {
      this.freq = null;
      this.time = null;
      return;
    }

    // Reuse buffers: zero allocations inside update().
    this.freq = new Uint8Array(analyser.frequencyBinCount);
    this.time = new Uint8Array(analyser.fftSize);

    this.sampleRate = sampleRate || 44100;
  }

  detach() {
    this.analyser = null;
    this.freq = null;
    this.time = null;
  }

  setTalking(v) {
    this.talking = !!v;
  }

  setEnabled(v) {
    this.enabled = !!v;
  }

  setAlignment(alignment) {
    this.alignment = alignment || null;
    this._alignedVowels = [];
    this._lastAlignedViseme = null;

    if (!alignment) return;

    const chars = alignment.characters || [];
    const starts =
      alignment.character_start_times_seconds || [];
    const ends =
      alignment.character_end_times_seconds || [];

    const visemeFor = (ch) => {
      switch ((ch || '').toLowerCase()) {
        case 'a':
        case 'ă':
        case 'â':
          return 'aa';

        case 'e':
          return 'ee';

        case 'i':
        case 'î':
        case 'y':
          return 'ih';

        case 'o':
          return 'oh';

        case 'u':
          return 'ou';

        default:
          return null;
      }
    };

    for (let i = 0; i < chars.length; i++) {
      const viseme = visemeFor(chars[i]);
      const start = Number(starts[i]);
      const end = Number(ends[i]);

      if (
        viseme &&
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end >= start
      ) {
        this._alignedVowels.push({
          start,
          end,
          viseme
        });
      }
    }
  }

  /**
   * Scrie un morph în out folosind numele real VRM atunci când
   * stage-ul poate verifica existența expresiei.
   *
   * semantic:
   *   aa / ih / ou / ee / oh
   *
   * real:
   *   A / I / U / E / O
   */
  _writeViseme(out, viseme, weight) {
    const candidates = VRM_VISEME_NAMES[viseme] || [viseme];

    const resolved = this._resolveExpression(candidates);

    if (resolved) {
      out[resolved] = (out[resolved] || 0) + weight;
      return;
    }

    // Fallback pentru un Stage care încă folosește aliasurile vechi.
    out[viseme] = (out[viseme] || 0) + weight;
  }

  _writeMouth(out, type, weight) {
    if (weight <= 0.001) return;

    const candidates = VRM_MOUTH_NAMES[type] || [];
    const resolved = this._resolveExpression(candidates);

    if (resolved) {
      out[resolved] = Math.max(out[resolved] || 0, weight);
    }
  }

  _resolveExpression(candidates) {
    if (!this.stage || typeof this.stage.hasExpression !== 'function') {
      return null;
    }

    for (const name of candidates) {
      if (this.stage.hasExpression(name)) {
        return name;
      }
    }

    return null;
  }

  update(dt, out, audioTime = null) {
    const frame = Math.min(
      0.05,
      Math.max(0.001, dt)
    );

    if (!this.talking || !this.enabled) {
      const closeRate =
        1 - Math.pow(0.045, frame);

      this.openness +=
        (0 - this.openness) * closeRate;

      for (const v of VISEMES) {
        this.weights[v] +=
          (0 - this.weights[v]) * closeRate;

        if (this.weights[v] > 0.002) {
          this._writeViseme(
            out,
            v,
            this.weights[v]
          );
        }
      }

      // No jawOpen here.
      // We optionally use a tiny mouth morph during release.
      if (this.openness > 0.002) {
        this._writeMouth(
          out,
          'small',
          Math.min(
            0.12,
            this.openness * 0.10
          )
        );
      }

      return out;
    }

    const signal = this._analyseSignal();

    const speech =
      this._speechAmount(signal.level);

    const targetOpen = Math.min(
      0.88,
      Math.pow(
        Math.max(0, speech) * 1.85,
        0.78
      )
    );

    const openRate =
      targetOpen > this.openness
        ? 1 - Math.pow(0.012, frame)
        : 1 - Math.pow(0.035, frame);

    this.openness +=
      (targetOpen - this.openness) * openRate;

    /**
     * Articulation:
     *
     * High frequency consonants narrow the mouth.
     * Mid/low energy supports fuller vowel shapes.
     */
    const articulation = Math.max(
      0.72,
      Math.min(
        1.10,
        0.92 +
          signal.mid * 0.22 -
          signal.high * 0.10 +
          Math.sin(
            signal.centroid * 0.0009
          ) * 0.015
      )
    );

    const vowelOpen = Math.max(
      0,
      Math.min(
        1,
        this.openness * articulation
      )
    );

    const alignedViseme =
      this._alignedVisemeAt(audioTime);

    const targets = alignedViseme
      ? this._alignedTargets(
          alignedViseme,
          vowelOpen
        )
      : this._vowelTargets(
          signal.centroid,
          signal.low,
          signal.mid,
          signal.high,
          vowelOpen
        );

    for (const v of VISEMES) {
      const target = targets[v] || 0;

      const rate =
        target > this.weights[v]
          ? 1 - Math.pow(0.018, frame)
          : 1 - Math.pow(0.035, frame);

      this.weights[v] +=
        (target - this.weights[v]) * rate;

      if (this.weights[v] > 0.003) {
        this._writeViseme(
          out,
          v,
          this.weights[v]
        );
      }
    }

    /**
     * Secondary mouth articulation.
     *
     * Because the models have no jaw bone, this acts as a subtle
     * secondary deformation layer.
     */
    const mouthLayer =
      vowelOpen *
      (
        0.10 +
        signal.mid * 0.06
      );

    this._writeMouth(
      out,
      'large',
      Math.min(
        0.16,
        mouthLayer
      )
    );

    /**
     * Slight vertical articulation.
     *
     * We keep it very weak so that MTH_Up / MTH_Down don't
     * fight the vowel morphs.
     */
    const vertical =
      Math.max(
        -1,
        Math.min(
          1,
          (signal.mid - signal.low) * 1.6
        )
      );

    if (vertical > 0.08) {
      this._writeMouth(
        out,
        'up',
        Math.min(
          0.06,
          vowelOpen * vertical * 0.08
        )
      );
    } else if (vertical < -0.08) {
      this._writeMouth(
        out,
        'down',
        Math.min(
          0.06,
          vowelOpen * Math.abs(vertical) * 0.08
        )
      );
    }

    return out;
  }

  _alignedVisemeAt(audioTime) {
    if (
      !this._alignedVowels.length ||
      !Number.isFinite(audioTime)
    ) {
      return null;
    }

    let active = null;

    for (const vowel of this._alignedVowels) {
      if (
        audioTime >= vowel.start &&
        audioTime < vowel.end
      ) {
        active = vowel.viseme;
        break;
      }

      if (audioTime >= vowel.start) {
        active = vowel.viseme;
      } else {
        break;
      }
    }

    this._lastAlignedViseme =
      active || this._lastAlignedViseme;

    return this._lastAlignedViseme;
  }

  _alignedTargets(viseme, open) {
    const out = {
      aa: 0,
      ih: 0,
      ou: 0,
      ee: 0,
      oh: 0
    };

    if (!viseme) return out;

    /**
     * We intentionally keep a tiny amount of coarticulation.
     * This avoids hard morph switching when ElevenLabs alignment
     * changes character.
     */
    const primary = Math.min(1, open * 0.86);
    const secondary = Math.min(1, open * 0.14);

    out[viseme] = primary;

    switch (viseme) {
      case 'aa':
        out.oh = secondary;
        break;

      case 'ih':
        out.ee = secondary;
        break;

      case 'ou':
        out.oh = secondary;
        break;

      case 'ee':
        out.ih = secondary;
        break;

      case 'oh':
        out.ou = secondary;
        break;
    }

    return out;
  }

  _speechAmount(level) {
    const gate = 0.028;

    if (level <= gate) {
      return 0;
    }

    const x = Math.min(
      1,
      (level - gate) / 0.22
    );

    return x * x * (3 - 2 * x);
  }

  _analyseSignal() {
    if (
      !this.analyser ||
      !this.time ||
      !this.freq
    ) {
      return this._fallbackSignal();
    }

    this.analyser.getByteTimeDomainData(
      this.time
    );

    this.analyser.getByteFrequencyData(
      this.freq
    );

    let sum = 0;
    let peak = 0;

    for (let i = 0; i < this.time.length; i++) {
      const x =
        (this.time[i] - 128) / 128;

      const ax = Math.abs(x);

      sum += x * x;

      if (ax > peak) {
        peak = ax;
      }
    }

    const rms = Math.sqrt(
      sum / this.time.length
    );

    const level = Math.min(
      1,
      rms * 3.05
    );

    const binHz =
      this.sampleRate /
      2 /
      this.freq.length;

    const bands = {
      low: [180, 700],
      mid: [700, 1700],
      high: [1700, 3600]
    };

    const bandEnergy = (lo, hi) => {
      const a = Math.max(
        1,
        Math.floor(lo / binHz)
      );

      const b = Math.min(
        this.freq.length - 1,
        Math.ceil(hi / binHz)
      );

      let e = 0;
      let n = 0;

      for (let i = a; i <= b; i++) {
        const m = this.freq[i] / 255;
        e += m * m;
        n++;
      }

      return n
        ? Math.sqrt(e / n)
        : 0;
    };

    const low =
      bandEnergy(...bands.low);

    const mid =
      bandEnergy(...bands.mid);

    const high =
      bandEnergy(...bands.high);

    let num = 0;
    let den = 0;

    const minBin = Math.max(
      1,
      Math.floor(180 / binHz)
    );

    const maxBin = Math.min(
      this.freq.length,
      Math.floor(4200 / binHz)
    );

    for (
      let i = minBin;
      i < maxBin;
      i++
    ) {
      const m =
        this.freq[i] / 255;

      const w = m * m;

      num +=
        w * (i * binHz);

      den += w;
    }

    const rawCentroid =
      den > 0.00001
        ? num / den
        : this._lastCentroid;

    const centroidK =
      1 -
      Math.pow(
        0.018,
        Math.min(
          0.05,
          Math.max(
            0.001,
            1 / 60
          )
        )
      );

    this._lastCentroid +=
      (rawCentroid - this._lastCentroid) *
      centroidK;

    const k = 0.28;

    this.lowEnergy +=
      (low - this.lowEnergy) * k;

    this.midEnergy +=
      (mid - this.midEnergy) * k;

    this.highEnergy +=
      (high - this.highEnergy) * k;

    this.energy +=
      (level - this.energy) * 0.32;

    return {
      level: this.energy,
      low: this.lowEnergy,
      mid: this.midEnergy,
      high: this.highEnergy,
      centroid: this._lastCentroid,
      peak
    };
  }

  _vowelTargets(
    centroid,
    low,
    mid,
    high,
    open
  ) {
    const c = Math.max(
      250,
      Math.min(3300, centroid)
    );

    const g = (
      x,
      center,
      width
    ) => {
      const d =
        (x - center) / width;

      return Math.exp(
        -0.5 * d * d
      );
    };

    let s = {
      ou: g(c, 480, 330),
      oh: g(c, 760, 430),
      aa: g(c, 1250, 600),
      ee: g(c, 2050, 720),
      ih: g(c, 2850, 850)
    };

    const lowMid =
      low / Math.max(0.035, mid);

    const highMid =
      high / Math.max(0.035, mid);

    s.ou *=
      0.82 +
      Math.min(
        0.60,
        lowMid * 0.55
      );

    s.oh *=
      0.90 +
      Math.min(
        0.42,
        lowMid * 0.35
      );

    s.aa *=
      0.94 +
      Math.min(
        0.25,
        mid * 0.30
      );

    s.ee *=
      0.86 +
      Math.min(
        0.55,
        highMid * 0.48
      );

    s.ih *=
      0.82 +
      Math.min(
        0.62,
        highMid * 0.55
      );

    let sum = 0;

    for (const v of VISEMES) {
      sum += s[v];
    }

    if (sum <= 0.0001) {
      s = {
        aa: 1,
        ih: 0,
        ou: 0,
        ee: 0,
        oh: 0
      };

      sum = 1;
    }

    const dominant =
      VISEMES.reduce(
        (a, b) =>
          s[a] > s[b]
            ? a
            : b
      );

    const dominantShare = 0.74;

    const out = {};

    for (const v of VISEMES) {
      const p =
        s[v] / sum;

      out[v] =
        open *
        (
          v === dominant
            ? dominantShare +
              p *
                (1 - dominantShare)
            : p *
              (1 - dominantShare)
        );
    }

    if (open < 0.03) {
      for (const v of VISEMES) {
        out[v] *=
          open / 0.03;
      }
    }

    return out;
  }

  _fallbackSignal() {
    this._fallbackTime +=
      1 / 60;

    const t =
      this._fallbackTime;

    const envelope =
      0.34 +
      0.18 *
        Math.sin(
          t * 5.3 + 0.4
        ) +
      0.09 *
        Math.sin(
          t * 8.7 + 1.8
        ) +
      0.045 *
        Math.sin(
          t * 13.1 + 2.7
        );

    const level =
      Math.max(
        0.04,
        Math.min(
          0.72,
          envelope
        )
      );

    return {
      level,
      low:
        0.16 +
        0.08 *
          Math.sin(t * 2.1),

      mid:
        0.24 +
        0.10 *
          Math.sin(
            t * 4.7 + 0.7
          ),

      high:
        0.12 +
        0.07 *
          Math.sin(
            t * 7.9 + 1.4
          ),

      centroid:
        1200 +
        650 *
          Math.sin(
            t * 2.6 + 0.5
          ),

      peak: level
    };
  }

  reset() {
    for (const v of VISEMES) {
      this.weights[v] = 0;
    }

    this.openness = 0;
    this.energy = 0;
    this.lowEnergy = 0;
    this.midEnergy = 0;
    this.highEnergy = 0;
  }
}