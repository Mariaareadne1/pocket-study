/**
 * Material factory. Every material shares the baked studio cube map, so swapping the studio
 * re-lights everything consistently.
 */
import * as THREE from 'three';
import { ROD_FRAG, ROD_VERT, SHEET_FRAG, SHEET_VERT } from './shaders/studio';
import { SCREEN_FRAG, SCREEN_VERT } from './shaders/screen';
import { DECAL_FRAG, DECAL_VERT, SURFACE_FRAG, SURFACE_VERT } from './shaders/surfaces';

export interface SurfaceSpec {
  color: [number, number, number];
  metal?: number;
  rough?: number;
  brush?: number;
  spark?: number;
  coat?: number;
  grain?: number;
  map?: THREE.Texture | null;
  mapMode?: 0 | 1 | 2 | 3;
  mask?: THREE.Texture | null;
  mapRect?: [number, number, number, number];
  ink?: [number, number, number];
  brushAxis?: [number, number, number];
}

/** Linear-space presets tuned against the studio. */
export const PRESET = {
  chrome: { color: [0.92, 0.93, 0.95], metal: 1, rough: 0.06, spark: 1 },
  satin: { color: [0.86, 0.87, 0.89], metal: 1, rough: 0.24, brush: 0.18, spark: 0.5, grain: 0.18 },
  brushed: { color: [0.8, 0.81, 0.83], metal: 1, rough: 0.3, brush: 0.32, spark: 0.35, grain: 0.3 },
  platinum: { color: [0.9, 0.89, 0.87], metal: 1, rough: 0.14, spark: 0.7 },
  keycap: { color: [0.86, 0.865, 0.875], metal: 0, rough: 0.3, coat: 0.45, grain: 0.08 },
  rubber: { color: [0.022, 0.022, 0.024], metal: 0, rough: 0.62 },
  darkSteel: { color: [0.36, 0.37, 0.4], metal: 1, rough: 0.3 },
  paper: { color: [0.94, 0.93, 0.9], metal: 0, rough: 0.7, coat: 0.18 },
} satisfies Record<string, SurfaceSpec>;

export class Materials {
  private readonly made: THREE.Material[] = [];
  constructor(
    private readonly room: THREE.Texture,
    private readonly roomSize: number,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly samples: number,
  ) {}

  private keep<T extends THREE.Material>(m: T): T {
    this.made.push(m);
    return m;
  }

  surface(spec: SurfaceSpec): THREE.ShaderMaterial {
    return this.keep(
      new THREE.ShaderMaterial({
        uniforms: {
          uRoom: { value: this.room },
          uColor: { value: new THREE.Vector3(...spec.color) },
          uMetal: { value: spec.metal ?? 0 },
          uRough: { value: spec.rough ?? 0.5 },
          uBrush: { value: spec.brush ?? 0 },
          uSpark: { value: spec.spark ?? 0 },
          uCoat: { value: spec.coat ?? 0 },
          uGrain: { value: spec.grain ?? 0 },
          uMap: { value: spec.map ?? null },
          uMapMode: { value: spec.mapMode ?? 0 },
          uMask: { value: spec.mask ?? null },
          uMapRect: { value: new THREE.Vector4(...(spec.mapRect ?? [0, 0, 1, 1])) },
          uInk: { value: new THREE.Vector3(...(spec.ink ?? [0.05, 0.05, 0.06])) },
          uBrushAxis: { value: new THREE.Vector3(...(spec.brushAxis ?? [1, 0, 0])) },
        },
        vertexShader: SURFACE_VERT,
        fragmentShader: SURFACE_FRAG,
      }),
    );
  }

  /** The LCD: samples the console framebuffer texture. */
  screen(map: THREE.Texture, res: [number, number]): THREE.ShaderMaterial {
    return this.keep(
      new THREE.ShaderMaterial({
        uniforms: {
          uScreen: { value: map },
          uRoom: { value: this.room },
          uRes: { value: new THREE.Vector2(...res) },
          uBacklight: { value: 0 },
          uGrid: { value: 1 },
        },
        vertexShader: SCREEN_VERT,
        fragmentShader: SCREEN_FRAG,
      }),
    );
  }

  decal(map: THREE.Texture, opacity = 1, gloss = 0.15): THREE.ShaderMaterial {
    return this.keep(
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: map }, uOpacity: { value: opacity }, uGloss: { value: gloss } },
        vertexShader: DECAL_VERT,
        fragmentShader: DECAL_FRAG,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -8,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      }),
    );
  }

  /** Clear rods (ray-traced through their profile). `absorb` sets tint: more red absorbed = icier. */
  rod(absorb: [number, number, number]): THREE.ShaderMaterial {
    return this.keep(
      new THREE.ShaderMaterial({
        uniforms: {
          uBehind: { value: null },
          uRoom: { value: this.room },
          uRoomSize: { value: this.roomSize },
          uProj: { value: this.camera.projectionMatrix },
          uDepth: { value: 9 },
          uIor: { value: 1.59 },
          uSamples: { value: this.samples },
          uAbsorb: { value: new THREE.Vector3(...absorb) },
        },
        vertexShader: ROD_VERT,
        fragmentShader: ROD_FRAG,
      }),
    );
  }

  /** Thin clear panel. `haze` (per mm) mixes what's behind toward `tint`: the body colour of tinted plastic. */
  sheet(absorb: [number, number, number], haze = 0, tint: [number, number, number] = [1, 1, 1]): THREE.ShaderMaterial {
    return this.keep(
      new THREE.ShaderMaterial({
        uniforms: {
          uIor: { value: 1.59 },
          uAbsorb: { value: new THREE.Vector3(...absorb) },
          uHaze: { value: haze },
          uTint: { value: new THREE.Vector3(...tint) },
        },
        vertexShader: SHEET_VERT,
        fragmentShader: SHEET_FRAG,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 4,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
      }),
    );
  }

  dispose(): void {
    for (const m of this.made) m.dispose();
    this.made.length = 0;
  }
}
