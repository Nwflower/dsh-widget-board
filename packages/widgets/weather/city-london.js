/*
 * 场景「泰晤士河看塔桥」：阴雨是这座城的长住客，机位落在一条船上看雾里的塔桥。
 *
 * 构图分三段：船首栏杆斜切过画面下缘，宽河面把塔桥与两岸的灯映亮，塔桥与金融城压进雾里。
 * 与 `scene-city.js` 同一种形状：`create(THREE, api)` 交回
 * `{ id, group, camera, rig, look, setWeather, resize, update, dispose }`；
 * 天空、雾、雨雪与泛光归 `world.js`，镜头轨道写在这里的 `rig` 里（`t` 是秒，`still` 时为 0）。
 */
;(function (root) {
  'use strict'

  var TAU = Math.PI * 2
  var HALF_PI = Math.PI / 2
  var ROAD_LEVEL = 14
  // 前甲板的高度：镜头在它上方三米半，甲板前缘与栏杆才能压到画面下缘。
  var DECK_Y = 1.7
  // 船首尖在镜头前方十五米处：两条栏杆从这里收向船首，越过去就是河面。
  var BOW_Z = -15
  // 单程 32 秒：慢到看不出推拉，只留下水上的漂。
  var SLIDE_SECONDS = 32

  function lerp(from, to, t) { return from + (to - from) * t }

  /**
   * 船上的机位：位置与看向点都是关于时间的函数，不新建任何东西。
   *
   * 高度在 3 到 6 之间浮沉，沿河从 z=−80 走到 −40 再退回；三组频率叠加的横摇、纵摇与侧移是水上的浮沉。
   * 船首组也在这里跟着镜头走：镜头离不了船，`still` 时船首同样停在 `t = 0` 的位置。
   * `t = 0` 时几项正弦都取 0，静止与循环的起点是同一个构图：塔桥落在画面上部，河面占下半幅。
   */
  function createRig(THREE, bow) {
    var placed = new THREE.Vector3()
    var looked = new THREE.Vector3()
    return function rig(t, outPosition, outTarget) {
      var phase = (t / SLIDE_SECONDS) % 1
      // 一个来回占两份时长：前半段朝塔桥推进，后半段退回。
      var slide = Math.sin(phase * TAU)
      var sway = Math.sin(t * 0.31) * 0.42 + Math.sin(t * 0.73 + 1.1) * 0.2 + Math.sin(t * 1.37 + 2.3) * 0.08
      var heave = Math.sin(t * 0.53 + 0.4) * 0.3 + Math.sin(t * 1.11) * 0.11 + Math.sin(t * 1.93 + 0.8) * 0.04
      var drift = Math.sin(t * 0.19 + 2) * 2.4 + Math.sin(t * 0.47) * 0.7

      // 高度在 3 到 6 之间：推进时升一点，退回去时落一点，纵摇再叠上不到半米。
      placed.set(drift, 4.55 + slide * 1 + heave, -60 - slide * 20)
      // 看向点锁在塔桥上层桥身；镜头比桥面低，仰角把桥身送到画面上部，下半幅全是河面。
      looked.set(sway * 3.2 + 2, ROAD_LEVEL - 4 + heave * 1.4, -200)

      outPosition.copy(placed)
      outTarget.copy(looked)

      // 船首长在镜头上：位置跟住机位，横摇与纵摇的幅度很小，画面下缘那两条栏杆才跟着轻轻起落。
      bow.position.set(placed.x, heave * 0.25, placed.z)
      bow.rotation.z = sway * 0.012
      bow.rotation.x = Math.sin(t * 0.71 + 0.5) * 0.006
    }
  }

  /** 可平铺的 canvas 贴图；粗糙度贴图不能声明成 sRGB，否则粗糙度会被曲线先扭一遍。 */
  function canvasTexture(THREE, width, height, srgb, repeatX, repeatY, draw) {
    var canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    draw(canvas.getContext('2d'))
    var texture = new THREE.CanvasTexture(canvas)
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(repeatX, repeatY)
    return texture
  }

  /** 按 `{ y, w }` 的轮廓叠出塔身：小黄瓜的收腰与碎片大厦的收锥共用这一段。 */
  function taperTower(THREE, kit, profile, sides, material) {
    var tower = new THREE.Group()
    for (var i = 0; i < profile.length - 1; i += 1) {
      var low = profile[i]
      var high = profile[i + 1]
      var piece = new THREE.Mesh(kit.frustum(THREE, { bottom: low.w, top: high.w, height: high.y - low.y, sides: sides }), material)
      piece.position.y = (low.y + high.y) / 2
      tower.add(piece)
    }
    return tower
  }

  function create(THREE, api) {
    var kit = root.WxCityKit
    var up = new THREE.Vector3(0, 1, 0)
    // 贴片平躺在地上、圆柱立起来，都靠这两根轴转过去；建场时定一次。
    var axisX = new THREE.Vector3(1, 0, 0)
    var axisZ = new THREE.Vector3(0, 0, 1)
    var group = new THREE.Group()
    var weather = 'cloudy'
    var night = false
    var random = kit.seeded(20121)
    // 建场与帧循环共用这一组暂存：每帧再 new 一次，垃圾回收会跟着镜头一起抖。
    var matrix = new THREE.Matrix4()
    var quaternion = new THREE.Quaternion()
    var position = new THREE.Vector3()
    var scale = new THREE.Vector3(1, 1, 1)
    var tint = new THREE.Color()
    var direction = new THREE.Vector3()

    /** 把实例放到某处：位置固定的实例都从这里写矩阵，帧循环里不必每处重拼一遍。 */
    function place(target, index, x, y, z) {
      position.set(x, y, z)
      matrix.compose(position, quaternion, scale)
      target.setMatrixAt(index, matrix)
    }

    /** 两根点之间的一段方柱：从 (0,0,0) 指向 (0,1,0) 的圆柱转过去。 */
    function strut(from, to, radius, sides, material) {
      var dx = to[0] - from[0]
      var dy = to[1] - from[1]
      var dz = to[2] - from[2]
      var length = Math.sqrt(dx * dx + dy * dy + dz * dz)
      var mesh = new THREE.Mesh(kit.frustum(THREE, { bottom: radius * 2, top: radius * 2, height: length, sides: sides || 5 }), material)
      mesh.position.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2)
      mesh.quaternion.setFromUnitVectors(up, direction.set(dx, dy, dz).normalize())
      return mesh
    }

    // —— 近景：船首 ——
    // 前甲板铺出去十五米，两条栏杆从画面下角收向船首尖，越过去才是河面。
    // 甲板、栏杆与船灯装进 `bow`，`rig` 每帧把它的原点放到镜头脚下，镜头推拉时船首不会漂走。

    // 水面颜色与粗糙度分开画：粗糙度贴图里那些横向暗纹就是起伏的碎浪。
    var waterMap = canvasTexture(THREE, 256, 256, true, 10, 10, function (ctx) {
      ctx.fillStyle = '#14222c'
      ctx.fillRect(0, 0, 256, 256)
      for (var grain = 0; grain < 1400; grain += 1) {
        var shade = 12 + Math.round(random() * 22)
        ctx.fillStyle = 'rgba(' + (shade + 2) + ',' + (shade + 6) + ',' + (shade + 12) + ',0.5)'
        ctx.fillRect(random() * 256, random() * 256, 1 + random() * 4, 0.6 + random() * 1.4)
      }
    })
    var waterRough = canvasTexture(THREE, 256, 256, false, 10, 10, function (ctx) {
      ctx.fillStyle = '#8a8a8a'
      ctx.fillRect(0, 0, 256, 256)
      // 横向的长条：风一吹，水面的高低只沿横方向连成片，竖着断得很快。
      for (var ripple = 0; ripple < 90; ripple += 1) {
        var rippleX = random() * 256
        var rippleY = random() * 256
        var rippleW = 24 + random() * 90
        var gradient = ctx.createLinearGradient(0, rippleY, 0, rippleY + 10)
        gradient.addColorStop(0, 'rgba(26,26,26,0)')
        gradient.addColorStop(0.5, 'rgba(26,26,26,0.92)')
        gradient.addColorStop(1, 'rgba(26,26,26,0)')
        ctx.fillStyle = gradient
        ctx.fillRect(rippleX - rippleW / 2, rippleY, rippleW, 4 + random() * 6)
      }
    })
    var waterMaterial = new THREE.MeshStandardMaterial({ map: waterMap, roughnessMap: waterRough, roughness: 0.24, metalness: 0.78 })
    var water = new THREE.Mesh(new THREE.PlaneGeometry(1100, 1100), waterMaterial)
    water.rotation.x = -HALF_PI
    water.position.set(0, 0, -440)
    group.add(water)

    // 水面底下兜一层暗色：远处被雾化开之后，地平线以下不能是天空的颜色。
    var bed = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ color: 0x080c11, roughness: 0.9, metalness: 0.1 }))
    bed.rotation.x = -HALF_PI
    bed.position.set(0, -1.2, -140)
    group.add(bed)

    var deckMaterial = new THREE.MeshStandardMaterial({ color: 0x2f2822, roughness: 0.82, metalness: 0.14 })
    var railMaterial = new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.42, metalness: 0.82 })
    var bow = new THREE.Group()
    group.add(bow)
    var deck = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.3, 23), deckMaterial)
    deck.position.set(0, DECK_Y, -3.5)
    bow.add(deck)

    // 船舷与栏杆沿两条斜线收向船首：近大远小把画面的深度推开，两条下斜线把画面下缘掐成一块三角。
    // 收得窄一点，一列高的卡片里两条栏杆才都在画内。
    for (var railSide = 0; railSide < 2; railSide += 1) {
      var sideSign = railSide === 0 ? -1 : 1
      bow.add(strut([sideSign * 3.6, DECK_Y + 1.15, 6], [sideSign * 1.1, DECK_Y + 0.92, BOW_Z], 0.05, 5, railMaterial))
      bow.add(strut([sideSign * 3.6, DECK_Y + 0.66, 6], [sideSign * 1.1, DECK_Y + 0.43, BOW_Z], 0.07, 5, railMaterial))
      for (var post = 0; post < 7; post += 1) {
        var railT = post / 6
        bow.add(strut([sideSign * lerp(3.6, 1.1, railT), DECK_Y, lerp(6, BOW_Z, railT)], [sideSign * lerp(3.6, 1.1, railT), DECK_Y + 1.18 - railT * 0.2, lerp(6, BOW_Z, railT)], 0.045, 5, railMaterial))
      }
    }
    // 船首那一圈挡板：一块矮平板横切过画面下缘。
    bow.add(strut([-1.2, DECK_Y + 0.95, BOW_Z], [1.2, DECK_Y + 0.95, BOW_Z], 0.16, 6, railMaterial))

    // 船首量角器：围着光点的一圈刻度，海图上最常见的那块装饰。
    var compass = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.07, 1.5), railMaterial, 13)
    for (var tick = 0; tick < 13; tick += 1) {
      var tickAngle = -Math.PI / 3 + (tick / 12) * (TAU / 3)
      position.set(Math.sin(tickAngle) * 1.4, DECK_Y + 0.16, -11.6 + Math.cos(tickAngle) * 1.4)
      quaternion.setFromAxisAngle(up, tickAngle)
      scale.set(1, 1, tick % 3 === 0 ? 1.5 : 1)
      matrix.compose(position, quaternion, scale)
      compass.setMatrixAt(tick, matrix)
    }
    quaternion.identity()
    scale.set(1, 1, 1)
    bow.add(compass)

    // 左下角那盏船灯：铜灯挂在左舷栏杆上，暖光晕压住画面左下角，把栏杆与甲板照亮一块。
    var lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: api.dotTexture, color: 0xffa860, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }))
    lampGlow.position.set(-2.2, DECK_Y + 1.5, -7.5)
    lampGlow.scale.setScalar(0.9)
    bow.add(lampGlow)
    var lamp = new THREE.PointLight(0xffa556, 34, 26, 2)
    lamp.position.set(-1.6, DECK_Y + 1.7, -6.5)
    bow.add(lamp)
    bow.add(strut([-2.2, DECK_Y, -7.5], [-2.2, DECK_Y + 1.4, -7.5], 0.07, 5, railMaterial))

    // 右舷的桅杆与桅顶白灯：给画面右侧压一条竖线，冷白与船灯的暖黄拉开。
    var mastGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: api.dotTexture, color: 0xdce9ff, transparent: true, opacity: 0.38, depthWrite: false, blending: THREE.AdditiveBlending }))
    mastGlow.position.set(2.4, DECK_Y + 2.5, -9.5)
    mastGlow.scale.setScalar(0.45)
    bow.add(mastGlow)
    bow.add(strut([2.4, DECK_Y, -9.5], [2.4, DECK_Y + 2.4, -9.5], 0.08, 5, railMaterial))

    // —— 中景：河面 ——
    // 光路是一张朝上的贴片：远处窄、近处宽，暖色集中在塔桥脚下，冷色散在两侧。
    var sheenMaterial = new THREE.MeshBasicMaterial({ map: api.dotTexture, vertexColors: true, transparent: true, opacity: 0.34, depthWrite: false, blending: THREE.AdditiveBlending })
    var sheenCount = 30
    var sheens = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), sheenMaterial, sheenCount)
    var sheenColor = new THREE.Color()
    for (var sheen = 0; sheen < sheenCount; sheen += 1) {
      var depth = random()
      var sheenSpread = 1 - depth * 0.45
      position.set((random() - 0.5) * 130 * sheenSpread, 0.06, -70 - depth * 150)
      scale.set((2 + random() * 5) * sheenSpread, (16 + random() * 46) * (1 - depth * 0.6), 1)
      // 贴片平躺在地上，绕 x 转过 90° 才是朝上的一张；矩阵里先转再缩。
      matrix.compose(position, quaternion.setFromAxisAngle(axisX, -HALF_PI), scale)
      sheens.setMatrixAt(sheen, matrix)
      var warm = Math.abs(position.x) < 26
      sheenColor.setHex(warm ? 0xffc98c : 0xa8cff2).multiplyScalar(0.35 + (1 - depth) * 0.65)
      sheens.setColorAt(sheen, sheenColor)
    }
    quaternion.identity()
    group.add(sheens)

    // 浪花：水面的碎白点一直在换位置，看久了才觉出河在动。点少、点小、偏冷灰，免得像一层雪花。
    var foamCount = 84
    var foamRandom = kit.seeded(7901)
    var foamSeeds = new Float32Array(foamCount)
    var foamPositions = new Float32Array(foamCount * 3)
    for (var foam = 0; foam < foamCount; foam += 1) {
      foamPositions[foam * 3] = (foamRandom() - 0.5) * 90
      foamPositions[foam * 3 + 1] = 0.1
      foamPositions[foam * 3 + 2] = -66 - foamRandom() * 96
      foamSeeds[foam] = foamRandom()
    }
    var foamGeometry = new THREE.BufferGeometry()
    foamGeometry.setAttribute('position', new THREE.BufferAttribute(foamPositions, 3))
    foamGeometry.setAttribute('aSeed', new THREE.BufferAttribute(foamSeeds, 1))
    var foamUniforms = { uTime: { value: 0 }, uOpacity: { value: 0.28 } }
    var foam = new THREE.Points(foamGeometry, new THREE.ShaderMaterial({
      uniforms: foamUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: [
        'attribute float aSeed;',
        'uniform float uTime;',
        'varying float vFade;',
        'void main() {',
        // 每个点各自绕一段小圈：看上去是水面在翻，不是点在漂。
        '  vec3 p = position;',
        '  p.x += sin(uTime * (0.4 + aSeed) + aSeed * 31.0) * 0.8;',
        '  p.z += cos(uTime * (0.3 + aSeed * 0.7) + aSeed * 17.0) * 0.6;',
        // 起落的相位错开，同一时刻只有一部分浪尖亮着，不会连成一片。
        '  vFade = 0.2 + 0.8 * smoothstep(0.55, 1.0, abs(sin(uTime * (0.5 + aSeed) + aSeed * 12.0)));',
        '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
        '  gl_PointSize = (1.1 + aSeed * 1.5) * (150.0 / -mv.z);',
        '  gl_Position = projectionMatrix * mv;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform float uOpacity;',
        'varying float vFade;',
        'void main() {',
        '  vec2 d = gl_PointCoord - vec2(0.5);',
        '  float a = smoothstep(0.5, 0.15, length(d));',
        // 冷灰：比主光暗一档，只在浪尖上提一点亮度。
        '  gl_FragColor = vec4(0.52, 0.6, 0.7, a * uOpacity * vFade);',
        '}',
      ].join('\n'),
    }))
    foam.frustumCulled = false
    group.add(foam)

    // 塔桥在水里的倒影：一块铺在桥脚前方水面上的长条，两头与远端都化开，河面才有水的分量。
    var reflectMap = canvasTexture(THREE, 96, 192, false, 1, 1, function (ctx) {
      ctx.clearRect(0, 0, 96, 192)
      for (var row = 0; row < 192; row += 1) {
        var along = row / 191
        // 贴着桥脚最亮，往镜头这边一段段断掉，像水面的碎光。
        var fall = Math.max(0, 1 - along) * 0.7 + Math.sin(along * Math.PI) * 0.3
        for (var col = 0; col < 96; col += 1) {
          var across = (col / 95) * 2 - 1
          var alpha = fall * Math.max(0, 1 - across * across) * 0.9
          ctx.fillStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')'
          ctx.fillRect(col, row, 1, 1)
        }
      }
    })
    var reflectMaterial = new THREE.MeshBasicMaterial({ map: reflectMap, color: 0x9fb4c6, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending })
    var reflections = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), reflectMaterial, 3)
    // 两座塔各一条窄的，桥身一条宽的：都从桥脚往镜头这边铺，铺不到跟前就淡掉。
    position.set(-30, 0.07, -180)
    scale.set(20, 32, 1)
    matrix.compose(position, quaternion.setFromAxisAngle(axisX, -HALF_PI), scale)
    reflections.setMatrixAt(0, matrix)
    position.set(30, 0.07, -180)
    matrix.compose(position, quaternion.setFromAxisAngle(axisX, -HALF_PI), scale)
    reflections.setMatrixAt(1, matrix)
    position.set(0, 0.05, -172)
    scale.set(76, 48, 1)
    matrix.compose(position, quaternion.setFromAxisAngle(axisX, -HALF_PI), scale)
    reflections.setMatrixAt(2, matrix)
    quaternion.identity()
    scale.set(1, 1, 1)
    group.add(reflections)

    // 船只的纵向范围：镜头最远退到 z=−40，船都在这条线之外，不会穿到镜头身上。
    var FLEET_NEAR = -48
    var FLEET_FAR = -146
    // 几艘小船：一艘载着双层巴士的观光船在前，快艇与两条拖船错开在河心与两岸边。
    var boats = [
      { x: -22, z: -96, speed: 1.6, w: 3.4, len: 10, cabin: 2.2 },
      { x: 27, z: -112, speed: -2.2, w: 2.4, len: 6.4, cabin: 1.6 },
      { x: -9, z: -132, speed: 0.9, w: 1.9, len: 5.2, cabin: 1.2 },
      { x: 40, z: -78, speed: -1.3, w: 2.7, len: 7.2, cabin: 1.8 },
    ]
    var hullGeometry = new THREE.BoxGeometry(1, 0.9, 1)
    var cabinGeometry = new THREE.BoxGeometry(1, 1, 1)
    var hullMaterial = new THREE.MeshStandardMaterial({ color: 0x1d2430, roughness: 0.5, metalness: 0.5 })
    var cabinMaterial = new THREE.MeshStandardMaterial({ color: 0x2b333f, roughness: 0.55, metalness: 0.35 })
    var winMaterial = new THREE.MeshBasicMaterial({ color: 0xffd9a4 })
    var hulls = new THREE.InstancedMesh(hullGeometry, hullMaterial, boats.length)
    var cabins = new THREE.InstancedMesh(cabinGeometry, cabinMaterial, boats.length)
    var wins = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.34, 1), winMaterial, boats.length * 2)
    group.add(hulls)
    group.add(cabins)
    group.add(wins)

    // 观光船里那辆红色双层巴士：整条河上最抓眼的一块红，宽河面靠它做参照。
    var busBody = new THREE.Mesh(new THREE.BoxGeometry(2.5, 4.2, 8.6), new THREE.MeshStandardMaterial({ color: 0xb0141f, roughness: 0.4, metalness: 0.24 }))
    group.add(busBody)
    var busPanes = new THREE.Mesh(new THREE.BoxGeometry(2.54, 0.9, 7.4), new THREE.MeshBasicMaterial({ color: 0xffdca8 }))
    group.add(busPanes)

    // 两岸的堤岸与一线灯：塔桥被夹在中间，两侧不能空到只剩雾。
    var bankMaterial = new THREE.MeshStandardMaterial({ color: 0x141a22, roughness: 0.86, metalness: 0.12 })
    var bankBoxes = []
    var bankLightPositions = []
    for (var bank = 0; bank < 2; bank += 1) {
      var bankSign = bank === 0 ? -1 : 1
      bankBoxes.push({ w: 34, h: 6, d: 320, x: bankSign * 92, y: 1.2, z: -190 })
      for (var bankLight = 0; bankLight < 14; bankLight += 1) {
        bankLightPositions.push({ x: bankSign * (74 + random() * 6), y: 2.6 + random() * 4.2, z: -96 - bankLight * 16 - random() * 8 })
      }
    }
    group.add(new THREE.Mesh(kit.mergeBoxes(THREE, bankBoxes), bankMaterial))
    var bankLightMaterial = new THREE.SpriteMaterial({ map: api.dotTexture, color: 0xffd2a2, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending })
    for (var bankLamp = 0; bankLamp < bankLightPositions.length; bankLamp += 1) {
      var bankAnchor = bankLightPositions[bankLamp]
      var bankSprite = new THREE.Sprite(bankLightMaterial)
      bankSprite.position.set(bankAnchor.x, bankAnchor.y, bankAnchor.z)
      bankSprite.scale.setScalar(5.4)
      group.add(bankSprite)
    }

    // —— 远景：塔桥 ——
    // 两座哥特式石塔：方形塔身、四角小尖塔、中央八面尖顶；桥身分上下两层，斜拉索从塔顶扇下来。
    var towerZ = -196
    var towerX = 30
    var stoneMaterial = new THREE.MeshStandardMaterial({ color: 0x9a9e9c, roughness: 0.82, metalness: 0.08 })
    var stoneDark = new THREE.MeshStandardMaterial({ color: 0x6d7370, roughness: 0.88, metalness: 0.1 })
    var towerWindows = []
    var towerParts = []
    for (var side = 0; side < 2; side += 1) {
      var sideOfBridge = side === 0 ? -1 : 1
      var towerGroup = new THREE.Group()
      towerGroup.position.set(sideOfBridge * towerX, 0, towerZ)
      // 基座压到水面以下：塔脚浸在水里，否则会像浮在河上。
      towerGroup.add(new THREE.Mesh(kit.mergeBoxes(THREE, [
        { w: 13, h: 5, d: 13, x: 0, y: 1.2, z: 0 },
        { w: 11.4, h: 30, d: 11.4, x: 0, y: 18.4, z: 0 },
        // 檐口与腰线：哥特塔身靠这两道横线立起来。
        { w: 12.6, h: 0.9, d: 12.6, x: 0, y: 33.4, z: 0 },
        { w: 12.2, h: 0.7, d: 12.2, x: 0, y: 22, z: 0 },
      ]), stoneMaterial))
      // 尖顶压扁一档：八面锥在 45 度高一次，画面上部就只剩一块石头，河面与天空都要留。
      var roof = new THREE.Mesh(kit.frustum(THREE, { bottom: 11, top: 0.4, height: 7, sides: 8 }), stoneMaterial)
      roof.position.y = 37.6
      towerGroup.add(roof)
      var finial = new THREE.Mesh(kit.frustum(THREE, { bottom: 0.9, top: 0.06, height: 4, sides: 6 }), stoneDark)
      finial.position.y = 43
      towerGroup.add(finial)
      for (var corner = 0; corner < 4; corner += 1) {
        var cornerX = corner % 2 === 0 ? -4.7 : 4.7
        var cornerZ = corner < 2 ? -4.7 : 4.7
        var pinnacle = new THREE.Mesh(kit.frustum(THREE, { bottom: 2.6, top: 1.1, height: 5.4, sides: 8 }), stoneMaterial)
        pinnacle.position.set(cornerX, 35.9, cornerZ)
        towerGroup.add(pinnacle)
        var spire = new THREE.Mesh(kit.frustum(THREE, { bottom: 1.6, top: 0.05, height: 3.8, sides: 8 }), stoneDark)
        spire.position.set(cornerX, 40.5, cornerZ)
        towerGroup.add(spire)
      }
      group.add(towerGroup)
      // 塔身正面三排窄窗：上下两层各一扇、中间一扇，靠窗框与石缝分开，不做成一串等距的竖条。
      for (var column = 0; column < 2; column += 1) {
        for (var level = 0; level < 3; level += 1) {
          towerWindows.push({
            x: sideOfBridge * towerX + (column === 0 ? -2.6 : 2.6),
            y: 12 + level * 7,
            z: towerZ + 5.7,
            lit: (column + level + side) % 3 === 0,
          })
        }
      }
    }

    // 桥身两层：上层走人，下层走车，两层之间用竖柱连起来。
    towerParts.push({ w: towerX * 2 - 8, h: 1.1, d: 12, x: 0, y: ROAD_LEVEL, z: towerZ })
    towerParts.push({ w: towerX * 2 - 8, h: 1.6, d: 10.4, x: 0, y: ROAD_LEVEL - 4.4, z: towerZ })
    group.add(new THREE.Mesh(kit.mergeBoxes(THREE, towerParts), stoneMaterial))
    // 桥面两排路灯：暖色小方块，倒影混在水面的光路里。
    var spanLights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), 14)
    for (var spanLight = 0; spanLight < 14; spanLight += 1) {
      place(spanLights, spanLight, -towerX + 6 + (spanLight / 13) * (towerX * 2 - 12), ROAD_LEVEL + 1.2, towerZ + (spanLight % 2 === 0 ? 6.4 : -6.4))
    }
    group.add(spanLights)
    var towerWindowMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 2.2, 0.24), new THREE.MeshBasicMaterial({ color: 0xffffff }), towerWindows.length)
    for (var towerWindow = 0; towerWindow < towerWindows.length; towerWindow += 1) {
      var towerSlot = towerWindows[towerWindow]
      place(towerWindowMesh, towerWindow, towerSlot.x, towerSlot.y, towerSlot.z)
      // 多数是墨色的窗洞，只有零星几扇亮着：塔身是一块石头，不是一排灯。
      tint.setHex(towerSlot.lit ? 0x8e9390 : 0x1b2530)
      towerWindowMesh.setColorAt(towerWindow, tint)
    }
    group.add(towerWindowMesh)

    var bridgeParts = new THREE.Group()
    for (var tie = 0; tie < 5; tie += 1) {
      var tieX = -towerX + 9 + (tie / 4) * (towerX * 2 - 18)
      bridgeParts.add(strut([tieX, ROAD_LEVEL - 4.4, towerZ], [tieX, ROAD_LEVEL - 0.6, towerZ], 0.16, 4))
    }
    bridgeParts.traverse(function (object) { if (object.isMesh) object.material = stoneDark })
    group.add(bridgeParts)

    // 斜拉索与主悬索：半透明的细钢线，只画结构线，不铺成一张网。
    var cableMaterial = new THREE.MeshBasicMaterial({ color: 0xb7c6d6, transparent: true, opacity: 0.2, depthWrite: false })
    var cables = new THREE.Group()
    for (var cableTower = 0; cableTower < 2; cableTower += 1) {
      var cableSign = cableTower === 0 ? -1 : 1
      // 每塔四根：两根朝塔外、两根朝塔内，落在桥面上的距离错开。
      for (var cable = 0; cable < 4; cable += 1) {
        var inward = cable % 2 === 0 ? -cableSign : cableSign
        var anchorX = cableSign * towerX + inward * (5 + cable * 4)
        var liftY = 40 - cable * 1.4
        cables.add(strut([anchorX, ROAD_LEVEL, towerZ + 6], [cableSign * towerX, liftY, towerZ + 4], 0.06, 4, cableMaterial))
      }
    }
    // 塔间一条主弧：从两座塔顶垂到桥身中段，只此一根。
    var arcSegments = 12
    for (var arc = 0; arc < arcSegments; arc += 1) {
      var arcA = -towerX + (arc / arcSegments) * towerX * 2
      var arcB = -towerX + ((arc + 1) / arcSegments) * towerX * 2
      var dipA = 43 - 12 * (1 - Math.pow(arcA / towerX, 2))
      var dipB = 43 - 12 * (1 - Math.pow(arcB / towerX, 2))
      cables.add(strut([arcA, dipA, towerZ + 4], [arcB, dipB, towerZ + 4], 0.05, 4, cableMaterial))
    }
    group.add(cables)

    // —— 远景：金融城压进雾里 ——
    // 小黄瓜：一段段收锥叠出橄榄形；螺旋光带是一圈小方块，整圈慢慢转。
    var gherkinGroup = new THREE.Group()
    gherkinGroup.position.set(-50, 0, -290)
    var gherkinProfile = [
      { y: 0, w: 13 }, { y: 6, w: 15 }, { y: 15, w: 16 }, { y: 25, w: 14 },
      { y: 33, w: 11 }, { y: 39, w: 7.4 }, { y: 44, w: 4 }, { y: 47, w: 1.6 },
    ]
    var gherkinMaterial = new THREE.MeshStandardMaterial({ color: 0x14392f, roughness: 0.16, metalness: 0.9, emissive: 0x0e4034, emissiveIntensity: 0.2 })
    gherkinGroup.add(taperTower(THREE, kit, gherkinProfile, 16, gherkinMaterial))
    var helixMaterial = new THREE.MeshBasicMaterial({ color: 0x9bf0d2, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending })
    var helixBeads = 48
    var helix = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.4, 0.55), helixMaterial, helixBeads)
    for (var bead = 0; bead < helixBeads; bead += 1) {
      var beadY = 1.5 + (bead / helixBeads) * 44
      var beadAngle = (bead / helixBeads) * TAU * 2.5
      // 收腰的塔身：光带贴着表面走，不能穿进去也不能飘开。
      var beadRadius = 7.6 * Math.sin((beadY / 47) * Math.PI * 0.92) + 1
      place(helix, bead, Math.cos(beadAngle) * beadRadius, beadY, Math.sin(beadAngle) * beadRadius)
    }
    gherkinGroup.add(helix)
    group.add(gherkinGroup)

    // 碎片大厦：四棱收锥转到 45 度，正对镜头的是一条棱；顶上三根尖错开高度。
    var shardGroup = new THREE.Group()
    shardGroup.position.set(50, 0, -310)
    shardGroup.rotation.y = Math.PI / 4
    // 收窄三成：碎片大厦太高，原样立在塔桥右边会把画面撑满上半部。
    var shardProfile = [{ y: 0, w: 21 }, { y: 18, w: 15 }, { y: 38, w: 10 }, { y: 56, w: 5.4 }, { y: 68, w: 2 }]
    var shardMaterial = new THREE.MeshStandardMaterial({ color: 0x5c7488, roughness: 0.22, metalness: 0.88, emissive: 0x1b3a52, emissiveIntensity: 0.25, flatShading: true })
    shardGroup.add(taperTower(THREE, kit, shardProfile, 4, shardMaterial))
    for (var spine = 0; spine < 3; spine += 1) {
      var spikeHeight = 9 + spine * 2.4
      var spike = new THREE.Mesh(kit.frustum(THREE, { bottom: 1.5, top: 0.08, height: spikeHeight, sides: 3 }), shardMaterial)
      spike.position.set((spine - 1) * 0.7, 68 + spikeHeight / 2 - 0.5, spine === 1 ? 0.6 : 0)
      spike.rotation.z = (spine - 1) * 0.06
      shardGroup.add(spike)
    }
    group.add(shardGroup)

    // 对岸一片塔群：宽窄高低不一，雾里只剩几块剪影与零星窗光。
    var skylineBoxes = []
    var skylineWindows = []
    var skylineCursor = -170
    while (skylineCursor < 170) {
      var skylineW = 12 + random() * 22
      var skylineH = 26 + random() * 62
      var skylineZ = -330 - random() * 90
      skylineBoxes.push({ w: skylineW, h: skylineH, d: 16 + random() * 14, x: skylineCursor, y: skylineH / 2, z: skylineZ })
      var rows = 2 + Math.floor(skylineH / 16)
      for (var row = 0; row < rows; row += 1) {
        for (var skylineColumn = 0; skylineColumn < 3; skylineColumn += 1) {
          skylineWindows.push({
            x: skylineCursor - skylineW * 0.3 + skylineColumn * skylineW * 0.3,
            y: 8 + row * 14,
            z: skylineZ + 8.4,
            lit: random() < 0.5,
          })
        }
      }
      skylineCursor += skylineW + 4 + random() * 10
    }
    group.add(new THREE.Mesh(kit.mergeBoxes(THREE, skylineBoxes), new THREE.MeshStandardMaterial({ color: 0x1b2531, roughness: 0.6, metalness: 0.4 })))
    var skylineWindowMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
    var skylineWindowMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 2.4, 0.3), skylineWindowMaterial, skylineWindows.length)
    for (var skylineWindow = 0; skylineWindow < skylineWindows.length; skylineWindow += 1) {
      var windowSlot = skylineWindows[skylineWindow]
      place(skylineWindowMesh, skylineWindow, windowSlot.x, windowSlot.y, windowSlot.z)
      tint.setHex(windowSlot.lit ? 0xffcf92 : 0x18202b)
      skylineWindowMesh.setColorAt(skylineWindow, tint)
    }
    group.add(skylineWindowMesh)

    // 左岸一簇低矮的收锥塔：小黄瓜的橄榄形转到这边还要往上收，左半幅近塔之外才有东西。
    var clusterProfile = [{ y: 0, w: 9 }, { y: 7, w: 10.4 }, { y: 16, w: 8.2 }, { y: 24, w: 5 }, { y: 29, w: 1.6 }]
    var cluster = taperTower(THREE, kit, clusterProfile, 10, shardMaterial)
    cluster.position.set(-15, 0, -250)
    group.add(cluster)

    // 伦敦眼：从右肩探出来的一圈细环，舱位沿环排开；轮子绕 z 慢慢转。
    var eyeGroup = new THREE.Group()
    eyeGroup.position.set(118, 22, -336)
    eyeGroup.rotation.y = -0.4
    var wheel = new THREE.Group()
    eyeGroup.add(wheel)
    var rimMaterial = new THREE.MeshStandardMaterial({ color: 0x9db0c0, roughness: 0.5, metalness: 0.45, emissive: 0x7d97ae, emissiveIntensity: 0.12 })
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(8.6, 0.18, 6, 40), rimMaterial))
    var spokeMaterial = new THREE.MeshStandardMaterial({ color: 0x8c9dab, roughness: 0.55, metalness: 0.5 })
    var spokeCount = 12
    var spokes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 8.6, 4), spokeMaterial, spokeCount)
    for (var spoke = 0; spoke < spokeCount; spoke += 1) {
      var spokeAngle = (spoke / spokeCount) * TAU
      // 圆柱默认沿 y，绕 z 转 (角度 − 90°) 才指向这一根辐条的方向。
      quaternion.setFromAxisAngle(axisZ, spokeAngle - HALF_PI)
      place(spokes, spoke, Math.cos(spokeAngle) * 4.3, Math.sin(spokeAngle) * 4.3, 0)
    }
    quaternion.identity()
    wheel.add(spokes)
    var capsuleCount = 14
    var capsuleMaterial = new THREE.MeshStandardMaterial({ color: 0xaebecd, roughness: 0.45, metalness: 0.3, emissive: 0x8fa6bc, emissiveIntensity: 0.2 })
    var capsules = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.7, 0.7), capsuleMaterial, capsuleCount)
    for (var capsule = 0; capsule < capsuleCount; capsule += 1) {
      var capsuleAngle = (capsule / capsuleCount) * TAU
      place(capsules, capsule, Math.cos(capsuleAngle) * 8.8, Math.sin(capsuleAngle) * 8.8, 0)
    }
    wheel.add(capsules)
    group.add(eyeGroup)

    return {
      id: 'london',
      group: group,
      // 视场角收窄到 46：塔桥在两百米外，宽角会把两座塔推到画面两侧。`rig` 接管机位与看向点，
      // 这组提示只提供视场角；高度与看向点跟 `rig(0, …)` 写成同一个数，切到别的场景时镜头不会跳。
      camera: { height: 4.55, distance: 60, targetY: ROAD_LEVEL - 4, fov: 46 },
      rig: createRig(THREE, bow),
      // 雾比街景厚一层：远处塔群只剩剪影，近处河面才跳出来。泛光收一档，灯团不会糊成一片。
      look: { ambient: 0.5, exposure: 0.95, fog: 0.74, bloom: 0.34 },
      setWeather: function (next) {
        weather = next.weather
        night = next.night
      },
      resize: function () {},
      update: function (dt, clock, palette) {
        var wet = weather === 'rain' || weather === 'storm' ? 1 : weather === 'snow' ? 0.4 : 0.15
        // 河面雨天是一整片镜：粗糙度压到最低、金属度提上来，塔桥与灯才有东西可映。
        waterMaterial.roughness = lerp(0.26, 0.06, wet)
        waterMaterial.metalness = lerp(0.78, 0.96, wet)
        // 贴图顺着河往下走，水就有了流向；滚动两层的速度不同，看上去不是一块板在滑。
        waterMap.offset.y = (clock * 0.006) % 1
        waterRough.offset.y = (clock * 0.012) % 1
        foamUniforms.uTime.value = clock
        foamUniforms.uOpacity.value = (night ? 0.2 : 0.28) + wet * 0.12
        // 倒影带随雨进雨退：雨天水面更亮，桥身的影子拖得更长。
        reflectMaterial.opacity = (night ? 0.26 : 0.14) + wet * 0.06 + Math.sin(clock * 0.7) * 0.012

        lampGlow.material.opacity = (night ? 0.95 : 0.5) + wet * 0.1
        lamp.intensity = (night ? 40 : 18) * (1 + wet * 0.3)
        mastGlow.material.opacity = night ? 0.5 : 0.22
        sheenMaterial.opacity = (night ? 0.52 : 0.2) + wet * 0.14
        bankLightMaterial.opacity = night ? 0.72 : 0.22

        // 窗与灯在夜里才亮；白天只剩石色的光。
        towerWindowMesh.material.color.setScalar(night ? 1 : 0.32)
        spanLights.material.color.setScalar(night ? 1 : 0.4)
        skylineWindowMaterial.color.setScalar(night ? 1 : 0.3)
        busPanes.material.color.setScalar(night ? 1 : 0.45)
        winMaterial.color.setScalar(night ? 1 : 0.42)
        gherkinMaterial.emissiveIntensity = 0.12 + palette.windows * 0.5
        shardMaterial.emissiveIntensity = 0.14 + palette.windows * 0.6
        rimMaterial.emissiveIntensity = 0.05 + palette.windows * 0.18
        capsuleMaterial.emissiveIntensity = 0.1 + palette.windows * 0.32
        helixMaterial.opacity = 0.28 + palette.windows * 0.4

        // 船在走：观光船与快艇沿河来回；观光船上那辆巴士跟着船一起挪。
        for (var b = 0; b < boats.length; b += 1) {
          var moving = boats[b]
          moving.z += moving.speed * dt
          if (moving.z > FLEET_NEAR) moving.z = FLEET_FAR
          else if (moving.z < FLEET_FAR) moving.z = FLEET_NEAR
          position.set(moving.x, 0.35, moving.z)
          scale.set(moving.w, 1, moving.len)
          matrix.compose(position, quaternion, scale)
          hulls.setMatrixAt(b, matrix)
          position.set(moving.x, 0.35 + 0.45 + moving.cabin * 0.5, moving.z)
          scale.set(moving.w * 0.7, moving.cabin, moving.len * 0.55)
          matrix.compose(position, quaternion, scale)
          cabins.setMatrixAt(b, matrix)
          position.set(moving.x, 0.35 + 0.45 + moving.cabin * 0.62, moving.z)
          scale.set(moving.w * 0.72, 1, moving.len * 0.5)
          matrix.compose(position, quaternion, scale)
          wins.setMatrixAt(b * 2, matrix)
          position.set(moving.x, 0.6, moving.z)
          scale.set(moving.w * 1.02, 1, moving.len * 0.9)
          matrix.compose(position, quaternion, scale)
          wins.setMatrixAt(b * 2 + 1, matrix)
        }
        hulls.instanceMatrix.needsUpdate = true
        cabins.instanceMatrix.needsUpdate = true
        wins.instanceMatrix.needsUpdate = true
        busBody.position.set(boats[0].x, 3.6, boats[0].z)
        busPanes.position.set(boats[0].x, 4.2, boats[0].z)

        // 船首跟着镜头一起横摇、纵摇：两条栏杆在画面下缘轻轻起伏，镜头看着才像钉在船上。
        wheel.rotation.z += dt * 0.06
        helix.rotation.y += dt * 0.07
      },
      dispose: function () {
        group.traverse(function (object) {
          if (object.geometry) object.geometry.dispose()
          if (!object.material) return
          var materials = Array.isArray(object.material) ? object.material : [object.material]
          for (var m = 0; m < materials.length; m += 1) {
            var material = materials[m]
            // `api.dotTexture` 由 world.js 持有并共用，这里一并放开会把别人的贴图删掉。
            if (material.map && material.map !== api.dotTexture) material.map.dispose()
            if (material.roughnessMap && material.roughnessMap !== material.map) material.roughnessMap.dispose()
            material.dispose()
          }
        })
      },
    }
  }

  root.WxScenes = root.WxScenes || {}
  root.WxScenes.london = create
})(window)
