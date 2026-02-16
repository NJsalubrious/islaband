/**
PixelStortion — High Performance WebGL 2.0 Fluid Simulation Engine
"I only want Aesthetics ---  Not Accuracy!!!!"

Architecture:
Eulerian Grid > Ping-Pong FBOs > Fragment Shader Physics
 Resolution-decoupled: physics solved at SIM_RES, rendered at screen res.
 
Physics pipeline per frame:
 1. Curl >  2. Vorticity Confinement >  3. Divergence
 4. Pressure (Jacobi ×N) >  5. Gradient Subtract
  6. Advect Velocity >  7. Advect Dye >  8. Display + Bloom
Stuff looked up -- 
Fluid effects in a browser - pixelstortion.com - click characters names and move cursor. 

 Papers and reference used:  

Eulerian Grid (Navier-Stokes Physics) 
∂t∂u​=−(u⋅∇)u−ρ1​∇p+F

Link: GPU Gems, Chapter 38: Fast Fluid Dynamics
Advection (Semi-Lagrangian Scheme)
q(x,t+Δt)=q(x−u(x,t)Δt,t)

Link: Stable Fluids (Jos Stam, 1999)
Pressure Projection (Jacobi Iteration)
xi,j(k+1)​=41​(xi−1,j(k)​+xi+1,j(k)​+xi,j−1(k)​+xi,j+1(k)​−αbi,j​)

Link: Jamie Wong: WebGL Fluid Simulation
Vorticity Confinement (Turbulence)
fvc​=ϵ(N×ω)whereN=∣∇∣ω∣∣∇∣ω∣​

Link: Visual Guide to Vorticity (Karl Sims)
HDR Bloom (Dual Kawase Blur)
Cout​=i=0∑N​Upsample(Downsample(Cin​,2i))

Link: SIGGRAPH 2015: Dual Filtering for Bloom
Simulated Audio Oscillator (CORS Fallback)
E(t)=(sin(t⋅BPM)3⋅0.55)+(sin(t⋅0.3)⋅0.30)+Noise

Link: Web Audio API Best Practices

 */

'use strict';

// ─────────────────────────────────────────────────────────────
// 1. CONFIG
// ─────────────────────────────────────────────────────────────

const CONFIG = {
    SIM_RESOLUTION: 256,   // Physics grid size (pixes). note 128 mobile and 256 desktop.
    DYE_RESOLUTION: 1024,  // Dye (col ) texture resolution. Higher = sharper smoke.
    DENSITY_DISSIPATION: 0.97,
    VELOCITY_DISSIPATION: 0.98,
    PRESSURE: 0.8,
    PRESSURE_ITERATIONS: 20,
    CURL: 30,
    SPLAT_RADIUS: 0.25,
    SPLAT_FORCE: 6000,
    BLOOM: true,
    BLOOM_ITERATIONS: 8,
    BLOOM_RESOLUTION: 256,
    BLOOM_INTENSITY: 0.8,
    BLOOM_THRESHOLD: 0.6,
    BLOOM_SOFT_KNEE: 0.7,
    COLOR: [0.0, 1.0, 0.25],   // Current ain RGB
    GRAVITY: 0.0,                 // Downw  force (DOMINIC uses this cause he be down)
};

// ─────────────────────────────────────────────────────────────
// feelings as presets — mapped from character names 
// ─────────────────────────────────────────────────────────────

const VIBES = {
    SILENCE: { color: [0.0, 1.0, 0.25], curl: 20, densDiss: 0.96, velDiss: 0.98, pIter: 20, bloom: 0.5, gravity: 0.0 },
    ISLA: { color: [0.42, 0.48, 1.0], curl: 55, densDiss: 0.995, velDiss: 0.995, pIter: 10, bloom: 1.2, gravity: 0.0 },
    ETHEL: { color: [1.0, 0.66, 0.2], curl: 30, densDiss: 0.97, velDiss: 0.99, pIter: 40, bloom: 0.8, gravity: 0.0 },
    DOMINIC: { color: [0.35, 0.02, 0.02], curl: 2, densDiss: 0.998, velDiss: 0.99, pIter: 40, bloom: 0.15, gravity: 980.0 },
    WITNESS: { color: [0.25, 0.04, 0.06], curl: 3, densDiss: 0.998, velDiss: 0.97, pIter: 35, bloom: 0.1, gravity: 490.0 },
    KINLEY: { color: [0.55, 0.50, 0.30], curl: 12, densDiss: 0.94, velDiss: 0.96, pIter: 25, bloom: 0.4, gravity: 0.0 },
    STICKY: { color: [0.36, 0.68, 0.89], curl: 25, densDiss: 0.96, velDiss: 0.98, pIter: 20, bloom: 0.7, gravity: 0.0 },
    NALANI: { color: [1.0, 0.3, 0.0], curl: 45, densDiss: 0.96, velDiss: 0.98, pIter: 30, bloom: 1.0, gravity: 0.0 },
};

// ─────────────────────────────────────────────────────────────
// 2. GLSL SHAD SOURCE
// ─────────────────────────────────────────────────────────────

const baseVertexShader = `
    precision highp float;
    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform vec2 texelSize;
    void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`;

const blurVertexShader = `
    precision highp float;
    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    uniform vec2 texelSize;
    void main () {
        vUv = aPosition * 0.5 + 0.5;
        float offset = 1.33333333;
        vL = vUv - texelSize * offset;
        vR = vUv + texelSize * offset;
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`;

const blurShader = `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    uniform sampler2D uTexture;
    void main () {
        vec4 sum = texture2D(uTexture, vUv) * 0.29411764;
        sum += texture2D(uTexture, vL) * 0.35294117;
        sum += texture2D(uTexture, vR) * 0.35294117;
        gl_FragColor = sum;
    }
`;

const copyShader = `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    void main () {
        gl_FragColor = texture2D(uTexture, vUv);
    }
`;

const clearShader = `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float value;
    void main () {
        gl_FragColor = value * texture2D(uTexture, vUv);
    }
`;

const splatShader = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio;
    uniform vec3 color;
    uniform vec2 point;
    uniform float radius;
    void main () {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
    }
`;

const advectionShader = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform vec2 dyeTexelSize;
    uniform float dt;
    uniform float dissipation;
    void main () {
        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
        vec4 result = dissipation * texture2D(uSource, coord);
        float decay = dissipation;
        gl_FragColor = vec4(result.rgb * decay, result.a);
    }
`;

const divergenceShader = `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    void main () {
        float L = texture2D(uVelocity, vL).x;
        float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y;
        float B = texture2D(uVelocity, vB).y;
        vec2 C = texture2D(uVelocity, vUv).xy;
        if (vL.x < 0.0) { L = -C.x; }
        if (vR.x > 1.0) { R = -C.x; }
        if (vT.y > 1.0) { T = -C.y; }
        if (vB.y < 0.0) { B = -C.y; }
        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }
`;

const curlShader = `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    void main () {
        float L = texture2D(uVelocity, vL).y;
        float R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x;
        float B = texture2D(uVelocity, vB).x;
        float vorticity = R - L - T + B;
        gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
    }
`;

const vorticityShader = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform float curl;
    uniform float dt;
    void main () {
        float L = texture2D(uCurl, vL).x;
        float R = texture2D(uCurl, vR).x;
        float T = texture2D(uCurl, vT).x;
        float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= curl * C;
        force.y *= -1.0;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity += force * dt;
        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
`;

const pressureShader = `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;
    void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        float divergence = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
`;

const gradientSubtractShader = `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;
    void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity.xy -= vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
`;

// Grave ravity shader — adds a downward force to velocity for the hellish  psycho that is DOMINIC 
const gravityShader = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform float gravity;
    uniform float dt;
    void main () {
        vec2 vel = texture2D(uVelocity, vUv).xy;
        vel.y -= gravity * dt;
        gl_FragColor = vec4(vel, 0.0, 1.0);
    }
`;

// Bloom pre filter
const bloomPrefilterShader = `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform vec3 curve;
    uniform float threshold;
    void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
        float br = max(c.r, max(c.g, c.b));
        float rq = clamp(br - curve.x, 0.0, curve.y);
        rq = curve.z * rq * rq;
        c *= max(rq, br - threshold) / max(br, 0.0001);
        gl_FragColor = vec4(c, 0.0);
    }
`;

// Bloom final comp 
const bloomFinalShader = `
    precision mediump float;
    precision mediump sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform sampler2D uBloom;
    uniform sampler2D uDithering;
    uniform vec2 ditherScale;
    uniform float bloomIntensity;
    void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
        vec3 bloom = texture2D(uBloom, vUv).rgb;
        c += bloom * bloomIntensity;
        // Tone-map (Reinhard)
        c = c / (c + vec3(1.0));
        // Gamma
        c = pow(c, vec3(1.0 / 2.2));
        gl_FragColor = vec4(c, 1.0);
    }
`;

// Simp  display (no bloom in site)
const displayShader = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
        // Tone-map (Reinhard)
        c = c / (c + vec3(1.0));
        // Gamma
        c = pow(c, vec3(1.0 / 2.2));
        gl_FragColor = vec4(c, 1.0);
    }
`;

// ─────────────────────────────────────────────────────────────
// 3. WEBGL HELPERS
// ─────────────────────────────────────────────────────────────

function getWebGLContext(canvas) {
    const params = {
        alpha: true,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: false,
    };

    let gl = canvas.getContext('webgl2', params);
    const isWebGL2 = !!gl;

    if (!isWebGL2) {
        gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);
    }

    if (!gl) {
        console.error('WebGL not supported. Fluid simulation disabled.');
        return null;
    }

    let halfFloat;
    let supportLinearFiltering;

    if (isWebGL2) {
        gl.getExtension('EXT_color_buffer_float');
        supportLinearFiltering = gl.getExtension('OES_texture_float_linear');
    } else {
        halfFloat = gl.getExtension('OES_texture_half_float');
        supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear');
    }

    gl.clearColor(0.0, 0.0, 0.0, 1.0);

    const halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : (halfFloat ? halfFloat.HALF_FLOAT_OES : gl.UNSIGNED_BYTE);

    let formatRGBA, formatRG, formatR;

    if (isWebGL2) {
        formatRGBA = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
        formatR = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
    } else {
        formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatRG = formatRGBA;
        formatR = formatRGBA;
    }

    // Mobile check — reduce resolution on crap devices
    if (/Mobi|Android/i.test(navigator.userAgent)) {
        CONFIG.SIM_RESOLUTION = 128;
        CONFIG.DYE_RESOLUTION = 512;
        CONFIG.BLOOM_RESOLUTION = 128;
        CONFIG.BLOOM_ITERATIONS = 4;
        CONFIG.PRESSURE_ITERATIONS = 15;
    }

    return {
        gl,
        ext: {
            formatRGBA,
            formatRG,
            formatR,
            halfFloatTexType,
            supportLinearFiltering,
        },
    };
}

function getSupportedFormat(gl, internalFormat, format, type) {
    if (!supportRenderTextureFormat(gl, internalFormat, format, type)) {
        // Fallback: try RGBA with unsigned byt 
        console.warn('Float texture format not supported, falling back to RGBA8.');
        return { internalFormat: gl.RGBA, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    }
    return { internalFormat, format, type };
}

function supportRenderTextureFormat(gl, internalFormat, format, type) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(texture);

    return status === gl.FRAMEBUFFER_COMPLETE;
}

// ─────────────────────────────────────────────────────────────
// 4. SHADER PROGRAM COMP 
// ─────────────────────────────────────────────────────────────

class GLProgram {
    constructor(gl, vertexShader, fragmentShader) {
        this.gl = gl;
        this.uniforms = {};
        this.program = gl.createProgram();

        gl.attachShader(this.program, vertexShader);
        gl.attachShader(this.program, fragmentShader);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error(gl.getProgramInfoLog(this.program));
            return;
        }

        const uniformCount = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < uniformCount; i++) {
            const uniformName = gl.getActiveUniform(this.program, i).name;
            this.uniforms[uniformName] = gl.getUniformLocation(this.program, uniformName);
        }
    }

    bind() {
        this.gl.useProgram(this.program);
    }
}

function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

// ─────────────────────────────────────────────────────────────
// 5. FBO (Fram  buff  Object) MANAGEMENT
// ─────────────────────────────────────────────────────────────

function createFBO(gl, w, h, internalFormat, format, type, filtering) {
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filtering);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filtering);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const texelSizeX = 1.0 / w;
    const texelSizeY = 1.0 / h;

    return {
        texture,
        fbo,
        width: w,
        height: h,
        texelSizeX,
        texelSizeY,
        attach(id) {
            gl.activeTexture(gl.TEXTURE0 + id);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            return id;
        },
    };
}

function createDoubleFBO(gl, w, h, internalFormat, format, type, filtering) {
    let fbo1 = createFBO(gl, w, h, internalFormat, format, type, filtering);
    let fbo2 = createFBO(gl, w, h, internalFormat, format, type, filtering);

    return {
        width: w,
        height: h,
        texelSizeX: fbo1.texelSizeX,
        texelSizeY: fbo1.texelSizeY,
        get read() { return fbo1; },
        set read(v) { fbo1 = v; },
        get write() { return fbo2; },
        set write(v) { fbo2 = v; },
        swap() {
            const temp = fbo1;
            fbo1 = fbo2;
            fbo2 = temp;
        },
    };
}

function resizeFBO(gl, target, w, h, internalFormat, format, type, filtering) {
    const newFBO = createFBO(gl, w, h, internalFormat, format, type, filtering);
    // Could copy old data > new, but for fluids it's fine to lose state on resize.
    return newFBO;
}

function resizeDoubleFBO(gl, target, w, h, internalFormat, format, type, filtering) {
    // Recreate
    return createDoubleFBO(gl, w, h, internalFormat, format, type, filtering);
}

// ─────────────────────────────────────────────────────────────
// 6. POINTER  ---- INTERACTION TRACKING
// ─────────────────────────────────────────────────────────────

class Pointer {
    constructor() {
        this.id = -1;
        this.texcoordX = 0;
        this.texcoordY = 0;
        this.prevTexcoordX = 0;
        this.prevTexcoordY = 0;
        this.deltaX = 0;
        this.deltaY = 0;
        this.down = false;
        this.moved = false;
        this.color = [0, 0, 0];
    }
}

// ─────────────────────────────────────────────────────────────
// 7. MAIN FLUID SIM  CLASS
// ─────────────────────────────────────────────────────────────

class FluidSimulator {
    constructor(canvas, audioController) {
        this.canvas = canvas;
        this.audioController = audioController;

        const ctx = getWebGLContext(canvas);
        if (!ctx) return;

        this.gl = ctx.gl;
        this.ext = ctx.ext;

        this.pointers = [new Pointer()];
        this.splatStack = [];
        this.currentColor = CONFIG.COLOR.slice();
        this.targetColor = CONFIG.COLOR.slice();
        this.lastUpdateTime = Date.now();
        this.colorUpdateSpeed = 8;

        this._initPrograms();
        this._initFramebuffers();
        this._initListeners();

        // Schedule ambient splat splat to keep the fluid alive even without visitor interaction
        this._ambientSplatTimer = 0;

        this.update();
    }

    // ───── Compile  shader pros ─────
    _initPrograms() {
        const gl = this.gl;

        const vs = compileShader(gl, gl.VERTEX_SHADER, baseVertexShader);
        const bvs = compileShader(gl, gl.VERTEX_SHADER, blurVertexShader);

        this.blurProgram = new GLProgram(gl, bvs, compileShader(gl, gl.FRAGMENT_SHADER, blurShader));
        this.copyProgram = new GLProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, copyShader));
        this.clearProgram = new GLProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, clearShader));
        this.splatProgram = new GLProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, splatShader));
        this.advectionProgram = new GLProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, advectionShader));
        this.divergenceProgram = new GLProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, divergenceShader));
        this.curlProgram = new GLProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, curlShader));
        this.vorticityProgram = new GLProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, vorticityShader));
        this.pressureProgram = new GLProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, pressureShader));
        this.gradientSubtractProgram = new GLProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, gradientSubtractShader));
        this.gravityProgram = new GLProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, gravityShader));
        this.displayProgram = new GLProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, displayShader));
        this.bloomPrefilterProgram = new GLProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, bloomPrefilterShader));
        this.bloomFinalProgram = new GLProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, bloomFinalShader));

        // Full screen quad (triangle strip blit)
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);

        const indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);
    }

    blit(target) {
        const gl = this.gl;
        if (target == null) {
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        } else {
            gl.viewport(0, 0, target.width, target.height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        }
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    // ───── Create FBOs ─────
    _initFramebuffers() {
        const gl = this.gl;
        const ext = this.ext;

        const simW = this._getResolution(CONFIG.SIM_RESOLUTION);
        const dyeW = this._getResolution(CONFIG.DYE_RESOLUTION);

        const texType = ext.formatRGBA.type;
        const rgba = ext.formatRGBA;
        const rg = ext.formatRG;
        const r = ext.formatR;
        const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

        this.dye = createDoubleFBO(gl, dyeW.width, dyeW.height, rgba.internalFormat, rgba.format, texType, filtering);
        this.velocity = createDoubleFBO(gl, simW.width, simW.height, rg.internalFormat, rg.format, texType, filtering);
        this.divergenceFBO = createFBO(gl, simW.width, simW.height, r.internalFormat, r.format, texType, gl.NEAREST);
        this.curlFBO = createFBO(gl, simW.width, simW.height, r.internalFormat, r.format, texType, gl.NEAREST);
        this.pressure = createDoubleFBO(gl, simW.width, simW.height, r.internalFormat, r.format, texType, gl.NEAREST);

        // Bloom FBOs
        this.bloom = [];
        if (CONFIG.BLOOM) {
            let bw = this._getResolution(CONFIG.BLOOM_RESOLUTION);
            for (let i = 0; i < CONFIG.BLOOM_ITERATIONS; i++) {
                let w = Math.max(1, bw.width >> i);
                let h = Math.max(1, bw.height >> i);
                this.bloom.push(createFBO(gl, w, h, rgba.internalFormat, rgba.format, texType, filtering));
            }
        }
    }

    _getResolution(resolution) {
        let aspectRatio = this.canvas.width / this.canvas.height;
        if (aspectRatio < 1) aspectRatio = 1 / aspectRatio;
        const min = Math.round(resolution);
        const max = Math.round(resolution * aspectRatio);
        if (this.canvas.width > this.canvas.height)
            return { width: max, height: min };
        else
            return { width: min, height: max };
    }

    resize() {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
            this._initFramebuffers();
        }
    }

    // ───── Input listeners ─────
    _initListeners() {
        // Listen on WINDOW to capture events even through overlays (panels)

        window.addEventListener('mousedown', (e) => {
            const p = this.pointers[0];
            p.down = true;
            p.color = this._generateColor();
            this._updatePointerDownData(p, e.clientX, e.clientY);
        });

        window.addEventListener('mousemove', (e) => {
            const p = this.pointers[0];
            //  mouse move must be like   like a drag if buttons are down, or passive hover
            if (!p.down && !e.buttons) {
                this._updatePointerMoveData(p, e.clientX, e.clientY);
                p.moved = p.deltaX !== 0 || p.deltaY !== 0;
                return;
            }
            this._updatePointerMoveData(p, e.clientX, e.clientY);
            p.moved = true;
        });

        window.addEventListener('mouseup', () => {
            this.pointers[0].down = false;
        });

        window.addEventListener('touchstart', (e) => {
            // Do NOT prevent Default, so clicks/scroll still work
            const touches = e.targetTouches;
            while (this.pointers.length < touches.length + 1) {
                this.pointers.push(new Pointer());
            }
            for (let i = 0; i < touches.length; i++) {
                const p = this.pointers[i + 1];
                p.id = touches[i].identifier;
                p.down = true;
                p.color = this._generateColor();
                // Use  coordinates directly
                this._updatePointerDownData(p, touches[i].clientX, touches[i].clientY);
            }
        }, { passive: true }); // Passive to allow scrolling // clicks

        window.addEventListener('touchmove', (e) => {
            // Do NOT prevent Default
            const touches = e.targetTouches;
            for (let i = 0; i < touches.length; i++) {
                const p = this.pointers.find(pp => pp.id === touches[i].identifier);
                if (!p) continue;
                this._updatePointerMoveData(p, touches[i].clientX, touches[i].clientY);
                p.moved = true;
            }
        }, { passive: true });

        window.addEventListener('touchend', (e) => {
            const touches = e.changedTouches;
            for (let i = 0; i < touches.length; i++) {
                const p = this.pointers.find(pp => pp.id === touches[i].identifier);
                if (p) p.down = false;
            }
        });

        window.addEventListener('resize', () => this.resize());
    }

    _updatePointerDownData(pointer, posX, posY) {
        // posX/Y are now clientX/Y (viewport coordinates). 
        // Since canvas is fixed inset-0, canvas.width/height matches viewport.
        pointer.prevTexcoordX = posX / window.innerWidth;
        pointer.prevTexcoordY = 1.0 - posY / window.innerHeight;
        pointer.texcoordX = pointer.prevTexcoordX;
        pointer.texcoordY = pointer.prevTexcoordY;

        // Safety check for NaN
        if (isNaN(pointer.texcoordX)) pointer.texcoordX = 0;
        if (isNaN(pointer.texcoordY)) pointer.texcoordY = 0;

        pointer.deltaX = 0;
        pointer.deltaY = 0;
    }

    _updatePointerMoveData(pointer, posX, posY) {
        pointer.prevTexcoordX = pointer.texcoordX;
        pointer.prevTexcoordY = pointer.texcoordY;
        pointer.texcoordX = posX / window.innerWidth;
        pointer.texcoordY = 1.0 - posY / window.innerHeight;
        pointer.deltaX = this._correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX);
        pointer.deltaY = this._correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY);
    }

    _correctDeltaX(delta) {
        const aspectRatio = this.canvas.width / this.canvas.height;
        if (aspectRatio < 1) delta *= aspectRatio;
        return delta;
    }

    _correctDeltaY(delta) {
        const aspectRatio = this.canvas.width / this.canvas.height;
        if (aspectRatio > 1) delta /= aspectRatio;
        return delta;
    }

    _generateColor() {
        return { r: this.currentColor[0], g: this.currentColor[1], b: this.currentColor[2] };
    }

    // ───── External API: Update config from Vibe system ─────
    updateConfig(vibeName) {
        const vibe = VIBES[vibeName] || VIBES.SILENCE;
        this.targetColor = vibe.color.slice();
        CONFIG.CURL = vibe.curl;
        CONFIG.DENSITY_DISSIPATION = vibe.densDiss;
        CONFIG.VELOCITY_DISSIPATION = vibe.velDiss;
        CONFIG.PRESSURE_ITERATIONS = vibe.pIter;
        CONFIG.BLOOM_INTENSITY = vibe.bloom;
        CONFIG.GRAVITY = vibe.gravity;

        console.log(`[Fluid] Vibe → ${vibeName}`, vibe);
    }

    // ───── MAIN ANIMATION LOOP ─────
    update() {
        const dt = this._calcDeltaTime();

        this.resize();

        // Smooth color interpolation
        const speed = this.colorUpdateSpeed * dt;
        this.currentColor[0] += (this.targetColor[0] - this.currentColor[0]) * speed;
        this.currentColor[1] += (this.targetColor[1] - this.currentColor[1]) * speed;
        this.currentColor[2] += (this.targetColor[2] - this.currentColor[2]) * speed;

        // Audio-reactive injection
        this._processAudio(dt);

        // Process pointer input
        this._processPointers();

        // Handle programmatic splats (from audio)
        this._processSplatStack();

        // Ambient splats — keeps the fluid alive when idle
        this._ambientSplatTimer += dt;
        if (this._ambientSplatTimer > 3.0) {
            this._ambientSplatTimer = 0;
            this._ambientSplat();
        }

        // === PHYSICS PIPELINE ===
        this._stepCurl();
        this._stepVorticity(dt);
        if (CONFIG.GRAVITY !== 0) this._stepGravity(dt);
        this._stepDivergence();
        this._stepClearPressure();
        this._stepPressure();
        this._stepGradientSubtract();
        this._stepAdvection(dt);

        // === RENDER ===
        this._render();

        requestAnimationFrame(() => this.update());
    }

    _calcDeltaTime() {
        const now = Date.now();
        let dt = (now - this.lastUpdateTime) / 1000;
        dt = Math.min(dt, 0.016666); // Cap at 60fps equivalent
        this.lastUpdateTime = now;
        return dt;
    }

    _processAudio(dt) {
        if (!this.audioController) return;

        // Try multi-band analysis first (bass/mid/treble)
        const bands = this.audioController.getMultiBandData
            ? this.audioController.getMultiBandData()
            : null;

        if (bands && (bands.bass > 0 || bands.mid > 0 || bands.treble > 0)) {
            // ── Peak detection: track previous frame to find transients ──
            if (!this._prevBands) this._prevBands = { bass: 0, mid: 0, treble: 0 };
            const bassDelta = Math.max(0, bands.bass - this._prevBands.bass);
            const midDelta = Math.max(0, bands.mid - this._prevBands.mid);
            this._prevBands = { bass: bands.bass, mid: bands.mid, treble: bands.treble };

            // ── BASS: Explosive only on sudden hits (drums, kicks) ──
            // Exponential curve: quiet bass does almost nothing, heavy hits detonate
            const bassIntensity = Math.pow(bands.bass, 3); // 0.3→0.027, 0.6→0.216, 0.9→0.729
            const bassIsHit = bassDelta > 0.08; // Sudden jump = a drum hit

            if (bassIsHit && bassIntensity > 0.02) {
                // DETONATION — only on actual transient hits
                const force = bassIntensity * 12000;
                const x = 0.25 + Math.random() * 0.5;
                const y = 0.25 + Math.random() * 0.5;
                const angle = Math.random() * Math.PI * 2;
                this.splatStack.push({
                    x, y,
                    dx: Math.cos(angle) * force,
                    dy: Math.sin(angle) * force,
                    color: {
                        r: this.currentColor[0] * (1.5 + bassIntensity * 3),
                        g: this.currentColor[1] * (0.3 + bassIntensity),
                        b: this.currentColor[2] * (0.8 + bassIntensity * 2),
                    },
                });
            } else if (bands.bass > 0.25 && Math.random() < bassIntensity * 0.3) {
                // Sustained bass: slow, heavy push (not explosion)
                const x = 0.3 + Math.random() * 0.4;
                const y = 0.3 + Math.random() * 0.4;
                const force = bassIntensity * 3000;
                const angle = Math.random() * Math.PI * 2;
                this.splatStack.push({
                    x, y,
                    dx: Math.cos(angle) * force,
                    dy: Math.sin(angle) * force,
                    color: {
                        r: this.currentColor[0] * (0.8 + bassIntensity),
                        g: this.currentColor[1] * 0.5,
                        b: this.currentColor[2] * (0.6 + bassIntensity * 0.5),
                    },
                });
            }

            // ── MIDS: Gentle to moderate flow (vocals, melody) ──
            const midIntensity = Math.pow(bands.mid, 2.5); // softer curve than bass
            if (bands.mid > 0.15 && Math.random() < midIntensity * 0.4) {
                const x = Math.random();
                const y = Math.random();
                const force = midIntensity * 2500;
                const dx = (Math.random() - 0.5) * force;
                const dy = (Math.random() - 0.5) * force;
                this.splatStack.push({
                    x, y, dx, dy,
                    color: {
                        r: this.currentColor[0] * (0.7 + midIntensity * 0.8),
                        g: this.currentColor[1] * (0.7 + midIntensity * 0.8),
                        b: this.currentColor[2] * (0.7 + midIntensity * 0.5),
                    },
                });
            }

            // ── TREBLE: Tiny delicate wisps (hi-hats, breath, air) ──
            if (bands.treble > 0.12 && Math.random() < 0.08) {
                const x = Math.random();
                const y = Math.random();
                const dx = (Math.random() - 0.5) * 600;
                const dy = (Math.random() - 0.5) * 600;
                this.splatStack.push({
                    x, y, dx, dy,
                    color: {
                        r: this.currentColor[0] * 0.4,
                        g: this.currentColor[1] * (0.5 + bands.treble * 0.5),
                        b: this.currentColor[2] * (0.6 + bands.treble),
                    },
                });
            }

            // ── QUIET PASSAGE: Gentle breathing wisp ──
            const totalEnergy = bands.bass + bands.mid + bands.treble;
            if (totalEnergy > 0.05 && totalEnergy < 0.4 && Math.random() < 0.06) {
                // Very soft, slow-moving barely-visible wisps
                const x = 0.3 + Math.random() * 0.4;
                const y = 0.3 + Math.random() * 0.4;
                const angle = Math.random() * Math.PI * 2;
                const force = totalEnergy * 400;
                this.splatStack.push({
                    x, y,
                    dx: Math.cos(angle) * force,
                    dy: Math.sin(angle) * force,
                    color: {
                        r: this.currentColor[0] * 0.3,
                        g: this.currentColor[1] * 0.3,
                        b: this.currentColor[2] * 0.3,
                    },
                });
            }

            return; // Used multi-band, skip single-energy
        }

        // Fallback: single energy mode (with exponential scaling)
        const energy = this.audioController.getAudioData() / 255.0;
        const scaledEnergy = Math.pow(energy, 3); // exponential: quiet stays quiet
        if (energy > 0.3 && Math.random() < scaledEnergy * 0.5) {
            const x = Math.random();
            const y = Math.random();
            const dx = (Math.random() - 0.5) * 6000 * scaledEnergy;
            const dy = (Math.random() - 0.5) * 6000 * scaledEnergy;
            this.splatStack.push({
                x, y, dx, dy,
                color: {
                    r: this.currentColor[0] * (0.8 + scaledEnergy),
                    g: this.currentColor[1] * (0.8 + scaledEnergy),
                    b: this.currentColor[2] * (0.8 + scaledEnergy),
                },
            });
        }
    }

    _processPointers() {
        for (const p of this.pointers) {
            if (p.moved) {
                p.moved = false;
                const color = p.down ? p.color : this._generateColor();
                const force = p.down ? CONFIG.SPLAT_FORCE : CONFIG.SPLAT_FORCE * 0.3;
                this._splat(p.texcoordX, p.texcoordY, p.deltaX * force, p.deltaY * force, color);
            }
        }
    }

    _processSplatStack() {
        for (const s of this.splatStack) {
            this._splat(s.x, s.y, s.dx, s.dy, s.color);
        }
        this.splatStack = [];
    }

    _ambientSplat() {
        const color = {
            r: this.currentColor[0] * 0.4,
            g: this.currentColor[1] * 0.4,
            b: this.currentColor[2] * 0.4,
        };
        const x = Math.random();
        const y = Math.random();
        const dx = (Math.random() - 0.5) * 800;
        const dy = (Math.random() - 0.5) * 800;
        this._splat(x, y, dx, dy, color);
    }

    // ───── SPLAT: Inject color + velocity ─────
    _splat(x, y, dx, dy, color) {
        const gl = this.gl;

        // Velocity splat
        this.splatProgram.bind();
        gl.uniform1i(this.splatProgram.uniforms.uTarget, this.velocity.read.attach(0));
        gl.uniform1f(this.splatProgram.uniforms.aspectRatio, this.canvas.width / this.canvas.height);
        gl.uniform2f(this.splatProgram.uniforms.point, x, y);
        gl.uniform3f(this.splatProgram.uniforms.color, dx, dy, 0.0);
        gl.uniform1f(this.splatProgram.uniforms.radius, this._correctRadius(CONFIG.SPLAT_RADIUS / 100.0));
        this.blit(this.velocity.write);
        this.velocity.swap();

        // Dye splat
        gl.uniform1i(this.splatProgram.uniforms.uTarget, this.dye.read.attach(0));
        gl.uniform3f(this.splatProgram.uniforms.color, color.r, color.g, color.b);
        gl.uniform1f(this.splatProgram.uniforms.radius, this._correctRadius(CONFIG.SPLAT_RADIUS / 100.0));
        this.blit(this.dye.write);
        this.dye.swap();
    }

    _correctRadius(radius) {
        const aspectRatio = this.canvas.width / this.canvas.height;
        if (aspectRatio > 1) return radius * aspectRatio;
        return radius;
    }

    // ───── PHYSICS STEPS ─────

    _stepCurl() {
        const gl = this.gl;
        this.curlProgram.bind();
        gl.uniform2f(this.curlProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(this.curlProgram.uniforms.uVelocity, this.velocity.read.attach(0));
        this.blit(this.curlFBO);
    }

    _stepVorticity(dt) {
        const gl = this.gl;
        this.vorticityProgram.bind();
        gl.uniform2f(this.vorticityProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(this.vorticityProgram.uniforms.uVelocity, this.velocity.read.attach(0));
        gl.uniform1i(this.vorticityProgram.uniforms.uCurl, this.curlFBO.attach(1));
        gl.uniform1f(this.vorticityProgram.uniforms.curl, CONFIG.CURL);
        gl.uniform1f(this.vorticityProgram.uniforms.dt, dt);
        this.blit(this.velocity.write);
        this.velocity.swap();
    }

    _stepGravity(dt) {
        const gl = this.gl;
        this.gravityProgram.bind();
        gl.uniform2f(this.gravityProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(this.gravityProgram.uniforms.uVelocity, this.velocity.read.attach(0));
        gl.uniform1f(this.gravityProgram.uniforms.gravity, CONFIG.GRAVITY);
        gl.uniform1f(this.gravityProgram.uniforms.dt, dt);
        this.blit(this.velocity.write);
        this.velocity.swap();
    }

    _stepDivergence() {
        const gl = this.gl;
        this.divergenceProgram.bind();
        gl.uniform2f(this.divergenceProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(this.divergenceProgram.uniforms.uVelocity, this.velocity.read.attach(0));
        this.blit(this.divergenceFBO);
    }

    _stepClearPressure() {
        const gl = this.gl;
        this.clearProgram.bind();
        gl.uniform1i(this.clearProgram.uniforms.uTexture, this.pressure.read.attach(0));
        gl.uniform1f(this.clearProgram.uniforms.value, CONFIG.PRESSURE);
        this.blit(this.pressure.write);
        this.pressure.swap();
    }

    _stepPressure() {
        const gl = this.gl;
        this.pressureProgram.bind();
        gl.uniform2f(this.pressureProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(this.pressureProgram.uniforms.uDivergence, this.divergenceFBO.attach(0));

        for (let i = 0; i < CONFIG.PRESSURE_ITERATIONS; i++) {
            gl.uniform1i(this.pressureProgram.uniforms.uPressure, this.pressure.read.attach(1));
            this.blit(this.pressure.write);
            this.pressure.swap();
        }
    }

    _stepGradientSubtract() {
        const gl = this.gl;
        this.gradientSubtractProgram.bind();
        gl.uniform2f(this.gradientSubtractProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(this.gradientSubtractProgram.uniforms.uPressure, this.pressure.read.attach(0));
        gl.uniform1i(this.gradientSubtractProgram.uniforms.uVelocity, this.velocity.read.attach(1));
        this.blit(this.velocity.write);
        this.velocity.swap();
    }

    _stepAdvection(dt) {
        const gl = this.gl;
        this.advectionProgram.bind();
        gl.uniform2f(this.advectionProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform2f(this.advectionProgram.uniforms.dyeTexelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);

        // Advect velocity
        gl.uniform1i(this.advectionProgram.uniforms.uVelocity, this.velocity.read.attach(0));
        gl.uniform1i(this.advectionProgram.uniforms.uSource, this.velocity.read.attach(0));
        gl.uniform1f(this.advectionProgram.uniforms.dt, dt);
        gl.uniform1f(this.advectionProgram.uniforms.dissipation, CONFIG.VELOCITY_DISSIPATION);
        this.blit(this.velocity.write);
        this.velocity.swap();

        // Advect dye (different resolution!)
        gl.uniform2f(this.advectionProgram.uniforms.dyeTexelSize, this.dye.texelSizeX, this.dye.texelSizeY);
        gl.uniform1i(this.advectionProgram.uniforms.uVelocity, this.velocity.read.attach(0));
        gl.uniform1i(this.advectionProgram.uniforms.uSource, this.dye.read.attach(1));
        gl.uniform1f(this.advectionProgram.uniforms.dissipation, CONFIG.DENSITY_DISSIPATION);
        this.blit(this.dye.write);
        this.dye.swap();
    }

    // ───── RENDER PIPELINE ─────
    _render() {
        const gl = this.gl;

        if (CONFIG.BLOOM && this.bloom.length > 0) {
            this._applyBloom(this.dye.read);
            this._renderBloomFinal();
        } else {
            // Simple display
            this.displayProgram.bind();
            gl.uniform1i(this.displayProgram.uniforms.uTexture, this.dye.read.attach(0));
            this.blit(null);
        }
    }

    _applyBloom(source) {
        const gl = this.gl;
        if (this.bloom.length < 2) return;

        const knee = CONFIG.BLOOM_THRESHOLD * CONFIG.BLOOM_SOFT_KNEE + 0.0001;
        const curve0 = CONFIG.BLOOM_THRESHOLD - knee;
        const curve1 = knee * 2.0;
        const curve2 = 0.25 / knee;

        // Prefilter — extract bright areas
        this.bloomPrefilterProgram.bind();
        gl.uniform1i(this.bloomPrefilterProgram.uniforms.uTexture, source.attach(0));
        gl.uniform3f(this.bloomPrefilterProgram.uniforms.curve, curve0, curve1, curve2);
        gl.uniform1f(this.bloomPrefilterProgram.uniforms.threshold, CONFIG.BLOOM_THRESHOLD);
        this.blit(this.bloom[0]);

        // Downscale blur (Kawase blur approximation via iterative downsample + blur)
        this.blurProgram.bind();
        let last = this.bloom[0];
        for (let i = 1; i < this.bloom.length; i++) {
            gl.uniform2f(this.blurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
            gl.uniform1i(this.blurProgram.uniforms.uTexture, last.attach(0));
            this.blit(this.bloom[i]);
            last = this.bloom[i];
        }

        // Upscale (additive blend back up)
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.enable(gl.BLEND);
        for (let i = this.bloom.length - 2; i >= 0; i--) {
            gl.uniform2f(this.blurProgram.uniforms.texelSize, this.bloom[i].texelSizeX, this.bloom[i].texelSizeY);
            gl.uniform1i(this.blurProgram.uniforms.uTexture, this.bloom[i + 1].attach(0));
            this.blit(this.bloom[i]);
        }
        gl.disable(gl.BLEND);
    }

    _renderBloomFinal() {
        const gl = this.gl;
        this.bloomFinalProgram.bind();
        gl.uniform1i(this.bloomFinalProgram.uniforms.uTexture, this.dye.read.attach(0));
        gl.uniform1i(this.bloomFinalProgram.uniforms.uBloom, this.bloom[0].attach(1));
        gl.uniform1f(this.bloomFinalProgram.uniforms.bloomIntensity, CONFIG.BLOOM_INTENSITY);
        this.blit(null);
    }
}

// ─────────────────────────────────────────────────────────────
// 8. EXPORT
// ─────────────────────────────────────────────────────────────

window.FluidSimulator = FluidSimulator;
window.FLUID_CONFIG = CONFIG;
