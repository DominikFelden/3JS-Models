import {
  WebGLRenderTarget, DepthTexture, FloatType, HalfFloatType, ShaderMaterial, Mesh, Scene, OrthographicCamera,
  BufferGeometry, Float32BufferAttribute, Vector2, Color,
} from 'three';

export interface ToonOutlineOptions {
  /** Line width in CSS pixels (scaled by the renderer's pixel ratio), 0.5..4. Default 1.25. */
  thickness?: number;
  /** How dark lines are: line colour = surface colour × darkness (0 = black ink). Default 0.3. */
  darkness?: number;
  /** Ink colour mixed into the line (the surface colour's share is 1 - inkMix). Default 0x2a1e2e. */
  ink?: number | string | Color;
  /** Share of `ink` in the line colour, 0..1. Default 0.35. */
  inkMix?: number;
  /** Depth jump (relative to distance) that counts as a silhouette. Default 0.035. */
  threshold?: number;
  /** Strength of crease lines (where a surface bends sharply), 0 = silhouettes only. Default 0.6. */
  creases?: number;
  /** Lines fade out between these view distances (world units). Default [40, 160]. */
  fade?: [number, number];
  /** Line opacity, 0..1. Default 0.9. */
  opacity?: number;
  /** Colour saturation of the whole image (1 = unchanged); a painted look likes a little more. Default 1.12. */
  saturation?: number;
  /** MSAA samples of the scene target (0 = off). Default 4. */
  samples?: number;
}

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
	vUv = position.xy * 0.5 + 0.5;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

const FRAG = /* glsl */`
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform float cameraNear;
uniform float cameraFar;
uniform float isOrtho;
uniform float thickness;
uniform float darkness;
uniform vec3 ink;
uniform float inkMix;
uniform float threshold;
uniform float creases;
uniform vec2 fade;
uniform float opacity;
uniform float saturation;
varying vec2 vUv;

float viewDepth( const in vec2 uv ) {
	float d = texture2D( tDepth, uv ).x;
	float z = isOrtho > 0.5 ? orthographicDepthToViewZ( d, cameraNear, cameraFar ) : perspectiveDepthToViewZ( d, cameraNear, cameraFar );
	return -z;
}

void main() {
	vec4 base = texture2D( tColor, vUv );
	base.rgb = max( mix( vec3( dot( base.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), base.rgb, saturation ), 0.0 );
	vec2 dx = vec2( texel.x * thickness, 0.0 ), dy = vec2( 0.0, texel.y * thickness );
	float d0 = viewDepth( vUv );
	float dl = viewDepth( vUv - dx ), dr = viewDepth( vUv + dx );
	float dd = viewDepth( vUv - dy ), du = viewDepth( vUv + dy );
	// Silhouettes: a neighbour much farther away. Lines sit on the nearer surface, in its own colour.
	float jump = max( max( dl, dr ), max( dd, du ) ) - d0;
	float edge = smoothstep( threshold, threshold * 2.0, jump / d0 );
	// Creases: 1 / depth is affine across a plane in screen space, so its second difference is zero on
	// flat surfaces and grows where the surface bends (only the convex/concave kink, not facet noise).
	if ( creases > 0.0 ) {
		float w0 = 1.0 / d0;
		float cx = abs( 1.0 / dl + 1.0 / dr - 2.0 * w0 ), cy = abs( 1.0 / dd + 1.0 / du - 2.0 * w0 );
		float bend = max( cx, cy ) / ( w0 * thickness );
		edge = max( edge, creases * smoothstep( 0.012, 0.03, bend ) );
	}
	edge *= opacity * ( 1.0 - smoothstep( fade.x, fade.y, d0 ) );
	edge *= step( d0, cameraFar * 0.999 );
	vec3 line = mix( base.rgb * darkness, ink, inkMix );
	gl_FragColor = vec4( mix( base.rgb, line, edge ), 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

/**
 * Ink outlines as one full-screen pass: the scene is drawn once into a target
 * with a depth texture, then silhouettes (depth jumps) and creases (bends) are
 * found in the depth buffer and inked in a darker shade of the surface colour.
 * The same pass lifts colour saturation a little (`saturation`).
 * Costs no extra draw calls (unlike inverted-hull outlines), which matters on
 * phones; lines fade with distance so far forests do not turn to scribble.
 *
 * Use it instead of `renderer.render(scene, camera)`:
 * ```js
 * const outlines = new ToonOutlines(renderer);
 * outlines.setSize(width, height);      // with renderer.setSize
 * outlines.render(scene, camera);       // each frame
 * ```
 * Tone mapping and the output colour space of the renderer are applied by the
 * pass, so the result matches a plain render. The canvas's own `antialias`
 * is unused; set `samples` instead.
 */
export class ToonOutlines {
  renderer: any;
  enabled = true;
  target: WebGLRenderTarget;
  material: ShaderMaterial;
  private quad: Mesh;
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private thickness = 1.25;

  constructor(renderer, options: ToonOutlineOptions = {}) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new Vector2());
    const depthTexture = new DepthTexture(size.x, size.y, FloatType);
    this.target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: options.samples ?? 4, depthTexture });
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: depthTexture },
        texel: { value: new Vector2(1 / size.x, 1 / size.y) },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        isOrtho: { value: 0 },
        thickness: { value: 1.25 },
        darkness: { value: 0.3 },
        ink: { value: new Color(0x2a1e2e) },
        inkMix: { value: 0.35 },
        threshold: { value: 0.035 },
        creases: { value: 0.6 },
        fade: { value: new Vector2(40, 160) },
        opacity: { value: 0.9 },
        saturation: { value: 1.12 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const tri = new BufferGeometry();
    tri.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new Mesh(tri, this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.set(options);
  }

  /** Change any option except `samples`. */
  set(options: ToonOutlineOptions = {}) {
    const u = this.material.uniforms;
    const num = (key, v, lo, hi) => { if (Number.isFinite(v)) u[key].value = Math.min(hi, Math.max(lo, v)); };
    num('thickness', options.thickness, 0.5, 4);
    num('darkness', options.darkness, 0, 1);
    num('inkMix', options.inkMix, 0, 1);
    num('threshold', options.threshold, 0.001, 1);
    num('creases', options.creases, 0, 1);
    num('opacity', options.opacity, 0, 1);
    num('saturation', options.saturation, 0, 2);
    if (options.ink !== undefined) u.ink.value.set(options.ink);
    if (options.fade) u.fade.value.set(options.fade[0], Math.max(options.fade[0] + 1e-3, options.fade[1]));
    this.thickness = u.thickness.value;
    return this;
  }

  /** Match the renderer's drawing buffer; call after `renderer.setSize` / `setPixelRatio`. */
  setSize(_width?: number, _height?: number) {
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    this.target.setSize(size.x, size.y);
    this.material.uniforms.texel.value.set(1 / size.x, 1 / size.y);
  }

  /** Draw `scene` with outlines to the screen (or the renderer's current target). */
  render(scene, camera) {
    const r = this.renderer;
    if (!this.enabled) {
      r.render(scene, camera);
      return;
    }
    const size = r.getDrawingBufferSize(new Vector2());
    if (size.x !== this.target.width || size.y !== this.target.height) this.setSize();
    const u = this.material.uniforms;
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    u.isOrtho.value = camera.isOrthographicCamera ? 1 : 0;
    u.thickness.value = this.thickness * r.getPixelRatio();
    const out = r.getRenderTarget();
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    r.setRenderTarget(out);
    r.render(this.scene, this.camera);
  }

  dispose() {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
