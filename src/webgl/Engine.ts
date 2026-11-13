/**
 * NIGHTWNTR visual engine.
 *
 * A GPU particle cloud that lives in float textures:
 *   - positions and velocities are integrated in a fragment shader (MRT ping-pong)
 *   - home positions come from procedurally generated "formations"
 *   - ribbon trails are a second small simulation (history rows)
 *   - the frame is finished with a blur-pyramid bloom and a film grade
 *
 * The page drives it with three inputs: a scene position (from scroll),
 * the pointer, and occasional bursts. Everything else is self-contained.
 */
import * as THREE from 'three';
import { TIERS, detectTier, lowerTier, rendererName, type Tier, type TierName } from './quality';
import { SCENES, sceneFor, type SceneDef } from './scenes';
import { FULLSCREEN_VS } from './shaders/common';
import { FORMATION_COUNT, FORMATION_FS, FORMATION_NAMES, RANDOM_FS } from './shaders/formations';
import { BLOOM_DOWN_FS, BLOOM_PREFILTER_FS, BLOOM_UP_FS, COMPOSITE_FS } from './shaders/post';
import { DUST_VS, POINTS_FS, POINTS_VS, TRAIL_FS, TRAIL_VS } from './shaders/render';
import { PARTICLE_SIM_FS, TRAIL_SIM_FS } from './shaders/simulation';

export interface EngineStats {
  fps: number;
  particles: number;
  trails: number;
  tier: TierName;
  formation: string;
  renderScale: number;
  renderer: string;
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  /** prefers-reduced-motion: slow everything down and ignore the pointer */
  calm?: boolean;
  onStats?: (stats: EngineStats) => void;
  /** called when WebGL cannot continue and the CSS fallback should take over */
  onFail?: (reason: string) => void;
}

const FOV = 30;
const CAM_Z = 7.2;
const NUMERIC_KEYS: Array<keyof SceneDef> = ['x', 'y', 'z', 'scale', 'tiltX', 'tiltZ', 'spin', 'hue', 'alpha', 'size', 'turb', 'spring', 'free', 'trail', 'glow', 'aperture', 'bloom'];

const PALETTE = {
  violet: new THREE.Color('#7C3AED'),
  purple: new THREE.Color('#A78BFA'),
  cyan: new THREE.Color('#38BDF8'),
  ice: new THREE.Color('#BAE6FD'),
  bg: new THREE.Color('#050507'),
  bg2: new THREE.Color('#0A0812'),
};

type Uniforms = Record<string, THREE.IUniform>;

function rawMaterial(vertexShader: string, fragmentShader: string, uniforms: Uniforms, additive = false): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    transparent: additive,
    blending: additive ? THREE.CustomBlending : THREE.NoBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
  });
}

const paletteUniforms = (): Uniforms => ({
  uViolet: { value: PALETTE.violet },
  uPurple: { value: PALETTE.purple },
  uCyan: { value: PALETTE.cyan },
  uIce: { value: PALETTE.ice },
});

const easeInOut = (t: number): number => t * t * (3 - 2 * t);
const damp = (current: number, target: number, lambda: number, dt: number): number => current + (target - current) * (1 - Math.exp(-lambda * dt));

export class Engine {
  private canvas: HTMLCanvasElement;
  private opts: EngineOptions;
  private renderer!: THREE.WebGLRenderer;
  private tier!: Tier;
  private floatType: THREE.TextureDataType = THREE.FloatType;
  private hdrType: THREE.TextureDataType = THREE.HalfFloatType;
  private rendererLabel = '';

  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  private world = new THREE.Scene();
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad!: THREE.Mesh;

  private formations: THREE.WebGLRenderTarget[] = [];
  private randomRT!: THREE.WebGLRenderTarget;
  private simA!: THREE.WebGLRenderTarget;
  private simB!: THREE.WebGLRenderTarget;
  private trailA: THREE.WebGLRenderTarget | null = null;
  private trailB: THREE.WebGLRenderTarget | null = null;
  private sceneRT!: THREE.WebGLRenderTarget;
  private bloomRT: THREE.WebGLRenderTarget[] = [];
  private bloomUpRT: THREE.WebGLRenderTarget[] = [];

  private simMat!: THREE.RawShaderMaterial;
  private trailSimMat: THREE.RawShaderMaterial | null = null;
  private pointsMat!: THREE.RawShaderMaterial;
  private trailMat: THREE.RawShaderMaterial | null = null;
  private dustMat!: THREE.RawShaderMaterial;
  private prefilterMat!: THREE.RawShaderMaterial;
  private downMat!: THREE.RawShaderMaterial;
  private upMat!: THREE.RawShaderMaterial;
  private compositeMat!: THREE.RawShaderMaterial;
  private points!: THREE.Points;
  private disposables: Array<{ dispose(): void }> = [];

  private raf = 0;
  private running = false;
  private built = false;
  private lost = false;
  private disposed = false;
  private lastTime = 0;
  private time = 0;
  private frame = 0;
  private needsSeed = true;
  private intro = 0;
  private trailClock = 0;

  // sizes
  private width = 1;
  private height = 1;
  private renderScale = 1;
  private drawFraction = 1;
  private portrait = 0;

  // scene blending
  private sceneTarget = 0;
  private scenePos = 0;
  /** every scene keeps turning at its own pace, whether it is on stage or not */
  private spins = new Float32Array(SCENES.length);
  private matA = new THREE.Matrix4();
  private matB = new THREE.Matrix4();
  private current: SceneDef = { ...SCENES[0] };

  // pointer
  private pointerNdc = new THREE.Vector2(0, 0);
  private pointerSmooth = new THREE.Vector2(0, 0);
  private pointerSeen = false;
  private pointerLastMove = -10;
  private pointerPresence = 0;
  private press = 0;
  private pressTarget = 0;
  private rayO = new THREE.Vector3();
  private rayD = new THREE.Vector3(0, 0, -1);
  private pointerWorld = new THREE.Vector3();
  private pointerWorldPrev = new THREE.Vector3();
  private pointerVel = new THREE.Vector3();
  private tilt = new THREE.Vector2(0, 0);
  private burstAmount = 0;
  private burstCenter = new THREE.Vector3();
  private center = new THREE.Vector3();

  // performance watch
  private fpsSmooth = 60;
  private perfFrames = 0;
  private perfTime = 0;
  private perfGrace = 90;
  private statsClock = 0;

  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private tmpW = new THREE.Vector3();
  private tmpE = new THREE.Euler();
  private tmpQ = new THREE.Quaternion();

  constructor(opts: EngineOptions) {
    this.opts = opts;
    this.canvas = opts.canvas;
    this.canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.build();
  }

  /* --------------------------------------------------------------- set-up */

  private build(): void {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer = renderer;
    renderer.autoClear = false;
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 1);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.debug.checkShaderErrors = import.meta.env.DEV;

    const gl = renderer.getContext() as WebGL2RenderingContext;
    this.rendererLabel = rendererName(gl);
    const float32 = this.canRenderTo(gl, gl.RGBA32F, gl.FLOAT);
    const float16 = this.canRenderTo(gl, gl.RGBA16F, gl.HALF_FLOAT);
    if (!float32 && !float16) throw new Error('float render targets are not supported');
    this.floatType = float32 ? THREE.FloatType : THREE.HalfFloatType;
    this.hdrType = float16 ? THREE.HalfFloatType : THREE.UnsignedByteType;

    this.tier = this.tier ?? detectTier(gl);
    this.quad = new THREE.Mesh(this.track(this.fullscreenTriangle()));
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.camera.position.set(0, 0, CAM_Z);
    this.camera.lookAt(0, 0, 0);

    this.buildSimulation();
    this.buildTrails();
    this.buildDust();
    this.buildPost();
    this.resize(true);

    this.needsSeed = true;
    this.intro = 0;
    this.built = true;
  }

  private track<T extends { dispose(): void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  /** The reliable way to know if a float format can be rendered to: try it. */
  private canRenderTo(gl: WebGL2RenderingContext, internalFormat: number, type: number): boolean {
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_color_buffer_half_float');
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, gl.RGBA, type, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
    this.renderer.resetState();
    return ok;
  }

  private fullscreenTriangle(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    return g;
  }

  private dataTarget(w: number, h: number, count = 1): THREE.WebGLRenderTarget {
    return this.track(
      new THREE.WebGLRenderTarget(w, h, {
        count,
        type: this.floatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      }),
    );
  }

  private hdrTarget(w: number, h: number): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      type: this.hdrType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
  }

  private pass(material: THREE.Material, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  private buildSimulation(): void {
    const size = this.tier.simSize;

    // formations and per-particle randoms are computed once, on the GPU
    const formationMat = this.track(rawMaterial(FULLSCREEN_VS, FORMATION_FS, { uKind: { value: 0 }, uSize: { value: size } }));
    this.formations = [];
    for (let i = 0; i < FORMATION_COUNT; i++) {
      const rt = this.dataTarget(size, size);
      formationMat.uniforms.uKind.value = i;
      this.pass(formationMat, rt);
      this.formations.push(rt);
    }
    this.randomRT = this.dataTarget(size, size);
    this.pass(this.track(rawMaterial(FULLSCREEN_VS, RANDOM_FS, { uSize: { value: size } })), this.randomRT);

    this.simA = this.dataTarget(size, size, 2);
    this.simB = this.dataTarget(size, size, 2);

    this.simMat = this.track(
      rawMaterial(FULLSCREEN_VS, PARTICLE_SIM_FS, {
        tPos: { value: null },
        tVel: { value: null },
        tA: { value: this.formations[0].texture },
        tB: { value: this.formations[0].texture },
        tRand: { value: this.randomRT.texture },
        uMatA: { value: this.matA },
        uMatB: { value: this.matB },
        uMorph: { value: 0 },
        uTime: { value: 0 },
        uDt: { value: 1 / 60 },
        uSeed: { value: 1 },
        uIntro: { value: 0 },
        uSpring: { value: 3 },
        uTurb: { value: 0.5 },
        uFlowScale: { value: 0.55 },
        uDamp: { value: 2.4 },
        uFree: { value: 0.16 },
        uRayO: { value: this.rayO },
        uRayD: { value: this.rayD },
        uPointerVel: { value: this.pointerVel },
        uPointer: { value: 0 },
        uPress: { value: 0 },
        uRadius: { value: 0.5 },
        uBurst: { value: 0 },
        uBurstCenter: { value: this.burstCenter },
      }),
    );

    // one vertex per particle; its "position" is just the address of its texel
    const count = size * size;
    const refs = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      refs[i * 3] = ((i % size) + 0.5) / size;
      refs[i * 3 + 1] = (Math.floor(i / size) + 0.5) / size;
    }
    const geometry = this.track(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(refs, 3));

    this.pointsMat = this.track(
      rawMaterial(
        POINTS_VS,
        POINTS_FS,
        {
          ...paletteUniforms(),
          tPos: { value: null },
          tVel: { value: null },
          tA: { value: this.formations[0].texture },
          tB: { value: this.formations[0].texture },
          tRand: { value: this.randomRT.texture },
          uMorph: { value: 0 },
          uPx: { value: 1000 },
          uSize: { value: 0.012 },
          uFocus: { value: CAM_Z },
          uAperture: { value: 0.011 },
          uMaxSize: { value: 48 },
          uAlpha: { value: 0.1 },
          uHue: { value: 0 },
          uFree: { value: 0.16 },
          uGlow: { value: 0.35 },
        },
        true,
      ),
    );
    this.points = new THREE.Points(geometry, this.pointsMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1;
    this.world.add(this.points);
  }

  private buildTrails(): void {
    const { trailCount: rows, trailSegments: segs } = this.tier;
    if (!rows || this.opts.calm) return;

    this.trailA = this.dataTarget(segs, rows);
    this.trailB = this.dataTarget(segs, rows);
    this.trailSimMat = this.track(
      rawMaterial(FULLSCREEN_VS, TRAIL_SIM_FS, {
        tTrail: { value: null },
        tA: { value: this.formations[0].texture },
        tB: { value: this.formations[0].texture },
        uSimSize: { value: this.tier.simSize },
        uMatA: { value: this.matA },
        uMatB: { value: this.matB },
        uMorph: { value: 0 },
        uTime: { value: 0 },
        uSeed: { value: 1 },
        uTurb: { value: 1.1 },
        uFlowScale: { value: 0.5 },
        uSpring: { value: 3.2 },
        uPointerPos: { value: this.pointerWorld },
        uPointer: { value: 0 },
        uPress: { value: 0 },
        uChase: { value: 0.34 },
        uBurst: { value: 0 },
        uBurstCenter: { value: this.burstCenter },
      }),
    );

    // a strip of quads per trail: two vertices per segment
    const verts = new Float32Array(rows * segs * 2 * 3);
    const index = new Uint32Array(rows * (segs - 1) * 6);
    let v = 0;
    let k = 0;
    for (let r = 0; r < rows; r++) {
      for (let s = 0; s < segs; s++) {
        verts[v++] = s;
        verts[v++] = r;
        verts[v++] = -1;
        verts[v++] = s;
        verts[v++] = r;
        verts[v++] = 1;
        if (s < segs - 1) {
          const a = (r * segs + s) * 2;
          index[k++] = a;
          index[k++] = a + 1;
          index[k++] = a + 2;
          index[k++] = a + 1;
          index[k++] = a + 3;
          index[k++] = a + 2;
        }
      }
    }
    const geometry = this.track(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));

    this.trailMat = this.track(
      rawMaterial(
        TRAIL_VS,
        TRAIL_FS,
        {
          ...paletteUniforms(),
          tTrail: { value: null },
          uSegments: { value: segs },
          uFrac: { value: 0 },
          uViewport: { value: new THREE.Vector2(1, 1) },
          uPx: { value: 1000 },
          uWidth: { value: 0.011 },
          uAlpha: { value: 0.5 },
          uHue: { value: 0 },
          uFocus: { value: CAM_Z },
          uAperture: { value: 0.011 },
          uChase: { value: 0.34 },
          uPointer: { value: 0 },
        },
        true,
      ),
    );
    this.trailMat.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geometry, this.trailMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.world.add(mesh);
  }

  private buildDust(): void {
    const n = this.tier.dust;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 4);
    // deterministic scatter so the sky is the same on every visit
    let s = 1234567;
    const rnd = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rnd() - 0.5) * 26;
      pos[i * 3 + 1] = (rnd() - 0.5) * 14;
      pos[i * 3 + 2] = -9 + rnd() * 14;
      seed[i * 4] = rnd();
      seed[i * 4 + 1] = rnd();
      seed[i * 4 + 2] = rnd();
      seed[i * 4 + 3] = rnd();
    }
    const geometry = this.track(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.dustMat = this.track(
      rawMaterial(
        DUST_VS,
        POINTS_FS,
        {
          ...paletteUniforms(),
          uTime: { value: 0 },
          uPx: { value: 1000 },
          uFocus: { value: CAM_Z },
          uAperture: { value: 0.011 },
          uAlpha: { value: 0.7 },
        },
        true,
      ),
    );
    const dust = new THREE.Points(geometry, this.dustMat);
    dust.frustumCulled = false;
    dust.renderOrder = 0;
    this.world.add(dust);
  }

  private buildPost(): void {
    this.prefilterMat = this.track(
      rawMaterial(FULLSCREEN_VS, BLOOM_PREFILTER_FS, {
        tMap: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uThreshold: { value: 0.5 },
        uKnee: { value: 0.4 },
      }),
    );
    this.downMat = this.track(rawMaterial(FULLSCREEN_VS, BLOOM_DOWN_FS, { tMap: { value: null }, uTexel: { value: new THREE.Vector2() } }));
    this.upMat = this.track(
      rawMaterial(FULLSCREEN_VS, BLOOM_UP_FS, {
        tMap: { value: null },
        tBase: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uSpread: { value: 1 },
      }),
    );
    this.compositeMat = this.track(
      rawMaterial(FULLSCREEN_VS, COMPOSITE_FS, {
        tScene: { value: null },
        tBloom: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uFrame: { value: 0 },
        uBloom: { value: 0.85 },
        uExposure: { value: 1.0 },
        uFringe: { value: 0.006 },
        uGrain: { value: 0.035 },
        uVignette: { value: 0.62 },
        uHaze: { value: 0.013 },
        uGlowPos: { value: new THREE.Vector2(0.5, 0.5) },
        uGlow: { value: 0.05 },
        uBg: { value: PALETTE.bg },
        uBg2: { value: PALETTE.bg2 },
        uViolet: { value: PALETTE.violet },
        uCyan: { value: PALETTE.cyan },
      }),
    );
  }

  /* ---------------------------------------------------------------- sizes */

  resize(force = false): void {
    if (!this.renderer) return;
    const cssW = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const cssH = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.tier.dprMax) * this.renderScale;
    const w = Math.max(2, Math.round(cssW * dpr));
    const h = Math.max(2, Math.round(cssH * dpr));
    if (!force && w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;

    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // how much the layout should lean toward the "tall screen" scene set
    this.portrait = THREE.MathUtils.clamp((1.15 - cssW / cssH) / 0.45, 0, 1);

    this.sceneRT?.dispose();
    this.sceneRT = this.hdrTarget(w, h);
    [...this.bloomRT, ...this.bloomUpRT].forEach(rt => rt.dispose());
    this.bloomRT = [];
    this.bloomUpRT = [];
    let bw = w;
    let bh = h;
    for (let i = 0; i < this.tier.bloomLevels; i++) {
      bw = Math.max(2, Math.round(bw / 2));
      bh = Math.max(2, Math.round(bh / 2));
      this.bloomRT.push(this.hdrTarget(bw, bh));
      if (i < this.tier.bloomLevels - 1) this.bloomUpRT.push(this.hdrTarget(bw, bh));
    }

    const px = h / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    this.pointsMat.uniforms.uPx.value = px;
    this.pointsMat.uniforms.uMaxSize.value = Math.min(72, h * 0.06);
    this.dustMat.uniforms.uPx.value = px;
    if (this.trailMat) {
      this.trailMat.uniforms.uPx.value = px;
      (this.trailMat.uniforms.uViewport.value as THREE.Vector2).set(w, h);
    }
    (this.compositeMat.uniforms.uResolution.value as THREE.Vector2).set(w, h);
    this.perfGrace = 60;
    // resizing a canvas clears it: draw again right away so no empty frame is ever shown
    if (this.built && !this.lost && this.frame > 0) this.render();
  }

  /* --------------------------------------------------------------- inputs */

  /** Scene position: integer part = scene index, fraction = progress to the next one. */
  setScene(position: number): void {
    this.sceneTarget = THREE.MathUtils.clamp(position, 0, SCENES.length - 1);
  }

  /** Pointer in CSS pixels relative to the viewport. */
  setPointer(clientX: number, clientY: number): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.pointerNdc.set((clientX / w) * 2 - 1, -(clientY / h) * 2 + 1);
    if (!this.pointerSeen) {
      this.pointerSeen = true;
      this.pointerSmooth.copy(this.pointerNdc);
    }
    this.pointerLastMove = this.time;
  }

  setPress(down: boolean): void {
    this.pressTarget = down ? 1 : 0;
    if (down) this.pointerLastMove = this.time;
  }

  /** The pointer left the page or the finger was lifted. */
  releasePointer(): void {
    this.pointerLastMove = -10;
    this.pressTarget = 0;
  }

  /** Device tilt (-1..1), used for parallax on phones. */
  setTilt(x: number, y: number): void {
    this.tilt.set(THREE.MathUtils.clamp(x, -1, 1), THREE.MathUtils.clamp(y, -1, 1));
  }

  /** A shock wave through the cloud. */
  burst(strength = 1): void {
    this.burstAmount = Math.max(this.burstAmount, 5.5 * strength);
  }

  /** Runs the simulation forward without drawing, e.g. to skip the birth of the cloud. */
  warp(seconds: number): void {
    if (!this.built || this.lost) return;
    const steps = Math.ceil(seconds * 30);
    const calm = this.opts.calm;
    this.opts.calm = false;
    for (let i = 0; i < steps; i++) this.update(1 / 30);
    this.opts.calm = calm;
  }

  get tierName(): TierName {
    return this.tier.name;
  }

  /* ----------------------------------------------------------------- loop */

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastTime = performance.now();
    this.opts.onStats?.(this.stats());
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    if (this.lost || !this.built) return;

    let elapsed = (now - this.lastTime) / 1000;
    if (this.tier.maxFps && elapsed < 1 / this.tier.maxFps - 0.002) return;
    this.lastTime = now;
    if (elapsed > 0.25) elapsed = 1 / 60; // came back from a pause
    const dt = Math.min(elapsed, 1 / 24);

    try {
      this.update(dt);
      this.render();
    } catch (err) {
      console.error('[engine] frame failed', err);
      this.stop();
      this.opts.onFail?.('runtime');
      return;
    }
    this.watchPerformance(elapsed);
  };

  private modelMatrix(scene: SceneDef, spin: number, out: THREE.Matrix4): THREE.Vector3 {
    const halfH = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * (CAM_Z - scene.z);
    const halfW = halfH * this.camera.aspect;
    const pos = this.tmpV.set(scene.x * halfW, scene.y * halfH, scene.z);
    const yaw = spin + this.pointerSmooth.x * 0.22;
    const pitch = scene.tiltX - this.pointerSmooth.y * 0.14;
    this.tmpE.set(pitch, yaw, scene.tiltZ, 'XYZ');
    this.tmpQ.setFromEuler(this.tmpE);
    out.compose(pos, this.tmpQ, this.tmpS.set(scene.scale, scene.scale, scene.scale));
    return pos;
  }

  private update(dt: number): void {
    const calm = !!this.opts.calm;
    const step = dt * (calm ? 0.35 : 1);
    this.time += step;
    this.frame++;
    this.intro = Math.min(1, this.intro + dt / 2.6);

    /* scene blend ------------------------------------------------------- */
    this.scenePos = damp(this.scenePos, this.sceneTarget, calm ? 12 : 5.5, dt);
    const ia = Math.min(SCENES.length - 1, Math.floor(this.scenePos));
    const ib = Math.min(SCENES.length - 1, ia + 1);
    const morph = ia === ib ? 0 : this.scenePos - ia;
    const sa = sceneFor(ia, this.portrait);
    const sb = sceneFor(ib, this.portrait);
    const e = easeInOut(morph);
    const cur = this.current;
    for (const key of NUMERIC_KEYS) (cur[key] as number) = (sa[key] as number) + ((sb[key] as number) - (sa[key] as number)) * e;

    for (let i = 0; i < SCENES.length; i++) this.spins[i] += SCENES[i].spin * step;

    /* pointer ----------------------------------------------------------- */
    const active = !calm && this.pointerSeen && this.time - this.pointerLastMove < 2.6;
    this.pointerPresence = damp(this.pointerPresence, active ? 1 : 0, active ? 7 : 1.6, dt);
    this.press = damp(this.press, calm ? 0 : this.pressTarget, 9, dt);
    this.pointerSmooth.x = damp(this.pointerSmooth.x, calm ? 0 : this.pointerNdc.x, 5, dt);
    this.pointerSmooth.y = damp(this.pointerSmooth.y, calm ? 0 : this.pointerNdc.y, 5, dt);

    // the camera drifts a little on its own and leans toward the pointer
    const driftX = Math.sin(this.time * 0.11) * 0.12;
    const driftY = Math.cos(this.time * 0.09) * 0.08;
    this.camera.position.set((this.pointerSmooth.x + this.tilt.x) * 0.42 + driftX, (this.pointerSmooth.y + this.tilt.y) * 0.3 + driftY, CAM_Z);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();

    this.modelMatrix(sa, this.spins[ia], this.matA);
    const posB = this.modelMatrix(sb, this.spins[ib], this.matB);
    // where the structure is right now (between the two scenes)
    this.center.setFromMatrixPosition(this.matA).lerp(posB, e);

    // pointer ray and its point on the plane of the structure
    this.rayO.copy(this.camera.position);
    this.rayD.set(this.pointerNdc.x, this.pointerNdc.y, 0.5).unproject(this.camera).sub(this.rayO).normalize();
    const forward = this.tmpV.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const denom = this.rayD.dot(forward);
    const dist = denom > 1e-4 ? this.tmpW.copy(this.center).sub(this.rayO).dot(forward) / denom : CAM_Z;
    this.pointerWorldPrev.copy(this.pointerWorld);
    this.pointerWorld.copy(this.rayO).addScaledVector(this.rayD, dist);
    if (this.frame < 3 || !this.pointerSeen) this.pointerWorldPrev.copy(this.pointerWorld);
    const vel = this.tmpW.copy(this.pointerWorld).sub(this.pointerWorldPrev).divideScalar(Math.max(dt, 1e-3));
    if (vel.length() > 14) vel.setLength(14);
    this.pointerVel.lerp(vel, 1 - Math.exp(-10 * dt));

    /* simulation -------------------------------------------------------- */
    const su = this.simMat.uniforms;
    su.tA.value = this.formations[sa.formation].texture;
    su.tB.value = this.formations[sb.formation].texture;
    su.uMorph.value = morph;
    su.uTime.value = this.time;
    su.uDt.value = Math.min(step, 1 / 30);
    su.uIntro.value = easeInOut(this.intro);
    su.uSpring.value = cur.spring;
    su.uTurb.value = cur.turb * 0.6;
    su.uFree.value = cur.free;
    su.uPointer.value = this.pointerPresence;
    su.uPress.value = this.press;
    su.uRadius.value = 0.34 * THREE.MathUtils.lerp(1, 0.75, this.portrait);
    su.uBurst.value = this.burstAmount;
    this.burstCenter.copy(this.center);
    su.uSeed.value = this.needsSeed ? 1 : 0;
    su.tPos.value = this.simA.textures[0];
    su.tVel.value = this.simA.textures[1];
    this.pass(this.simMat, this.simB);
    [this.simA, this.simB] = [this.simB, this.simA];

    if (this.trailSimMat && this.trailA && this.trailB) {
      const tu = this.trailSimMat.uniforms;
      tu.tA.value = su.tA.value;
      tu.tB.value = su.tB.value;
      tu.uMorph.value = morph;
      tu.uPointer.value = this.pointerPresence;
      tu.uPress.value = this.press;
      tu.uBurst.value = this.burstAmount;
      // trails tick at a fixed 30 Hz so their length does not depend on the display;
      // the vertex shader interpolates between ticks
      this.trailClock += step;
      let steps = this.needsSeed ? 1 : Math.min(3, Math.floor(this.trailClock * 30));
      this.trailClock -= steps / 30;
      if (this.trailClock > 0.2) this.trailClock = 0;
      while (steps-- > 0) {
        tu.uTime.value = this.time;
        tu.uSeed.value = this.needsSeed ? 1 : 0;
        tu.tTrail.value = this.trailA.texture;
        this.pass(this.trailSimMat, this.trailB);
        [this.trailA, this.trailB] = [this.trailB, this.trailA];
      }
    }
    this.needsSeed = false;
    this.burstAmount = 0;

    /* drawing parameters ------------------------------------------------ */
    // fewer particles get slightly larger and brighter so every tier has the same presence
    const count = this.tier.simSize * this.tier.simSize * this.drawFraction;
    const density = Math.sqrt(262144 / count);
    const focus = CAM_Z - cur.z;
    const pu = this.pointsMat.uniforms;
    pu.tPos.value = this.simA.textures[0];
    pu.tVel.value = this.simA.textures[1];
    pu.tA.value = su.tA.value;
    pu.tB.value = su.tB.value;
    pu.uMorph.value = morph;
    pu.uSize.value = cur.size * (0.93 + 0.07 * density);
    pu.uAlpha.value = 0.095 * cur.alpha * Math.pow(density, 1.25) * easeInOut(Math.min(1, this.intro * 1.6));
    pu.uHue.value = cur.hue;
    pu.uFree.value = cur.free;
    pu.uFocus.value = focus;
    pu.uAperture.value = cur.aperture;
    this.points.geometry.setDrawRange(0, Math.floor(count));

    if (this.trailMat && this.trailA) {
      const tr = this.trailMat.uniforms;
      tr.tTrail.value = this.trailA.texture;
      tr.uFrac.value = THREE.MathUtils.clamp(this.trailClock * 30, 0, 1);
      tr.uAlpha.value = 0.3 * cur.trail * easeInOut(this.intro);
      tr.uHue.value = cur.hue;
      tr.uFocus.value = focus;
      tr.uAperture.value = cur.aperture;
      tr.uPointer.value = this.pointerPresence;
    }

    const du = this.dustMat.uniforms;
    du.uTime.value = this.time;
    du.uFocus.value = focus;
    du.uAperture.value = cur.aperture;

    const cu = this.compositeMat.uniforms;
    cu.uTime.value = this.time;
    cu.uFrame.value = this.frame % 4096;
    cu.uBloom.value = 0.72 * cur.bloom;
    cu.uGlow.value = 0.034 * cur.glow * easeInOut(this.intro);
    const ndc = this.tmpV.copy(this.center).project(this.camera);
    (cu.uGlowPos.value as THREE.Vector2).set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
  }

  private render(): void {
    const r = this.renderer;

    // 1. light into an HDR buffer
    r.setRenderTarget(this.sceneRT);
    r.clear(true, false, false);
    r.render(this.world, this.camera);

    // 2. bloom: bright pass, blur down the pyramid, then back up
    const levels = this.bloomRT;
    this.prefilterMat.uniforms.tMap.value = this.sceneRT.texture;
    (this.prefilterMat.uniforms.uTexel.value as THREE.Vector2).set(1 / this.width, 1 / this.height);
    this.pass(this.prefilterMat, levels[0]);
    for (let i = 1; i < levels.length; i++) {
      const src = levels[i - 1];
      this.downMat.uniforms.tMap.value = src.texture;
      (this.downMat.uniforms.uTexel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
      this.pass(this.downMat, levels[i]);
    }
    let blurred = levels[levels.length - 1];
    for (let i = levels.length - 2; i >= 0; i--) {
      this.upMat.uniforms.tMap.value = blurred.texture;
      this.upMat.uniforms.tBase.value = levels[i].texture;
      (this.upMat.uniforms.uTexel.value as THREE.Vector2).set(1 / blurred.width, 1 / blurred.height);
      this.pass(this.upMat, this.bloomUpRT[i]);
      blurred = this.bloomUpRT[i];
    }

    // 3. grade to the screen
    this.compositeMat.uniforms.tScene.value = this.sceneRT.texture;
    this.compositeMat.uniforms.tBloom.value = blurred.texture;
    this.pass(this.compositeMat, null);
  }

  /* --------------------------------------------------- adaptive quality */

  private watchPerformance(elapsed: number): void {
    // a single long gap is the page being busy (loading, a background tab), not a slow GPU
    if (elapsed > 0.5) return;
    this.fpsSmooth += (1 / Math.max(elapsed, 1e-3) - this.fpsSmooth) * 0.06;

    this.statsClock += elapsed;
    if (this.statsClock > 0.5) {
      this.statsClock = 0;
      this.opts.onStats?.(this.stats());
    }

    if (this.perfGrace > 0) {
      this.perfGrace--;
      this.perfFrames = 0;
      this.perfTime = 0;
      return;
    }
    this.perfFrames++;
    this.perfTime += elapsed;
    if (this.perfTime < 1.6) return;
    const fps = this.perfFrames / this.perfTime;
    this.perfFrames = 0;
    this.perfTime = 0;

    const floor = this.tier.maxFps ? this.tier.maxFps * 0.7 : 44;
    if (fps >= floor) return;
    // too slow: first render fewer pixels, then fewer particles, then drop a tier
    if (this.renderScale > 0.62) {
      this.renderScale = Math.max(0.6, this.renderScale * 0.85);
      this.resize(true);
    } else if (this.drawFraction > 0.4) {
      this.drawFraction = Math.max(0.35, this.drawFraction * 0.7);
      this.perfGrace = 40;
    } else {
      const next = lowerTier(this.tier.name);
      if (next) this.rebuild(TIERS[next]);
    }
  }

  private stats(): EngineStats {
    const ia = Math.round(this.scenePos);
    return {
      fps: Math.round(this.fpsSmooth),
      particles: Math.floor(this.tier.simSize * this.tier.simSize * this.drawFraction),
      trails: this.trailMat ? this.tier.trailCount : 0,
      tier: this.tier.name,
      formation: FORMATION_NAMES[SCENES[Math.min(SCENES.length - 1, ia)].formation],
      renderScale: this.renderScale,
      renderer: this.rendererLabel,
    };
  }

  /* -------------------------------------------------- lifecycle & errors */

  private rebuild(tier: Tier): void {
    this.releaseGpu();
    this.tier = tier;
    this.renderScale = 1;
    this.drawFraction = 1;
    const introDone = this.intro;
    this.build();
    this.intro = Math.max(introDone, 0.6);
    // a new renderer starts with an empty canvas: fill it before the browser shows it
    this.update(1 / 60);
    this.render();
  }

  private releaseGpu(): void {
    this.built = false;
    this.world.clear();
    this.quadScene.clear();
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this.sceneRT?.dispose();
    [...this.bloomRT, ...this.bloomUpRT].forEach(rt => rt.dispose());
    this.bloomRT = [];
    this.bloomUpRT = [];
    this.trailA = this.trailB = null;
    this.trailSimMat = this.trailMat = null;
    this.renderer?.dispose();
  }

  private onContextLost = (e: Event): void => {
    // keep the canvas: the browser may give the context back
    e.preventDefault();
    this.lost = true;
  };

  private onContextRestored = (): void => {
    try {
      this.releaseGpu();
      this.build();
      this.intro = 0.6;
      this.lost = false;
      this.update(1 / 60);
      this.render();
    } catch (err) {
      console.error('[engine] could not restore the context', err);
      this.opts.onFail?.('context-lost');
    }
  };

  private onVisibility = (): void => {
    // nothing is drawn while the tab is hidden
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
    } else if (this.running) {
      this.lastTime = performance.now();
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.tick);
    }
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.releaseGpu();
  }
}
