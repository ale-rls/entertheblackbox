/**
 * WebGL2 renderer for curtain-light votes, adapted from the Curtain Light
 * Lab prototype (shader/curtain_light.frag). The prototype lit the fabric
 * with four point lights in one loop. Here light arrives as two textures so
 * the cost does not grow with the audience:
 *
 *  1. pool light  - the answer pools, composed on the CPU from the counting
 *     geometry (see @entertheblackbox/shared buildPoolMasks) and uploaded
 *     as a small texture;
 *  2. cursor light - every cursor's soft flood, drawn as instanced Gaussian
 *     sprites into a quarter-resolution additive buffer in one draw call.
 *
 * The fabric pass shades the packed curtain video (colour | normal X /
 * normal Y | depth) once with the summed light, then cursor cores are drawn
 * on top so each participant keeps a crisp bright centre. Text (question
 * and answer labels) is applied last and adapts to what is beneath it, so
 * it stays readable on lit and unlit fabric.
 */

const CLIP_ASPECT = 1280 / 704;
/** Light map values are stored sqrt-encoded in RGBA8 over this range. */
export const POOL_ENCODE_RANGE = 4;

const FULLSCREEN_VS = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0., 1.); }`;

export const FABRIC_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D tex;      // packed curtain frame (2560x1408)
uniform sampler2D pool;     // answer-pool light, sqrt-encoded linear RGB
uniform sampler2D cursorLight; // accumulated cursor floods, linear RGB
uniform sampler2D txt;      // text at output size: RGBA lettering and shadow
uniform bool hasTex;
uniform vec4 crop;          // clip-space crop: xy offset, zw size (cover fit)
uniform float baked, folds, shine, shadow, opacity, cursorScale;
const float ASPECT = 1280. / 704.;
const float RELIEF = .22;
const vec2 HALF = vec2(.5 / 2560., .5 / 1408.);
vec2 tile(vec2 q, vec2 off){ return clamp(q, HALF, .5 - HALF) + off; }
vec3 colour(vec2 q){ return hasTex ? texture(tex, tile(q * .5, vec2(0.))).rgb : vec3(.2); }
float depth(vec2 q){ return hasTex ? texture(tex, tile(q * .5, vec2(.5))).r : .5; }
vec3 normal(vec2 q){
  if (!hasTex) return vec3(0., 0., 1.);
  vec2 n = vec2(texture(tex, tile(q * .5, vec2(.5, 0.))).r, texture(tex, tile(q * .5, vec2(0., .5))).r) * 2. - 1.;
  return normalize(vec3(n * folds, sqrt(max(.04, 1. - dot(n, n)))));
}
float occlusion(vec3 P, vec3 L){
  if (!hasTex) return 1.;
  float hit = 0.;
  for (int i = 1; i <= 10; i++) {
    float t = float(i) * .012;
    vec3 r = P + L * t;
    float h = depth(vec2(r.x / ASPECT, r.y)) * RELIEF;
    hit = max(hit, smoothstep(.0, .012, h - r.z) * (1. - float(i) / 11.));
  }
  return 1. - hit * shadow;
}
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
void main(){
  vec2 q = crop.xy + uv * crop.zw;
  vec3 base = lin(colour(q));
  float luma = dot(base, vec3(.2126, .7152, .0722));
  vec3 N = normal(q);
  vec3 P = vec3(q.x * ASPECT, q.y, depth(q) * RELIEF);
  vec3 albedo = vec3(.12 + luma * .55);
  vec3 poolLight = pow(texture(pool, uv).rgb, vec3(2.)) * ${POOL_ENCODE_RANGE.toFixed(1)};
  // The cursor buffer is a rendered framebuffer: its rows run bottom-up, unlike
  // the CPU-uploaded pool and text textures, so flip v to keep floods under their cores.
  vec3 crowd = texture(cursorLight, vec2(uv.x, 1. - uv.y)).rgb * cursorScale;
  // Many overlapping floods compress instead of clipping the fabric to white.
  crowd = crowd / (1. + crowd * .6);
  vec3 light = poolLight + crowd;
  // Washes come from the front and slightly above, like stage lights on a gauze.
  vec3 L = normalize(vec3(0., -.35, 1.));
  vec3 H = normalize(L + vec3(0., 0., 1.));
  float nl = max(dot(N, L), 0.);
  float nh = max(dot(N, H), 0.);
  float spec = .5 * pow(nh, 12.) + 1.4 * pow(nh, 70.);
  vec3 sum = (albedo * nl + spec * shine * (.25 + .75 * nl)) * light * occlusion(P, L);
  vec3 c = base * baked + sum;
  // Soft shoulder, capped below white so labels keep contrast in a full pool.
  c = (1. - exp(-c * 1.15)) * .9;
  vec3 shown = pow(c, vec3(1. / 2.2));
  vec4 t = texture(txt, uv);
  // Preserve white lettering and its dark halo from the CPU text canvas.
  o = vec4(mix(shown, t.rgb, t.a), opacity);
}`;

/** Instanced Gaussian sprite: used for both cursor floods (into a buffer) and cores (on screen). */
const SPRITE_VS = `#version 300 es
in vec2 corner;
in vec2 center;   // 0..1 viewport, y down
in vec4 tint;     // linear rgb, amount
in float radius;  // fraction of viewport height
uniform float aspect; // width / height
out vec2 local; out vec4 vTint;
void main(){
  local = corner;
  vTint = tint;
  vec2 pos = center + corner * vec2(radius / aspect, radius);
  gl_Position = vec4(pos.x * 2. - 1., 1. - pos.y * 2., 0., 1.);
}`;

const SPRITE_FS = `#version 300 es
precision highp float;
in vec2 local; in vec4 vTint; out vec4 o;
uniform float sharpness;
void main(){
  float d2 = dot(local, local);
  if (d2 > 1.) discard;
  float fall = exp(-d2 * sharpness) * (1. - d2);
  o = vec4(vTint.rgb * vTint.a * fall, 1.);
}`;

export type CurtainFabricParams = { baked: number; folds: number; shine: number; shadow: number };

/** One cursor light: position, linear colour, flood amount, core amount and pulse (0..1). */
export type CursorLight = {
  x: number;
  y: number;
  rgb: readonly [number, number, number];
  flood: number;
  core: number;
  pulse: number;
};

export type CurtainFrame = {
  opacity: number;
  /** Fades cursor floods and cores together (e.g. after the vote closes). */
  cursorOpacity: number;
  fabric: CurtainFabricParams;
  cursors: readonly CursorLight[];
};

export const FLOOD_RADIUS = 0.15;
export const CORE_RADIUS = 0.016;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`curtain shader: ${gl.getShaderInfoLog(shader) ?? "compile failed"}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`curtain program: ${gl.getProgramInfoLog(program) ?? "link failed"}`);
  }
  return program;
}

function makeTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  return texture;
}

/** Cover-fit crop of the 1280x704 clip for a viewport aspect: offset and size in clip uv. */
export function coverCrop(viewportAspect: number): [number, number, number, number] {
  if (viewportAspect >= CLIP_ASPECT) {
    const size = CLIP_ASPECT / viewportAspect;
    return [0, (1 - size) / 2, 1, size];
  }
  const size = viewportAspect / CLIP_ASPECT;
  return [(1 - size) / 2, 0, size, 1];
}

/** Encode a linear-RGB light map into RGBA8 (sqrt over POOL_ENCODE_RANGE) for upload. */
export function encodeLightMap(light: Float32Array, out: Uint8Array): Uint8Array {
  const cells = light.length / 3;
  for (let i = 0; i < cells; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      const value = Math.min(1, Math.max(0, light[i * 3 + c]! / POOL_ENCODE_RANGE));
      out[i * 4 + c] = Math.round(Math.sqrt(value) * 255);
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}

export class CurtainRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly fabric: WebGLProgram;
  private readonly sprite: WebGLProgram;
  private readonly quad: WebGLVertexArrayObject;
  private readonly spriteVao: WebGLVertexArrayObject;
  private readonly instanceBuffer: WebGLBuffer;
  private readonly videoTexture: WebGLTexture;
  private readonly poolTexture: WebGLTexture;
  private readonly textTexture: WebGLTexture;
  private readonly lightTexture: WebGLTexture;
  private readonly lightBuffer: WebGLFramebuffer;
  private readonly floatLight: boolean;
  private lightSize = { width: 0, height: 0 };
  private instances = new Float32Array(0);
  private hasVideo = false;
  private poolEncoded = new Uint8Array(0);

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: false, antialias: false });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    // Packed normal/depth tiles are data, not pictures: never colour-convert them.
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    this.floatLight = gl.getExtension("EXT_color_buffer_float") !== null;
    this.fabric = link(gl, FULLSCREEN_VS, FABRIC_FS);
    this.sprite = link(gl, SPRITE_VS, SPRITE_FS);

    this.quad = gl.createVertexArray()!;
    gl.bindVertexArray(this.quad);
    const tri = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const p = gl.getAttribLocation(this.fabric, "p");
    gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);

    this.spriteVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.spriteVao);
    const corners = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const corner = gl.getAttribLocation(this.sprite, "corner");
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    this.instanceBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    const stride = 7 * 4;
    const attrib = (name: string, size: number, offset: number) => {
      const location = gl.getAttribLocation(this.sprite, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(location, 1);
    };
    attrib("center", 2, 0);
    attrib("tint", 4, 8);
    attrib("radius", 1, 24);
    gl.bindVertexArray(null);

    this.videoTexture = makeTexture(gl);
    this.poolTexture = makeTexture(gl);
    this.textTexture = makeTexture(gl);
    this.lightTexture = makeTexture(gl);
    this.lightBuffer = gl.createFramebuffer()!;
  }

  /** Resize the drawing buffer; the light buffer follows at quarter resolution. */
  resize(width: number, height: number): void {
    const gl = this.gl;
    if (this.canvas.width === width && this.canvas.height === height && this.lightSize.width > 0) return;
    this.canvas.width = width;
    this.canvas.height = height;
    const lightWidth = Math.max(1, Math.round(width / 4));
    const lightHeight = Math.max(1, Math.round(height / 4));
    this.lightSize = { width: lightWidth, height: lightHeight };
    gl.bindTexture(gl.TEXTURE_2D, this.lightTexture);
    if (this.floatLight) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, lightWidth, lightHeight, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lightWidth, lightHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lightBuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.lightTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Upload the current curtain video frame (call each animation frame while playing). */
  uploadVideo(video: HTMLVideoElement | null): void {
    const gl = this.gl;
    if (video === null || video.readyState < 2 || video.videoWidth === 0) return;
    gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    this.hasVideo = true;
  }

  /** Upload the composed pool light map (linear RGB, columns x rows). */
  uploadPools(light: Float32Array, columns: number, rows: number): void {
    const gl = this.gl;
    if (this.poolEncoded.length !== columns * rows * 4) this.poolEncoded = new Uint8Array(columns * rows * 4);
    encodeLightMap(light, this.poolEncoded);
    gl.bindTexture(gl.TEXTURE_2D, this.poolTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, columns, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.poolEncoded);
  }

  /** Upload white lettering and its dark halo as an RGBA text layer. */
  uploadText(text: HTMLCanvasElement): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.textTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, text);
  }

  private writeInstances(cursors: readonly CursorLight[], core: boolean, fade: number): number {
    const needed = cursors.length * 7;
    if (this.instances.length < needed) this.instances = new Float32Array(Math.max(needed, 64 * 7));
    let n = 0;
    for (const cursor of cursors) {
      const amount = (core ? cursor.core * (1 + 1.6 * cursor.pulse) : cursor.flood * (1 + 0.6 * cursor.pulse)) * fade;
      if (amount <= 0.001) continue;
      const o = n * 7;
      this.instances[o] = cursor.x;
      this.instances[o + 1] = cursor.y;
      this.instances[o + 2] = core ? 0.35 + 0.65 * cursor.rgb[0] : cursor.rgb[0];
      this.instances[o + 3] = core ? 0.35 + 0.65 * cursor.rgb[1] : cursor.rgb[1];
      this.instances[o + 4] = core ? 0.35 + 0.65 * cursor.rgb[2] : cursor.rgb[2];
      this.instances[o + 5] = amount;
      this.instances[o + 6] = core ? CORE_RADIUS * (1 + 1.2 * cursor.pulse) : FLOOD_RADIUS;
      n += 1;
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instances.subarray(0, n * 7), gl.DYNAMIC_DRAW);
    return n;
  }

  private drawSprites(count: number, sharpness: number): void {
    const gl = this.gl;
    gl.useProgram(this.sprite);
    gl.uniform1f(gl.getUniformLocation(this.sprite, "aspect"), this.canvas.width / Math.max(1, this.canvas.height));
    gl.uniform1f(gl.getUniformLocation(this.sprite, "sharpness"), sharpness);
    gl.bindVertexArray(this.spriteVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
  }

  render(frame: CurtainFrame): void {
    const gl = this.gl;
    // Pass 1: cursor floods, additive, quarter resolution, one instanced draw.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lightBuffer);
    gl.viewport(0, 0, this.lightSize.width, this.lightSize.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // RGBA8 cannot hold values above 1, so floods are stored scaled down.
    const storeScale = this.floatLight ? 1 : 0.25;
    const floods = this.writeInstances(frame.cursors, false, frame.cursorOpacity * storeScale);
    if (floods > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.drawSprites(floods, 2.2);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Pass 2: fabric shaded once by pool light + crowd light, then text.
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.fabric);
    const bind = (unit: number, texture: WebGLTexture, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(gl.getUniformLocation(this.fabric, name), unit);
    };
    bind(0, this.videoTexture, "tex");
    bind(1, this.poolTexture, "pool");
    bind(2, this.lightTexture, "cursorLight");
    bind(3, this.textTexture, "txt");
    const u = (name: string) => gl.getUniformLocation(this.fabric, name);
    gl.uniform1i(u("hasTex"), this.hasVideo ? 1 : 0);
    gl.uniform4fv(u("crop"), coverCrop(this.canvas.width / Math.max(1, this.canvas.height)));
    gl.uniform1f(u("baked"), frame.fabric.baked);
    gl.uniform1f(u("folds"), frame.fabric.folds);
    gl.uniform1f(u("shine"), frame.fabric.shine);
    gl.uniform1f(u("shadow"), frame.fabric.shadow);
    gl.uniform1f(u("opacity"), frame.opacity);
    gl.uniform1f(u("cursorScale"), 1 / storeScale);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    // Pass 3: bright cursor centres on top, so every participant stays identifiable.
    const cores = this.writeInstances(frame.cursors, true, frame.cursorOpacity * frame.opacity);
    if (cores > 0) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
      this.drawSprites(cores, 3.5);
      gl.disable(gl.BLEND);
    }
  }

  dispose(): void {
    const gl = this.gl;
    for (const texture of [this.videoTexture, this.poolTexture, this.textTexture, this.lightTexture]) gl.deleteTexture(texture);
    gl.deleteFramebuffer(this.lightBuffer);
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteProgram(this.fabric);
    gl.deleteProgram(this.sprite);
  }
}
