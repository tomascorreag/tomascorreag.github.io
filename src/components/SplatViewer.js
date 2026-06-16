/**
 * SplatViewer — Self-contained Gaussian splat 3D viewer.
 *
 * Manages a Three.js renderer + Spark's SplatMesh inside a given container.
 * NOT a Sprite subclass — Sprites are 2D DOM elements positioned in a scene.
 * This is a full WebGL canvas with its own render loop.
 *
 * Lifecycle: mount(container, url, opts) → renders splat → destroy()
 *
 * Think of it like an embedded viewport in a game editor —
 * it has its own camera, scene, and render loop, but lives inside
 * a panel of the larger UI.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SplatMesh } from '@sparkjsdev/spark';
import { SPLAT_CONFIG, getQualityTier } from '../config/splats.js';

export class SplatViewer {
  constructor() {
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.splatMesh = null;
    this.resizeObserver = null;
    this.animFrameId = null;
    this.destroyed = false;
    this.needsRender = true;
    this.loaded = false;
  }

  /**
   * Mounts the viewer into a container element and loads a .spz splat.
   *
   * @param {HTMLElement} container - DOM element to fill with the WebGL canvas
   * @param {string} url - URL to the .spz file (Vite-resolved, hashed in prod)
   * @param {Object} [opts] - Optional overrides
   * @param {number[]} [opts.cameraPosition] - [x, y, z] override for initial camera
   * @param {Function} [opts.onLoad] - Called when splat finishes loading
   * @param {Function} [opts.onError] - Called with error if loading fails
   */
  mount(container, url, opts = {}) {
    const tier = getQualityTier();
    const { width, height } = container.getBoundingClientRect();

    // --- Renderer ---
    // alpha: true → transparent background so the page's dark bg shows through.
    // Like a render texture with a clear color of (0,0,0,0).
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,  // Splats are fuzzy by nature, AA is wasted work
      alpha: true,
    });
    this.renderer.setPixelRatio(tier.pixelRatio);
    this.renderer.setSize(width, height);
    container.appendChild(this.renderer.domElement);

    // --- Scene ---
    this.scene = new THREE.Scene();

    // --- Camera ---
    const camPos = opts.cameraPosition || SPLAT_CONFIG.defaultPosition;
    this.camera = new THREE.PerspectiveCamera(
      SPLAT_CONFIG.fov,
      width / height,
      SPLAT_CONFIG.near,
      SPLAT_CONFIG.far,
    );
    this.camera.position.set(...camPos);

    // --- Orbit Controls ---
    const orbitCfg = SPLAT_CONFIG.orbit;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = orbitCfg.enableDamping;
    this.controls.dampingFactor = orbitCfg.dampingFactor;
    this.controls.enablePan = orbitCfg.enablePan;
    this.controls.minDistance = orbitCfg.minDistance;
    this.controls.maxDistance = orbitCfg.maxDistance;
    this.controls.autoRotate = orbitCfg.autoRotate;
    this.controls.autoRotateSpeed = orbitCfg.autoRotateSpeed;

    // Render-on-demand dirty flag. OrbitControls fires 'change' whenever it
    // actually moves the camera (drag, zoom, damping inertia) — that's our
    // "scene is dirty" signal.
    this.controls.addEventListener('change', () => { this.needsRender = true; });

    // --- Splat Mesh ---
    // SplatMesh handles loading + rendering. Pass url directly —
    // it fetches, decodes, and builds the GPU buffers internally.
    this.splatMesh = new SplatMesh({
      url,
      maxSh: tier.maxSh,
      onLoad: () => {
        this.loaded = true;
        this.needsRender = true;
        if (!this.destroyed && opts.onLoad) opts.onLoad();
      },
      onError: (err) => {
        console.error('Gaussian splat load failed:', err);
        if (!this.destroyed && opts.onError) opts.onError(err);
      },
    });
    this.scene.add(this.splatMesh);

    // --- Resize Observer ---
    // Watches the container (not window) since this isn't fullscreen.
    // Like a viewport resize callback in a docked editor panel.
    this.resizeObserver = new ResizeObserver((entries) => {
      if (this.destroyed || !this.camera || !this.renderer) return;
      const { width: w, height: h } = entries[0].contentRect;
      if (w === 0 || h === 0) return; // Container collapsed, skip
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.needsRender = true;
    });
    this.resizeObserver.observe(container);

    // --- Render Loop (on demand) ---
    // The rAF tick always runs (it's cheap), but GPU work only happens when
    // something changed — like a game editor viewport that re-renders on
    // input instead of free-running. An idle splat costs ~zero GPU/battery.
    //
    // controls.update() must run every tick so damping inertia plays out; in
    // three r182 it returns true exactly when it moved the camera (and fires
    // 'change'), so either signal marks the frame dirty. Until the splat
    // finishes loading we render unconditionally — Spark builds GPU buffers
    // progressively and there's no change event for that.
    const clock = new THREE.Clock();
    const animate = () => {
      if (this.destroyed) return;
      this.animFrameId = requestAnimationFrame(animate);

      const moved = this.controls.update();

      if (moved || this.needsRender || !this.loaded) {
        this.needsRender = false;
        // Spark needs the clock delta for internal animations
        const delta = clock.getDelta();
        if (this.splatMesh) {
          this.splatMesh.update(this.renderer, this.camera, delta);
        }
        this.renderer.render(this.scene, this.camera);
      }
    };
    animate();
  }

  /**
   * Tears down everything — renderer, controls, splat, canvas, observers.
   *
   * WebGL contexts are a limited resource (~8-16 per browser tab).
   * Not calling destroy = context leak. Like not calling Destroy()
   * on a RenderTexture in Unity — the GPU memory stays allocated.
   */
  destroy() {
    this.destroyed = true;

    if (this.animFrameId != null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }

    if (this.splatMesh) {
      this.scene.remove(this.splatMesh);
      this.splatMesh.dispose();
      this.splatMesh = null;
    }

    if (this.renderer) {
      this.renderer.domElement.remove();
      this.renderer.dispose();
      // dispose() frees three's GPU resources but the context itself lives
      // until GC. Browsers cap WebGL contexts per tab (~8-16); force the
      // loss now so rapid open/close cycles can't exhaust the pool.
      this.renderer.forceContextLoss?.();
      this.renderer = null;
    }

    this.scene = null;
    this.camera = null;
  }
}
