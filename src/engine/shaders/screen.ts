/**
 * The LCD. Samples the console's 160×144 software framebuffer (a DataTexture, row 0 = top) with
 * sharp-bilinear filtering so pixels stay square at any zoom without shimmering, adds a faint
 * pixel grid that fades out when pixels get smaller than a few screen pixels, a backlight with
 * slight edge falloff, and the reflection of the studio in the cover glass.
 *
 * Output alpha is 2.0 ("matter, no sparkle") so the star pass never blooms game pixels.
 */
import { STUDIO } from './studio';

export const SCREEN_VERT = `
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

export const SCREEN_FRAG = `
  uniform sampler2D uScreen;
  uniform samplerCube uRoom;
  uniform vec2 uRes;
  uniform float uBacklight;
  uniform float uGrid;
  varying vec2 vUv;
  varying vec3 vP;
  varying vec3 vN;
  ${STUDIO}

  vec3 toLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }

  void main() {
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    vec2 px = uv * uRes;
    vec2 fw = max(fwidth(px), vec2(1e-4));
    // Sharp bilinear: hard texel interiors, one screen pixel of blend at each texel edge.
    vec2 seam = floor(px + 0.5);
    vec2 sp = seam + clamp((px - seam) / fw, -0.5, 0.5);
    vec3 lcd = toLinear(texture2D(uScreen, sp / uRes).rgb);

    // Pixel grid: thin darker gaps between cells, faded out when cells are small on screen.
    vec2 cell = abs(fract(px) - 0.5);
    float edge = max(cell.x, cell.y);
    float gap = smoothstep(0.5 - fw.x * 0.9 - 0.06, 0.5, edge);
    float gridVis = (1.0 - smoothstep(0.16, 0.42, max(fw.x, fw.y))) * uGrid;
    lcd *= 1.0 - gap * 0.34 * gridVis;

    // Backlight: slightly brighter centre, soft falloff to the edges of the panel.
    vec2 q = abs(vUv - 0.5) * 2.0;
    float vign = 1.0 - 0.14 * pow(max(q.x, q.y), 3.0);
    vec3 black = vec3(0.010, 0.011, 0.014);
    vec3 col = black + lcd * 1.12 * vign * uBacklight;
    // Inner shadow where the panel meets the bezel window.
    float inner = smoothstep(0.0, 0.035, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
    col *= mix(0.55, 1.0, inner);

    // Cover glass reflection (dim, so the game stays readable).
    vec3 N = normalize(vN);
    vec3 V = normalize(-vP);
    if (dot(N, V) < 0.0) N = -N;
    float cosv = max(dot(N, V), 0.0);
    vec3 R = reflect(-V, N);
    float f = fresnel(cosv, 1.52);
    col += min(room(R), vec3(2.2)) * f * 0.55;

    gl_FragColor = vec4(col, 2.0);
  }
`;
