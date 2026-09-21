import * as THREE from 'three';

/**
 * Gaze Engine
 *
 * Compatibil cu VRM 0.x / VRoid:
 *   J_Adj_L_FaceEye
 *   J_Adj_R_FaceEye
 *
 * Modelele analizate au o mișcare realistă disponibilă aproximativ:
 *   orizontal: ±8 ... ±12°
 *   vertical : ±10°
 *
 * De aceea nu mai trimitem ținte de ±35 / ±25° către lookAt.
 *
 * Three-vrm / stage-ul este responsabil pentru maparea lookTarget
 * la eye bones.
 */
export class GazeEngine {
  constructor(stage) {
    this.stage = stage;

    this.enabled = true;
    this.intensity = 1;

    // Limite VRM reale.
    this.eyeYawLimit = 10.0;
    this.eyePitchLimit = 9.0;

    this.aiYaw = 0;
    this.aiPitch = 0;

    this.saccadeYaw = 0;
    this.saccadePitch = 0;

    this.currentYaw = 0;
    this.currentPitch = 0;

    this.nextSaccade = 1.2;
    this.timer = 0;

    this.lockUser = 0;

    this._tmp = new THREE.Vector3();
    this._headPos = new THREE.Vector3();

    this.distance = 1.0;

    // Doar o fracțiune din privire ajunge în cap.
    this.headFollowYaw = 0.18;
    this.headFollowPitch = 0.15;
  }

  setEnabled(v) {
    this.enabled = !!v;
  }

  setIntensity(v) {
    this.intensity = Math.max(
      0,
      Math.min(1, v)
    );
  }

  setAiTarget(yawDeg, pitchDeg) {
    this.aiYaw = THREE.MathUtils.clamp(
      Number(yawDeg) || 0,
      -this.eyeYawLimit,
      this.eyeYawLimit
    );

    this.aiPitch = THREE.MathUtils.clamp(
      Number(pitchDeg) || 0,
      -this.eyePitchLimit,
      this.eyePitchLimit
    );
  }

  setBehavior(behavior) {
    switch (behavior) {
      case 'look_at_user':
        this.aiYaw = 0;
        this.aiPitch = 0;

        this.saccadeYaw = 0;
        this.saccadePitch = 0;

        this.lockUser = 1.6;
        break;

      case 'look_away': {
        const side =
          Math.random() < 0.5
            ? -1
            : 1;

        this.saccadeYaw =
          side *
          (
            3.0 +
            Math.random() * 4.5
          );

        this.saccadePitch =
          1.5 +
          Math.random() * 2.5;

        this.nextSaccade =
          1.8;
        break;
      }

      case 'think':
        this.saccadeYaw =
          -(
            3.5 +
            Math.random() * 4
          );

        this.saccadePitch =
          -(
            2.5 +
            Math.random() * 3
          );

        this.nextSaccade =
          2.2;
        break;
    }
  }

  update(dt, talking) {
    const frame = Math.min(
      0.05,
      Math.max(0.001, dt)
    );

    this.timer += frame;

    if (this.lockUser > 0) {
      this.lockUser -= frame;
    }

    /**
     * Saccade scheduling.
     *
     * În loc de salturi mari, utilizăm deviații mici
     * compatibile cu amplitudinea eye bones.
     */
    if (
      this.enabled &&
      this.lockUser <= 0 &&
      this.timer >= this.nextSaccade
    ) {
      this.timer = 0;

      const big =
        Math.random() <
        (talking ? 0.08 : 0.16);

      const range =
        big ? 7.0 : 2.6;

      this.saccadeYaw =
        (
          Math.random() * 2 - 1
        ) *
        range *
        this.intensity;

      this.saccadePitch =
        (
          Math.random() * 2 - 1
        ) *
        range *
        0.55 *
        this.intensity;

      this.nextSaccade =
        talking
          ? 0.9 +
            Math.random() * 1.8
          : 1.4 +
            Math.random() * 3.2;

      /**
       * Majoritatea saccadelor trebuie să fie micro.
       */
      if (
        Math.random() <
        (talking ? 0.52 : 0.38)
      ) {
        this.saccadeYaw *= 0.25;
        this.saccadePitch *= 0.25;
      }
    }

    let targetYaw =
      this.aiYaw +
      (
        this.enabled
          ? this.saccadeYaw
          : 0
      );

    let targetPitch =
      this.aiPitch +
      (
        this.enabled
          ? this.saccadePitch
          : 0
      );

    /**
     * Hard clamp la capacitatea reală a eye bones.
     */
    targetYaw =
      THREE.MathUtils.clamp(
        targetYaw,
        -this.eyeYawLimit,
        this.eyeYawLimit
      );

    targetPitch =
      THREE.MathUtils.clamp(
        targetPitch,
        -this.eyePitchLimit,
        this.eyePitchLimit
      );

    /**
     * Eyes:
     * rapid, dar elastic.
     */
    const eyeK =
      1 -
      Math.pow(
        0.0006,
        frame
      );

    this.currentYaw +=
      (
        targetYaw -
        this.currentYaw
      ) *
      eyeK;

    this.currentPitch +=
      (
        targetPitch -
        this.currentPitch
      ) *
      eyeK;

    this._applyTarget();

    /**
     * Capul urmează doar puțin.
     *
     * Important:
     * nu transformăm o mișcare a ochilor într-o rotație mare
     * a capului.
     */
    return {
      yaw:
        THREE.MathUtils.degToRad(
          this.currentYaw
        ) *
        this.headFollowYaw,

      pitch:
        THREE.MathUtils.degToRad(
          this.currentPitch
        ) *
        this.headFollowPitch
    };
  }

  _applyTarget() {
    const stage = this.stage;

    if (
      !stage ||
      !stage.vrm ||
      !stage.lookTarget
    ) {
      return;
    }

    const head =
      stage.bone('head');

    if (!head) {
      return;
    }

    head.getWorldPosition(
      this._headPos
    );

    const dist =
      Math.max(
        0.4,
        stage.camera.position.distanceTo(
          this._headPos
        )
      );

    this.distance = dist;

    const yaw =
      THREE.MathUtils.degToRad(
        this.currentYaw
      );

    const pitch =
      THREE.MathUtils.degToRad(
        this.currentPitch
      );

    /**
     * lookTarget este mutat în spațiul scenei.
     * Three-vrm va folosi eye bones:
     *   J_Adj_L_FaceEye
     *   J_Adj_R_FaceEye
     */
    this._tmp.set(
      this._headPos.x +
        Math.sin(yaw) * dist,

      this._headPos.y -
        Math.sin(pitch) * dist,

      this._headPos.z +
        Math.cos(yaw) * dist
    );

    stage.lookTarget.position.copy(
      this._tmp
    );
  }
}