/**
 * Idle Animation Engine
 *
 * Compatibil cu VRM 0.x / VRoid.
 *
 * Blink morph-uri:
 *   Blink
 *   Blink_L
 *   Blink_R
 *
 * IMPORTANT:
 *   EYE_Close_L / EYE_Close_R sunt tratate ca expresii
 *   de wink/close special și NU sunt folosite pentru clipitul
 *   normal.
 *
 * Animația rămâne discretă:
 * - blink natural
 * - respirație
 * - micro head motion
 * - mici variații în timpul vorbirii
 */

const BLINK_NAMES = {
  both: ['Blink'],
  left: ['Blink_L', 'blinkLeft'],
  right: ['Blink_R', 'blinkRight']
};

export class IdleEngine {
  constructor(stage) {
    this.stage = stage;

    this.intensity = 0.85;
    this.reduceMotion = false;

    this.t =
      Math.random() * 100;

    // Blink
    this.blinkTimer =
      1 +
      Math.random() * 2;

    this.blinkPhase = 0;
    this.blinking = false;

    this.blinkKind =
      'both';

    this.blinkDuration =
      0.13;

    this.blinkElapsed =
      0;

    this.pendingDouble =
      false;
  }

  setIntensity(v) {
    this.intensity =
      Math.max(
        0,
        Math.min(1, v)
      );
  }

  setReduceMotion(v) {
    this.reduceMotion =
      !!v;
  }

  _resolveBlink(kind) {
    const candidates =
      BLINK_NAMES[kind] ||
      BLINK_NAMES.both;

    if (
      this.stage &&
      typeof this.stage.hasExpression ===
        'function'
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

  _writeBlink(out, kind, weight) {
    const resolved =
      this._resolveBlink(kind);

    if (resolved) {
      out[resolved] =
        Math.max(
          out[resolved] || 0,
          weight
        );

      return;
    }

    /**
     * Fallback semantic names pentru Stage-uri
     * mai vechi.
     */
    if (kind === 'left') {
      if (
        this.stage &&
        typeof this.stage.hasExpression ===
          'function' &&
        this.stage.hasExpression(
          'blinkLeft'
        )
      ) {
        out.blinkLeft =
          weight;
      } else {
        out.blink =
          weight;
      }

      return;
    }

    if (kind === 'right') {
      if (
        this.stage &&
        typeof this.stage.hasExpression ===
          'function' &&
        this.stage.hasExpression(
          'blinkRight'
        )
      ) {
        out.blinkRight =
          weight;
      } else {
        out.blink =
          weight;
      }

      return;
    }

    out.blink =
      weight;
  }

  update(dt, out, talking) {
    this.t += dt;

    this._updateBlink(
      dt,
      out,
      talking
    );

    const amp =
      this.reduceMotion
        ? 0
        : this.intensity;

    const t = this.t;

    /**
     * Respirație.
     *
     * Este foarte mică deoarece modelele sunt VRoid
     * și nu vrem deformări corporale evidente.
     */
    const breathPhase =
      Math.sin(t * 0.62);

    const breath =
      breathPhase *
      (
        0.008 +
        0.010 * amp
      );

    /**
     * Micro head sway.
     */
    const sway = {
      yaw:
        (
          Math.sin(
            t * 0.31
          ) *
          0.6 +
          Math.sin(
            t * 0.13 + 2.1
          ) *
          0.4
        ) *
        0.022 *
        amp,

      pitch:
        (
          Math.sin(
            t * 0.27 + 1.4
          ) *
          0.5 +
          Math.sin(
            t * 0.11
          ) *
          0.5
        ) *
        0.016 *
        amp,

      roll:
        Math.sin(
          t * 0.19 + 0.7
        ) *
        0.012 *
        amp
    };

    /**
     * În timpul vorbirii, capul răspunde ușor la ritm.
     */
    if (talking) {
      sway.pitch +=
        Math.sin(
          t * 2.7
        ) *
        0.010 *
        amp;

      sway.yaw +=
        Math.sin(
          t * 1.9 + 0.5
        ) *
        0.008 *
        amp;
    }

    return {
      sway,
      breath
    };
  }

  _updateBlink(
    dt,
    out,
    talking
  ) {
    if (this.blinking) {
      this.blinkElapsed += dt;

      const p =
        Math.min(
          1,
          this.blinkElapsed /
            this.blinkDuration
        );

      /**
       * 35% closing
       * 65% opening
       */
      const w =
        p < 0.35
          ? p / 0.35
          : 1 -
            (
              p - 0.35
            ) /
              0.65;

      const weight =
        Math.max(
          0,
          Math.min(1, w)
        );

      /**
       * Exact VRM morph:
       *
       * both -> Blink
       * left  -> Blink_L
       * right -> Blink_R
       */
      this._writeBlink(
        out,
        this.blinkKind,
        weight
      );

      if (p >= 1) {
        this.blinking =
          false;

        this.blinkElapsed =
          0;

        if (
          this.pendingDouble
        ) {
          this.pendingDouble =
            false;

          this.blinkTimer =
            0.12;
        } else {
          this.blinkTimer =
            this._nextBlinkDelay(
              talking
            );
        }
      }

      return;
    }

    this.blinkTimer -= dt;

    if (
      this.blinkTimer <= 0
    ) {
      this.blinking =
        true;

      this.blinkElapsed =
        0;

      this.blinkDuration =
        0.10 +
        Math.random() * 0.06;

      const r =
        Math.random();

      /**
       * Wink rar.
       *
       * Modelele tale au Blink_L / Blink_R,
       * deci le putem folosi direct.
       */
      this.blinkKind =
        r < 0.04
          ? 'left'
          : r < 0.07
            ? 'right'
            : 'both';

      this.pendingDouble =
        Math.random() <
        0.16;
    }
  }

  _nextBlinkDelay(talking) {
    /**
     * Puțin mai des în timpul vorbirii.
     */
    const base =
      talking
        ? 1.6
        : 2.4;

    return (
      base +
      Math.random() *
        (
          talking
            ? 2.6
            : 4.2
        )
    );
  }
}