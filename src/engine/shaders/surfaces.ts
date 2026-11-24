/**
 * Opaque materials for Pocket Study, written against the same camera-fixed studio as the
 * reference rods so metal, moulded plastic, PCB and paper all reflect the same softboxes and flags.
 *
 * Alpha conventions follow the reference pipeline: 0 = backdrop, ≥1 = matter (fully visible through
 * refraction), values above 2 mark sparkle that the post pass turns into small stars.
 */
import { STUDIO } from './studio';

const LIGHTS = `
  vec3 lights(vec3 N) {
    return vec3(0.40) + vec3(0.62) * max(dot(N, KEY), 0.0) + vec3(0.30) * max(dot(N, STRIP), 0.0) +
      vec3(0.22) * max(dot(N, TOP), 0.0) + vec3(0.06) * max(dot(N, BOUNCE), 0.0);
  }
  vec4 envAt(samplerCube room, vec3 R, float lod) {
    vec4 m = textureLod(room, R, lod);
    return vec4(mix(m.rgb, vec3(1.0), backdrop(R) * (1.0 - lod / 9.0)), m.a);
  }
`;

export const SURFACE_VERT = `
  uniform vec3 uBrushAxis;
  varying vec3 vP;
  varying vec3 vN;
  varying vec3 vT;
  varying vec3 vLocal;
  varying vec2 vUv;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vP = mv.xyz;
    vN = normalize(normalMatrix * normal);
    vT = normalize(mat3(modelViewMatrix) * uBrushAxis);
    vLocal = position;
    vUv = uv;
    gl_Position = projectionMatrix * mv;
  }
`;

export const SURFACE_FRAG = `
  uniform samplerCube uRoom;
  uniform vec3 uColor;
  uniform float uMetal;
  uniform float uRough;
  uniform float uBrush;
  uniform float uSpark;
  uniform float uCoat;
  uniform sampler2D uMap;
  uniform int uMapMode;      // 0 none, 1 albedo (labels), 2 engraved ink on metal, 3 packed two-sided board
  uniform sampler2D uMask;   // mode 3: metalness (white = exposed copper/gold)
  uniform vec4 uMapRect;     // local xy → uv: (x0, y0, 1/w, 1/h); used when uMapMode == 2
  uniform vec3 uInk;
  uniform float uGrain;
  varying vec3 vP;
  varying vec3 vN;
  varying vec3 vT;
  varying vec3 vLocal;
  varying vec2 vUv;
  ${STUDIO}
  ${LIGHTS}

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(-vP);
    if (dot(N, V) < 0.0) N = -N;
    float cosv = max(dot(N, V), 0.0);

    vec3 albedo = uColor;
    float rough = uRough;
    float metal = uMetal;
    float ink = 0.0;
    if (uMapMode == 1) {
      vec4 t = texture2D(uMap, vUv);
      albedo = mix(albedo, t.rgb, t.a);
    } else if (uMapMode == 2) {
      vec2 uv = (vLocal.xy - uMapRect.xy) * uMapRect.zw;
      float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
      ink = texture2D(uMap, uv).a * inside;
    } else if (uMapMode == 3) {
      // Front half of the atlas for +Z faces, back half for −Z faces.
      vec2 uv = clamp((vLocal.xy - uMapRect.xy) * uMapRect.zw, 0.0, 1.0);
      uv.x = uv.x * 0.5 + (vLocal.z < 0.0 ? 0.5 : 0.0);
      albedo = texture2D(uMap, uv).rgb;
      float m = texture2D(uMask, uv).r;
      metal = mix(metal, 1.0, m);
      rough = mix(rough, 0.22, m);
    }

    // Fine grain: brushed metal streaks, paper tooth, moulded plastic.
    float g = 0.0;
    if (uGrain > 0.0) {
      vec2 q = uBrush > 0.0 ? vec2(dot(vLocal, normalize(vec3(1.0, 0.0, 0.0))) * 0.6, vLocal.y * 40.0 + vLocal.z * 40.0)
                            : vLocal.xy * 9.0;
      g = (hash(floor(q)) - 0.5) * uGrain;
    }

    vec3 R = reflect(-V, N);
    float lod = clamp(rough * 7.5, 0.0, 8.5);
    vec4 env;
    if (uBrush > 0.0) {
      // Anisotropic lobe along the brushing direction: smear the lookup along the tangent.
      vec3 T = normalize(vT - N * dot(vT, N));
      env = envAt(uRoom, R, lod) * 0.4 +
            envAt(uRoom, normalize(R + T * uBrush), lod + 0.6) * 0.3 +
            envAt(uRoom, normalize(R - T * uBrush), lod + 0.6) * 0.3;
    } else {
      env = envAt(uRoom, R, lod);
    }
    vec3 F0 = mix(vec3(0.04), albedo, metal);
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - cosv, 5.0) * (1.0 - rough * 0.7);
    vec3 spec = env.rgb * F;
    vec3 diff = albedo * (1.0 - metal) * lights(N);
    vec3 col = diff + spec * (1.0 + g);

    if (uCoat > 0.0) {
      float fc = fresnel(cosv, 1.5);
      col += min(envAt(uRoom, R, 1.5).rgb, vec3(3.0)) * fc * uCoat;
    }
    if (ink > 0.0) {
      vec3 inkCol = uInk * lights(N) * 0.8 + envAt(uRoom, R, 6.0).rgb * 0.02;
      col = mix(col, inkCol, ink);
    }

    float spark = uSpark * env.a * dot(F, vec3(0.3333)) * (1.0 - rough) * (1.0 - ink);
    gl_FragColor = vec4(col, 2.0 + spark);
  }
`;

/** Printed ink on clear plastic or paper, blended into the opaque pass so glass refracts it. */
export const DECAL_VERT = `
  varying vec2 vUv;
  varying vec3 vP;
  varying vec3 vN;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vP = mv.xyz;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

export const DECAL_FRAG = `
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform float uGloss;
  varying vec2 vUv;
  varying vec3 vP;
  varying vec3 vN;
  ${STUDIO}
  vec3 lights(vec3 N) {
    return vec3(0.46) + vec3(0.6) * max(dot(N, KEY), 0.0) + vec3(0.3) * max(dot(N, STRIP), 0.0) +
      vec3(0.2) * max(dot(N, TOP), 0.0);
  }
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float a = t.a * uOpacity;
    if (a < 0.003) discard;
    vec3 N = normalize(vN);
    vec3 V = normalize(-vP);
    if (dot(N, V) < 0.0) N = -N;
    vec3 col = t.rgb * lights(N) + min(room(reflect(-V, N)), vec3(1.5)) * uGloss * fresnel(max(dot(N, V), 0.0), 1.5);
    gl_FragColor = vec4(col * a, a);
  }
`;

export const BACKDROP_VERT = `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/**
 * White sweep with analytic soft shadows of seven rounded boxes (the handheld and six cartridges),
 * each evaluated in its own local frame like the reference jewel-case shadows.
 */
export const SHADOW_BOXES = 7;
export const BACKDROP_FRAG = `
  uniform vec3 uLight;
  uniform mat4 uInv[${SHADOW_BOXES}];
  uniform vec4 uBox[${SHADOW_BOXES}];      // half-width, half-height, corner radius, darkness
  uniform vec2 uZ[${SHADOW_BOXES}];        // shadow plane z in local space, extra softness
  uniform vec3 uCentre;
  uniform float uScale;
  varying vec3 vWorld;

  float roundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - (b - r);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  float shade(mat4 inv, vec4 box, vec2 z) {
    if (box.w <= 0.0) return 1.0;
    vec3 lo = (inv * vec4(vWorld, 1.0)).xyz;
    vec3 ld = mat3(inv) * uLight;
    if (abs(ld.z) < 1e-4) return 1.0;
    float s = (z.x - lo.z) / ld.z;
    if (s <= 0.0) return 1.0;
    vec2 h = lo.xy + ld.xy * s;
    float soft = 1.2 + s * 0.11 / uScale + z.y;
    float d = roundBox(h, box.xy, box.z);
    float cover = 1.0 - smoothstep(-soft, soft, d);
    float core = 1.0 - smoothstep(-soft * 3.0, soft * 0.5, d);
    return 1.0 - box.w * (0.55 * cover + 0.45 * core);
  }

  void main() {
    float lit = 1.0;
    for (int i = 0; i < ${SHADOW_BOXES}; i++) lit *= shade(uInv[i], uBox[i], uZ[i]);
    float r = length((vWorld.xy - uCentre.xy) / (520.0 * uScale));
    vec3 paper = mix(vec3(1.0), vec3(0.935, 0.928, 0.915), smoothstep(0.15, 1.25, r));
    gl_FragColor = vec4(paper * lit, 0.0);
  }
`;
