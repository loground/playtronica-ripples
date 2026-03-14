import './style.css'
import * as THREE from 'three'

const GRID_COLS = 12
const GRID_ROWS = 6
const MAX_RIPPLES = 96
const RIPPLE_LIFETIME = 5.2

const app = document.querySelector('#app')
app.innerHTML = `
  <div id="hud">
    <div class="row">
      <button id="audio-toggle" type="button">Enable Audio</button>
      <label for="intensity">Drop intensity</label>
      <input id="intensity" type="range" min="0" max="100" value="35" />
      <output id="intensity-value">35%</output>
    </div>
    <div class="row">
      <label for="instrument">Instrument</label>
      <select id="instrument">
        <option value="piano">Piano</option>
        <option value="bell">Bell</option>
        <option value="organ">Organ</option>
        <option value="synth">Synth</option>
      </select>
      <span id="note-label">Tap water to start</span>
    </div>
  </div>
  <div id="keyboard-label">12x6 mini-keyboard mapped across the full screen</div>
`

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
camera.position.z = 1
const clock = new THREE.Clock()

const rippleUniform = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(-10, -10, -100, 0))
const uniforms = {
  uTime: { value: 0 },
  uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  uBackground: { value: null },
  uHasBackground: { value: 0.0 },
  uRippleRadius: { value: 1.0 },
  uRippleAmp: { value: 1.0 },
  uNormalStrength: { value: 28.0 },
  uRippleCount: { value: 0 },
  uRipples: { value: rippleUniform },
}

const material = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;

    #define MAX_RIPPLES ${MAX_RIPPLES}

    varying vec2 vUv;

    uniform float uTime;
    uniform vec2 uResolution;
    uniform sampler2D uBackground;
    uniform float uHasBackground;
    uniform float uRippleRadius;
    uniform float uRippleAmp;
    uniform float uNormalStrength;
    uniform int uRippleCount;
    uniform vec4 uRipples[MAX_RIPPLES];

    float rippleHeight(vec2 uv) {
      float h = 0.0;

      for (int i = 0; i < MAX_RIPPLES; i++) {
        if (i >= uRippleCount) {
          break;
        }
        vec4 ripple = uRipples[i];
        float dt = uTime - ripple.z;
        if (dt < 0.0 || dt > ${RIPPLE_LIFETIME.toFixed(1)}) {
          continue;
        }

        float d = distance(uv, ripple.xy) / max(0.2, uRippleRadius);
        float phase = d * 104.0 - dt * 8.0;
        float envelope = exp(-dt * 1.32) * exp(-d * 5.6);
        h += sin(phase) * envelope * ripple.w * uRippleAmp;
      }

      float n = sin((uv.x + uTime * 0.03) * 30.0) * cos((uv.y - uTime * 0.02) * 24.0) * 0.008;
      return h + n;
    }

    void main() {
      vec2 uv = vUv;
      float h = rippleHeight(uv);

      vec2 px = vec2(1.0 / max(1.0, uResolution.x), 0.0);
      vec2 py = vec2(0.0, 1.0 / max(1.0, uResolution.y));
      float dx = rippleHeight(clamp(uv + px, 0.0, 1.0)) - rippleHeight(clamp(uv - px, 0.0, 1.0));
      float dy = rippleHeight(clamp(uv + py, 0.0, 1.0)) - rippleHeight(clamp(uv - py, 0.0, 1.0));
      vec3 normal = normalize(vec3(-dx * uNormalStrength, -dy * uNormalStrength, 1.0));

      vec3 lightDir = normalize(vec3(-0.3, 0.5, 0.82));
      float diffuse = max(dot(normal, lightDir), 0.0);
      float specular = pow(max(dot(reflect(-lightDir, normal), vec3(0.0, 0.0, 1.0)), 0.0), 26.0);
      float fresnel = pow(1.0 - max(dot(normal, vec3(0.0, 0.0, 1.0)), 0.0), 2.5);

      vec3 deep = vec3(0.012, 0.065, 0.14);
      vec3 mid = vec3(0.05, 0.28, 0.49);
      vec3 crest = vec3(0.65, 0.9, 1.0);
      float waveMix = clamp(h * 0.8 + 0.5, 0.0, 1.0);
      vec3 color = mix(deep, mid, waveMix);

      vec2 refractUv = clamp(uv + normal.xy * 0.05, 0.001, 0.999);
      if (uHasBackground > 0.5) {
        vec2 bgUv = refractUv;
        float screenRatio = uResolution.x / max(1.0, uResolution.y);
        if (screenRatio > 1.0) {
          bgUv.x = (bgUv.x - 0.5) / screenRatio + 0.5;
        } else {
          bgUv.y = (bgUv.y - 0.5) * screenRatio + 0.5;
        }
        vec3 bg = texture2D(uBackground, bgUv).rgb;
        color = mix(bg * 0.7, color, 0.45 + waveMix * 0.35);
      }

      color += crest * specular * 0.65;
      color += vec3(0.26, 0.48, 0.62) * diffuse * 0.25;
      color += vec3(0.4, 0.64, 0.8) * fresnel * 0.18;

      vec2 g = fract(uv * vec2(12.0, 6.0));
      float edge = min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y));
      float gridLine = 1.0 - smoothstep(0.0, 0.016, edge);
      color = mix(color, color + vec3(0.1, 0.12, 0.14), gridLine * 0.65);

      gl_FragColor = vec4(color, 1.0);
    }
  `,
})

const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
scene.add(plane)

const textureLoader = new THREE.TextureLoader()
textureLoader.load('/bh.png', (texture) => {
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  uniforms.uBackground.value = texture
  uniforms.uHasBackground.value = 1.0
})

function applyResponsiveTuning() {
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const narrow = window.matchMedia('(max-width: 820px)').matches
  isMobileLayout = coarse || narrow

  uniforms.uRippleRadius.value = isMobileLayout ? 0.56 : 1.0
  uniforms.uRippleAmp.value = isMobileLayout ? 0.72 : 1.0
  uniforms.uNormalStrength.value = isMobileLayout ? 22.0 : 28.0
}

const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const ripples = []
let dropIntensity = 0.35
let dropAccumulator = 0
const recentlyTriggered = new Map()
let isMobileLayout = false

const intensityInput = document.querySelector('#intensity')
const intensityValue = document.querySelector('#intensity-value')
const instrumentSelect = document.querySelector('#instrument')
const noteLabel = document.querySelector('#note-label')
const audioToggle = document.querySelector('#audio-toggle')

intensityInput.addEventListener('input', () => {
  dropIntensity = Number(intensityInput.value) / 100
  intensityValue.textContent = `${intensityInput.value}%`
})

let audioContext
let masterGain

function ensureAudio() {
  if (audioContext) {
    return
  }
  audioContext = new AudioContext()
  masterGain = audioContext.createGain()
  masterGain.gain.value = 0.34
  masterGain.connect(audioContext.destination)
}

audioToggle.addEventListener('click', async () => {
  ensureAudio()
  await audioContext.resume()
  audioToggle.textContent = 'Audio Active'
})

function midiToFrequency(midi) {
  return 440 * (2 ** ((midi - 69) / 12))
}

function uvToNote(uv) {
  const col = Math.min(GRID_COLS - 1, Math.max(0, Math.floor(uv.x * GRID_COLS)))
  const row = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor(uv.y * GRID_ROWS)))
  const octave = GRID_ROWS - 1 - row
  const midi = 36 + octave * 12 + col
  const noteName = `${notes[midi % 12]}${Math.floor(midi / 12) - 1}`
  return { midi, noteName, col, row }
}

function playNote(midi, velocity, instrument) {
  if (!audioContext || audioContext.state !== 'running') {
    return
  }
  const frequency = midiToFrequency(midi)
  const now = audioContext.currentTime

  if (instrument === 'bell') {
    const carrier = audioContext.createOscillator()
    const mod = audioContext.createOscillator()
    const modGain = audioContext.createGain()
    const out = audioContext.createGain()

    carrier.type = 'sine'
    carrier.frequency.setValueAtTime(frequency, now)
    mod.type = 'sine'
    mod.frequency.setValueAtTime(frequency * 1.5, now)
    modGain.gain.setValueAtTime(frequency * 0.7, now)

    out.gain.setValueAtTime(0.0001, now)
    out.gain.exponentialRampToValueAtTime(0.24 * velocity, now + 0.01)
    out.gain.exponentialRampToValueAtTime(0.0001, now + 1.6)

    mod.connect(modGain)
    modGain.connect(carrier.frequency)
    carrier.connect(out)
    out.connect(masterGain)
    carrier.start(now)
    mod.start(now)
    carrier.stop(now + 1.7)
    mod.stop(now + 1.7)
    return
  }

  const oscA = audioContext.createOscillator()
  const oscB = audioContext.createOscillator()
  const voice = audioContext.createGain()
  const filter = audioContext.createBiquadFilter()

  if (instrument === 'organ') {
    oscA.type = 'square'
    oscB.type = 'sine'
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(4200, now)
  } else if (instrument === 'synth') {
    oscA.type = 'sawtooth'
    oscB.type = 'triangle'
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(3000, now)
    filter.Q.setValueAtTime(5, now)
  } else {
    oscA.type = 'triangle'
    oscB.type = 'sine'
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(2400, now)
  }

  oscA.frequency.setValueAtTime(frequency, now)
  oscB.frequency.setValueAtTime(frequency * 2, now)
  oscB.detune.setValueAtTime(3, now)

  const attack = 0.008
  const decay = instrument === 'organ' ? 0.9 : 1.2
  const peak = 0.24 * velocity

  voice.gain.setValueAtTime(0.0001, now)
  voice.gain.exponentialRampToValueAtTime(peak, now + attack)
  voice.gain.exponentialRampToValueAtTime(0.0001, now + decay)

  oscA.connect(voice)
  oscB.connect(voice)
  voice.connect(filter)
  filter.connect(masterGain)

  oscA.start(now)
  oscB.start(now)
  oscA.stop(now + decay + 0.06)
  oscB.stop(now + decay + 0.06)
}

function tryTriggerNote(uv, velocity) {
  const { midi, noteName, col, row } = uvToNote(uv)
  const key = `${col}-${row}`
  const now = performance.now()
  const previous = recentlyTriggered.get(key) || 0
  if (now - previous < 95) {
    return
  }
  recentlyTriggered.set(key, now)
  noteLabel.textContent = `Now playing: ${noteName}`
  playNote(midi, velocity, instrumentSelect.value)
}

function spawnRipple(uv, strength) {
  const elapsed = uniforms.uTime.value
  ripples.push({
    x: uv.x,
    y: uv.y,
    start: elapsed,
    amp: strength,
  })
  if (ripples.length > MAX_RIPPLES) {
    ripples.shift()
  }
  tryTriggerNote(uv, Math.max(0.25, strength))
}

let pointerDown = false
let lastPointerUV = null
let lastPointerStamp = 0

function getPointerUV(event) {
  const rect = renderer.domElement.getBoundingClientRect()
  const x = (event.clientX - rect.left) / rect.width
  const y = 1 - (event.clientY - rect.top) / rect.height
  return {
    x: THREE.MathUtils.clamp(x, 0, 1),
    y: THREE.MathUtils.clamp(y, 0, 1),
  }
}

renderer.domElement.addEventListener('pointerdown', async (event) => {
  pointerDown = true
  ensureAudio()
  await audioContext.resume()
  audioToggle.textContent = 'Audio Active'
  const uv = getPointerUV(event)
  spawnRipple(uv, 0.95)
  lastPointerUV = uv
  lastPointerStamp = performance.now()
})

renderer.domElement.addEventListener('pointermove', (event) => {
  if (!pointerDown) {
    return
  }
  const uv = getPointerUV(event)
  const now = performance.now()
  if (!lastPointerUV) {
    spawnRipple(uv, 0.9)
    lastPointerUV = uv
    lastPointerStamp = now
    return
  }
  const dist = Math.hypot(uv.x - lastPointerUV.x, uv.y - lastPointerUV.y)
  if (dist > 0.02 || now - lastPointerStamp > 80) {
    spawnRipple(uv, 0.82)
    lastPointerUV = uv
    lastPointerStamp = now
  }
})

const endPointer = () => {
  pointerDown = false
  lastPointerUV = null
}

renderer.domElement.addEventListener('pointerup', endPointer)
renderer.domElement.addEventListener('pointerleave', endPointer)
renderer.domElement.addEventListener('pointercancel', endPointer)

function updateRipples(time) {
  for (let i = ripples.length - 1; i >= 0; i -= 1) {
    if (time - ripples[i].start > RIPPLE_LIFETIME) {
      ripples.splice(i, 1)
    }
  }

  const count = Math.min(ripples.length, MAX_RIPPLES)
  uniforms.uRippleCount.value = count

  for (let i = 0; i < MAX_RIPPLES; i += 1) {
    if (i < count) {
      const r = ripples[ripples.length - count + i]
      rippleUniform[i].set(r.x, r.y, r.start, r.amp)
    } else {
      rippleUniform[i].set(-10, -10, -100, 0)
    }
  }
}

function spawnAutoDrops(dt) {
  const baseRate = isMobileLayout ? 5.2 : 7.5
  const dropsPerSecond = dropIntensity * baseRate
  dropAccumulator += dt * dropsPerSecond

  while (dropAccumulator >= 1) {
    dropAccumulator -= 1
    spawnRipple(
      {
        x: Math.random(),
        y: Math.random(),
      },
      0.55 + Math.random() * 0.27,
    )
  }
}

function animate() {
  requestAnimationFrame(animate)
  const dt = Math.min(clock.getDelta(), 0.05)
  uniforms.uTime.value = clock.elapsedTime
  spawnAutoDrops(dt)
  updateRipples(uniforms.uTime.value)
  renderer.render(scene, camera)
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  uniforms.uResolution.value.set(window.innerWidth, window.innerHeight)
  applyResponsiveTuning()
}

window.addEventListener('resize', onResize)
applyResponsiveTuning()
animate()
