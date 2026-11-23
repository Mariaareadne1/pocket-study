/**
 * Render pipeline, following the framebuffer sequence of Ann Nguyen's CD Case (`CaseStage.js`):
 * opaque page → clear groups back-to-front, each refracting the image so far (ping-pong MSAA
 * targets, scissored to the object) → spark detection → four-point stars → sRGB composite.
 * Generalised from two fixed groups to any number, and the page now has depth + MSAA because
 * the mechanism has many overlapping opaque parts.
 */
import * as THREE from 'three';
import { BRIGHT_FRAG, COPY_FRAG, FINAL_FRAG, ROOM_BAKE_FRAG, SCREEN_VERT, STREAK_FRAG } from '../shaders/studio';

export const ROOM_SIZE = 512;
const MSAA = 4;
const STARS = 1.25;
const STAR_THRESHOLD = 2.2;

export interface GlassGroup {
  meshes: THREE.Mesh[];
  rodMaterials: THREE.ShaderMaterial[];
  depth: number;
}

export interface Rect {
  x: number;
  y: number;
  x1: number;
  y1: number;
}

export class Pipeline {
  readonly renderer: THREE.WebGLRenderer;
  readonly opaque = new THREE.Scene();
  readonly glass = new THREE.Scene();
  readonly roomRT: THREE.WebGLCubeRenderTarget;
  private readonly page: THREE.WebGLRenderTarget;
  private readonly rt: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly bright: THREE.WebGLRenderTarget;
  private readonly starA: THREE.WebGLRenderTarget;
  private readonly starB: THREE.WebGLRenderTarget;
  private readonly screenCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad = new THREE.PlaneGeometry(2, 2);
  private readonly copyMat: THREE.ShaderMaterial;
  private readonly passes: { scene: THREE.Scene; material: THREE.ShaderMaterial }[] = [];
  private readonly brightPass;
  private readonly streakPass;
  private readonly finalPass;
  private readonly bakePass;
  private readonly picked;
  private readonly allGlass: THREE.Mesh[] = [];

  constructor(canvas: HTMLCanvasElement, preserve = false) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: preserve,
    });
    const r = this.renderer;
    r.autoClear = false;
    r.setClearColor(0xffffff, 0);
    for (const s of [this.opaque, this.glass]) s.matrixWorldAutoUpdate = false;
    const hdr = r.extensions.has('EXT_color_buffer_float') || r.extensions.has('EXT_color_buffer_half_float');
    const target = (samples: number, depth: boolean): THREE.WebGLRenderTarget =>
      new THREE.WebGLRenderTarget(1, 1, {
        type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
        samples,
        depthBuffer: depth,
        stencilBuffer: false,
        resolveDepthBuffer: false,
      });
    this.page = target(MSAA, true);
    this.rt = [target(MSAA, true), target(MSAA, true)];
    this.bright = target(0, false);
    this.starA = target(0, false);
    this.starB = target(0, false);

    const pass = (frag: string, uniforms: Record<string, THREE.IUniform>): { scene: THREE.Scene; material: THREE.ShaderMaterial } => {
      const material = new THREE.ShaderMaterial({ uniforms, vertexShader: SCREEN_VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
      const scene = new THREE.Scene();
      scene.add(new THREE.Mesh(this.quad, material));
      const p = { scene, material };
      this.passes.push(p);
      return p;
    };
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: null } },
      vertexShader: SCREEN_VERT,
      fragmentShader: COPY_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const copyQuad = new THREE.Mesh(this.quad, this.copyMat);
    copyQuad.frustumCulled = false;
    copyQuad.renderOrder = -10;
    this.glass.add(copyQuad);

    this.picked = {
      uTex: { value: this.page.texture },
      uTexInside: { value: this.page.texture },
      uRect: { value: new THREE.Vector4() },
    };
    this.brightPass = pass(BRIGHT_FRAG, { ...this.picked, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: STAR_THRESHOLD } });
    this.streakPass = pass(STREAK_FRAG, { uTex: { value: null }, uStep: { value: new THREE.Vector2() }, uFalloff: { value: 0.66 } });
    this.finalPass = pass(FINAL_FRAG, {
      ...this.picked,
      uStarA: { value: this.starA.texture },
      uStarB: { value: this.starB.texture },
      uStars: { value: STARS },
    });

    this.roomRT = new THREE.WebGLCubeRenderTarget(ROOM_SIZE, {
      type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    this.bakePass = pass(ROOM_BAKE_FRAG, { uFace: { value: 0 }, uSize: { value: ROOM_SIZE } });
    this.bakeRoom();
  }

  bakeRoom(): void {
    for (let face = 0; face < 6; face++) {
      this.bakePass.material.uniforms.uFace.value = face;
      this.renderer.setRenderTarget(this.roomRT, face);
      this.renderer.render(this.bakePass.scene, this.screenCam);
    }
    this.renderer.setRenderTarget(null);
  }

  registerGlass(meshes: THREE.Mesh[]): void {
    this.allGlass.push(...meshes);
  }

  setSize(w: number, h: number): THREE.Vector2 {
    this.renderer.setSize(w, h, false);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.page.setSize(size.x, size.y);
    for (const r of this.rt) r.setSize(size.x, size.y);
    const hw = Math.max(1, Math.round(size.x / 2));
    const hh = Math.max(1, Math.round(size.y / 2));
    for (const r of [this.bright, this.starA, this.starB]) r.setSize(hw, hh);
    return size;
  }

  get drawSize(): { w: number; h: number } {
    return { w: this.page.width, h: this.page.height };
  }

  draw(camera: THREE.Camera, groups: GlassGroup[], rect: Rect | null): void {
    const r = this.renderer;
    r.setRenderTarget(this.page);
    r.clear();
    r.render(this.opaque, camera);

    const sorted = groups;
    const w = this.page.width;
    const h = this.page.height;
    let from = this.page;
    if (rect) {
      for (const t of this.rt) {
        t.scissor.set(rect.x, rect.y, rect.x1 - rect.x, rect.y1 - rect.y);
        t.scissorTest = true;
      }
      sorted.forEach((g, i) => {
        const into = this.rt[i % 2];
        r.setRenderTarget(into);
        r.clear();
        this.copyMat.uniforms.uTex.value = from.texture;
        for (const m of this.allGlass) m.visible = false;
        for (const m of g.meshes) m.visible = true;
        for (const mat of g.rodMaterials) mat.uniforms.uBehind.value = from.texture;
        r.render(this.glass, camera);
        from = into;
      });
      for (const t of this.rt) t.scissorTest = false;
    }
    for (const m of this.allGlass) m.visible = true;
    this.picked.uTexInside.value = from.texture;
    if (rect) this.picked.uRect.value.set(rect.x / w, rect.y / h, rect.x1 / w, rect.y1 / h);
    else this.picked.uRect.value.set(0, 0, 0, 0);

    this.brightPass.material.uniforms.uTexel.value.set(1 / this.bright.width, 1 / this.bright.height);
    r.setRenderTarget(this.bright);
    r.render(this.brightPass.scene, this.screenCam);
    this.streakPass.material.uniforms.uTex.value = this.bright.texture;
    this.streakPass.material.uniforms.uStep.value.set(1.5 / this.bright.width, 0);
    r.setRenderTarget(this.starA);
    r.render(this.streakPass.scene, this.screenCam);
    this.streakPass.material.uniforms.uStep.value.set(0, 1.5 / this.bright.height);
    r.setRenderTarget(this.starB);
    r.render(this.streakPass.scene, this.screenCam);
    r.setRenderTarget(null);
    r.render(this.finalPass.scene, this.screenCam);
  }

  dispose(): void {
    for (const p of this.passes) p.material.dispose();
    this.copyMat.dispose();
    this.quad.dispose();
    for (const t of [this.page, ...this.rt, this.bright, this.starA, this.starB, this.roomRT]) t.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
