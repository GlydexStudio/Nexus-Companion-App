import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

/**
 * Nexus VRM stage.
 * Expression lookup is dynamic so VRoid/VRM 0.x morphs such as A/I/U/E/O,
 * Joy/Fun/Sorrow/Angry/Surprised and Blink_L/R are never lost by a small cache.
 */
export class VRMStage {
  constructor(canvas) {
    this.canvas = canvas;
    this.vrm = null;
    this.clock = new THREE.Clock();
    this.running = false;
    this.updaters = [];
    this._appliedExpressions = new Set();
    this._frameHandle = null;
    this._pixelRatioCap = Math.min(window.devicePixelRatio || 1, 2);
    this._renderRatio = this._pixelRatioCap;
    this._perf = { acc: 0, frames: 0 };

    this.framing = {
      headroom: 0.10,
      belowChest: 0.45,
      faceWidthRatio: 0.66,
      maxHairSpill: 1.15,
      keepAboveHips: true,
      fov: 26
    };
    this.headMetrics = null;

    this._initRenderer();
    this._initScene();
    this._initLights();
    this._observeResize();
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: window.devicePixelRatio < 2,
      alpha: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false
    });
    this.renderer.setClearColor(0x06070a, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = false;
    this._applySize();
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.camera = new THREE.PerspectiveCamera(this.framing.fov, this._aspect(), 0.05, 20);
    this.camera.position.set(0, 1.35, 0.9);
    this.lookTarget = new THREE.Object3D();
    this.lookTarget.position.set(0, 1.35, 1.2);
    this.scene.add(this.lookTarget);
    this._cameraTarget = new THREE.Vector3(0, 1.35, 0);
    this._cameraBase = new THREE.Vector3(0, 1.35, 0.9);
  }

  _initLights() {
    this.scene.add(new THREE.HemisphereLight(0xa8c4ff, 0x0c0f16, 0.62));
    const key = new THREE.DirectionalLight(0xfff4e8, 1.15); key.position.set(0.9, 1.9, 1.6); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcd4ff, 0.42); fill.position.set(-1.4, 1.1, 1.0); this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0x9fc0ff, 0.85); rim.position.set(-0.6, 1.7, -1.8); this.scene.add(rim);
  }

  _aspect() {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    return w / h;
  }

  _applySize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.renderer.setPixelRatio(this._renderRatio);
    this.renderer.setSize(w, h, false);
  }

  _adaptQuality(dt) {
    const p = this._perf; p.acc += dt; p.frames++;
    if (p.acc < 2) return;
    const avg = p.acc / p.frames; p.acc = 0; p.frames = 0;
    if (avg > 0.032 && this._renderRatio > 1) { this._renderRatio = Math.max(1, this._renderRatio - 0.25); this._applySize(); }
    else if (avg < 0.019 && this._renderRatio < this._pixelRatioCap) { this._renderRatio = Math.min(this._pixelRatioCap, this._renderRatio + 0.25); this._applySize(); }
  }

  _observeResize() {
    this._onResize = () => { this._applySize(); this.camera.aspect = this._aspect(); this.camera.updateProjectionMatrix(); this.frameCamera(); };
    window.addEventListener('resize', this._onResize, { passive: true });
    window.addEventListener('orientationchange', this._onResize, { passive: true });
  }

  async load(url, onProgress) {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url, (e) => { if (onProgress && e.total) onProgress(Math.min(1, e.loaded / e.total)); });
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error('fisierul nu contine date VRM');

    try { VRMUtils.removeUnnecessaryVertices(gltf.scene); } catch (_) {}
    try { VRMUtils.removeUnnecessaryJoints(gltf.scene); } catch (_) {}
    try { VRMUtils.rotateVRM0(vrm); } catch (_) {}

    vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
      if (obj.isMesh && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => { if (m) m.depthWrite = true; });
      }
    });

    if (this.vrm) this.unload();
    this.vrm = vrm;
    this.scene.add(vrm.scene);
    this._appliedExpressions.clear();

    if (vrm.lookAt) {
      vrm.lookAt.target = this.lookTarget;
      vrm.lookAt.autoUpdate = true;
    }

    this.applyAPose();
    this.headMetrics = this._measureHead();
    this.frameCamera();
    return vrm;
  }

  hasExpression(name) {
    const em = this.vrm && this.vrm.expressionManager;
    if (!em || !name) return false;
    try { return !!em.getExpression(name); } catch (_) { return false; }
  }

  /**
   * Stable A-pose for VRoid-style humanoids.
   * Arms are rotated down from T-pose around local Z. Lower arms remain relaxed.
   */
  applyAPose() {
    if (!this.vrm || !this.vrm.humanoid) return;
    const left = this.bone('leftUpperArm');
    const right = this.bone('rightUpperArm');
    const leftLower = this.bone('leftLowerArm');
    const rightLower = this.bone('rightLowerArm');
    if (left) left.rotation.set(0, 0, THREE.MathUtils.degToRad(36));
    if (right) right.rotation.set(0, 0, THREE.MathUtils.degToRad(-36));
    if (leftLower) leftLower.rotation.set(0, 0, 0);
    if (rightLower) rightLower.rotation.set(0, 0, 0);
  }

  _measureHead() {
    const vrm = this.vrm;
    if (!vrm || !vrm.humanoid) return null;
    const rawHead = (vrm.humanoid.getRawBoneNode && vrm.humanoid.getRawBoneNode('head')) || (vrm.humanoid.getBoneNode && vrm.humanoid.getBoneNode('head'));
    if (!rawHead) return null;
    const headNodes = new Set(); rawHead.traverse((n) => headNodes.add(n));
    const box = new THREE.Box3(); const v = new THREE.Vector3(); let found = 0;
    vrm.scene.updateWorldMatrix(true, true);
    vrm.scene.traverse((obj) => {
      if (!obj.isSkinnedMesh || !obj.geometry || !obj.skeleton) return;
      const pos = obj.geometry.attributes.position; const si = obj.geometry.attributes.skinIndex; const sw = obj.geometry.attributes.skinWeight;
      if (!pos || !si || !sw) return;
      const isHeadBone = obj.skeleton.bones.map((b) => headNodes.has(b));
      if (!isHeadBone.some(Boolean)) return;
      const stride = pos.count > 120000 ? Math.ceil(pos.count / 120000) : 1;
      for (let i = 0; i < pos.count; i += stride) {
        let best = -1, bestW = 0;
        for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bestW) { bestW = w; best = si.getComponent(i, k); } }
        if (best < 0 || bestW <= 0 || !isHeadBone[best]) continue;
        v.fromBufferAttribute(pos, i);
        if (obj.applyBoneTransform) obj.applyBoneTransform(i, v); else if (obj.boneTransform) obj.boneTransform(i, v);
        obj.localToWorld(v); box.expandByPoint(v); found++;
      }
    });
    if (found < 20 || box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3()); const center = box.getCenter(new THREE.Vector3());
    let faceWidth = size.x * 0.62;
    const eyeL = this._rawBone('leftEye'); const eyeR = this._rawBone('rightEye');
    if (eyeL && eyeR) { const a = eyeL.getWorldPosition(new THREE.Vector3()); const b = eyeR.getWorldPosition(new THREE.Vector3()); const ipd = a.distanceTo(b); if (ipd > 0.01) faceWidth = Math.min(size.x, Math.max(size.x * 0.42, ipd * 2.6)); }
    return { width: Math.max(0.02, size.x), height: Math.max(0.02, size.y), faceWidth: Math.max(0.02, faceWidth), top: box.max.y, centerX: center.x, centerZ: center.z };
  }

  _rawBone(name) {
    const h = this.vrm && this.vrm.humanoid; if (!h) return null;
    try { if (h.getRawBoneNode) return h.getRawBoneNode(name); if (h.getBoneNode) return h.getBoneNode(name); } catch (_) {}
    return null;
  }

  bone(name) {
    if (!this.vrm || !this.vrm.humanoid) return null;
    try { return this.vrm.humanoid.getNormalizedBoneNode(name); } catch (_) { return null; }
  }

  frameCamera() {
    if (!this.vrm) return;
    this.vrm.scene.updateWorldMatrix(true, true);
    const head = this.bone('head'); if (!head) return;
    const chest = this.bone('upperChest') || this.bone('chest') || this.bone('spine');
    const headPos = new THREE.Vector3(); head.getWorldPosition(headPos);
    const chestPos = new THREE.Vector3(); chest ? chest.getWorldPosition(chestPos) : chestPos.set(headPos.x, headPos.y - 0.22, headPos.z);
    const unit = Math.max(0.08, headPos.y - chestPos.y); const f = this.framing; const aspect = this._aspect(); const m = this.headMetrics;
    const headTop = m ? m.top : headPos.y + unit * 0.56; const faceWidth = m ? m.faceWidth : unit * 0.62; const centerX = m ? m.centerX : headPos.x;
    const frameBottom = chestPos.y - unit * f.belowChest; let visibleHeight = (headTop - frameBottom) / (1 - f.headroom);
    let minWidth = faceWidth / f.faceWidthRatio; if (m && m.width > 0) minWidth = Math.max(minWidth, m.width / f.maxHairSpill); if (visibleHeight * aspect < minWidth) visibleHeight = minWidth / aspect;
    const hips = this._rawBone('hips'); if (f.keepAboveHips && hips) { const hipsY = hips.getWorldPosition(new THREE.Vector3()).y; const maxHeight = (headTop - hipsY) / (1 - f.headroom); if (maxHeight > unit * 1.5) visibleHeight = Math.min(visibleHeight, maxHeight); }
    const fovRad = (this.camera.fov * Math.PI) / 180; const distance = (visibleHeight / 2) / Math.tan(fovRad / 2);
    const targetY = headTop + f.headroom * visibleHeight - visibleHeight * 0.5;
    this._cameraTarget.set(centerX, targetY, headPos.z); this._cameraBase.set(centerX, targetY + unit * 0.05, headPos.z + distance);
    this.camera.position.copy(this._cameraBase); this.camera.lookAt(this._cameraTarget);
    this.lookTarget.position.set(headPos.x, headPos.y, headPos.z + distance);
  }

  applyCameraDrift(amount, t) {
    if (!this._cameraBase) return;
    if (amount <= 0) this.camera.position.copy(this._cameraBase);
    else this.camera.position.set(this._cameraBase.x + Math.sin(t * 0.21) * 0.006 * amount, this._cameraBase.y + Math.sin(t * 0.17 + 1.3) * 0.004 * amount, this._cameraBase.z);
    this.camera.lookAt(this._cameraTarget);
  }

  applyExpressions(weights) {
    const em = this.vrm && this.vrm.expressionManager; if (!em) return;
    for (const key of Object.keys(weights)) this._appliedExpressions.add(key);
    for (const name of this._appliedExpressions) {
      const v = weights[name] == null ? 0 : THREE.MathUtils.clamp(Number(weights[name]) || 0, 0, 1);
      try { if (em.getExpression(name)) em.setValue(name, v); } catch (_) {}
    }
  }

  addUpdater(fn) { this.updaters.push(fn); }

  start() {
    if (this.running) return;
    this.running = true; this.clock.getDelta();
    const loop = () => {
      if (!this.running) return;
      this._frameHandle = requestAnimationFrame(loop);
      const dt = Math.min(0.05, this.clock.getDelta()); this._adaptQuality(dt);
      try {
        for (let i = 0; i < this.updaters.length; i++) this.updaters[i](dt);
        if (this.vrm) this.vrm.update(dt);
        this.renderer.render(this.scene, this.camera);
      } catch (err) {
        if (window.NexusNative && window.NexusNative.log) window.NexusNative.log('render error: ' + err.message);
      }
    };
    this._frameHandle = requestAnimationFrame(loop);
  }

  pause() { this.running = false; if (this._frameHandle) cancelAnimationFrame(this._frameHandle); this._frameHandle = null; }
  resume() { if (!this.running) this.start(); }

  unload() {
    if (!this.vrm) return;
    this.scene.remove(this.vrm.scene);
    try { VRMUtils.deepDispose(this.vrm.scene); } catch (_) {}
    this.vrm = null; this._appliedExpressions.clear();
  }

  dispose() { this.pause(); window.removeEventListener('resize', this._onResize); window.removeEventListener('orientationchange', this._onResize); this.unload(); try { this.renderer.dispose(); } catch (_) {} }
}
