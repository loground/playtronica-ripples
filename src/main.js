import './style.css'
import * as THREE from 'three'
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

const GRID_COLS = 12
const GRID_ROWS = 6
const MAX_RIPPLES = 72
const RIPPLE_LIFETIME = 4.2
const HARMONY_SHIFT_SECONDS = 18
const AMBIENT_MODES = [
  { root: 40, scale: [0, 2, 4, 7, 9] },
  { root: 45, scale: [0, 2, 5, 7, 9] },
  { root: 43, scale: [0, 3, 5, 7, 10] },
  { root: 47, scale: [0, 2, 4, 6, 9] },
]

const app = document.querySelector('#app')
app.innerHTML = `
  <div id="hud">
    <div class="row controls-row">
      <button id="audio-toggle" type="button">Enable Audio</button>
      <button id="mute-toggle" type="button">Mute</button>
      <button id="hand-toggle" type="button">Hand Off</button>
      <button id="voice-toggle" type="button">Voice Off</button>
      <button id="hide-ui-btn" type="button">Hide UI</button>
      <button id="grid-toggle" type="button">Hide Grid</button>
      <select id="trigger-mode" aria-label="Mode">
        <option value="auto">Auto</option>
        <option value="manual" selected>Manual</option>
      </select>
      <select id="instrument" aria-label="Instrument">
        <option value="dx7">DX7 FM</option>
        <option value="piano">Soft Piano</option>
        <option value="pad">Web Pad</option>
        <option value="bell">Glass Bell</option>
        <option value="organ">Organ</option>
        <option value="synth">Analog Synth</option>
      </select>
    </div>
    <div class="row slider-row">
      <label for="intensity">Drop Intensity</label>
      <input id="intensity" type="range" min="0" max="100" value="35" />
      <output id="intensity-value">35%</output>
    </div>
    <div class="row loop-row">
      <button id="record-btn" type="button">Record</button>
      <button id="loop-btn" type="button" disabled>Loop Off</button>
      <button id="clear-loop" type="button" disabled>Clear</button>
      <span id="loop-status">No loop recorded</span>
    </div>
    <div class="row">
      <span id="note-label">Tap water to start</span>
    </div>
  </div>
  <div id="hand-debug" aria-hidden="true">
    <video id="hand-video" autoplay muted playsinline></video>
    <canvas id="hand-canvas"></canvas>
    <div id="hand-state">Hand: off</div>
  </div>
  <button id="show-ui-fab" type="button" aria-label="Show menu">Menu</button>
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
  uRippleFreq: { value: 92.0 },
  uShowGrid: { value: 1.0 },
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
    uniform float uShowGrid;
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
        if (d > 1.35) {
          continue;
        }
        float phase = d * uRippleFreq - dt * 6.5;
        float envelope = exp(-dt * 1.52) * exp(-d * 7.2);
        h += sin(phase) * envelope * ripple.w * uRippleAmp;
      }

      float n = sin((uv.x + uTime * 0.03) * 14.0) * cos((uv.y - uTime * 0.02) * 10.0) * 0.004;
      return h + n;
    }

    void main() {
      vec2 uv = vUv;
      float h = rippleHeight(uv);

      vec2 px = vec2(1.0 / max(1.0, uResolution.x), 0.0);
      vec2 py = vec2(0.0, 1.0 / max(1.0, uResolution.y));
      float dx = rippleHeight(clamp(uv + px, 0.0, 1.0)) - h;
      float dy = rippleHeight(clamp(uv + py, 0.0, 1.0)) - h;
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
      float gridLine = (1.0 - smoothstep(0.0, 0.016, edge)) * uShowGrid;
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

  uniforms.uRippleRadius.value = isMobileLayout ? 1.65 : 1.0
  uniforms.uRippleAmp.value = isMobileLayout ? 0.78 : 0.96
  uniforms.uNormalStrength.value = isMobileLayout ? 20.0 : 26.0
  uniforms.uRippleFreq.value = isMobileLayout ? 62.0 : 84.0
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
const recordBtn = document.querySelector('#record-btn')
const loopBtn = document.querySelector('#loop-btn')
const clearLoopBtn = document.querySelector('#clear-loop')
const loopStatus = document.querySelector('#loop-status')
const hideUiBtn = document.querySelector('#hide-ui-btn')
const showUiFab = document.querySelector('#show-ui-fab')
const gridToggleBtn = document.querySelector('#grid-toggle')
const handToggleBtn = document.querySelector('#hand-toggle')
const voiceToggleBtn = document.querySelector('#voice-toggle')
const handDebug = document.querySelector('#hand-debug')
const handCanvas = document.querySelector('#hand-canvas')
const handStateLabel = document.querySelector('#hand-state')

intensityInput.addEventListener('input', () => {
  dropIntensity = Number(intensityInput.value) / 100
  intensityValue.textContent = `${intensityInput.value}%`
})

let triggerMode = 'manual'
let audioMuted = false
let baseMasterGain = 0.3
let pointerDown = false
let activeManualRipple = null
let manualPressStart = 0
let manualMoved = false
let manualSustain = null
let manualPointerUV = null
const activePointers = new Set()
const pointerTracks = new Map()
let showGrid = true
let handEnabled = false
let handLandmarker = null
const handVideo = document.querySelector('#hand-video')
const handCanvasCtx = handCanvas.getContext('2d')
let handLoopId = 0
const createHandState = () => ({
  pressed: false,
  closedFrames: 0,
  openFrames: 0,
  engagedFrames: 0,
  disengagedFrames: 0,
  smoothedUv: null,
  lastFingerCount: -1,
  bounds: {
    minX: 0.08,
    maxX: 0.92,
    minY: 0.02,
    maxY: 0.98,
  },
})
const handStates = [createHandState(), createHandState()]
const handControlOffset = { x: 0.08, y: 0.02 }
let voiceEnabled = false
let recognition = null
let voiceActive = false
let voiceRestartTimer = 0
let lastVoiceError = ''
let voiceRetryDelay = 400

const looper = {
  isRecording: false,
  isLooping: false,
  events: [],
  startMs: 0,
  duration: 0,
  playhead: 0,
  nextEventIndex: 0,
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

async function activateAudio() {
  ensureAudio()
  await audioContext.resume()
  audioToggle.textContent = 'Audio Active'
}

audioToggle.addEventListener('click', async () => {
  await activateAudio()
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

function applyTriggerMode() {
  triggerMode = triggerModeSelect.value
  intensityInput.disabled = triggerMode === 'manual'
  noteLabel.textContent = triggerMode === 'manual'
    ? 'Manual: auto interaction with rain disabled'
    : 'Auto rain mode active'
}

triggerModeSelect.addEventListener('change', applyTriggerMode)

function setLoopUi() {
  recordBtn.textContent = looper.isRecording ? 'Stop Rec' : 'Record'
  loopBtn.textContent = looper.isLooping ? 'Loop On' : 'Loop Off'
  loopBtn.disabled = looper.events.length === 0 || looper.isRecording
  clearLoopBtn.disabled = looper.events.length === 0
}

function startRecording() {
  looper.isRecording = true
  looper.isLooping = false
  looper.events = []
  looper.startMs = performance.now()
  looper.duration = 0
  looper.playhead = 0
  looper.nextEventIndex = 0
  loopStatus.textContent = 'Recording...'
  setLoopUi()
}

function stopRecording() {
  looper.isRecording = false
  if (looper.events.length > 0) {
    const lastTime = looper.events[looper.events.length - 1].time
    looper.duration = Math.max(0.8, lastTime + 0.35)
    loopStatus.textContent = `Loop ready (${looper.duration.toFixed(1)}s)`
  } else {
    looper.duration = 0
    loopStatus.textContent = 'No loop recorded'
  }
  setLoopUi()
}

function toggleLoopPlayback() {
  if (looper.events.length === 0) {
    return
  }
  looper.isLooping = !looper.isLooping
  looper.playhead = 0
  looper.nextEventIndex = 0
  loopStatus.textContent = looper.isLooping ? 'Loop playing' : 'Loop paused'
  setLoopUi()
}

function clearLoop() {
  looper.isRecording = false
  looper.isLooping = false
  looper.events = []
  looper.duration = 0
  looper.playhead = 0
  looper.nextEventIndex = 0
  loopStatus.textContent = 'No loop recorded'
  setLoopUi()
}

recordBtn.addEventListener('click', () => {
  if (looper.isRecording) {
    stopRecording()
  } else {
    startRecording()
  }
})

loopBtn.addEventListener('click', () => {
  toggleLoopPlayback()
})

clearLoopBtn.addEventListener('click', () => {
  clearLoop()
})

hideUiBtn.addEventListener('click', () => {
  app.classList.add('hud-hidden')
})

showUiFab.addEventListener('click', () => {
  app.classList.remove('hud-hidden')
})

gridToggleBtn.addEventListener('click', () => {
  showGrid = !showGrid
  uniforms.uShowGrid.value = showGrid ? 1.0 : 0.0
  gridToggleBtn.textContent = showGrid ? 'Hide Grid' : 'Show Grid'
})

function setMode(mode) {
  triggerModeSelect.value = mode
  applyTriggerMode()
}

function setGridVisible(visible) {
  if (showGrid !== visible) {
    gridToggleBtn.click()
  }
}

function setHudVisible(visible) {
  if (visible) {
    app.classList.remove('hud-hidden')
  } else {
    app.classList.add('hud-hidden')
  }
}

function setLooping(shouldLoop) {
  if (shouldLoop !== looper.isLooping && looper.events.length > 0) {
    toggleLoopPlayback()
  }
}

function setRecording(shouldRecord) {
  if (shouldRecord && !looper.isRecording) startRecording()
  if (!shouldRecord && looper.isRecording) stopRecording()
}

function handleVoiceCommand(text) {
  const cmd = text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cmd) return
  noteLabel.textContent = `Voice heard: "${cmd}"`

  if (cmd.includes('stop recording') || (cmd.includes('stop') && cmd.includes('record'))) {
    setRecording(false)
    noteLabel.textContent = 'Voice: stop recording'
    return
  }
  if (cmd.includes('stop loop') || cmd.includes('loop off') || cmd.includes('pause loop')) {
    setLooping(false)
    noteLabel.textContent = 'Voice: loop off'
    return
  }
  if (cmd === 'stop' || cmd.includes('stop all')) {
    setRecording(false)
    setLooping(false)
    noteLabel.textContent = 'Voice: stop'
    return
  }
  if (cmd.includes('start recording') || cmd.includes('record')) {
    setRecording(true)
    noteLabel.textContent = 'Voice: record'
    return
  }
  if (cmd.includes('loop on') || cmd.includes('start loop') || cmd.includes('play loop')) {
    setLooping(true)
    noteLabel.textContent = 'Voice: loop on'
    return
  }
  if (cmd.includes('manual')) {
    setMode('manual')
    return
  }
  if (cmd.includes('auto')) {
    setMode('auto')
    return
  }
  if (cmd.includes('hide menu') || cmd.includes('hide ui')) {
    setHudVisible(false)
    return
  }
  if (cmd.includes('show menu') || cmd.includes('show ui')) {
    setHudVisible(true)
    return
  }
  if (cmd.includes('hide grid')) {
    setGridVisible(false)
    return
  }
  if (cmd.includes('show grid')) {
    setGridVisible(true)
    return
  }
  if (cmd.includes('unmute')) {
    if (audioMuted) muteToggle.click()
    return
  }
  if (cmd.includes('mute')) {
    if (!audioMuted) muteToggle.click()
    return
  }
  if (cmd.includes('enable audio')) {
    activateAudio()
    return
  }
  noteLabel.textContent = `Voice not matched: "${cmd}"`
}

function initSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) return null
  const sr = new SR()
  sr.lang = 'en-US'
  sr.continuous = true
  sr.interimResults = true
  sr.maxAlternatives = 1
  sr.onstart = () => {
    voiceActive = true
    lastVoiceError = ''
    voiceRetryDelay = 400
    voiceToggleBtn.textContent = 'Voice On'
  }
  sr.onresult = (event) => {
    const result = event.results[event.results.length - 1]
    if (result && result.isFinal) {
      handleVoiceCommand(result[0].transcript || '')
    }
  }
  sr.onend = () => {
    voiceActive = false
    if (voiceRestartTimer) {
      clearTimeout(voiceRestartTimer)
      voiceRestartTimer = 0
    }
    if (voiceEnabled && lastVoiceError !== 'network') {
      const delay = voiceRetryDelay
      voiceRetryDelay = Math.min(3000, Math.floor(voiceRetryDelay * 1.6))
      voiceRestartTimer = setTimeout(() => {
        if (!voiceEnabled || voiceActive) return
        try {
          sr.start()
        } catch (error) {
          // will retry on next onend cycle
        }
      }, delay)
    }
  }
  sr.onerror = (event) => {
    lastVoiceError = event.error || 'unknown'
    noteLabel.textContent = `Voice error: ${lastVoiceError}`
    if (lastVoiceError === 'network' || lastVoiceError === 'not-allowed' || lastVoiceError === 'service-not-allowed') {
      voiceEnabled = false
      voiceActive = false
      voiceToggleBtn.textContent = 'Voice Off'
      if (voiceRestartTimer) {
        clearTimeout(voiceRestartTimer)
        voiceRestartTimer = 0
      }
    }
  }
  return sr
}

voiceToggleBtn.addEventListener('click', () => {
  if (!recognition) {
    recognition = initSpeechRecognition()
    if (!recognition) {
      noteLabel.textContent = 'Speech recognition unavailable'
      return
    }
  }
  voiceEnabled = !voiceEnabled
  voiceToggleBtn.textContent = voiceEnabled ? 'Voice On' : 'Voice Off'
  try {
    if (voiceEnabled && !voiceActive) {
      lastVoiceError = ''
      voiceRetryDelay = 400
      recognition.start()
    }
    if (!voiceEnabled) {
      if (voiceRestartTimer) {
        clearTimeout(voiceRestartTimer)
        voiceRestartTimer = 0
      }
      if (voiceActive) {
        recognition.stop()
      }
    }
  } catch (error) {
    voiceEnabled = false
    voiceActive = false
    voiceToggleBtn.textContent = 'Voice Off'
    noteLabel.textContent = 'Voice failed to start'
  }
})

function getHandPoseState(landmarks) {
  const palmCenter = {
    x: (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[13].x + landmarks[17].x) / 5,
    y: (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[13].y + landmarks[17].y) / 5,
  }

  const tips = [8, 12, 16, 20]
  const pips = [6, 10, 14, 18]
  let curledCount = 0
  let extensionRatioSum = 0

  for (let i = 0; i < tips.length; i += 1) {
    const tip = landmarks[tips[i]]
    const pip = landmarks[pips[i]]
    const dTip = Math.hypot(tip.x - palmCenter.x, tip.y - palmCenter.y)
    const dPip = Math.max(0.0001, Math.hypot(pip.x - palmCenter.x, pip.y - palmCenter.y))
    const ratio = dTip / dPip
    extensionRatioSum += ratio
    if (ratio < 0.92) {
      curledCount += 1
    }
  }

  const avgRatio = extensionRatioSum / tips.length
  const thumbTip = landmarks[4]
  const thumbMcp = landmarks[2]
  const indexMcp = landmarks[5]
  const thumbFolded =
    Math.hypot(thumbTip.x - indexMcp.x, thumbTip.y - indexMcp.y) <
    Math.hypot(thumbMcp.x - indexMcp.x, thumbMcp.y - indexMcp.y) * 0.95

  if (curledCount >= 4 && avgRatio < 0.95 && thumbFolded) {
    return 'closed'
  }
  if (curledCount <= 1 && avgRatio > 1.18) {
    return 'open'
  }
  return 'neutral'
}

function countShownFingers(landmarks) {
  const palmCenter = {
    x: (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[13].x + landmarks[17].x) / 5,
    y: (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[13].y + landmarks[17].y) / 5,
  }
  const tips = [4, 8, 12, 16, 20]
  const pips = [2, 6, 10, 14, 18]
  let count = 0

  for (let i = 0; i < tips.length; i += 1) {
    const tip = landmarks[tips[i]]
    const pip = landmarks[pips[i]]
    const dTip = Math.hypot(tip.x - palmCenter.x, tip.y - palmCenter.y)
    const dPip = Math.max(0.0001, Math.hypot(pip.x - palmCenter.x, pip.y - palmCenter.y))
    if (dTip / dPip > 1.15) {
      count += 1
    }
  }

  return count
}

function applyInstrumentForFingerCount(count) {
  const byCount = {
    1: 'dx7',
    2: 'piano',
    3: 'pad',
    4: 'bell',
    5: 'organ',
  }
  const instrument = byCount[count]
  if (!instrument || instrumentSelect.value === instrument) {
    return
  }
  instrumentSelect.value = instrument
}

async function ensureHandTracker() {
  if (handLandmarker) return
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
  )
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    },
    runningMode: 'VIDEO',
    numHands: 2,
  })
}

function drawHandDebug(hands) {
  if (!handVideo.videoWidth || !handVideo.videoHeight) return
  if (handCanvas.width !== handVideo.videoWidth || handCanvas.height !== handVideo.videoHeight) {
    handCanvas.width = handVideo.videoWidth
    handCanvas.height = handVideo.videoHeight
  }

  handCanvasCtx.clearRect(0, 0, handCanvas.width, handCanvas.height)
  handCanvasCtx.save()
  handCanvasCtx.scale(-1, 1)
  handCanvasCtx.translate(-handCanvas.width, 0)
  handCanvasCtx.drawImage(handVideo, 0, 0, handCanvas.width, handCanvas.height)

  if (hands && hands.length > 0) {
    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [5, 9], [9, 10], [10, 11], [11, 12],
      [9, 13], [13, 14], [14, 15], [15, 16],
      [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
    ]
    const palette = ['#48ff9b', '#ff8b5c']

    for (let h = 0; h < hands.length; h += 1) {
      const item = hands[h]
      const landmarks = item.landmarks
      const poseState = item.poseState
      const anchor = item.anchor

      handCanvasCtx.lineWidth = 2
      handCanvasCtx.strokeStyle = poseState === 'closed' ? palette[h % palette.length] : '#7bc0ff'
      handCanvasCtx.beginPath()
      for (const [a, b] of edges) {
        const p1 = landmarks[a]
        const p2 = landmarks[b]
        handCanvasCtx.moveTo(p1.x * handCanvas.width, p1.y * handCanvas.height)
        handCanvasCtx.lineTo(p2.x * handCanvas.width, p2.y * handCanvas.height)
      }
      handCanvasCtx.stroke()

      for (let i = 0; i < landmarks.length; i += 1) {
        const p = landmarks[i]
        handCanvasCtx.fillStyle = i === 8 ? '#ffde59' : '#ffffff'
        handCanvasCtx.beginPath()
        handCanvasCtx.arc(p.x * handCanvas.width, p.y * handCanvas.height, i === 8 ? 4 : 2.2, 0, Math.PI * 2)
        handCanvasCtx.fill()
      }

      if (anchor) {
        handCanvasCtx.fillStyle = '#ff4d6d'
        handCanvasCtx.beginPath()
        handCanvasCtx.arc(anchor.x * handCanvas.width, anchor.y * handCanvas.height, 5, 0, Math.PI * 2)
        handCanvasCtx.fill()
      }
    }
  }
  handCanvasCtx.restore()
}

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

function uvToNote(uv, velocity, source) {
  const col = Math.min(GRID_COLS - 1, Math.max(0, Math.floor(uv.x * GRID_COLS)))
  const row = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor(uv.y * GRID_ROWS)))
  const modeIndex = Math.floor(uniforms.uTime.value / HARMONY_SHIFT_SECONDS) % AMBIENT_MODES.length
  const mode = AMBIENT_MODES[modeIndex]
  const degree = mode.scale[col % mode.scale.length]
  const octave = source === 'pointer' ? 2 + Math.floor((1 - uv.y) * 3.5) : 1 + Math.floor((1 - uv.y) * 3.0)
  let midi = mode.root + degree + octave * 12

  const shimmer = 0.08 + velocity * 0.18
  if (Math.random() < shimmer) midi += 12
  if (Math.random() < 0.06) midi -= 12
  midi = Math.max(30, Math.min(92, midi))
  const noteName = midiToName(midi)
  return { midi, noteName, col, row }
}

function routeVoice(node) {
  node.connect(dryGain)
  node.connect(wetGain)
}

function startManualSustain(uv) {
  if (!audioContext || audioContext.state !== 'running') {
    return
  }
  const note = uvToNote(uv, 0.8, 'pointer')
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
  const { midi, noteName, col, row } = uvToNote(uv, velocity, source)
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
  noteLabel.textContent = `Now playing: ${noteName}`
  playNote(midi, velocity, instrumentSelect.value)
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
  if (looper.isRecording && source === 'pointer') {
    looper.events.push({
      time: (performance.now() - looper.startMs) / 1000,
      uv: { x: uv.x, y: uv.y },
      strength,
    })
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

function pointerDownAtUv(uv, pointerId = 'virtual') {
  activePointers.add(pointerId)
  pointerTracks.set(pointerId, { uv: { ...uv }, stamp: performance.now() })
  pointerDown = true
  spawnRipple(uv, 0.95, 'pointer')
}

function pointerMoveAtUv(uv, pointerId = 'virtual') {
  if (!activePointers.has(pointerId)) {
    return
  }
  const track = pointerTracks.get(pointerId)
  const now = performance.now()
  if (!track) {
    spawnRipple(uv, 0.9, 'pointer')
    pointerTracks.set(pointerId, { uv: { ...uv }, stamp: now })
    return
  }
  const dist = Math.hypot(uv.x - track.uv.x, uv.y - track.uv.y)
  if (dist > 0.02 || now - track.stamp > 80) {
    spawnRipple(uv, 0.82, 'pointer')
    pointerTracks.set(pointerId, { uv: { ...uv }, stamp: now })
  }
}

function pointerMoveAtUvHand(uv, pointerId = 'hand-0') {
  if (!activePointers.has(pointerId)) {
    return
  }
  const track = pointerTracks.get(pointerId)
  const now = performance.now()
  if (!track) {
    spawnRipple(uv, 0.92, 'pointer')
    pointerTracks.set(pointerId, { uv: { ...uv }, stamp: now })
    return
  }
  const dist = Math.hypot(uv.x - track.uv.x, uv.y - track.uv.y)
  if (dist > 0.004 || now - track.stamp > 22) {
    spawnRipple(uv, 0.86, 'pointer')
    pointerTracks.set(pointerId, { uv: { ...uv }, stamp: now })
  }
}

function pointerUpById(pointerId = 'virtual') {
  activePointers.delete(pointerId)
  pointerTracks.delete(pointerId)
  pointerDown = activePointers.size > 0
}

renderer.domElement.addEventListener('pointerdown', async (event) => {
  await activateAudio()
  pointerDownAtUv(getPointerUV(event), event.pointerId)
})

renderer.domElement.addEventListener('pointermove', (event) => {
  pointerMoveAtUv(getPointerUV(event), event.pointerId)
})

const endPointer = (event) => {
  if (event && typeof event.pointerId === 'number') {
    pointerUpById(event.pointerId)
  } else {
    activePointers.clear()
    pointerTracks.clear()
    pointerDown = false
  }
}

renderer.domElement.addEventListener('pointerup', endPointer)
renderer.domElement.addEventListener('pointerleave', endPointer)
renderer.domElement.addEventListener('pointercancel', endPointer)

function stopHandControl() {
  handEnabled = false
  handToggleBtn.textContent = 'Hand Off'
  handDebug.classList.remove('active')
  handStateLabel.textContent = 'Hand: off'
  if (handLoopId) {
    cancelAnimationFrame(handLoopId)
    handLoopId = 0
  }
  for (let i = 0; i < handStates.length; i += 1) {
    const s = handStates[i]
    if (s.pressed) {
      pointerUpById(`hand-${i}`)
    }
    handStates[i] = createHandState()
  }
  if (handVideo) {
    const tracks = handVideo.srcObject?.getTracks?.() || []
    tracks.forEach((t) => t.stop())
    handVideo.srcObject = null
  }
}

async function startHandControl() {
  await ensureHandTracker()

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 } },
    audio: false,
  })
  handVideo.srcObject = stream
  await handVideo.play()

  handEnabled = true
  handToggleBtn.textContent = 'Hand On'
  handDebug.classList.add('active')
  handStates[0] = createHandState()
  handStates[1] = createHandState()

  const step = () => {
    if (!handEnabled || !handLandmarker || !handVideo) {
      return
    }
    const result = handLandmarker.detectForVideo(handVideo, performance.now())
    const detected = result?.landmarks || []

    if (detected.length === 0) {
      for (let i = 0; i < handStates.length; i += 1) {
        const s = handStates[i]
        s.openFrames += 1
        s.closedFrames = 0
        s.engagedFrames = 0
        s.disengagedFrames += 1
        if (s.openFrames >= 2 && s.pressed) {
          pointerUpById(`hand-${i}`)
          s.pressed = false
        }
      }
      drawHandDebug([])
      handStateLabel.textContent = 'Hand: none'
      handLoopId = requestAnimationFrame(step)
      return
    }
    const debugHands = []
    const summaries = []

    for (let i = 0; i < handStates.length; i += 1) {
      const state = handStates[i]
      const landmarks = detected[i]
      const pointerId = `hand-${i}`

      if (!landmarks) {
        state.openFrames += 1
        state.closedFrames = 0
        state.engagedFrames = 0
        state.disengagedFrames += 1
        if (state.disengagedFrames >= 2 && state.pressed) {
          pointerUpById(pointerId)
          state.pressed = false
        }
        summaries.push(`H${i + 1}: none`)
        continue
      }

      const fingerCount = countShownFingers(landmarks)
      if (i === 0 && fingerCount !== state.lastFingerCount) {
        applyInstrumentForFingerCount(fingerCount)
      }
      state.lastFingerCount = fingerCount

      const anchorX = (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[13].x + landmarks[17].x) / 5
      const anchorY = (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[13].y + landmarks[17].y) / 5

      state.bounds.minX = Math.min(state.bounds.minX, anchorX - 0.012)
      state.bounds.maxX = Math.max(state.bounds.maxX, anchorX + 0.012)
      state.bounds.minY = Math.min(state.bounds.minY, anchorY - 0.02)
      state.bounds.maxY = Math.max(state.bounds.maxY, anchorY + 0.02)

      const spanX = Math.max(0.22, state.bounds.maxX - state.bounds.minX)
      const spanY = Math.max(0.25, state.bounds.maxY - state.bounds.minY)
      const normX = (anchorX - state.bounds.minX) / spanX
      const normY = (anchorY - state.bounds.minY) / spanY
      const rawUv = {
        x: THREE.MathUtils.clamp(1 - normX + handControlOffset.x, 0, 1),
        y: THREE.MathUtils.clamp(1 - normY + handControlOffset.y, 0, 1),
      }

      if (!state.smoothedUv) {
        state.smoothedUv = { ...rawUv }
      } else {
        state.smoothedUv.x += (rawUv.x - state.smoothedUv.x) * 0.62
        state.smoothedUv.y += (rawUv.y - state.smoothedUv.y) * 0.62
      }
      const uv = state.smoothedUv
      const poseState = getHandPoseState(landmarks)
      const handEngaged = poseState === 'closed' || fingerCount > 0

      if (poseState === 'closed') {
        state.closedFrames += 1
        state.openFrames = 0
      } else if (poseState === 'open') {
        state.openFrames += 1
        state.closedFrames = 0
      } else {
        state.closedFrames = Math.max(0, state.closedFrames - 1)
        state.openFrames = Math.max(0, state.openFrames - 1)
      }

      if (handEngaged) {
        state.engagedFrames += 1
        state.disengagedFrames = 0
      } else {
        state.disengagedFrames += 1
        state.engagedFrames = 0
      }

      if (!state.pressed && state.engagedFrames >= 2) {
        pointerDownAtUv(uv, pointerId)
        state.pressed = true
      } else if (state.pressed && handEngaged) {
        pointerMoveAtUvHand(uv, pointerId)
      } else if (state.pressed && state.disengagedFrames >= 3) {
        pointerUpById(pointerId)
        state.pressed = false
      }

      debugHands.push({ landmarks, poseState, anchor: { x: anchorX, y: anchorY } })
      summaries.push(`H${i + 1}: ${poseState}${state.pressed ? ' down' : ' up'} f${fingerCount}`)
    }

    drawHandDebug(debugHands)
    handStateLabel.textContent = summaries.join(' • ')

    handLoopId = requestAnimationFrame(step)
  }

  handLoopId = requestAnimationFrame(step)
}

handToggleBtn.addEventListener('click', async () => {
  if (handEnabled) {
    stopHandControl()
    return
  }
  try {
    await activateAudio()
    await startHandControl()
  } catch (error) {
    noteLabel.textContent = 'Hand tracking permission/model failed'
    stopHandControl()
  }
})

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

function updateLoopPlayback(dt) {
  if (!looper.isLooping || looper.events.length === 0 || looper.duration <= 0) {
    return
  }

  looper.playhead += dt
  while (
    looper.nextEventIndex < looper.events.length &&
    looper.events[looper.nextEventIndex].time <= looper.playhead
  ) {
    const evt = looper.events[looper.nextEventIndex]
    spawnRipple(evt.uv, evt.strength * 0.92, 'loop')
    looper.nextEventIndex += 1
  }

  if (looper.playhead >= looper.duration) {
    looper.playhead -= looper.duration
    looper.nextEventIndex = 0
  }
}

function animate() {
  requestAnimationFrame(animate)
  const dt = Math.min(clock.getDelta(), 0.05)
  uniforms.uTime.value = clock.elapsedTime
  spawnAutoDrops(dt)
  updateLoopPlayback(dt)
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
applyTriggerMode()
setLoopUi()
animate()
