/*
 * 窗外的一座城：Three.js 负责调度，具体风景交给 `scene-*.js`。
 *
 * 这一份管天空、云、星、雨雪、闪电、雾、镜头与逐帧节奏；场景只搭自己的几何，响应天气与调色。
 * 场景按 `WxScenes` 注册：`city`、`ink`、`court`、`heritage`，由 `city-style.js` 按城市挑一个。
 *
 * `main.js` 传进尺寸、天气、场景 id 与指针，这里只负责把这一帧画出来（D7 的一份脚本）。减弱动效
 * 时由调用方只画一帧（D10）。
 */
;(function (root) {
  'use strict'

  var THREE = root.THREE
  if (!THREE) return

  var TAU = Math.PI * 2

  function clamp(value, low, high) { return value < low ? low : value > high ? high : value }
  function lerp(from, to, t) { return from + (to - from) * t }
  function mixColor(target, source, t) { target.r = lerp(target.r, source.r, t); target.g = lerp(target.g, source.g, t); target.b = lerp(target.b, source.b, t) }

  /** 固定种子的随机序列。 */
  function seeded(seed) {
    var state = seed >>> 0
    return function () {
      state = (state * 1664525 + 1013904223) >>> 0
      return state / 4294967296
    }
  }

  /** 天色与光的一组取值；夜里与深色主题各压一档。 */
  var PALETTES = {
    clear: {
      day: { top: '#2f7ed0', mid: '#79b5e9', low: '#d2ebfb', haze: '#edf6fd', sun: '#fff4d6', fog: 0.0016, ambient: 1.05, windows: 0.06, stars: 0, exposure: 1.02 },
      night: { top: '#03060f', mid: '#081226', low: '#0e1f3c', haze: '#17304f', sun: '#e8eeff', fog: 0.0019, ambient: 0.34, windows: 1.25, stars: 1, exposure: 1.16 },
    },
    cloudy: {
      day: { top: '#6b8cae', mid: '#a3bdd3', low: '#dbe7ef', haze: '#edf2f6', sun: '#fff2dd', fog: 0.0022, ambient: 0.92, windows: 0.1, stars: 0, exposure: 1.0 },
      night: { top: '#060a14', mid: '#0c1524', low: '#16243a', haze: '#22374f', sun: '#dfe8ff', fog: 0.0024, ambient: 0.3, windows: 1.15, stars: 0.22, exposure: 1.14 },
    },
    overcast: {
      day: { top: '#5a6d80', mid: '#8c9bab', low: '#c3ccd5', haze: '#dbe0e5', sun: '#f2f0ea', fog: 0.003, ambient: 0.82, windows: 0.16, stars: 0, exposure: 0.98 },
      night: { top: '#080c12', mid: '#111823', low: '#1c2733', haze: '#283543', sun: '#cfd9ea', fog: 0.0032, ambient: 0.26, windows: 1.05, stars: 0.06, exposure: 1.1 },
    },
    rain: {
      day: { top: '#37475a', mid: '#5a6d80', low: '#8fa0b1', haze: '#aeb9c5', sun: '#e9eef5', fog: 0.0036, ambient: 0.7, windows: 0.22, stars: 0, exposure: 0.96 },
      night: { top: '#05080d', mid: '#0b1119', low: '#141d28', haze: '#1d2936', sun: '#c6d4e8', fog: 0.0038, ambient: 0.22, windows: 1.0, stars: 0, exposure: 1.08 },
    },
    storm: {
      day: { top: '#1a232e', mid: '#2c3a49', low: '#4f5d6a', haze: '#6b7885', sun: '#dfe9f5', fog: 0.0044, ambient: 0.58, windows: 0.3, stars: 0, exposure: 0.92 },
      night: { top: '#030509', mid: '#070b11', low: '#0d141d', haze: '#151f2a', sun: '#b9cbe4', fog: 0.0046, ambient: 0.18, windows: 0.95, stars: 0, exposure: 1.04 },
    },
    snow: {
      day: { top: '#8ba1b7', mid: '#b6c6d6', low: '#e4edf5', haze: '#f3f8fc', sun: '#ffffff', fog: 0.0032, ambient: 0.95, windows: 0.14, stars: 0, exposure: 1.05 },
      night: { top: '#0a1220', mid: '#141f31', low: '#233247', haze: '#33465c', sun: '#e6eeff', fog: 0.0034, ambient: 0.32, windows: 1.1, stars: 0.12, exposure: 1.14 },
    },
  }

  /** 天气对应的天色，读不到时按多云。 */
  function paletteOf(scene, night, dark) {
    var entry = PALETTES[scene] || PALETTES.cloudy
    var raw = night ? entry.night : entry.day
    var dim = dark ? 0.82 : 1
    var color = function (hex) { return new THREE.Color(hex).multiplyScalar(dim) }
    return {
      top: color(raw.top),
      mid: color(raw.mid),
      low: color(raw.low),
      haze: color(raw.haze),
      sun: color(raw.sun),
      fog: raw.fog,
      ambient: raw.ambient,
      windows: raw.windows,
      stars: raw.stars,
      exposure: raw.exposure,
    }
  }

  /** 一张径向渐变的贴图：太阳、月亮与场景里的光点都用它。 */
  function glowTexture(inner, outer) {
    var size = 128
    var canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    var ctx = canvas.getContext('2d')
    var gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, inner)
    gradient.addColorStop(0.35, outer)
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
    var texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  /** 一朵软云：几团半透明白叠在一起，边缘化开。 */
  function cloudTexture(seed) {
    var size = 256
    var canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    var ctx = canvas.getContext('2d')
    var random = seeded(seed)
    for (var i = 0; i < 26; i += 1) {
      var radius = size * (0.08 + random() * 0.16)
      var x = size * (0.2 + random() * 0.6)
      var y = size * (0.36 + random() * 0.3)
      var gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
      gradient.addColorStop(0, 'rgba(255,255,255,0.5)')
      gradient.addColorStop(0.55, 'rgba(255,255,255,0.22)')
      gradient.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, size, size)
    }
    var texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  /** 一颗柔边的圆点：雪、星与场景里的光点用它。 */
  function dotTexture() {
    var size = 32
    var canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    var ctx = canvas.getContext('2d')
    var gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.6, 'rgba(255,255,255,0.55)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
    var texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  var SKY_VERTEX = [
    'varying vec3 vDirection;',
    'void main() {',
    '  vDirection = normalize(position);',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}',
  ].join('\n')

  var SKY_FRAGMENT = [
    'uniform vec3 uTop;',
    'uniform vec3 uMid;',
    'uniform vec3 uLow;',
    'uniform vec3 uHaze;',
    'uniform vec3 uSun;',
    'uniform vec3 uSunDir;',
    'uniform float uGlow;',
    'uniform float uFlash;',
    'varying vec3 vDirection;',
    'void main() {',
    '  vec3 dir = normalize(vDirection);',
    '  float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);',
    '  vec3 col = mix(uLow, uMid, smoothstep(0.5, 0.72, h));',
    '  col = mix(col, uTop, smoothstep(0.72, 0.98, h));',
    '  col = mix(uHaze, col, smoothstep(0.42, 0.6, h));',
    '  float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);',
    '  col += uSun * pow(sunDot, 240.0) * 1.6;',
    '  col += uSun * pow(sunDot, 8.0) * uGlow;',
    '  col += vec3(0.72, 0.8, 0.95) * uFlash;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}',
  ].join('\n')

  /** 建一层天与一套天气，再按场景 id 换风景。 */
  function create(canvas) {
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.setPixelRatio(1)
    renderer.setSize(1, 1, false)
    // 质感的一半来自光：软阴影、环境反射与泛光，后面在合成器里一起出。
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap

    var scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x0b1220, 0.002)

    var lookTarget = new THREE.Vector3(0, 11.4, -46)
    var camera = new THREE.PerspectiveCamera(52, 1, 0.1, 900)
    camera.position.set(0, 10.4, 36)

    var hemi = new THREE.HemisphereLight(0xbfd8ff, 0x0a0f18, 1)
    scene.add(hemi)
    var ambient = new THREE.AmbientLight(0xffffff, 0.35)
    scene.add(ambient)
    // 天光压暗之后给一盏很弱的补光：立体感靠主光与阴影出，免得只剩一层灰。
    var fill = new THREE.DirectionalLight(0xdce8ff, 0.2)
    fill.position.set(-40, 30, -20)
    scene.add(fill)
    var key = new THREE.DirectionalLight(0xfff1d0, 1.2)
    key.position.set(30, 60, -40)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.near = 1
    key.shadow.camera.far = 220
    key.shadow.camera.left = -80
    key.shadow.camera.right = 80
    key.shadow.camera.top = 80
    key.shadow.camera.bottom = -40
    key.shadow.bias = -0.0006
    scene.add(key)

    // 环境反射：湿地面与瓦面因此有东西可映，不再是一块死色。
    var addons = root.THREE_ADDONS || {}
    var pmrem = null
    if (typeof THREE.PMREMGenerator === 'function' && typeof addons.RoomEnvironment === 'function') {
      pmrem = new THREE.PMREMGenerator(renderer)
      scene.environment = pmrem.fromScene(new addons.RoomEnvironment(), 0.05).texture
      scene.environmentIntensity = 0.08
    }

    // 后期：泛光把灯、窗、月亮的光晕揉开；合成器同时负责输出色彩。
    var composer = null
    var bloom = null
    if (typeof addons.EffectComposer === 'function' && typeof addons.RenderPass === 'function' && typeof addons.OutputPass === 'function') {
      composer = new addons.EffectComposer(renderer)
      composer.addPass(new addons.RenderPass(scene, camera))
      if (typeof addons.UnrealBloomPass === 'function') {
        bloom = new addons.UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.5, 1.0)
        composer.addPass(bloom)
      }
      composer.addPass(new addons.OutputPass())
    }

    // 天：一个从里看的球，颜色由 uniforms 推。
    var skyUniforms = {
      uTop: { value: new THREE.Color('#2f7ed0') },
      uMid: { value: new THREE.Color('#79b5e9') },
      uLow: { value: new THREE.Color('#d2ebfb') },
      uHaze: { value: new THREE.Color('#edf6fd') },
      uSun: { value: new THREE.Color('#fff4d6') },
      uSunDir: { value: new THREE.Vector3(0.5, 0.35, -0.8) },
      uGlow: { value: 0.5 },
      uFlash: { value: 0 },
    }
    scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(420, 32, 20),
      new THREE.ShaderMaterial({ uniforms: skyUniforms, vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: THREE.BackSide, depthWrite: false })
    ))

    // 太阳或月亮：一枚发光贴片。
    var body = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,255,255,1)', 'rgba(255,236,190,0.45)'), color: 0xfff4d6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    body.scale.set(30, 30, 1)
    scene.add(body)

    // 星：只在天色够暗时浮出来。
    var starCount = 600
    var starGeometry = new THREE.BufferGeometry()
    var starPositions = new Float32Array(starCount * 3)
    var starRandom = seeded(77)
    for (var s = 0; s < starCount; s += 1) {
      var theta = starRandom() * TAU
      var phi = Math.acos(starRandom() * 0.85)
      var radius = 380
      starPositions[s * 3] = Math.sin(phi) * Math.cos(theta) * radius
      starPositions[s * 3 + 1] = Math.cos(phi) * radius * 0.9 + 40
      starPositions[s * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    var dots = dotTexture()
    var stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ map: dots, color: 0xdfe9ff, size: 1.7, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false }))
    scene.add(stars)

    // 云：几片朝镜头的贴片，慢慢横移。
    var cloudTextures = [cloudTexture(11), cloudTexture(29), cloudTexture(53)]
    var clouds = []
    var cloudRandom = seeded(101)
    for (var c = 0; c < 14; c += 1) {
      var sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTextures[c % cloudTextures.length], color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }))
      var scale = 60 + cloudRandom() * 90
      sprite.scale.set(scale, scale * 0.52, 1)
      sprite.position.set(-140 + cloudRandom() * 280, 26 + cloudRandom() * 34, -150 + cloudRandom() * 120)
      scene.add(sprite)
      clouds.push({ sprite: sprite, speed: 1.6 + cloudRandom() * 3.4, base: sprite.position.x })
    }

    // 雨：一条条斜下的细线，位置在顶点着色器里按时间循环。
    var rainCount = 800
    var rainGeometry = new THREE.BufferGeometry()
    var rainPositions = new Float32Array(rainCount * 6)
    var rainSeeds = new Float32Array(rainCount * 2)
    var rainRandom = seeded(911)
    for (var r = 0; r < rainCount; r += 1) {
      var rx = -60 + rainRandom() * 120
      var ry = rainRandom() * 34
      var rz = -80 + rainRandom() * 100
      var length = 2.4 + rainRandom() * 2.6
      rainPositions[r * 6] = rx
      rainPositions[r * 6 + 1] = ry
      rainPositions[r * 6 + 2] = rz
      rainPositions[r * 6 + 3] = rx - 0.16
      rainPositions[r * 6 + 4] = ry + length
      rainPositions[r * 6 + 5] = rz
      // 一条雨丝的两个端点共用同一个种子，否则两端各按自己的速度下落，线段会被拆成两个点。
      rainSeeds[r * 2] = rainRandom()
      rainSeeds[r * 2 + 1] = rainSeeds[r * 2]
    }
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3))
    rainGeometry.setAttribute('aSeed', new THREE.BufferAttribute(rainSeeds, 1))
    var rainUniforms = { uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0x9fb4c8) } }
    var rain = new THREE.LineSegments(rainGeometry, new THREE.ShaderMaterial({
      uniforms: rainUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: [
        'attribute float aSeed;',
        'uniform float uTime;',
        'varying float vFade;',
        'void main() {',
        '  vec3 p = position;',
        '  float span = 34.0;',
        '  float fall = mod(p.y - uTime * (26.0 + aSeed * 18.0), span);',
        '  p.y = fall - 4.0;',
        // 风把雨丝吹斜：越往下落越偏，整片雨才有方向。
        '  p.x += (1.0 - fall / span) * 3.4 + sin(uTime * 0.4 + aSeed * 6.28) * 0.4;',
        '  p.z += (1.0 - fall / span) * 0.8;',
        '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
        // 近处与最远处的雨丝淡掉：贴着镜头的那几滴会糊成一片白。
        '  float near = smoothstep(1.5, 6.0, -mv.z);',
        '  float far = 1.0 - smoothstep(70.0, 150.0, -mv.z);',
        '  vFade = (0.3 + aSeed * 0.7) * near * far;',
        '  gl_Position = projectionMatrix * mv;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uColor;',
        'uniform float uOpacity;',
        'varying float vFade;',
        'void main() { gl_FragColor = vec4(uColor, uOpacity * vFade); }',
      ].join('\n'),
    }))
    rain.frustumCulled = false
    scene.add(rain)

    // 雪：慢一点、会摆，柔边圆点。
    var snowCount = 600
    var snowGeometry = new THREE.BufferGeometry()
    var snowPositions = new Float32Array(snowCount * 3)
    var snowSeeds = new Float32Array(snowCount)
    var snowRandom = seeded(613)
    for (var n = 0; n < snowCount; n += 1) {
      snowPositions[n * 3] = -60 + snowRandom() * 120
      snowPositions[n * 3 + 1] = snowRandom() * 50
      snowPositions[n * 3 + 2] = -80 + snowRandom() * 100
      snowSeeds[n] = snowRandom()
    }
    snowGeometry.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3))
    snowGeometry.setAttribute('aSeed', new THREE.BufferAttribute(snowSeeds, 1))
    var snowUniforms = { uTime: { value: 0 }, uOpacity: { value: 0 } }
    var snow = new THREE.Points(snowGeometry, new THREE.ShaderMaterial({
      uniforms: snowUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: [
        'attribute float aSeed;',
        'uniform float uTime;',
        'varying float vFade;',
        'void main() {',
        '  vec3 p = position;',
        '  p.y = mod(p.y - uTime * (2.2 + aSeed * 2.4), 50.0) - 2.0;',
        '  p.x += sin(uTime * (0.3 + aSeed) + aSeed * 6.28) * 2.2;',
        '  vFade = 0.4 + aSeed * 0.6;',
        '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
        '  gl_PointSize = (2.2 + aSeed * 3.2) * (240.0 / -mv.z);',
        '  gl_Position = projectionMatrix * mv;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform float uOpacity;',
        'varying float vFade;',
        'void main() {',
        '  vec2 d = gl_PointCoord - vec2(0.5);',
        '  float a = smoothstep(0.5, 0.12, length(d));',
        '  gl_FragColor = vec4(vec3(1.0), a * uOpacity * vFade);',
        '}',
      ].join('\n'),
    }))
    snow.frustumCulled = false
    scene.add(snow)

    var mediaUniforms = []
    var state = {
      width: 1,
      height: 1,
      palette: paletteOf('cloudy', false, false),
      target: paletteOf('cloudy', false, false),
      weather: 'cloudy',
      night: false,
      motion: 'drift',
      dark: false,
      sceneId: null,
      flash: 0,
      nextFlash: 3,
      skyOverride: null,
      mood: 'cloudy',
      pointer: { x: 0, y: 0 },
      cloudOpacity: 0.6,
      rainOpacity: 0,
      snowOpacity: 0,
      look: { ambient: 1, exposure: 1, fog: 1 },
      cameraHint: { height: 10.4, distance: 36, targetY: 11.4, fov: 52 },
      cameraNow: { height: 10.4, distance: 36, targetY: 11.4, fov: 52 },
    }
    var active = null
    var textures = { dotTexture: dots }

    /** 换场景：旧场景自己收掉，新场景跟着天气与调色走。 */
    function adopt(sceneId) {
      var factory = (root.WxScenes || {})[sceneId] || (root.WxScenes || {}).city
      if (typeof factory !== 'function' || state.sceneId === sceneId) return
      if (active !== null) {
        scene.remove(active.group)
        if (typeof active.dispose === 'function') active.dispose()
        active = null
      }
      state.sceneId = sceneId
      active = factory(THREE, textures)
      active.group.traverse(function (object) {
        if (object.isMesh || object.isInstancedMesh) {
          object.castShadow = true
          object.receiveShadow = true
        }
      })
      scene.add(active.group)
      if (typeof active.setWeather === 'function') active.setWeather({ weather: state.weather, night: state.night, dark: state.dark })
      if (active.camera) state.cameraHint = active.camera
      // 有的城不想要一片蓝天（赛博朋克默认在雾里），交给场景声明。
      state.skyOverride = active.sky || null
      // 收集一次这座城里的媒体立面材质，帧循环里只为它们推时间。
      mediaUniforms.length = 0
      active.group.traverse(function (object) {
        var material = object.material
        if (material && material.uniforms && material.uniforms.uKind !== undefined) mediaUniforms.push(material.uniforms)
      })
      state.look = active.look || { ambient: 1, exposure: 1, fog: 1 }
    }

    /** 天气、昼夜与场景：颜色与粒子强度朝新的一组过渡。 */
    function setScene(next) {
      state.weather = next.weather
      state.night = next.night
      state.dark = next.dark
      state.motion = next.motion || 'drift'
      // 先换场景再取调色：场景可以带自己的一套雾与天空（赛博朋克始终在雾里）。
      adopt(next.sceneId || 'city')
      var override = state.skyOverride
      var mood = override && override.weather ? override.weather : next.weather
      state.mood = mood
      state.target = paletteOf(mood, next.night, next.dark)
      if (override && typeof override.fog === 'number') state.target.fog *= override.fog
      var wet = next.weather === 'rain' || next.weather === 'storm'
      state.rainOpacity = wet ? (next.weather === 'storm' ? 0.34 : 0.2) : 0
      state.snowOpacity = mood === 'snow' ? 0.95 : 0
      state.cloudOpacity = mood === 'clear' ? 0.5 : mood === 'cloudy' ? 0.72 : mood === 'snow' ? 0.7 : 0.9
      if (active && typeof active.setWeather === 'function') active.setWeather({ weather: next.weather, night: next.night, dark: next.dark })
    }

    function resize(width, height, dpr) {
      state.width = Math.max(1, width)
      state.height = Math.max(1, height)
      renderer.setPixelRatio(clamp(dpr, 1, 1.8))
      renderer.setSize(state.width, state.height, false)
      if (composer !== null) {
        composer.setPixelRatio(renderer.getPixelRatio())
        composer.setSize(state.width, state.height)
      }
      camera.aspect = state.width / state.height
      if (active && typeof active.resize === 'function') active.resize(state.width, state.height)
    }

    /** 画一帧；`dt` 是秒，`clock` 是这一片天空走过的时间。 */
    function render(dt, clock, pointer) {
      if (pointer) {
        state.pointer.x = lerp(state.pointer.x, clamp(pointer.x, -1, 1), 0.06)
        state.pointer.y = lerp(state.pointer.y, clamp(pointer.y, -1, 1), 0.06)
      }
      var ease = 1 - Math.exp(-dt * 2.4)
      var palette = state.palette
      mixColor(palette.top, state.target.top, ease)
      mixColor(palette.mid, state.target.mid, ease)
      mixColor(palette.low, state.target.low, ease)
      mixColor(palette.haze, state.target.haze, ease)
      mixColor(palette.sun, state.target.sun, ease)
      palette.fog = lerp(palette.fog, state.target.fog, ease)
      palette.ambient = lerp(palette.ambient, state.target.ambient, ease)
      palette.windows = lerp(palette.windows, state.target.windows, ease)
      palette.stars = lerp(palette.stars, state.target.stars, ease)
      palette.exposure = lerp(palette.exposure, state.target.exposure, ease)

      skyUniforms.uTop.value.copy(palette.top)
      skyUniforms.uMid.value.copy(palette.mid)
      skyUniforms.uLow.value.copy(palette.low)
      skyUniforms.uHaze.value.copy(palette.haze)
      skyUniforms.uSun.value.copy(palette.sun)
      skyUniforms.uGlow.value = state.mood === 'clear' ? 0.55 : state.mood === 'cloudy' ? 0.28 : 0.12

      // 雷：隔两三秒亮一下，亮起时天与雾一起泛白。
      if (state.mood === 'storm' && clock >= state.nextFlash) {
        state.flash = 1
        state.nextFlash = clock + 2.2 + Math.random() * 2.6
      }
      state.flash = Math.max(0, state.flash - dt * 3.4)
      var flicker = state.flash > 0.6 ? state.flash : state.flash * 0.4
      skyUniforms.uFlash.value = flicker * 0.55

      scene.fog.color.copy(palette.haze)
      scene.fog.density = palette.fog * state.look.fog
      renderer.toneMappingExposure = palette.exposure * state.look.exposure * (1 + flicker * 0.25)
      hemi.intensity = palette.ambient * state.look.ambient
      fill.intensity = 0.18 * state.look.ambient
      ambient.intensity = 0.18 + palette.ambient * 0.22
      key.intensity = 0.5 + palette.ambient * 0.7

      // 日月的位置：晴天高一点，阴雨压到云后。
      var sunAngle = state.night ? 2.4 : 0.9
      var sunDirX = Math.cos(sunAngle) * 0.8
      var sunDirY = state.night ? 0.42 : 0.3
      var sunDirZ = -0.9
      var sunLength = Math.sqrt(sunDirX * sunDirX + sunDirY * sunDirY + sunDirZ * sunDirZ)
      skyUniforms.uSunDir.value.set(sunDirX / sunLength, sunDirY / sunLength, sunDirZ / sunLength)
      body.position.set(sunDirX / sunLength, sunDirY / sunLength, sunDirZ / sunLength).multiplyScalar(320)
      body.material.color.copy(palette.sun)
      body.scale.setScalar(state.night ? 26 : 44)
      // 白天太阳只当一枚亮斑：太亮会被泛光揉成一片奶白，把整幅画面洗掉。
      // 城市里楼群很高，日月只需一小枚亮斑：给大了泛光会把半幅画面洗白。
      body.material.opacity = state.mood === 'clear' ? (state.night ? 0.62 : 0.5) : state.mood === 'cloudy' ? 0.36 : 0.14

      stars.material.opacity = palette.stars * (state.weather === 'clear' ? 1 : 0.8)
      stars.rotation.y = clock * 0.004

      // 云：横着慢慢漂，出画就从另一头回来。
      for (var i = 0; i < clouds.length; i += 1) {
        var cloud = clouds[i]
        cloud.sprite.position.x = cloud.base + clock * cloud.speed
        if (cloud.sprite.position.x > 190) cloud.base -= 380
        if (cloud.sprite.position.x < -190) cloud.base += 380
        cloud.sprite.material.opacity = lerp(cloud.sprite.material.opacity, state.cloudOpacity * (0.35 + (i % 5) * 0.12), ease)
        cloud.sprite.material.color.copy(palette.mid)
      }

      rainUniforms.uTime.value = clock
      rainUniforms.uOpacity.value = lerp(rainUniforms.uOpacity.value, state.rainOpacity, ease)
      rain.visible = rainUniforms.uOpacity.value > 0.01
      // 雨雪跟着镜头走：固定在一处的雨箱，镜头一挪就只剩远处几点。
      rain.position.x = camera.position.x
      rain.position.z = camera.position.z
      // 高机位要把雨箱一起抬上去，否则俯看时雨全在脚下、只剩一些小点。
      rain.position.y = clamp(camera.position.y - 16, 0, 46)
      snowUniforms.uTime.value = clock
      snow.position.x = camera.position.x
      snow.position.z = camera.position.z
      snow.position.y = clamp(camera.position.y - 16, 0, 46)
      snowUniforms.uOpacity.value = lerp(snowUniforms.uOpacity.value, state.snowOpacity, ease)
      snow.visible = snowUniforms.uOpacity.value > 0.01

      // 场景自己的动画。
      if (active && typeof active.update === 'function') active.update(dt, clock, palette)
      // 媒体立面（广告楼、流光墙）的着色器只认这两个 uniform，统一在这里推进。
      for (var m = 0; m < mediaUniforms.length; m += 1) {
        mediaUniforms[m].uTime.value = clock
        mediaUniforms[m].uNight.value = state.night ? 1 : 0
      }

      // 镜头：场景可以自己给一条轨道（`rig`），没有时就沿街慢慢推拉。换场景时参数平滑过去。
      var hint = state.cameraHint
      var now = state.cameraNow
      now.height = lerp(now.height, hint.height || 10.4, ease)
      now.distance = lerp(now.distance, hint.distance || 36, ease)
      now.targetY = lerp(now.targetY, hint.targetY || 11.4, ease)
      now.fov = lerp(now.fov, hint.fov || 52, ease)
      // `still` 只把镜头放稳：同一帧里不推拉也不跟指针。
      var breathe = state.motion === 'still' ? 0 : 1
      var rig = active && active.rig ? active.rig : null
      if (rig !== null) {
        // 轨道由场景给：位置与看向点都是关于时间的函数，轨道自己决定推、升、绕还是跟车。
        rig(clock * breathe, camera.position, lookTarget)
        camera.position.x += state.pointer.x * 1.6 * breathe
        camera.position.y += state.pointer.y * 0.9 * breathe
        camera.fov = state.width / state.height < 0.9 ? now.fov + 10 : now.fov
        camera.updateProjectionMatrix()
        camera.lookAt(lookTarget.x + state.pointer.x * 1.2, lookTarget.y + state.pointer.y * 0.8, lookTarget.z)
      } else {
        var sway = (Math.sin(clock * 0.11) * 0.5 + Math.sin(clock * 0.037) * 0.3) * breathe
        var dolly = Math.sin(clock * 0.05) * 2.6 * breathe
        camera.position.x = state.pointer.x * 3.4 * breathe + Math.sin(clock * 0.09) * 1.4 * breathe
        camera.position.y = now.height + state.pointer.y * 1.1 * breathe + Math.sin(clock * 0.07) * 0.35 * breathe
        camera.position.z = now.distance + dolly - (state.weather === 'storm' ? 3 : 0)
        camera.fov = state.width / state.height < 0.9 ? now.fov + 10 : now.fov
        camera.updateProjectionMatrix()
        camera.lookAt(state.pointer.x * 3.2, now.targetY + state.pointer.y * 1.4 + sway * 0.4, -46)
      }

      if (bloom !== null) {
        // 夜里灯多，泛光收一点免得糊；水墨要更收，墨色不能发光。
        var bloomBase = state.look.bloom === undefined ? 0.3 : state.look.bloom
        bloom.strength = bloomBase * (state.night ? 0.85 : 0.45)
      }
      if (composer !== null) composer.render(dt)
      else renderer.render(scene, camera)
    }

    function snapshot() { return renderer.domElement }

    function dispose() {
      if (active && typeof active.dispose === 'function') active.dispose()
      active = null
      scene.traverse(function (object) {
        if (object.geometry) object.geometry.dispose()
        if (object.material) {
          var materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach(function (material) {
            if (material.map) material.map.dispose()
            if (material.emissiveMap && material.emissiveMap !== material.map) material.emissiveMap.dispose()
            material.dispose()
          })
        }
      })
      if (composer !== null) composer.dispose()
      if (scene.environment) scene.environment.dispose()
      if (pmrem !== null) pmrem.dispose()
      renderer.dispose()
      // 卡片被换掉时立刻放手：浏览器同时保留的 WebGL 上限不高，留着会拖垮下一次创建。
      if (typeof renderer.forceContextLoss === 'function') renderer.forceContextLoss()
    }

    return { resize: resize, setScene: setScene, render: render, snapshot: snapshot, dispose: dispose, paletteOf: paletteOf }
  }

  root.WxWorld = { create: create, paletteOf: paletteOf }
})(window)
