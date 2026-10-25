/*
 * 场景「纽约曼哈顿」：站在街心仰视，两侧高楼把天收成一线的窄口。
 *
 * 近景是湿沥青上的车灯拉痕、外挂消防梯、斜切过画面左下的路灯杆，一辆黄色出租贴着镜头驶过；
 * 中景是两侧楼体在画面上方收成的窄口，中上部由几块广告屏占住；窄口里是帝国大厦的上段与一块天空。
 * 镜头走 `rig`：低机位 40 秒一循环地向上仰再落回，横移与沿街向前溜各取一条更慢的正弦。
 * 公共零件取自 `WxCityKit`，这里只写这座城的轮廓与地标（D7 的一份脚本）。
 */
;(function (root) {
  'use strict'

  function create(THREE, api) {
    var kit = root.WxCityKit
    var group = new THREE.Group()
    var weather = 'cloudy'
    var night = false

    // 帧循环里复用同一份矩阵：每帧新建会让车流上出现周期性的顿挫。
    var matrix = new THREE.Matrix4()
    var random = kit.seeded(1987)

    var stone = new THREE.MeshStandardMaterial({ color: 0x474238, roughness: 0.76, metalness: 0.3 })
    var metal = new THREE.MeshStandardMaterial({ color: 0x0b0f15, roughness: 0.5, metalness: 0.72 })
    var glass = new THREE.MeshStandardMaterial({
      color: 0x0d1722, roughness: 0.14, metalness: 0.9, emissive: new THREE.Color(0x1a3350), emissiveIntensity: 0.2,
    })

    /** 湿沥青：噪点底、两道车道虚线；粗糙度贴图把积水压暗，积水处于是更亮地反光。 */
    function asphalt() {
      var size = 512
      var canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      var ctx = canvas.getContext('2d')
      var rnd = kit.seeded(210)
      ctx.fillStyle = '#0d1117'
      ctx.fillRect(0, 0, size, size)
      for (var i = 0; i < 1800; i += 1) {
        var shade = 14 + Math.round(rnd() * 20)
        ctx.fillStyle = 'rgb(' + shade + ',' + (shade + 3) + ',' + (shade + 9) + ')'
        ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1 + rnd() * 2)
      }
      ctx.fillStyle = 'rgba(226,214,150,0.45)'
      for (var dash = 0; dash < 14; dash += 1) {
        ctx.fillRect(size * 0.33, dash * 36, 4, 18)
        ctx.fillRect(size * 0.67, dash * 36, 4, 18)
      }
      var rough = document.createElement('canvas')
      rough.width = rough.height = size
      var rctx = rough.getContext('2d')
      rctx.fillStyle = '#8f8f8f'
      rctx.fillRect(0, 0, size, size)
      for (var p = 0; p < 16; p += 1) {
        var px = rnd() * size
        var py = rnd() * size
        var pr = 20 + rnd() * 46
        var gradient = rctx.createRadialGradient(px, py, 0, px, py, pr)
        gradient.addColorStop(0, 'rgba(22,22,22,0.95)'); gradient.addColorStop(1, 'rgba(140,140,140,0)')
        rctx.fillStyle = gradient
        rctx.beginPath()
        rctx.arc(px, py, pr, 0, Math.PI * 2)
        rctx.fill()
      }
      var map = new THREE.CanvasTexture(canvas)
      map.colorSpace = THREE.SRGBColorSpace
      map.wrapS = THREE.RepeatWrapping
      map.wrapT = THREE.RepeatWrapping
      map.repeat.set(1, 8)
      var roughness = new THREE.CanvasTexture(rough)
      roughness.wrapS = THREE.RepeatWrapping
      roughness.wrapT = THREE.RepeatWrapping
      roughness.repeat.set(1, 8)
      return { map: map, roughness: roughness }
    }

    /** 一团柔光：径向渐变的贴图，灯头、车灯与地面光斑共用一张。 */
    var glowTexture = (function () {
      var size = 128
      var canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      var ctx = canvas.getContext('2d')
      var gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
      gradient.addColorStop(0, 'rgba(255,255,255,1)')
      gradient.addColorStop(0.3, 'rgba(255,236,205,0.5)')
      gradient.addColorStop(1, 'rgba(255,214,164,0)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, size, size)
      var texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      return texture
    })()

    var wet = asphalt()
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      new THREE.MeshStandardMaterial({ color: 0x080b10, roughness: 0.3, metalness: 0.6 })
    )
    ground.rotation.x = -Math.PI / 2
    group.add(ground)

    // 街面 32 宽：把相机与两侧楼脚都包住，远景交给雾。
    var street = new THREE.Mesh(
      new THREE.PlaneGeometry(32, 260),
      new THREE.MeshStandardMaterial({ map: wet.map, roughnessMap: wet.roughness, roughness: 0.55, metalness: 0.62 })
    )
    street.rotation.x = -Math.PI / 2
    street.position.set(0, 0.02, -30)
    group.add(street)

    // 峡谷：两侧各五栋临街高楼，内壁齐在离街心 13 的一线上，楼顶在 112 以上。
    // 低机位仰到 46° 时两面墙在画面上缘之外收口，窄口里只剩中上部的屏与远景；
    // 内壁整面是一块媒体立面，`uTime`/`uNight` 由 `world.js` 统一推进，场景里不重复写。
    var facades = [
      kit.mediaMaterial(THREE, { kind: 'grid', colorA: '#2f6fd0', colorB: '#9ad4ff' }),
      kit.mediaMaterial(THREE, { kind: 'wave', colorA: '#5b4bff', colorB: '#39d0ff' }),
      kit.mediaMaterial(THREE, { kind: 'grid', colorA: '#ffb457', colorB: '#ff6a8a' }),
    ]
    var walls = [
      { side: -1, face: -13, z: 4, w: 17, h: 120, d: 26, cap: 12, panel: 0 },
      { side: -1, face: -12.6, z: -24, w: 16, h: 142, d: 24, cap: 16, panel: 1 },
      { side: -1, face: -13.2, z: -56, w: 17, h: 112, d: 28, panel: 2 },
      { side: -1, face: -12.4, z: -96, w: 20, h: 150, d: 34, cap: 18, panel: 0 },
      { side: -1, face: -13, z: -136, w: 22, h: 128, d: 30, panel: 1 },
      { side: 1, face: 12.8, z: 6, w: 17, h: 126, d: 28, cap: 14, panel: 2 },
      { side: 1, face: 13.2, z: -22, w: 16, h: 116, d: 24, panel: 0 },
      { side: 1, face: 12.6, z: -50, w: 18, h: 146, d: 26, cap: 16, panel: 1 },
      { side: 1, face: 13.4, z: -86, w: 19, h: 124, d: 30, panel: 2 },
      { side: 1, face: 13, z: -122, w: 20, h: 138, d: 28, cap: 12, panel: 0 },
    ]
    walls.forEach(function (wall) {
      var body = new THREE.Mesh(new THREE.BoxGeometry(wall.w, wall.h, wall.d), stone)
      body.position.set(wall.face + wall.side * wall.w / 2, wall.h / 2, wall.z)
      group.add(body)
      if (wall.cap) {
        var crown = new THREE.Mesh(new THREE.BoxGeometry(wall.w * 0.56, wall.cap, wall.d * 0.56), stone)
        crown.position.set(wall.face + wall.side * wall.w / 2, wall.h + wall.cap / 2, wall.z)
        group.add(crown)
      }
      var panel = new THREE.Mesh(new THREE.PlaneGeometry(wall.d * 0.94, wall.h * 0.9), facades[wall.panel])
      panel.position.set(wall.face - wall.side * 0.06, wall.h * 0.47, wall.z)
      panel.rotation.y = wall.side < 0 ? Math.PI / 2 : -Math.PI / 2
      group.add(panel)
    })

    // 楼脚的店招：一进巷子最先撞到的一层暖光，夜里更亮。
    var fronts = []
    var frontSpecs = [
      { side: -1, z: -7, w: 3.6 }, { side: 1, z: -13, w: 4.2 },
      { side: -1, z: -26, w: 3.2 }, { side: 1, z: -34, w: 3.8 },
    ]
    frontSpecs.forEach(function (spec, index) {
      var frontMaterial = new THREE.MeshBasicMaterial({
        color: index % 2 === 0 ? 0xffb875 : 0x8fd4ff, transparent: true, opacity: 0.4,
        toneMapped: false, depthWrite: false,
      })
      var front = new THREE.Mesh(new THREE.PlaneGeometry(spec.w, 2.4), frontMaterial)
      front.position.set(spec.side < 0 ? -12.9 : 12.9, 2.6, spec.z)
      front.rotation.y = spec.side < 0 ? Math.PI / 2 : -Math.PI / 2
      group.add(front)
      fronts.push({ mesh: front, phase: index * 1.7 })
    })

    // 中上部的三块屏：左边动画、右边科技、最靠街心那块行情屏，占住窄口的下半截。
    var animeBoard = kit.billboard(THREE, { width: 13, height: 7, theme: 'anime' })
    animeBoard.mesh.position.set(-12.7, 27, -40)
    animeBoard.mesh.rotation.y = Math.PI / 2
    group.add(animeBoard.mesh)

    var techBoard = kit.billboard(THREE, { width: 14, height: 8, theme: 'tech' })
    techBoard.mesh.position.set(12.7, 28, -36)
    techBoard.mesh.rotation.y = -Math.PI / 2
    group.add(techBoard.mesh)

    var newsBoard = kit.billboard(THREE, { width: 9, height: 5, theme: 'news' })
    newsBoard.mesh.position.set(-14.6, 60, -92)
    newsBoard.mesh.rotation.y = Math.PI / 2
    group.add(newsBoard.mesh)

    // 竖排霓虹：贴图横着写，绕 z 转 90° 之后字从下往上读，正是这种街区挂招牌的方式。
    var signs = []
    function addSign(text, tint, length, x, y, z) {
      var material = new THREE.MeshBasicMaterial({
        map: kit.neonTexture(THREE, text, tint),
        transparent: true,
        toneMapped: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      var sign = new THREE.Mesh(new THREE.PlaneGeometry(length, length * 0.32), material)
      sign.rotation.z = Math.PI / 2
      sign.position.set(x, y, z)
      group.add(sign)
      signs.push(material)
    }
    addSign('BROADWAY', '#ff4fa8', 8, -12.5, 12, -18)
    addSign('NYC', '#49c8ff', 5, 12.5, 9, -24)
    addSign('24H', '#ffe066', 4, 12.5, 15, -56)

    // 街尾的楼：一栋横楼封住街，屋顶落在画面三成高处；左右各一栋更高更近的板楼把天挤成中间一道竖口，
    // 窄口里只留帝国大厦的上段与一块天。它们都在楼墙之外，画面上只从两侧探进来。
    var endBlock = new THREE.Mesh(new THREE.BoxGeometry(30, 87, 26), stone)
    endBlock.position.set(-14, 43.5, -158)
    group.add(endBlock)
    var endGlass = new THREE.Mesh(new THREE.PlaneGeometry(26, 76), facades[1])
    endGlass.position.set(-14, 41, -144.9)
    group.add(endGlass)

    var slabs = [
      { x: -18.5, z: -172, h: 168 },
      { x: 21, z: -172, h: 176 },
    ]
    slabs.forEach(function (slab) {
      var body = new THREE.Mesh(new THREE.BoxGeometry(13, slab.h, 22), glass)
      body.position.set(slab.x, slab.h / 2, slab.z)
      group.add(body)
    })

    // 帝国大厦：四段收分塔身、桅杆与针尖。塔脚被横楼挡掉，画面上只有上段与针尖。
    // 塔身向右让开街心的视线，针尖与它周围那块天落在窄口正中。
    var empire = new THREE.Group()
    empire.position.set(4, 0, -186)
    var tiers = [
      { bottom: 34, top: 26, height: 40, sides: 8 },
      { bottom: 22, top: 17, height: 28, sides: 8 },
      { bottom: 14, top: 10, height: 24, sides: 8 },
      { bottom: 9, top: 6, height: 22, sides: 8 },
    ]
    var tierY = 0
    tiers.forEach(function (part) {
      var mesh = new THREE.Mesh(kit.frustum(THREE, part), stone)
      mesh.position.y = tierY + part.height / 2
      tierY += part.height
      empire.add(mesh)
    })
    var mast = new THREE.Mesh(kit.frustum(THREE, { bottom: 4.6, top: 1.8, height: 18, sides: 6 }), metal)
    mast.position.y = tierY + 9
    empire.add(mast)
    var needle = new THREE.Mesh(new THREE.ConeGeometry(0.55, 14, 6), metal)
    needle.position.y = tierY + 25
    empire.add(needle)
    group.add(empire)

    // 消防梯：外挂的几段斜梯与平台，合并成一块几何只画一次。
    // 左面楼离镜头只有四米，三段消防梯只能挤在画面左缘一条缝里；主力放在右面楼，中景那段离镜头十三米。
    var escapeBoxes = []
    function addEscape(faceX, faceZ, toward, flights) {
      for (var flight = 0; flight < flights; flight += 1) {
        var baseY = 7 + flight * 5.4
        escapeBoxes.push({ w: 1.6, h: 0.1, d: 2.4, x: faceX + toward * 0.8, y: baseY, z: faceZ })
        for (var step = 0; step < 8; step += 1) {
          escapeBoxes.push({
            w: 1.1, h: 0.09, d: 0.42,
            x: faceX + toward * 0.75,
            y: baseY + 0.4 + step * 0.44,
            z: faceZ + 1.3 + step * 0.5,
          })
        }
        escapeBoxes.push({ w: 0.07, h: 4.4, d: 0.07, x: faceX + toward * 1.45, y: baseY + 2.2, z: faceZ - 1.1 })
        escapeBoxes.push({ w: 0.07, h: 4.4, d: 0.07, x: faceX + toward * 1.45, y: baseY + 2.2, z: faceZ + 2.6 })
      }
    }
    addEscape(-13, -5, 1, 2)
    addEscape(13, -16, -1, 4)
    group.add(new THREE.Mesh(kit.mergeBoxes(THREE, escapeBoxes), metal))

    // 路灯杆：立在左侧楼脚、离镜头五米半，杆身从画面左下角斜出画外，灯头与光晕压着左上那一带。
    // 低机位它先出现在画面下缘左角，抬头时一路扫过左下角再往上出画，近景那一刻的纵深全靠它。
    var lampFittings = [
      { w: 0.34, h: 8.6, d: 0.34, x: -7.2, y: 4.3, z: -2.4 },
      { w: 0.16, h: 0.16, d: 2.4, x: -7.2, y: 8.42, z: -3.6 },
      { w: 0.84, h: 0.24, d: 0.96, x: -7.2, y: 8.3, z: -4.6 },
    ]
    group.add(new THREE.Mesh(kit.mergeBoxes(THREE, lampFittings), metal))
    var lampHalo = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 4.4),
      new THREE.MeshBasicMaterial({
        map: glowTexture, color: 0xffd9a8, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    )
    lampHalo.position.set(-7.2, 8.2, -4.6)
    lampHalo.lookAt(-5.4, 1.5, 0)
    group.add(lampHalo)

    // 车灯在湿沥青上的拉痕：一条条窄长的加色片，一路拉向街尾，湿街最认得出的那一层近景。
    var streakTints = [0xffd9a8, 0xff4a3d, 0xfff0c4, 0xffb861]
    var streaks = []
    for (var k = 0; k < 16; k += 1) {
      var streakMaterial = new THREE.MeshBasicMaterial({
        color: streakTints[k % 4], transparent: true, opacity: 0.12,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
      var streak = new THREE.Mesh(new THREE.PlaneGeometry(0.6 + random() * 1.1, 8 + random() * 22), streakMaterial)
      streak.rotation.x = -Math.PI / 2
      streak.position.set(-10 + random() * 20, 0.04 + k * 0.002, 0 - random() * 56)
      group.add(streak)
      streaks.push({ mesh: streak, base: 0.1 + random() * 0.2, phase: random() * 6.3 })
    }

    // 屏落在街面的两片反光：蓝紫与粉，湿沥青才像湿的。
    var glows = []
    var glowSpecs = [
      { color: 0x3d5cff, w: 20, d: 34, x: -4, z: -26, alpha: 0.3 },
      { color: 0xff3d9a, w: 18, d: 30, x: 5, z: -48, alpha: 0.24 },
    ]
    glowSpecs.forEach(function (spec) {
      var material = new THREE.MeshBasicMaterial({
        color: spec.color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      })
      var glow = new THREE.Mesh(new THREE.PlaneGeometry(spec.w, spec.d), material)
      glow.rotation.x = -Math.PI / 2
      glow.position.set(spec.x, 0.05, spec.z)
      group.add(glow)
      glows.push({ mesh: glow, alpha: spec.alpha })
    })

    // 贴着镜头驶过的出租：车身占住画面下缘一条，车头灯与地面光斑跟着它一起过。
    var taxiPaint = new THREE.MeshStandardMaterial({ color: 0xf7c531, roughness: 0.4, metalness: 0.45 })
    var taxiGlass = new THREE.MeshStandardMaterial({ color: 0x121a24, roughness: 0.16, metalness: 0.86 })
    var tyre = new THREE.MeshStandardMaterial({ color: 0x11151a, roughness: 0.9, metalness: 0.1 })
    var taxi = new THREE.Group()
    var taxiBody = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 4.6), taxiPaint)
    taxiBody.position.y = 0.84
    taxi.add(taxiBody)
    var taxiCabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.62, 2.2), taxiGlass)
    taxiCabin.position.set(0, 1.48, 0.05)
    taxi.add(taxiCabin)
    var taxiSign = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, 0.24, 0.32),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8, toneMapped: false })
    )
    taxiSign.position.set(0, 1.9, 0.05)
    taxi.add(taxiSign)
    var wheelGeometry = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 12)
    var wheelCorners = [[-0.92, 1.5], [0.92, 1.5], [-0.92, -1.5], [0.92, -1.5]]
    wheelCorners.forEach(function (corner) {
      var wheel = new THREE.Mesh(wheelGeometry, tyre)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(corner[0], 0.36, corner[1])
      taxi.add(wheel)
    })
    // 车朝镜头开：两片车头灯在 +z 面上，地面光斑铺在车头之前。
    var headlightMaterial = new THREE.MeshBasicMaterial({
      map: glowTexture, color: 0xfff2cf, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
    var headlights = [[-0.62, 0.82], [0.62, 0.82]]
    headlights.forEach(function (spot) {
      var light = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6), headlightMaterial)
      light.position.set(spot[0], spot[1], 2.32)
      taxi.add(light)
    })
    var headPool = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 6.4),
      new THREE.MeshBasicMaterial({
        map: glowTexture, color: 0xffdfae, transparent: true, opacity: 0.34,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    )
    headPool.rotation.x = -Math.PI / 2
    headPool.position.set(0, 0.06, 5.6)
    taxi.add(headPool)
    var headLight = new THREE.PointLight(0xffe2b0, 7, 22, 2)
    headLight.position.set(0, 0.7, 3)
    taxi.add(headLight)
    // 车身占画面下缘一条：沿近侧车道驶向镜头，镜头比车身低时，车身从右侧下缘升起、
    // 压住右下角那一条；镜头抬到两米以上时它从下缘滑出画，车头灯的光在沥青上留一道。
    taxi.position.set(9.6, 0, 0)
    group.add(taxi)
    var taxiZ = 0
    var taxiSpeed = 1.8

    // 街上的车流：也都在出租身后，给中景添几道过街的灯。近侧车道让给出租。
    var carCount = 10
    var cars = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.9, 0.95, 4.1),
      new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.45 }),
      carCount
    )
    cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    var carState = []
    var carRandom = kit.seeded(404)
    var carColor = new THREE.Color()
    var lanes = [-9.4, -6.6, 6.4, 9.6]
    for (var t = 0; t < carCount; t += 1) {
      carState.push({
        x: lanes[t % 4],
        z: -26 - carRandom() * 96,
        speed: (carRandom() > 0.5 ? 1 : -1) * (9 + carRandom() * 12),
      })
      carColor.setHex(carRandom() > 0.3 ? 0xf6c42b : carRandom() > 0.5 ? 0x1b2028 : 0xdfe6ee)
      cars.setColorAt(t, carColor)
    }
    group.add(cars)

    // 井盖蒸汽：两团缓缓上浮并散开的半透明球，湿街的招牌之一。
    var steamGeometry = new THREE.SphereGeometry(1.1, 14, 10)
    var steam = []
    for (var v = 0; v < 2; v += 1) {
      var puffMaterial = new THREE.MeshBasicMaterial({
        color: 0xcfd9e6,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      var puff = new THREE.Mesh(steamGeometry, puffMaterial)
      puff.position.set(v === 0 ? -5.6 : 4.4, 0.6, v === 0 ? -22 : -34)
      group.add(puff)
      steam.push({ mesh: puff, time: v * 0.45, speed: 0.11 + v * 0.03 })
    }

    // 街面细节与人群：护栏、斑马线、路灯杆都在 `streetFurniture` 里；人潮走在中景，最近也在十五米外。
    group.add(kit.streetFurniture(THREE, { length: 140, seed: 88 }))
    var crowd = kit.crowd(THREE, { count: 90, range: { x0: -10, x1: 10, z0: -46, z1: -15 }, coat: 0x232a36, seed: 61 })
    group.add(crowd.group)

    // 塔顶航空灯：几点慢慢眨的红，最前那点是帝国大厦的针尖。
    var beaconGeometry = new THREE.BufferGeometry()
    beaconGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      4, 145, -186, -14, 87, -158, -25, 168, -161, 25, 176, -161, -12.6, 132, -50,
    ]), 3))
    var beacons = new THREE.Points(beaconGeometry, new THREE.PointsMaterial({
      map: api.dotTexture, color: 0xff4a3d, size: 2.6, sizeAttenuation: true,
      transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    group.add(beacons)

    // 夜里横过街道的光柱：雾把颜色摊开，三条的高度与色相各不同。
    var beams = []
    var beamColors = [0x5a7bff, 0xff4fa8, 0x8a5bff]
    for (var b = 0; b < 3; b += 1) {
      var beam = kit.lightBeam(THREE, { radius: 0.12 + b * 0.05, length: 26, color: beamColors[b] })
      beam.position.set(0, 16 + b * 7, -16 - b * 16)
      group.add(beam)
      beams.push(beam)
    }

    var blueLight = new THREE.PointLight(0x5a7bff, 4, 80, 2)
    blueLight.position.set(-10, 24, -40); group.add(blueLight)
    var pinkLight = new THREE.PointLight(0xff4fa8, 4, 80, 2)
    pinkLight.position.set(10, 26, -34); group.add(pinkLight)
    var warmLight = new THREE.PointLight(0xffd9a8, 8, 30, 2)
    warmLight.position.set(-7.2, 8.2, -4.6); group.add(warmLight)

    var nightMix = 0

    // 轨道：低机位站在街心，40 秒一个循环里向上仰到塔尖方向再落回（一次往返），
    // 看向点从街面的 y 6 升到 y 36 再回来。横移 ±1.2、沿街向前溜 1.25–3.75 各取一条更慢的正弦，
    // 像人往人行道上退半步再踮脚看塔尖；`still` 时 `t = 0` 正是这套轨道里最低最近的那个仰视定格。
    // 这里只写 `world.js` 递进来的两个向量，不新建任何东西。
    function rig(t, position, target) {
      var phase = t * (Math.PI / 20)
      var rise = 0.5 - 0.5 * Math.cos(phase)
      position.set(
        -1.2 * Math.cos(phase),
        1.2 + rise * 1.1,
        2.5 - 1.25 * Math.sin(t * 0.19)
      )
      target.set(
        1.4 * Math.cos(phase),
        6 + rise * 30,
        -16 - rise * 39
      )
    }

    return {
      id: 'newyork',
      group: group,
      // `rig` 每帧接管机位；这几项是换景那几帧镜头平滑过去的目标，与 `rig` 在 `t = 0` 时一致。
      camera: { height: 1.2, distance: 2.5, targetY: 6, fov: 50 },
      // 天空压细：窄口里那块天不能比楼还亮，雾留到街尾。
      sky: { fog: 0.8 },
      look: { ambient: 0.6, exposure: 0.95, fog: 0.72, bloom: 0.5 },
      setWeather: function (next) {
        weather = next.weather
        night = next.night
      },
      rig: rig,
      resize: function () {},
      update: function (dt, clock, palette) {
        // 昼夜按帧率无关的速率靠近，换场景时屏与灯不会跳一下。
        nightMix += ((night ? 1 : 0) - nightMix) * (1 - Math.exp(-dt * 2.4))
        animeBoard.update(dt, night)
        techBoard.update(dt, night)
        newsBoard.update(dt, night)
        crowd.update(dt, night)

        glass.emissiveIntensity = 0.14 + palette.windows * 0.55
        beacons.material.opacity = 0.35 + 0.6 * (0.5 + 0.5 * Math.sin(clock * 2.2))
        blueLight.intensity = 3 + nightMix * 26
        pinkLight.intensity = 3 + nightMix * 24
        warmLight.intensity = 8 + nightMix * 14
        lampHalo.material.opacity = 0.22 + nightMix * 0.5
        for (var gl = 0; gl < glows.length; gl += 1) {
          glows[gl].mesh.material.opacity = 0.03 + nightMix * glows[gl].alpha
        }
        for (var g = 0; g < beams.length; g += 1) {
          beams[g].material.opacity = 0.04 + nightMix * (0.14 + g * 0.03)
        }
        for (var n = 0; n < signs.length; n += 1) {
          // 霓虹管自己的呼吸：几条不同相，免得整条街一起闪。
          signs[n].opacity = 0.55 + 0.45 * (0.6 + 0.4 * Math.sin(clock * 1.7 + n * 2.1))
        }
        for (var f = 0; f < fronts.length; f += 1) {
          fronts[f].mesh.material.opacity = 0.2 + nightMix * 0.62 + 0.06 * Math.sin(clock * 1.3 + fronts[f].phase)
        }
        for (var s2 = 0; s2 < streaks.length; s2 += 1) {
          streaks[s2].mesh.material.opacity = streaks[s2].base * (0.4 + nightMix * 0.9) *
            (0.82 + 0.18 * Math.sin(clock * 3.1 + streaks[s2].phase))
        }
        // 雨后的街面更滑：粗糙度低一点，灯光在积水里拉得更长。
        street.material.roughness = weather === 'rain' || weather === 'storm' ? 0.3 : 0.55

        // 出租贴着镜头驶过：从远处车道开过来、贴着右下角那一条驶出画面，再从远处来一遍。
        taxiZ += taxiSpeed * dt
        if (taxiZ > 6) taxiZ = -46
        taxi.position.set(9.6, Math.sin(clock * 7.3) * 0.02, taxiZ)
        headLight.intensity = 1.6 + nightMix * 9

        for (var c = 0; c < carState.length; c += 1) {
          var car = carState[c]
          car.z += car.speed * dt
          if (car.z > -26) car.z = -122
          if (car.z < -122) car.z = -26
          matrix.makeTranslation(car.x, 0.55, car.z)
          cars.setMatrixAt(c, matrix)
        }
        cars.instanceMatrix.needsUpdate = true

        for (var st = 0; st < steam.length; st += 1) {
          var puffState = steam[st]
          puffState.time += dt * puffState.speed
          if (puffState.time > 1) puffState.time -= 1
          var rise = puffState.time
          var grow = 0.6 + rise * 2.4
          puffState.mesh.position.y = 0.6 + rise * 7
          puffState.mesh.scale.set(grow, grow * 1.3, grow)
          puffState.mesh.material.opacity = 0.3 * (1 - rise) * (1 - rise)
        }
      },
      dispose: function () {
        group.traverse(function (object) {
          if (object.geometry) object.geometry.dispose()
          if (object.material) {
            var materials = Array.isArray(object.material) ? object.material : [object.material]
            materials.forEach(function (material) {
              // `api.dotTexture` 属于宿主，别的场景也在用，换景时不能把它释放掉。
              if (material.map && material.map !== api.dotTexture) material.map.dispose()
              if (material.emissiveMap && material.emissiveMap !== material.map) material.emissiveMap.dispose()
              material.dispose()
            })
          }
        })
        wet.roughness.dispose()
      },
    }
  }

  root.WxScenes = root.WxScenes || {}
  root.WxScenes.newyork = create
})(window)
