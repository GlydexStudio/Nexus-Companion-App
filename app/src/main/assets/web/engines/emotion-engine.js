/**
 * Emotion Engine
 *
 * Compatibil cu morph-urile reale ale modelelor VRM:
 *
 *   neutral   -> Neutral
 *   relaxed   -> Fun
 *   happy     -> Joy
 *   sad       -> Sorrow
 *   angry     -> Angry
 *   surprised -> Surprised
 *
 * Nu combinăm expresiile complete cu BRW/EYE/MTH pentru aceeași
 * emoție, deoarece expresiile complete conțin deja aceste componente.
 */

const EMOTIONS = [
  'neutral',
  'relaxed',
  'happy',
  'sad',
  'angry'
];

const VRM_EMOTION_NAMES = {
  neutral: ['Neutral', 'neutral'],
  relaxed: ['Fun', 'relaxed'],
  happy: ['Joy', 'happy'],
  sad: ['Sorrow', 'sad'],
  angry: ['Angry', 'angry']
};

export class EmotionEngine {
  constructor(stage) {
    this.stage = stage;

    this.current = {
      neutral: 0,
      relaxed: 0,
      happy: 0,
      sad: 0,
      angry: 0
    };

    this.target = {
      neutral: 0,
      relaxed: 0.12,
      happy: 0,
      sad: 0,
      angry: 0
    };

    this.behavior = 'idle';
    this.behaviorTime = 0;
    this.behaviorDuration = 0;

    this.talking = false;
    this.intensityScale = 1;
    this.t = 0;
  }

  _resolveExpression(candidates) {
    if (
      this.stage &&
      typeof this.stage.hasExpression === 'function'
    ) {
      for (const name of candidates) {
        if (
          this.stage.hasExpression(name)
        ) {
          return name;
        }
      }
    }

    return null;
  }

  _writeEmotion(out, semantic, value) {
    if (value <= 0.001) return;

    const candidates =
      VRM_EMOTION_NAMES[semantic] ||
      [semantic];

    const resolved =
      this._resolveExpression(
        candidates
      );

    if (resolved) {
      out[resolved] =
        (out[resolved] || 0) +
        value;
    } else {
      /**
       * Fallback pentru un Stage care încă face mapping
       * semantic -> VRM.
       */
      out[semantic] =
        (out[semantic] || 0) +
        value;
    }
  }

  _writeMorph(out, candidates, value) {
    if (value <= 0.001) return;

    const resolved =
      this._resolveExpression(
        candidates
      );

    if (resolved) {
      out[resolved] =
        (out[resolved] || 0) +
        value;
    }
  }

  setEmotion(
    emotion,
    intensity
  ) {
    const name =
      EMOTIONS.includes(emotion)
        ? emotion
        : 'neutral';

    const value =
      Math.max(
        0,
        Math.min(
          1,
          intensity == null
            ? 0.6
            : intensity
        )
      );

    EMOTIONS.forEach(
      (e) => {
        this.target[e] = 0;
      }
    );

    if (name === 'neutral') {
      /**
       * Neutral-ul nu trebuie să facă fața complet rigidă.
       * Fun este folosit doar ca micro "alive state".
       */
      this.target.relaxed =
        0.10 +
        value * 0.12;
    } else {
      this.target[name] = value;

      /**
       * Joy primește puțin Fun pentru continuitate.
       */
      if (name === 'happy') {
        this.target.relaxed =
          value * 0.18;
      }
    }
  }

  setBehavior(behavior) {
    this.behavior =
      behavior || 'idle';

    this.behaviorTime = 0;

    switch (this.behavior) {
      case 'laugh':
        this.behaviorDuration = 2.1;
        break;

      case 'surprised':
        this.behaviorDuration = 1.3;
        break;

      case 'think':
        this.behaviorDuration = 2.6;
        break;

      case 'concerned':
        this.behaviorDuration = 2.4;
        break;

      case 'look_away':
        this.behaviorDuration = 2.0;
        break;

      case 'look_at_user':
        this.behaviorDuration = 1.4;
        break;

      default:
        this.behaviorDuration = 0;
        break;
    }
  }

  setTalking(v) {
    this.talking = !!v;
  }

  setIntensityScale(v) {
    this.intensityScale =
      Math.max(
        0,
        Math.min(
          1,
          v
        )
      );
  }

  update(dt, out) {
    this.t += dt;

    if (
      this.behaviorDuration > 0
    ) {
      this.behaviorTime += dt;

      if (
        this.behaviorTime >
        this.behaviorDuration
      ) {
        this.behavior =
          'idle';

        this.behaviorDuration =
          0;
      }
    }

    const speed =
      1 -
      Math.pow(
        0.002,
        dt
      );

    EMOTIONS.forEach(
      (e) => {
        this.current[e] +=
          (
            this.target[e] -
            this.current[e]
          ) *
          speed;
      }
    );

    const scale =
      0.35 +
      0.65 *
        this.intensityScale;

    /**
     * În timpul vorbirii nu vrem ca Joy/Angry să lupte
     * agresiv cu morph-urile A/I/U/E/O.
     */
    const talkDamp =
      this.talking
        ? 0.62
        : 1;

    for (const e of EMOTIONS) {
      const v =
        this.current[e] *
        scale *
        (
          e === 'happy' ||
          e === 'angry'
            ? talkDamp
            : 1
        );

      this._writeEmotion(
        out,
        e,
        v
      );
    }

    const p =
      this.behaviorDuration > 0
        ? Math.sin(
            (
              this.behaviorTime /
              this.behaviorDuration
            ) *
            Math.PI
          )
        : 0;

    /**
     * LAUGH
     *
     * Joy este expresia completă.
     * Pentru gură adăugăm A doar când Nu vorbește,
     * ca să nu se bată cu lip-sync-ul.
     */
    if (
      this.behavior === 'laugh' &&
      p > 0
    ) {
      this._writeEmotion(
        out,
        'happy',
        p *
          0.45 *
          scale
      );

      if (!this.talking) {
        this._writeMorph(
          out,
          ['A', 'aa'],
          p * 0.18
        );
      }
    }

    /**
     * SURPRISED
     *
     * Dante are Surprised custom "unknown", iar
     * Nexus/Lyra îl au de asemenea ca expresie.
     *
     * Dacă expresia există, o folosim.
     * Altfel facem fallback la OH + EYE_Surprised.
     */
    else if (
      this.behavior === 'surprised' &&
      p > 0
    ) {
      const surprised =
        this._resolveExpression([
          'Surprised',
          'surprised'
        ]);

      if (surprised) {
        out[surprised] =
          Math.min(
            1,
            p *
              0.70 *
              scale
          );
      } else if (!this.talking) {
        this._writeMorph(
          out,
          ['O', 'oh'],
          p * 0.32
        );

        this._writeMorph(
          out,
          ['EYE_Surprised'],
          p * 0.35
        );
      }
    }

    /**
     * CONCERNED
     *
     * Folosim Sorrow ca expresie completă.
     */
    else if (
      this.behavior === 'concerned' &&
      p > 0
    ) {
      this._writeEmotion(
        out,
        'sad',
        p *
          0.30 *
          scale
      );
    }

    /**
     * THINK
     *
     * Doar o urmă de Fun, fără să adăugăm separat
     * BRW/EYE/MTH care ar putea dubla expresia.
     */
    else if (
      this.behavior === 'think' &&
      p > 0
    ) {
      this._writeEmotion(
        out,
        'relaxed',
        p *
          0.18 *
          scale
      );
    }

    return out;
  }

  /**
   * Offset de cap pentru comportamente.
   * Valorile sunt intenționat mici.
   */
  headOffset() {
    if (
      this.behaviorDuration <= 0
    ) {
      return null;
    }

    const prog =
      this.behaviorTime /
      this.behaviorDuration;

    const p =
      Math.sin(
        prog * Math.PI
      );

    switch (this.behavior) {
      case 'laugh':
        return {
          pitch:
            -0.10 * p +
            Math.sin(
              this.t * 11
            ) *
            0.015 *
            p,

          yaw: 0,
          roll:
            0.03 * p
        };

      case 'think':
        return {
          pitch:
            0.06 * p,

          yaw:
            -0.13 * p,

          roll:
            0.05 * p
        };

      case 'surprised':
        return {
          pitch:
            -0.07 * p,

          yaw: 0,
          roll: 0
        };

      case 'concerned':
        return {
          pitch:
            0.05 * p,

          yaw: 0,

          roll:
            -0.04 * p
        };

      case 'look_away':
        return {
          pitch:
            0.02 * p,

          yaw:
            0.16 * p,

          roll: 0
        };

      default:
        return null;
    }
  }
}