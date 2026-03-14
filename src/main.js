import './style.css'
import * as THREE from 'three'

const GRID_COLS = 12
const GRID_ROWS = 6
const MAX_RIPPLES = 96
const RIPPLE_LIFETIME = 5.2
const CIRCLE_OF_FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]
const HARMONY_MOVES = [1, 1, -2, 1, 2, -1]
const CHORD_TYPES = [
  { name: 'maj9', intervals: [0, 4, 7, 11, 14] },
  { name: '6/9', intervals: [0, 4, 7, 9, 14] },
  { name: 'maj7#11', intervals: [0, 4, 7, 11, 18] },
  { name: 'm9', intervals: [0, 3, 7, 10, 14] },
  { name: 'm11', intervals: [0, 3, 7, 10, 17] },
  { name: '13sus', intervals: [0, 5, 7, 10, 21] },
]

const app = document.querySelector('#app')
app.innerHTML = `
  <div id="hud">
    <div class="row">
      <button id="audio-toggle" type="button">Enable Audio</button>
      <button id="mute-toggle" type="button">Mute</button>
      <label for="trigger-mode">Mode</label>
      <select id="trigger-mode">
        <option value="auto" selected>Auto</option>
        <option value="manual">Manual</option>
      </select>
      <label for="intensity">Drop intensity</label>
      <input id="intensity" type="range" min="0" max="100" value="35" />
      <output id="intensity-value">35%</output>
    </div>
    <div class="row">
      <label for="instrument">Instrument</label>
      <select id="instrument">
        <option value="dx7">DX7 FM</option>
        <option value="piano">Soft Piano</option>
        <option value="pad">Web Pad</option>
        <option value="bell">Glass Bell</option>
        <option value="organ">Organ</option>
        <option value="synth">Analog Synth</option>
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
  uRippleFreq: { value: 104.0 },
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
    uniform float uRippleFreq;
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
        float phase = d * uRippleFreq - dt * 8.0;
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

  uniforms.uRippleRadius.value = isMobileLayout ? 1.12 : 1.0
  uniforms.uRippleAmp.value = isMobileLayout ? 0.88 : 1.0
  uniforms.uNormalStrength.value = isMobileLayout ? 25.0 : 28.0
  uniforms.uRippleFreq.value = isMobileLayout ? 132.0 : 104.0
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
const muteToggle = document.querySelector('#mute-toggle')
const triggerModeSelect = document.querySelector('#trigger-mode')

intensityInput.addEventListener('input', () => {
  dropIntensity = Number(intensityInput.value) / 100
  intensityValue.textContent = `${intensityInput.value}%`
})

let triggerMode = 'auto'
let audioMuted = false
let baseMasterGain = 0.3
let pointerDown = false
let lastPointerUV = null
let lastPointerStamp = 0
let activeManualRipple = null
let manualPressStart = 0
let manualMoved = false
let manualSustain = null
let manualPointerUV = null
const activePointers = new Set()
let harmonyCircleIndex = 0
let harmonyStep = 0
let autoAdvanceCounter = 0
let lastLeadMidi = 57
let currentHarmony = {
  rootPc: CIRCLE_OF_FIFTHS[0],
  name: 'maj9',
  tones: [48, 52, 55, 59, 62],
}

let audioContext
let masterGain
let dryGain
let wetGain
let ambienceConvolver

function ensureAudio() {
  if (audioContext) {
    return
  }
  audioContext = new AudioContext()
  masterGain = audioContext.createGain()
  dryGain = audioContext.createGain()
  wetGain = audioContext.createGain()
  ambienceConvolver = audioContext.createConvolver()

  masterGain.gain.value = baseMasterGain
  dryGain.gain.value = 0.86
  wetGain.gain.value = 0.32
  ambienceConvolver.buffer = createImpulseResponse(audioContext, 2.8, 2.2)

  dryGain.connect(masterGain)
  wetGain.connect(ambienceConvolver)
  ambienceConvolver.connect(masterGain)
  masterGain.connect(audioContext.destination)
}

audioToggle.addEventListener('click', async () => {
  ensureAudio()
  await audioContext.resume()
  audioToggle.textContent = 'Audio Active'
})

muteToggle.addEventListener('click', () => {
  audioMuted = !audioMuted
  muteToggle.textContent = audioMuted ? 'Unmute' : 'Mute'
  if (masterGain) {
    const now = audioContext.currentTime
    masterGain.gain.cancelScheduledValues(now)
    masterGain.gain.setTargetAtTime(audioMuted ? 0.0001 : baseMasterGain, now, 0.015)
  }
})

triggerModeSelect.addEventListener('change', () => {
  triggerMode = triggerModeSelect.value
  intensityInput.disabled = triggerMode === 'manual'
  noteLabel.textContent = triggerMode === 'manual'
    ? 'Manual: tap once, drag to sustain'
    : 'Auto rain mode active'
})

function midiToFrequency(midi) {
  return 440 * (2 ** ((midi - 69) / 12))
}

function createImpulseResponse(context, duration, decay) {
  const rate = context.sampleRate
  const length = Math.floor(rate * duration)
  const buffer = context.createBuffer(2, length, rate)
  for (let c = 0; c < 2; c += 1) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < length; i += 1) {
      const t = i / length
      data[i] = (Math.random() * 2 - 1) * ((1 - t) ** decay)
    }
  }
  return buffer
}

function midiToName(midi) {
  return `${notes[midi % 12]}${Math.floor(midi / 12) - 1}`
}

function closestPitchClassMidi(pc, target) {
  let best = target
  let bestDist = Infinity
  for (let octave = 2; octave <= 7; octave += 1) {
    const cand = octave * 12 + pc
    const d = Math.abs(cand - target)
    if (d < bestDist) {
      bestDist = d
      best = cand
    }
  }
  return best
}

function rebuildHarmony(rootPc, chordType) {
  const tones = chordType.intervals.map((interval) => {
    let tone = 48 + rootPc + interval
    while (tone < 38) tone += 12
    while (tone > 88) tone -= 12
    return tone
  })
  currentHarmony = {
    rootPc,
    name: chordType.name,
    tones,
  }
}

function advanceHarmony(seedUv, isMultiTouch) {
  let move = HARMONY_MOVES[harmonyStep % HARMONY_MOVES.length]
  if (isMultiTouch) {
    move += seedUv.x > 0.5 ? 1 : -1
  }
  if (seedUv.y < 0.25) {
    move += 1
  }
  harmonyCircleIndex = (harmonyCircleIndex + move + 120) % 12
  harmonyStep += 1
  const rootPc = CIRCLE_OF_FIFTHS[harmonyCircleIndex]
  const typeIndex = (harmonyStep + (isMultiTouch ? 2 : 0)) % CHORD_TYPES.length
  rebuildHarmony(rootPc, CHORD_TYPES[typeIndex])
}

function uvToNote(uv) {
  const col = Math.min(GRID_COLS - 1, Math.max(0, Math.floor(uv.x * GRID_COLS)))
  const row = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor(uv.y * GRID_ROWS)))
  const toneIndex = col % currentHarmony.tones.length
  const target = 40 + (1 - uv.y) * 34
  const pitchClass = currentHarmony.tones[toneIndex] % 12
  const midi = closestPitchClassMidi(pitchClass, target)
  const noteName = midiToName(midi)
  return { midi, noteName, col, row, chordName: currentHarmony.name, chordTones: currentHarmony.tones }
}

function routeVoice(node) {
  node.connect(dryGain)
  node.connect(wetGain)
}

function startManualSustain(uv) {
  if (!audioContext || audioContext.state !== 'running') {
    return
  }
  const note = uvToNote(uv)
  const frequency = midiToFrequency(note.midi)
  if (!manualSustain) {
    const oscA = audioContext.createOscillator()
    const oscB = audioContext.createOscillator()
    const gain = audioContext.createGain()
    const filter = audioContext.createBiquadFilter()
    oscA.type = 'sine'
    oscB.type = 'triangle'
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(1500, audioContext.currentTime)
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime)

    oscA.connect(gain)
    oscB.connect(gain)
    gain.connect(filter)
    routeVoice(filter)

    oscA.start()
    oscB.start()

    manualSustain = { oscA, oscB, gain, filter }
  }

  const now = audioContext.currentTime
  manualSustain.oscA.frequency.setTargetAtTime(frequency, now, 0.03)
  manualSustain.oscB.frequency.setTargetAtTime(frequency * 0.5, now, 0.035)
}

function setManualSustainLevel(level) {
  if (!manualSustain || !audioContext) {
    return
  }
  const now = audioContext.currentTime
  const target = Math.max(0.0001, Math.min(0.22, level))
  manualSustain.gain.gain.cancelScheduledValues(now)
  manualSustain.gain.gain.setTargetAtTime(target, now, 0.05)
}

function stopManualSustain(releaseSeconds = 0.25) {
  if (!manualSustain || !audioContext) {
    return
  }
  const now = audioContext.currentTime
  manualSustain.gain.gain.cancelScheduledValues(now)
  manualSustain.gain.gain.setTargetAtTime(0.0001, now, Math.max(0.03, releaseSeconds * 0.4))
  manualSustain.oscA.stop(now + releaseSeconds + 0.12)
  manualSustain.oscB.stop(now + releaseSeconds + 0.12)
  manualSustain = null
}

function playDX7ish(frequency, velocity, now) {
  const carrier = audioContext.createOscillator()
  const mod1 = audioContext.createOscillator()
  const mod2 = audioContext.createOscillator()
  const modGain1 = audioContext.createGain()
  const modGain2 = audioContext.createGain()
  const amp = audioContext.createGain()

  carrier.type = 'sine'
  mod1.type = 'sine'
  mod2.type = 'sine'
  carrier.frequency.setValueAtTime(frequency, now)
  mod1.frequency.setValueAtTime(frequency * 2.0, now)
  mod2.frequency.setValueAtTime(frequency * 3.01, now)

  modGain1.gain.setValueAtTime(frequency * 1.8, now)
  modGain1.gain.exponentialRampToValueAtTime(Math.max(12, frequency * 0.2), now + 1.4)
  modGain2.gain.setValueAtTime(frequency * 0.9, now)
  modGain2.gain.exponentialRampToValueAtTime(Math.max(8, frequency * 0.08), now + 1.2)

  amp.gain.setValueAtTime(0.0001, now)
  amp.gain.exponentialRampToValueAtTime(0.22 * velocity, now + 0.012)
  amp.gain.exponentialRampToValueAtTime(0.0001, now + 1.9)

  mod1.connect(modGain1)
  mod2.connect(modGain2)
  modGain1.connect(carrier.frequency)
  modGain2.connect(carrier.frequency)
  carrier.connect(amp)
  routeVoice(amp)

  carrier.start(now)
  mod1.start(now)
  mod2.start(now)
  carrier.stop(now + 2.0)
  mod1.stop(now + 2.0)
  mod2.stop(now + 2.0)
}

function playNote(midi, velocity, instrument) {
  if (!audioContext || audioContext.state !== 'running') {
    return
  }
  const frequency = midiToFrequency(midi)
  const now = audioContext.currentTime

  if (instrument === 'dx7') {
    playDX7ish(frequency, velocity, now)
    return
  }

  if (instrument === 'pad') {
    const oscA = audioContext.createOscillator()
    const oscB = audioContext.createOscillator()
    const lfo = audioContext.createOscillator()
    const lfoGain = audioContext.createGain()
    const filter = audioContext.createBiquadFilter()
    const out = audioContext.createGain()

    oscA.type = 'triangle'
    oscB.type = 'sine'
    oscA.frequency.setValueAtTime(frequency, now)
    oscB.frequency.setValueAtTime(frequency * 0.5, now)
    oscB.detune.setValueAtTime(6, now)

    lfo.type = 'sine'
    lfo.frequency.setValueAtTime(0.25, now)
    lfoGain.gain.setValueAtTime(10, now)
    lfo.connect(lfoGain)
    lfoGain.connect(oscA.detune)

    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(1200, now)
    filter.Q.setValueAtTime(1.4, now)

    out.gain.setValueAtTime(0.0001, now)
    out.gain.exponentialRampToValueAtTime(0.2 * velocity, now + 0.25)
    out.gain.exponentialRampToValueAtTime(0.0001, now + 3.8)

    oscA.connect(out)
    oscB.connect(out)
    out.connect(filter)
    routeVoice(filter)

    oscA.start(now)
    oscB.start(now)
    lfo.start(now)
    oscA.stop(now + 4.0)
    oscB.stop(now + 4.0)
    lfo.stop(now + 4.0)
    return
  }

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
    routeVoice(out)
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
  routeVoice(filter)

  oscA.start(now)
  oscB.start(now)
  oscA.stop(now + decay + 0.06)
  oscB.stop(now + decay + 0.06)
}

function tryTriggerNote(uv, velocity, source) {
  const isMultiTouch = source === 'pointer' && activePointers.size > 1
  const shouldAdvance =
    source === 'pointer' ||
    source === 'swipe' ||
    source === 'funnel' ||
    source === 'spin' ||
    source === 'loop' ||
    (source === 'auto' && autoAdvanceCounter++ % 4 === 0)

  if (shouldAdvance) {
    advanceHarmony(uv, isMultiTouch)
  }

  const { midi, noteName, col, row, chordName, chordTones } = uvToNote(uv)
  const key = `${col}-${row}`
  const now = performance.now()
  const previous = recentlyTriggered.get(key) || 0
  if (now - previous < 95) {
    return
  }
  if (source === 'auto' && Math.random() > (0.62 + dropIntensity * 0.28)) {
    return
  }
  recentlyTriggered.set(key, now)
  noteLabel.textContent = `Now playing: ${noteName} (${chordName})`
  playNote(midi, velocity, instrumentSelect.value)
  lastLeadMidi = midi

  if (isMultiTouch) {
    const voicing = [0, 2, 3, 4].map((idx, voiceIdx) => {
      const tone = chordTones[idx % chordTones.length]
      const anchor = lastLeadMidi + (voiceIdx - 1) * 6
      return closestPitchClassMidi(tone % 12, anchor)
    })
    voicing.forEach((tone, voiceIdx) => {
      setTimeout(() => {
        playNote(tone, velocity * (0.65 - voiceIdx * 0.08), instrumentSelect.value)
      }, voiceIdx * 42)
    })
  }
}

function spawnRipple(uv, strength, source = 'auto') {
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
  tryTriggerNote(uv, Math.max(0.25, strength), source)
}

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
  activePointers.add(event.pointerId)
  pointerDown = true
  ensureAudio()
  await audioContext.resume()
  audioToggle.textContent = 'Audio Active'
  const uv = getPointerUV(event)
  if (triggerMode === 'manual') {
    spawnRipple(uv, 1.0, 'pointer')
    activeManualRipple = ripples[ripples.length - 1] || null
    manualPointerUV = uv
    manualPressStart = performance.now()
    manualMoved = false
    startManualSustain(uv)
    setManualSustainLevel(0.0001)
  } else {
    spawnRipple(uv, 0.95, 'pointer')
  }
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
    if (triggerMode === 'auto') {
      spawnRipple(uv, 0.9, 'pointer')
    }
    lastPointerUV = uv
    lastPointerStamp = now
    return
  }
  if (triggerMode === 'manual') {
    if (!activeManualRipple) {
      lastPointerUV = uv
      lastPointerStamp = now
      return
    }
    const moveDist = Math.hypot(uv.x - lastPointerUV.x, uv.y - lastPointerUV.y)
    manualMoved = manualMoved || moveDist > 0.0015
    manualPointerUV = uv
    activeManualRipple.x = uv.x
    activeManualRipple.y = uv.y
    activeManualRipple.start = uniforms.uTime.value
    activeManualRipple.amp = 0.95
    startManualSustain(uv)
    setManualSustainLevel(0.13)
    lastPointerUV = uv
    lastPointerStamp = now
    return
  }
  const dist = Math.hypot(uv.x - lastPointerUV.x, uv.y - lastPointerUV.y)
  if (dist > 0.02 || now - lastPointerStamp > 80) {
    spawnRipple(uv, 0.82, 'pointer')
    lastPointerUV = uv
    lastPointerStamp = now
  }
})

const endPointer = (event) => {
  if (event && typeof event.pointerId === 'number') {
    activePointers.delete(event.pointerId)
  } else {
    activePointers.clear()
  }

  if (triggerMode === 'manual' && activePointers.size === 0) {
    const heldFor = performance.now() - manualPressStart
    if (manualMoved || heldFor > 220) {
      stopManualSustain(0.45)
    } else {
      stopManualSustain(0.12)
    }
    activeManualRipple = null
    manualPointerUV = null
  }
  pointerDown = activePointers.size > 0
  if (!pointerDown) {
    lastPointerUV = null
  }
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
  if (triggerMode !== 'auto') {
    return
  }
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
  if (triggerMode === 'manual' && pointerDown && activeManualRipple && manualPointerUV) {
    activeManualRipple.x = manualPointerUV.x
    activeManualRipple.y = manualPointerUV.y
    activeManualRipple.start = uniforms.uTime.value
    activeManualRipple.amp = 0.95
  }
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
