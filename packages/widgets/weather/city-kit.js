/*
 * 街景的公共层：媒体立面、霓虹招牌、人群、街面细节与地标工具。
 *
 * 每个城市（`city-*.js`）只写自己的轮廓、地标与配色；其余共用这里的零件，免得五份文件各抄一遍。
 * 全部只在 `create` 时调用，帧循环里只是改已有矩阵与材质强度（D7 的一份脚本）。
 *
 * 用法：`var kit = root.WxCityKit.create(THREE, api)` 之后调 `kit.ground(...)`、`kit.tower(...)` 等。
 */
;(function (root) {
  'use strict'

  /** 固定种子的随机序列。 */
  function seeded(seed) {
    var state = seed >>> 0
    return function () {
      state = (state * 1664525 + 1013904223) >>> 0
      return state / 4294967296
    }
  }

  /** 把若干折线拼成一个平面几何，省掉一个个 Mesh。 */
  function mergeBoxes(THREE, boxes) {
    var positions = []
    var normals = []
    var uvs = []
    var indices = []
    var base = 0
    for (var i = 0; i < boxes.length; i += 1) {
      var box = boxes[i]
      var geometry = new THREE.BoxGeometry(box.w, box.h, box.d)
      geometry.translate(box.x, box.y, box.z)
      var position = geometry.getAttribute('position')
      var normal = geometry.getAttribute('normal')
      var uv = geometry.getAttribute('uv')
      var index = geometry.getIndex()
      for (var p = 0; p < position.count; p += 1) {
        positions.push(position.getX(p), position.getY(p), position.getZ(p))
        normals.push(normal.getX(p), normal.getY(p), normal.getZ(p))
        uvs.push(uv.getX(p), uv.getY(p))
      }
      for (var k = 0; k < index.count; k += 1) indices.push(index.getX(k) + base)
      base += position.count
      geometry.dispose()
    }
    var merged = new THREE.BufferGeometry()
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    merged.setIndex(indices)
    return merged
  }

  /**
   * 媒体立面：楼身本身就是一块屏。
   *
   * 白天是暗色玻璃幕墙，夜里按着色器跑流动色块、扫描线与噪点；四个城市用不同的图案。
   *
   * @param THREE - Three.js。
   * @param options.kind - `wave`（竖向流光）、`bars`（横向信息条）、`grid`（像素墙）、`streak`（斜向拖影）。
   * @param options.colorA - 主色。
   * @param options.colorB - 副色。
   * @returns 材质。
   */
  function mediaMaterial(THREE, options) {
    return new THREE.ShaderMaterial({
      transparent: false,
      uniforms: {
        uTime: { value: 0 },
        uNight: { value: 0 },
        uA: { value: new THREE.Color(options.colorA || '#39d0ff') },
        uB: { value: new THREE.Color(options.colorB || '#ff3d9a') },
        uKind: { value: options.kind === 'bars' ? 1 : options.kind === 'grid' ? 2 : options.kind === 'streak' ? 3 : 0 },
      },
      vertexShader: [
        'varying vec2 vUv;',
        'varying vec3 vWorld;',
        'void main() {',
        '  vUv = uv;',
        '  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;',
        '  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform float uTime;',
        'uniform float uNight;',
        'uniform vec3 uA;',
        'uniform vec3 uB;',
        'uniform float uKind;',
        'varying vec2 vUv;',
        'varying vec3 vWorld;',
        'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
        'void main() {',
        // 竖向流动的光带：城里有节奏地往上走
        '  float wave = smoothstep(0.0, 0.8, sin(vUv.x * 18.0 + vWorld.y * 0.12 - uTime * 0.9));',
        // 横向信息条：像行情屏
        '  float bars = step(0.72, fract(vUv.y * 22.0 + floor(uTime * 0.35) * 0.17));',
        // 像素墙：低分辨率的随机格子，隔一会儿换一次
        '  vec2 cell = floor(vec2(vUv.x * 24.0, vWorld.y * 0.45));',
        '  float grid = step(0.55, hash(cell + floor(uTime * 0.6)));',
        // 斜向拖影
        '  float streak = smoothstep(0.35, 1.0, fract((vUv.x + vUv.y) * 3.0 - uTime * 0.25));',
        '  float pattern = mix(wave, bars, step(1.5, uKind) * step(2.5, uKind));',
        '  pattern = mix(pattern, grid, step(0.5, uKind) * (1.0 - step(2.5, uKind)));',
        '  pattern = mix(pattern, streak, step(2.5, uKind));',
        '  vec3 tint = mix(uA, uB, 0.5 + 0.5 * sin(vWorld.y * 0.05 + uTime * 0.2));',
        '  // 夜里是屏，白天只是带一点反光的深色玻璃。',
        '  vec3 glass = vec3(0.035, 0.05, 0.075) + tint * 0.012;',
        '  vec3 lit = glass + tint * pattern * (0.55 + 0.4 * hash(cell + uTime));',
        '  float scan = 0.92 + 0.08 * sin(vWorld.y * 2.2);',
        '  gl_FragColor = vec4(mix(glass, lit * scan, uNight), 1.0);',
        '}',
      ].join('\n'),
    })
  }

  /** 一块霓虹招牌：canvas 画的字与描边，自发光，泛光会把它揉开。 */
  function neonTexture(THREE, text, color) {
    var width = 512
    var height = 160
    var canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    var ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, width, height)
    ctx.font = 'bold 96px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = color
    ctx.shadowBlur = 34
    ctx.fillStyle = color
    ctx.fillText(text, width / 2, height / 2)
    ctx.shadowBlur = 0
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'
    ctx.lineWidth = 2
    ctx.strokeText(text, width / 2, height / 2)
    var texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  /**
   * 一块横排霓虹招牌：canvas 画字与光晕，贴在任意朝向的面上。
   *
   * @param THREE - Three.js。
   * @param options.text - 显示的词。
   * @param options.color - 主色。
   * @param options.width - 招牌宽。
   * @param options.height - 招牌高。
   * @param options.vertical - 竖排（一次一个字）。
   * @returns `{ mesh, dispose }`。
   */
  function neonPanel(THREE, options) {
    var text = options.text || 'NEON'
    var color = options.color || '#5fe3ff'
    var width = options.width || 6
    var height = options.height || 2.4
    var vertical = options.vertical === true
    var canvasWidth = vertical ? 160 : 512
    var canvasHeight = vertical ? 512 : 160
    var canvas = document.createElement('canvas')
    canvas.width = canvasWidth
    canvas.height = canvasHeight
    var ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvasWidth, canvasHeight)
    ctx.shadowColor = color
    ctx.shadowBlur = 40
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (vertical) {
      var size = Math.min(120, Math.floor((canvasHeight - 40) / Math.max(1, text.length)))
      ctx.font = 'bold ' + size + 'px ui-sans-serif, system-ui, sans-serif'
      for (var i = 0; i < text.length; i += 1) {
        ctx.fillText(text.charAt(i), canvasWidth / 2, (i + 0.5) * (canvasHeight / text.length))
      }
    } else {
      var fitted = 96
      ctx.font = 'bold ' + fitted + 'px ui-sans-serif, system-ui, sans-serif'
      while (ctx.measureText(text).width > canvasWidth - 60 && fitted > 24) {
        fitted -= 4
        ctx.font = 'bold ' + fitted + 'px ui-sans-serif, system-ui, sans-serif'
      }
      ctx.fillText(text, canvasWidth / 2, canvasHeight / 2)
    }
    ctx.shadowBlur = 0
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'
    ctx.lineWidth = 2
    var texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    var material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, depthWrite: false, side: THREE.DoubleSide })
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material)
    return {
      mesh: mesh,
      dispose: function () {
        texture.dispose()
        material.dispose()
        mesh.geometry.dispose()
      },
    }
  }

  /**
   * 全景广告屏：一块朝街的大屏，画面由 canvas 动画驱动（每 0.12 秒换一帧，省掉 GPU 上的算力）。
   *
   * @param THREE - Three.js。
   * @param options.width - 屏宽。
   * @param options.height - 屏高。
   * @param options.theme - `news`、`anime`、`tech`、`finance`。
   * @returns 一组：`mesh`、`update(dt, night)`、`texture`。
   */
  function billboard(THREE, options) {
    var width = 384
    var height = 192
    var canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    var ctx = canvas.getContext('2d')
    var texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    var interval = 0.12
    var since = 0
    var frame = 0
    var theme = options.theme || 'tech'
    var palettes = {
      news: ['#0d3b66', '#f4d35e', '#ee964b'],
      anime: ['#ff5fa2', '#ffe66d', '#7bdff2'],
      tech: ['#0b1d3a', '#39d0ff', '#9b5cff'],
      finance: ['#04203a', '#19d2a2', '#ffd166'],
    }
    var palette = palettes[theme] || palettes.tech
    /** 画一帧：底色、一条正在走的色带、几行字，加一层扫描线。 */
    function draw(time) {
      ctx.fillStyle = palette[0]
      ctx.fillRect(0, 0, width, height)
      var band = (time * 40) % (width + 160) - 160
      var gradient = ctx.createLinearGradient(band, 0, band + 160, height)
      gradient.addColorStop(0, 'rgba(0,0,0,0)')
      gradient.addColorStop(0.5, palette[1])
      gradient.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalAlpha = 0.55
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)
      ctx.globalAlpha = 1
      ctx.fillStyle = palette[2]
      ctx.font = 'bold 44px ui-sans-serif, system-ui, sans-serif'
      ctx.fillText(theme === 'anime' ? 'ネオン東京' : theme === 'news' ? 'LIVE CBD' : theme === 'finance' ? 'INDEX ▲ 1.8%' : 'AI × CITY', 22, 66)
      ctx.font = '600 26px ui-sans-serif, system-ui, sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.86)'
      ctx.fillText(theme === 'finance' ? (12620 + Math.round(Math.sin(time) * 40)).toString() : 'THE FUTURE IS ALREADY HERE', 22, 112)
      ctx.globalAlpha = 0.25
      ctx.fillStyle = '#000'
      for (var y = 0; y < height; y += 4) ctx.fillRect(0, y, width, 1.5)
      ctx.globalAlpha = 1
      texture.needsUpdate = true
    }
    draw(0)
    var material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(options.width || 12, options.height || 6), material)
    return {
      mesh: mesh,
      texture: texture,
      update: function (dt, night) {
        since += dt
        material.color.setScalar(night ? 1 : 0.42)
        if (since < interval) return
        since = 0
        frame += 0.35
        draw(frame)
      },
    }
  }

  /**
   * 一群人：低模人形，实例化，沿街来回走并摆腿。
   *
   * @param THREE - Three.js。
   * @param options.count - 人数。
   * @param options.range - `{ x0, x1, z0, z1 }` 活动范围。
   * @param options.coat - 衣服主色。
   * @returns `{ group, update(dt, night) }`。
   */
  function crowd(THREE, options) {
    var count = options.count || 90
    // 每个人两条腿：实例数按人算两倍，索引也按人走。
    var total = count * 2
    var geometry = new THREE.BoxGeometry(0.34, 1.05, 0.28)
    var material = new THREE.MeshStandardMaterial({ color: options.coat || 0x2a2f3a, roughness: 0.85, metalness: 0.05 })
    var mesh = new THREE.InstancedMesh(geometry, material, total)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    var range = options.range || { x0: -18, x1: 18, z0: -40, z1: 6 }
    var random = seeded(options.seed || 51)
    var walkers = []
    var color = new THREE.Color()
    for (var i = 0; i < count; i += 1) {
      walkers.push({
        x: range.x0 + random() * (range.x1 - range.x0),
        z: range.z0 + random() * (range.z1 - range.z0),
        speed: (0.6 + random() * 0.9) * (random() > 0.5 ? 1 : -1),
        phase: random() * Math.PI * 2,
        scale: 0.9 + random() * 0.25,
      })
      color.setHSL(0.58 + random() * 0.08, 0.16, 0.22 + random() * 0.2)
      mesh.setColorAt(i, color)
    }
    var group = new THREE.Group()
    group.add(mesh)
    // 头：一颗小球。俯拍时人群是一堆方块，加上头才有"人在走"的读法。
    var headGeometry = new THREE.SphereGeometry(0.135, 6, 5)
    var headMaterial = new THREE.MeshStandardMaterial({ color: options.coat || 0x2a2f3a, roughness: 0.85, metalness: 0.05 })
    var heads = new THREE.InstancedMesh(headGeometry, headMaterial, count)
    heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    group.add(heads)
    var near = new THREE.Vector2()
    var matrix = new THREE.Matrix4()
    var quat = new THREE.Quaternion()
    var position = new THREE.Vector3()
    var scale = new THREE.Vector3()
    return {
      group: group,
      update: function (dt, night) {
        // 白天的人在日光下是暗的剪影，夜里被招牌照亮；同一份实例色乘这个系数。
        material.color.setScalar(night ? 0.72 : 0.5)
        material.emissive.setRGB(0, 0, 0)
        for (var w = 0; w < count; w += 1) {
          var walker = walkers[w]
          walker.z += walker.speed * dt * 3.2
          if (walker.z > range.z1) walker.z = range.z0
          if (walker.z < range.z0) walker.z = range.z1
          // 腿：两个矮方块，一前一后，按步伐相位错开。
          var swing = Math.sin(walker.phase + walker.z * 2.4) * 0.16
          for (var leg = 0; leg < 2; leg += 1) {
            var index = w * 2 + leg
            var side = leg === 0 ? -0.1 : 0.1
            near.set(walker.x + side, walker.z)
            quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, 0)
            position.set(walker.x + side, 0.42, walker.z + (leg === 0 ? swing : -swing))
            scale.set(walker.scale, walker.scale, walker.scale)
            matrix.compose(position, quat, scale)
            mesh.setMatrixAt(index, matrix)
          }
        }
        mesh.instanceMatrix.needsUpdate = true
        // 头跟着身体走，位置在肩上一点。
        for (var h = 0; h < count; h += 1) {
          var walkerH = walkers[h]
          var bob = Math.abs(Math.sin(walkerH.phase + walkerH.z * 2.4)) * 0.03
          position.set(walkerH.x, 1.34 * walkerH.scale + bob, walkerH.z)
          scale.setScalar(walkerH.scale)
          matrix.compose(position, quat, scale)
          heads.setMatrixAt(h, matrix)
        }
        heads.instanceMatrix.needsUpdate = true
        headMaterial.color.copy(material.color)
        mesh.visible = true
      },
    }
  }

  /** 街面细节：护栏、斑马线、路牌、路灯杆底座 —— 一次合并成一块几何。 */
  function streetFurniture(THREE, options) {
    var boxes = []
    var random = seeded(options.seed || 88)
    var length = options.length || 120
    // 斑马线：一段段白条，沿街均匀。
    for (var stripe = 0; stripe < 18; stripe += 1) {
      boxes.push({ w: 0.5, h: 0.02, d: 3.2, x: -length / 2 + 4 + stripe * 1.2, y: 0.03, z: -2 })
    }
    // 护栏：两侧连续的矮杆与横杆。
    for (var rail = 0; rail < 26; rail += 1) {
      var z = -length / 2 + rail * (length / 26)
      boxes.push({ w: 0.08, h: 0.85, d: 0.08, x: -11, y: 0.43, z: z })
      boxes.push({ w: 0.08, h: 0.85, d: 0.08, x: 11, y: 0.43, z: z })
    }
    boxes.push({ w: 0.06, h: 0.06, d: length, x: -11, y: 0.8, z: 0 })
    boxes.push({ w: 0.06, h: 0.06, d: length, x: 11, y: 0.8, z: 0 })
    // 路灯杆：两侧各八根，杆顶一段横臂。
    for (var lamp = 0; lamp < 8; lamp += 1) {
      var lz = -length / 2 + 6 + lamp * (length / 8)
      boxes.push({ w: 0.14, h: 4.2, d: 0.14, x: -10.4, y: 2.1, z: lz })
      boxes.push({ w: 0.14, h: 4.2, d: 0.14, x: 10.4, y: 2.1, z: lz })
      boxes.push({ w: 1.1, h: 0.1, d: 0.1, x: -9.9, y: 4.15, z: lz })
      boxes.push({ w: 1.1, h: 0.1, d: 0.1, x: 9.9, y: 4.15, z: lz })
    }
    var merged = mergeBoxes(THREE, boxes)
    var material = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.6, metalness: 0.6 })
    var mesh = new THREE.Mesh(merged, material)
    // 一点随机让它不死板。
    mesh.rotation.y = (random() - 0.5) * 0.004
    return mesh
  }

  /**
   * 街面反光：一条沿街的加色光带，夜里把招牌的颜色拉成竖条。
   *
   * @param THREE - Three.js。
   * @param options.color - 光带颜色。
   * @returns `{ group, dispose }`。
   */
  function reflectionStrips(THREE, options) {
    var group = new THREE.Group()
    var colors = options.colors || ['#5fe3ff', '#ff3d9a', '#ffd166']
    var random = seeded(options.seed || 21)
    var strips = []
    for (var i = 0; i < 14; i += 1) {
      var color = new THREE.Color(colors[i % colors.length])
      var material = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })
      var mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.1 + random() * 1.6, 10 + random() * 16), material)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set((random() - 0.5) * 17, 0.035, -6 - random() * (options.span || 44))
      group.add(mesh)
      strips.push({ mesh: mesh, phase: random() * Math.PI * 2 })
    }
    return {
      group: group,
      update: function (clock, night) {
        for (var s = 0; s < strips.length; s += 1) {
          var strip = strips[s]
          strip.mesh.material.opacity = (night ? 0.22 : 0.06) + 0.05 * Math.sin(clock * 1.4 + strip.phase)
        }
      },
      dispose: function () {
        for (var s2 = 0; s2 < strips.length; s2 += 1) {
          strips[s2].mesh.geometry.dispose()
          strips[s2].mesh.material.dispose()
        }
      },
    }
  }

  /** 地标常用的圆台/棱台：从底宽到顶宽、从底高到顶高的过渡。 */
  function frustum(THREE, options) {
    var bottom = options.bottom || 6
    var top = options.top || 3
    var height = options.height || 40
    var sides = options.sides || 8
    return new THREE.CylinderGeometry(top / 2, bottom / 2, height, sides, 1, false)
  }

  /** 一束横跨街道的光：顶点与底部各一条窄光带，夜里亮。 */
  function lightBeam(THREE, options) {
    var radius = options.radius || 0.08
    var length = options.length || 20
    var geometry = new THREE.CylinderGeometry(radius, radius, length, 6, 1, true)
    var material = new THREE.MeshBasicMaterial({ color: options.color || 0x66ccff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
    var mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.z = Math.PI / 2
    return mesh
  }

  root.WxCityKit = {
    seeded: seeded,
    mergeBoxes: mergeBoxes,
    mediaMaterial: mediaMaterial,
    neonTexture: neonTexture,
    billboard: billboard,
    crowd: crowd,
    streetFurniture: streetFurniture,
    frustum: frustum,
    lightBeam: lightBeam,
    neonPanel: neonPanel,
    reflectionStrips: reflectionStrips,
  }
})(window)
