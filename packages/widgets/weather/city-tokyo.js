/*
 * 场景「东京涩谷」：从路口斜上方俯看全向十字路口，四条过街带从画面下缘铺向上方的塔楼。
 * 近景是交叉的斑马线、街角的行道树与人群脚下的一片暗斑，中景是绿灯时按过街带铺开的人潮，
 * 远景是 SHIBUYA SKY 的方塔、109 的圆柱楼体与挂满招牌的楼墙；镜头绕着路口慢慢摆。
 *
 * 每个场景都是同一个形状：`create(THREE, api)` 交回 `{ id, group, setWeather, resize, update, dispose, rig }`，
 * 由 `world.js` 负责天空、雾、雨雪与逐帧调度。场景只搭几何与自己的动画（D7 的一份脚本）。
 */
;(function (root) {
  'use strict'

  /** 招牌上的词：片假名、汉字与拉丁字母混排，一块压着一块挂满楼面才是涩谷的密度。 */
  var SIGN_WORDS = ['カラオケ', 'ラーメン', 'SHIBUYA', '109', '居酒屋', 'ゲーム', 'DRUG', '焼肉', 'KARAOKE', '酒場', '24H', '漫画喫茶', 'パチンコ', 'TOKYO', 'ネオン', 'CAFE']
  var SIGN_COLORS = ['#ff4fa3', '#35e0ff', '#ffd23f', '#ff4438', '#9b5cff', '#57ff9e']

  /** 招牌总数：两侧楼墙拆成四角楼之后，挂满楼面的块数一块不少。 */
  var SIGN_TOTAL = 221

  /** 路口：四条路在这里交，四条过街带围着它摆，相机绕着它转。 */
  var CROSS_X = 0
  var CROSS_Z = 0

  /**
   * 过街带：人行方向 `angle`，两条一组，各自偏移 `offset`。四条沿路的一组在路口边上（±10.5），
   * 两条斜的一组靠路口中心（±4.2），对角线上才有交叉的斑马线，画面中央不会空出一块沥青。
   */
  var CROSSINGS = [
    { angle: 0, offset: -10.5 },
    { angle: 0, offset: 10.5 },
    { angle: Math.PI / 2, offset: -10.5 },
    { angle: Math.PI / 2, offset: 10.5 },
    { angle: Math.PI / 4, offset: -4.2 },
    { angle: Math.PI / 4, offset: 4.2 },
    { angle: Math.PI * 0.75, offset: -4.2 },
    { angle: Math.PI * 0.75, offset: 4.2 },
  ]

  /**
   * 轨道：在 ±0.18 弧度里绕路口摆，74 秒一个来回，半径与高度跟着轻微呼吸。
   * 机位在路口东南方、离路口 38 米、高 14.5 米，看向点锁在路口中心：俯角约 21°，
   * 下半个画面是斑马线与树冠，上缘留给远处的塔与楼墙。高度按呼吸在 13.1–15.9 之间，
   * `still` 时 t = 0 停在弧的中段。
   */
  var ORBIT_BEARING = 0.42
  var ORBIT_SWING = 0.18
  var ORBIT_PERIOD = 74
  var ORBIT_RADIUS = 38
  var ORBIT_HEIGHT = 14.5
  var VIEW_FOV = 56
  var ORBIT_TARGET_Y = 1.2

  /** 楼面：一张贴图既是颜色也是自发光，夜里亮的格子就是这些窗。 */
  function facadeTexture(THREE, kit, seed, litRatio, warm) {
    var width = 128
    var height = 256
    var canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    var ctx = canvas.getContext('2d')
    var random = kit.seeded(seed)
    ctx.fillStyle = '#0a0d14'
    ctx.fillRect(0, 0, width, height)
    var columns = 7
    var rows = 25
    var cellW = width / columns
    var cellH = height / rows
    for (var row = 0; row < rows; row += 1) {
      for (var column = 0; column < columns; column += 1) {
        ctx.globalAlpha = 0.5 + random() * 0.5
        ctx.fillStyle = random() < litRatio ? (random() > 0.74 ? '#cfe8ff' : warm) : '#10151d'
        ctx.fillRect(column * cellW + 1, row * cellH + 1.5, cellW - 2, cellH - 4)
      }
      // 每四层一道挑檐：放大之后楼面才不是一片整齐的格子。
      if (row % 4 === 3) {
        ctx.globalAlpha = 0.5
        ctx.fillStyle = '#1a212c'
        ctx.fillRect(0, (row + 0.85) * cellH, width, Math.max(1, cellH * 0.13))
      }
    }
    ctx.globalAlpha = 1
    var texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    return texture
  }

  function create(THREE, api) {
    var kit = root.WxCityKit
    var group = new THREE.Group()
    var weather = 'cloudy'
    var night = false

    // 单位盒与一组复用向量：几十块楼、招牌与平台全靠缩放摆，帧循环里不再分配。
    var unitBox = new THREE.BoxGeometry(1, 1, 1)
    var matrix = new THREE.Matrix4()
    var quat = new THREE.Quaternion()
    var roll = new THREE.Quaternion()
    var position = new THREE.Vector3()
    var scale = new THREE.Vector3()
    var axisX = new THREE.Vector3(1, 0, 0)
    var axisY = new THREE.Vector3(0, 1, 0)
    var axisZ = new THREE.Vector3(0, 0, 1)

    /** 一块盒子：位置取中心、尺寸按世界单位给，几何共用一份。 */
    function addBox(material, width, height, depth, x, y, z, shape) {
      var mesh = new THREE.Mesh(shape || unitBox, material)
      mesh.scale.set(width, height, depth)
      mesh.position.set(x, y, z)
      group.add(mesh)
      return mesh
    }

    /** 一组盒子合并成一块几何：路沿、斑马线、树冠这类成群的块只占一次绘制。 */
    function addBoxes(material, boxes) {
      var mesh = new THREE.Mesh(kit.mergeBoxes(THREE, boxes), material)
      group.add(mesh)
      return mesh
    }

    // 地面与路面：沥青压得很暗、很亮，招牌的颜色才能在湿面上拖出反光。
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(820, 820),
      new THREE.MeshStandardMaterial({ color: 0x070a10, roughness: 0.5, metalness: 0.4 })
    )
    ground.rotation.x = -Math.PI / 2
    group.add(ground)

    // 四条 24 宽的路交在路口：两条沿 x/z 轴，两条斜 45°，中间那块 26 见方的空地以路口为中心。
    var roadMaterial = new THREE.MeshStandardMaterial({ color: 0x0d1118, roughness: 0.3, metalness: 0.86 })
    var spokes = [0, Math.PI / 4, Math.PI / 2, Math.PI * 0.75]
    var spokeGeometry = new THREE.PlaneGeometry(24, 240)
    for (var spoke = 0; spoke < spokes.length; spoke += 1) {
      var spokeMesh = new THREE.Mesh(spokeGeometry, roadMaterial)
      spokeMesh.rotation.set(-Math.PI / 2, 0, spokes[spoke])
      spokeMesh.position.set(CROSS_X, 0.02 + spoke * 0.002, CROSS_Z)
      group.add(spokeMesh)
    }

    // 街角的人行道：四块沿对角摆的台面，斑马线的两头踩在它们上面。台面压低，
    // 镜头从对角看过来时它们只是地面的一道边，不是一块挡在路口的板。
    var walkMaterial = new THREE.MeshStandardMaterial({ color: 0x1b2029, roughness: 0.82, metalness: 0.08 })
    var walks = []
    for (var corner = 0; corner < 4; corner += 1) {
      var cornerAngle = corner * Math.PI / 2 + Math.PI / 4
      walks.push({ w: 34, h: 0.08, d: 6.5, x: Math.cos(cornerAngle) * 26, y: 0.04, z: Math.sin(cornerAngle) * 26 })
    }
    addBoxes(walkMaterial, walks)

    // 斑马线：每条过街带十八条白条，垂直人行方向排开，带心落在 ±10.5；八条带合起来就是前景的放射纹理。
    // 白条占到带宽的一半（1.5 格宽、3 米一档），俯看时才是「一片斑马线」而不是几条细线。
    // 白条是绕 y 轴转过角度的长条，几何与材质各建一份，按过街带实例化。
    var stripeGeometry = new THREE.BoxGeometry(1.5, 0.04, 4.4)
    var stripeMaterial = new THREE.MeshStandardMaterial({
      color: 0x9aa6b4, roughness: 0.55, metalness: 0.3, emissive: 0x243040, emissiveIntensity: 0.6,
    })
    for (var band = 0; band < CROSSINGS.length; band += 1) {
      var crossing = CROSSINGS[band]
      var alongX = Math.cos(crossing.angle)
      var alongZ = Math.sin(crossing.angle)
      var sideX = -alongZ
      var sideZ = alongX
      var stripeMesh = new THREE.InstancedMesh(stripeGeometry, stripeMaterial, 18)
      quat.setFromAxisAngle(axisY, crossing.angle)
      for (var stripe = 0; stripe < 18; stripe += 1) {
        var along = -25.5 + stripe * 3
        position.set(
          CROSS_X + sideX * crossing.offset + alongX * along,
          0.06,
          CROSS_Z + sideZ * crossing.offset + alongZ * along
        )
        scale.set(1, 1, 1)
        matrix.compose(position, quat, scale)
        stripeMesh.setMatrixAt(stripe, matrix)
      }
      stripeMesh.instanceMatrix.needsUpdate = true
      group.add(stripeMesh)
    }

    // 招牌：每个词一块贴图、一份材质；面片按词实例化，绘制数不随招牌数量涨。
    var signGeometry = new THREE.PlaneGeometry(1, 1)
    var signMaterials = SIGN_WORDS.map(function (text, index) {
      return new THREE.MeshBasicMaterial({
        map: kit.neonTexture(THREE, text, SIGN_COLORS[index % SIGN_COLORS.length]),
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      })
    })
    var neonMaterials = signMaterials.slice()
    var signSlots = SIGN_WORDS.map(function () { return [] })
    var signTotal = 0

    /** 记一块招牌：先收位置，全部楼摆完再一次性实例化，省下几十次绘制。 */
    function queueSign(x, y, z, length, thickness, yaw, vertical) {
      signSlots[signTotal % signSlots.length].push({
        x: x, y: y, z: z, w: length, h: thickness, yaw: yaw, roll: vertical ? Math.PI / 2 : 0,
      })
      signTotal += 1
    }

    // 四角的楼：每块占一个 45° 扇形，从路口边上一路排出去，正面斜对路口，招牌挂在正面与两个侧翼上。
    // 相机悬在 45° 那一块的正上方，所以那一块整块让开（街角是空地，只有树），镜头与路口之间不留屋顶；
    // 正前方那一块压到 6–10 米，塔楼从它背后升起来；左右两块 12–17 米，是画面两侧的楼墙。
    var nearTexture = facadeTexture(THREE, kit, 5, 0.34, '#ffe0b0')
    var nearMaterial = new THREE.MeshStandardMaterial({
      map: nearTexture, emissiveMap: nearTexture, emissive: 0xffe2b8, emissiveIntensity: 0.12,
      color: 0x0b1018, roughness: 0.6, metalness: 0.34,
    })
    var buildRandom = kit.seeded(7031)
    var quadrants = [
      { angle: Math.PI / 4, inner: 52, reach: 66, base: 7, step: 1.2, top: 10 },
      { angle: Math.PI * 0.75, inner: 27, reach: 52, base: 9, step: 1.6, top: 14 },
      { angle: Math.PI * 1.25, inner: 24, reach: 46, base: 6, step: 1.2, top: 10 },
      { angle: Math.PI * 1.75, inner: 27, reach: 52, base: 9, step: 1.6, top: 14 },
    ]
    var screenHosts = [null, null]
    var roofs = []
    for (var quadrant = 0; quadrant < quadrants.length; quadrant += 1) {
      var wedge = quadrants[quadrant]
      var wedgeX = Math.cos(wedge.angle)
      var wedgeZ = Math.sin(wedge.angle)
      // 沿对角往外摆楼，每栋之间留 1.5 的巷子，排到 `reach` 为止。
      var frontYaw = Math.atan2(wedgeX, wedgeZ)
      var cursor = wedge.inner
      for (var step = 0; step < 4 && cursor + 14 <= wedge.reach; step += 1) {
        var depth = 10 + step * 2.4
        var width = 22 + buildRandom() * 12
        var distance = cursor + depth / 2
        var centerX = CROSS_X + wedgeX * distance
        var centerZ = CROSS_Z + wedgeZ * distance
        var height = Math.min(wedge.top, wedge.base + step * wedge.step + buildRandom() * 2.5)
        addBox(nearMaterial, width, height, depth, centerX, height / 2, centerZ)
        // 楼面朝路口：正面（朝街心那一侧）与两个侧翼都排招牌，转角楼才读得出体积。
        var frontX = centerX - wedgeX * (depth / 2 + 0.14)
        var frontZ = centerZ - wedgeZ * (depth / 2 + 0.14)
        var sideYawLeft = frontYaw - Math.PI / 2
        var sideYawRight = frontYaw + Math.PI / 2
        var floors = Math.floor((height - 2) / 5)
        for (var floor = 0; floor < floors; floor += 1) {
          var y = 4.6 + floor * 5
          if (y > height - 1.6) break
          var slide = (buildRandom() - 0.5) * width * 0.7
          // 正面一块横招牌，侧翼隔层一块竖招牌：转角被招牌围住。
          queueSign(
            frontX + Math.cos(frontYaw) * slide, y, frontZ - Math.sin(frontYaw) * slide,
            2.4 + buildRandom() * 2.6, 1 + buildRandom() * 1.4, frontYaw, false
          )
          if (floor % 2 === 1 && y + 5 < height) {
            // 侧翼是楼的左边或右边：沿正面退到边上，再贴着那一面往外半米。
            var sideSign = buildRandom() > 0.5 ? 1 : -1
            var sideYaw = sideSign > 0 ? sideYawLeft : sideYawRight
            var edgeX = centerX + wedgeZ * sideSign * (width / 2)
            var edgeZ = centerZ - wedgeX * sideSign * (width / 2)
            var outX = Math.cos(sideYaw)
            var outZ = Math.sin(sideYaw)
            queueSign(
              edgeX + outX * (depth / 2 + 0.2), y + 2.1, edgeZ + outZ * (depth / 2 + 0.2),
              3.6 + buildRandom() * 1.6, 1.05, sideYaw, true
            )
          }
        }
        // 楼顶的塔式招牌：俯看时四角楼只露顶面，顶上的字是最后一块能读到的东西。
        roofs.push({ x: centerX, y: height + 1.6, z: centerZ, yaw: frontYaw, height: height })
        // 大屏挂在两侧楼墙的一栋上，朝路口，镜头一转就换一片画面。
        if (wedge.top > 14 && (screenHosts[quadrant % 2] === null || height > screenHosts[quadrant % 2].height)) {
          screenHosts[quadrant % 2] = { x: centerX, z: centerZ, height: height, yaw: frontYaw, width: width, depth: depth }
        }
        cursor += depth + 1.5
      }
    }
    for (var roof = 0; roof < roofs.length; roof += 1) {
      var roofSign = roofs[roof]
      if (roofSign.height < 13) continue
      queueSign(roofSign.x, roofSign.height + 2.2, roofSign.z, 5.4 + (roof % 3) * 1.4, 1.8, roofSign.yaw, false)
    }

    // 招牌的密度是这个城的灵魂：四角楼盘出来的块数不足时，差额补到面朝路口的楼面上，总数不变。
    if (signTotal < SIGN_TOTAL) {
      for (var extra = 0; signTotal < SIGN_TOTAL; extra += 1) {
        var hostWedge = quadrants[extra % quadrants.length]
        var hostYaw = Math.atan2(Math.cos(hostWedge.angle), Math.sin(hostWedge.angle))
        var hostReach = hostWedge.inner + 4 + (extra % 3) * 6
        queueSign(
          CROSS_X + Math.cos(hostWedge.angle) * hostReach,
          4.6 + (extra % Math.max(1, Math.floor((hostWedge.top - 3) / 5))) * 5,
          CROSS_Z + Math.sin(hostWedge.angle) * hostReach,
          2.4 + buildRandom() * 2.6, 1 + buildRandom() * 1.4, hostYaw, false
        )
      }
    }

    // 把招牌按词实例化：位置、朝向与竖排的滚转都在矩阵里。
    for (var slot = 0; slot < signSlots.length; slot += 1) {
      var slots = signSlots[slot]
      if (slots.length === 0) continue
      var signMesh = new THREE.InstancedMesh(signGeometry, signMaterials[slot], slots.length)
      for (var q = 0; q < slots.length; q += 1) {
        var entry = slots[q]
        position.set(entry.x, entry.y, entry.z)
        scale.set(entry.w, entry.h, 1)
        quat.setFromAxisAngle(axisY, entry.yaw)
        roll.setFromAxisAngle(axisZ, entry.roll)
        quat.multiply(roll)
        matrix.compose(position, quat, scale)
        signMesh.setMatrixAt(q, matrix)
      }
      signMesh.instanceMatrix.needsUpdate = true
      group.add(signMesh)
    }

    // 两座地标的位置先定下来。镜头在路口东南方的低空俯看，塔要落在画面上方又不压住路口：
    // SHIBUYA SKY 立在路口的南侧偏西、109 立在北侧偏东，两座都在 70 米内，从这个高度看塔身还有高度。
    // 两座地标落在路口另一侧、视线左前与右前各一座：都在 90 米上下，24 米高的塔身正好躺在画面上部，
    // 塔顶不越出上缘，塔底藏在正前方那排矮楼之后。
    var skyX = -74
    var skyZ = -56
    var tower109X = -24
    var tower109Z = -85
    // 两座塔的正面都朝相机常驻的方向，招牌与环屏才一直看得见。
    var eyeMeanX = Math.sin(ORBIT_BEARING) * ORBIT_RADIUS
    var eyeMeanZ = Math.cos(ORBIT_BEARING) * ORBIT_RADIUS
    var skyYaw = Math.atan2(eyeMeanX - skyX, eyeMeanZ - skyZ)
    var yaw109 = Math.atan2(eyeMeanX - tower109X, eyeMeanZ - tower109Z)

    // 远景：楼压得低而密，几栋塔从屋群里冒头；天际线比纽约低，光点却更碎。
    var farTexture = facadeTexture(THREE, kit, 23, 0.26, '#ffd79c')
    var farMaterial = new THREE.MeshStandardMaterial({
      map: farTexture, emissiveMap: farTexture, emissive: 0xffd9a4, emissiveIntensity: 0.1,
      color: 0x090d14, roughness: 0.74, metalness: 0.2,
    })
    var farCount = 150
    var far = new THREE.InstancedMesh(unitBox, farMaterial, farCount)
    var skyRandom = kit.seeded(3311)
    for (var f = 0; f < farCount; f += 1) {
      var tower = f >= 132
      var farW = tower ? 12 + skyRandom() * 12 : 6 + skyRandom() * 13
      var farD = tower ? 12 + skyRandom() * 10 : 6 + skyRandom() * 13
      // 远景楼比两座地标矮一档：天际线贴着画面下缘到上缘之间那一带。
      var farH = tower ? 11 + skyRandom() * 6 : 5 + skyRandom() * 7
      // 远景从路口的另一侧长起来：相机身后与两侧那一圈留给四角楼，远景只填画面上部。
      var farX = (skyRandom() - 0.5) * 240
      var farZ = -150 + skyRandom() * 110
      if (tower) farX = (skyRandom() - 0.5) * 180
      if (Math.sqrt(farX * farX + farZ * farZ) < 62) continue
      if (Math.abs(farX - skyX) < 22 && Math.abs(farZ - skyZ) < 22) farX += farX > skyX ? 30 : -30
      if (Math.abs(farX - tower109X) < 20 && Math.abs(farZ - tower109Z) < 20) farZ += farZ > tower109Z ? 30 : -30
      matrix.makeScale(farW, farH, farD)
      matrix.setPosition(farX, farH / 2, farZ)
      far.setMatrixAt(f, matrix)
    }
    group.add(far)

    // 楼体的两种灰：混凝土吃光，钢与玻璃把天光收成一条亮边。
    var concreteMaterial = new THREE.MeshStandardMaterial({ color: 0x141a24, roughness: 0.66, metalness: 0.4 })
    var steelMaterial = new THREE.MeshStandardMaterial({ color: 0x0d1219, roughness: 0.5, metalness: 0.6 })

    // SHIBUYA SKY：方塔顶上一层外挑的观景平台，平台边一圈自发光，夜空里像一条横着的灯带。
    addBox(concreteMaterial, 22, 5, 22, skyX, 2.5, skyZ)
    addBox(steelMaterial, 15, 17, 15, skyX, 13.5, skyZ)
    addBox(concreteMaterial, 27, 1.8, 27, skyX, 22.9, skyZ)
    addBox(steelMaterial, 1, 6, 1, skyX, 26.4, skyZ)
    var deckMaterial = new THREE.MeshBasicMaterial({ color: 0xa9ecff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })
    var deckGlow = new THREE.Mesh(kit.mergeBoxes(THREE, [
      { w: 27.4, h: 0.4, d: 0.6, x: 0, y: 0, z: 13.5 },
      { w: 27.4, h: 0.4, d: 0.6, x: 0, y: 0, z: -13.5 },
      { w: 0.6, h: 0.4, d: 27.4, x: 13.5, y: 0, z: 0 },
      { w: 0.6, h: 0.4, d: 27.4, x: -13.5, y: 0, z: 0 },
    ]), deckMaterial)
    deckGlow.position.set(skyX, 24, skyZ)
    deckGlow.rotation.y = skyYaw
    group.add(deckGlow)
    var skySignMaterial = new THREE.MeshBasicMaterial({
      map: kit.neonTexture(THREE, 'SHIBUYA', '#bfe9ff'),
      transparent: true, depthWrite: false, toneMapped: false,
    })
    neonMaterials.push(skySignMaterial)
    var skySign = new THREE.Mesh(new THREE.PlaneGeometry(17, 5), skySignMaterial)
    skySign.position.set(skyX + Math.sin(skyYaw) * 7.6, 17, skyZ + Math.cos(skyYaw) * 7.6)
    skySign.rotation.y = skyYaw
    group.add(skySign)

    // 109：圆柱楼体，腰上一圈广告屏，屏上的竖流光整夜往上走。
    var tower109 = new THREE.Group()
    tower109.position.set(tower109X, 0, tower109Z)
    var pedestal109 = new THREE.Mesh(unitBox, steelMaterial)
    pedestal109.scale.set(18, 5, 18)
    pedestal109.position.y = 2.5
    tower109.add(pedestal109)
    var body109 = new THREE.Mesh(kit.frustum(THREE, { bottom: 14, top: 12, height: 19, sides: 32 }), steelMaterial)
    body109.position.y = 14
    tower109.add(body109)
    var ringMaterial = kit.mediaMaterial(THREE, { kind: 'wave', colorA: '#ff3fa0', colorB: '#35e0ff' })
    var ring = new THREE.Mesh(new THREE.CylinderGeometry(6.8, 6.8, 4.4, 32, 1, true), ringMaterial)
    ring.position.y = 14
    tower109.add(ring)
    group.add(tower109)
    // 楼顶的霓虹 109 单独朝路口：镜头绕过来时字一直正面朝着画面。
    var sign109Material = new THREE.MeshBasicMaterial({
      map: kit.neonTexture(THREE, '109', '#ff2d6f'),
      transparent: true, depthWrite: false, toneMapped: false,
    })
    neonMaterials.push(sign109Material)
    var sign109 = new THREE.Mesh(new THREE.PlaneGeometry(15, 5), sign109Material)
    sign109.position.set(tower109X + Math.sin(yaw109) * 6.6, 21.5, tower109Z + Math.cos(yaw109) * 6.6)
    sign109.rotation.y = yaw109
    group.add(sign109)

    // 两块动画广告屏：挂在四角楼最高一栋的正面，朝路口，镜头一转就换一片画面。
    var billboards = []
    for (var host = 0; host < screenHosts.length; host += 1) {
      var record = screenHosts[host]
      if (record === null) continue
      var screen = kit.billboard(THREE, { width: Math.min(13, record.width - 2), height: 7, theme: 'anime' })
      screen.mesh.position.set(
        record.x - Math.cos(record.yaw) * (record.depth / 2 + 0.2),
        Math.min(record.height - 4.5, 12),
        record.z - Math.sin(record.yaw) * (record.depth / 2 + 0.2)
      )
      screen.mesh.rotation.y = record.yaw
      group.add(screen.mesh)
      billboards.push(screen)
    }

    // 行道树：沿路口两侧排四簇，冠幅收紧，只在画框边上露一角；树干细，挡不住人潮。
    // 最近的一簇离相机也在 25 米外：太近的方冠在画面角上会读成一块色块。
    var trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.95, metalness: 0.02 })
    var canopyMaterial = new THREE.MeshStandardMaterial({ color: 0x1c3a2a, roughness: 0.9, metalness: 0.02 })
    var trunks = []
    var crowns = []
    var copses = [
      { x: -20, z: 20, count: 3, seed: 43, height: 8, crown: 1.6, blobs: 3 },
      { x: -26, z: -2, count: 3, seed: 57, height: 8, crown: 1.6, blobs: 3 },
      { x: 20, z: -16, count: 3, seed: 71, height: 8, crown: 1.6, blobs: 3 },
      { x: -10, z: -22, count: 2, seed: 83, height: 8, crown: 1.6, blobs: 3 },
    ]
    for (var copse = 0; copse < copses.length; copse += 1) {
      var grove = copses[copse]
      var groveRandom = kit.seeded(grove.seed)
      for (var tree = 0; tree < grove.count; tree += 1) {
        var treeX = grove.x + (groveRandom() - 0.5) * 5
        var treeZ = grove.z + (groveRandom() - 0.5) * 5
        var treeHeight = grove.height + groveRandom() * 2.5
        trunks.push({ w: 0.55, h: treeHeight, d: 0.55, x: treeX, y: treeHeight / 2 + 0.26, z: treeZ })
        // 一簇几团球冠，扁一圈：俯着看是几团暗绿的剪影，底下的灯只把边缘挑亮。
        for (var blob = 0; blob < grove.blobs; blob += 1) {
          var crownSize = grove.crown + groveRandom() * 1.2
          crowns.push({
            w: crownSize, h: crownSize * 0.7, d: crownSize,
            x: treeX + (groveRandom() - 0.5) * 3,
            y: treeHeight + 0.4 + groveRandom() * 1.6,
            z: treeZ + (groveRandom() - 0.5) * 3,
          })
        }
      }
    }
    addBoxes(trunkMaterial, trunks)
    addBoxes(canopyMaterial, crowns)

    // 人群：人潮按过街带分组，每一组在自己的带上横着铺开、沿人行方向来回走；绿灯时它们一起过街。
    // 走在画面上方、背对镜头的那两条带距离远、显得小，人数给得比下缘那条多一档。
    // 脚下的一块暗斑：贴地的小圆面片，实例化后每帧跟着人走，人不再贴平在路面上。
    var contactGeometry = new THREE.CircleGeometry(0.5, 10)
    contactGeometry.rotateX(-Math.PI / 2)
    var contactMaterial = new THREE.MeshBasicMaterial({
      color: 0x04060a, transparent: true, opacity: 0.42, depthWrite: false,
    })
    var contactScale = new THREE.Vector3(1.7, 1, 1.7)
    var flatQuat = new THREE.Quaternion()
    var walkerTint = new THREE.Color()
    var crowdGroups = []
    var crowdShadows = []
    for (var walkBand = 0; walkBand < CROSSINGS.length; walkBand += 1) {
      var lane = CROSSINGS[walkBand]
      var inlineX = Math.cos(lane.angle)
      var inlineZ = Math.sin(lane.angle)
      var laneX = -inlineZ
      var laneZ = inlineX
      // 背对镜头走上去的两条带（负 z）最远，给 46 人；迎面下来的两条给 34。
      var people = inlineZ >= 0 ? 34 : 46
      var centerX = CROSS_X + laneX * lane.offset
      var centerZ = CROSS_Z + laneZ * lane.offset
      // 过街带换成本地坐标里的轴对齐范围：沿带长 20，横着 2.6，人群在带里来回走。
      // 衣着给到浅灰蓝：深色沥青上，人要靠明度差才读得出来。
      var crowd = kit.crowd(THREE, {
        count: people,
        range: { x0: -2.6, x1: 2.6, z0: -20, z1: 20 },
        seed: 121 + walkBand * 17,
        coat: 0xcfd8e4,
      })
      // 实例色是乘在材质色上的：把原来偏暗的蓝灰换成中亮的中性色，衣服之间仍然各不相同。
      var walkers = crowd.group.children[0]
      var tintRandom = kit.seeded(211 + walkBand * 29)
      for (var shade = 0; shade < people; shade += 1) {
        walkerTint.setHSL(0.57 + tintRandom() * 0.05, 0.14, 0.4 + tintRandom() * 0.22)
        walkers.setColorAt(shade, walkerTint)
      }
      walkers.instanceColor.needsUpdate = true
      var contact = new THREE.InstancedMesh(contactGeometry, contactMaterial, people)
      contact.frustumCulled = false
      crowd.group.add(contact)
      crowd.group.rotation.y = Math.PI / 2 - lane.angle
      crowd.group.position.set(centerX, 0, centerZ)
      crowd.group.updateMatrixWorld(true)
      group.add(crowd.group)
      crowdGroups.push(crowd)
      crowdShadows.push({ walkers: walkers, contact: contact, count: people })
    }

    // 湿路面上的反光：一层沿路口铺开的加色光斑，颜色取招牌的色，夜里最亮。
    // 斑马线是前景的主角，所以它压得很淡、也窄，只在沥青上留一层色。
    var smearGeometry = new THREE.PlaneGeometry(1, 1)
    var smearMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    var smearCount = 46
    var smears = new THREE.InstancedMesh(smearGeometry, smearMaterial, smearCount)
    var smearRandom = kit.seeded(4507)
    var smearPalette = SIGN_COLORS.map(function (hex) { return new THREE.Color(hex) })
    quat.setFromAxisAngle(axisX, -Math.PI / 2)
    for (var smear = 0; smear < smearCount; smear += 1) {
      var smearAngle = smearRandom() * Math.PI * 2
      var smearRange = 8 + smearRandom() * 42
      position.set(CROSS_X + Math.cos(smearAngle) * smearRange, 0.035, CROSS_Z + Math.sin(smearAngle) * smearRange)
      scale.set(0.6 + smearRandom() * 1.7, 5 + smearRandom() * 16, 1)
      matrix.compose(position, quat, scale)
      smears.setMatrixAt(smear, matrix)
      smears.setColorAt(smear, smearPalette[Math.floor(smearRandom() * smearPalette.length)])
    }
    group.add(smears)

    // 招牌的光落在街上：三盏彩色点光围在路口四周，白天几乎不亮，夜里把路面与人群染上一层。
    var signLightLeft = new THREE.PointLight(0xff3f9e, 0, 46, 2)
    signLightLeft.position.set(-12, 8, 6)
    group.add(signLightLeft)
    var signLightRight = new THREE.PointLight(0x2fd8ff, 0, 46, 2)
    signLightRight.position.set(13, 9, -8)
    group.add(signLightRight)
    var streetLight = new THREE.PointLight(0xffd7b0, 0, 38, 2)
    streetLight.position.set(0, 5, 0)
    group.add(streetLight)

    // 路口上空两条横过的光带：俯看时它们斜穿画面，夜里的招牌色才有第二个方向。
    var beams = []
    var beamColors = [0xff4fa3, 0x39d8ff]
    for (var beamIndex = 0; beamIndex < 2; beamIndex += 1) {
      var beam = kit.lightBeam(THREE, { radius: 0.1, length: 30, color: beamColors[beamIndex] })
      beam.position.set(beamIndex === 0 ? -2 : 3, 9 + beamIndex * 3.4, -3 - beamIndex * 9)
      beam.rotation.y = beamIndex === 0 ? Math.PI / 4 : -Math.PI / 5
      group.add(beam)
      beams.push(beam)
    }

    // 塔顶的航空灯：一点点红，慢慢眨。
    var beaconGeometry = new THREE.BufferGeometry()
    beaconGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      skyX, 81.4, skyZ, tower109X, 53, tower109Z, -78, 52, -176, 96, 44, -190, -116, 38, -208,
    ]), 3))
    var beacons = new THREE.Points(beaconGeometry, new THREE.PointsMaterial({
      map: api.dotTexture, color: 0xff4a3d, size: 2.4, sizeAttenuation: true,
      transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    group.add(beacons)

    return {
      id: 'tokyo',
      group: group,
      // 提示里的数与 `rig(0)` 是同一组：离路口 38 米、高 14.5 米、看向点 y 1.2，fov 56 就是构图用的竖直视角。
      camera: { height: ORBIT_HEIGHT, distance: ORBIT_RADIUS, targetY: ORBIT_TARGET_Y, fov: VIEW_FOV },
      look: { ambient: 0.64, exposure: 1.14, fog: 0.76, bloom: 0.55 },
      /**
       * 轨道：`t` 秒时把机位与看向点写进 `world.js` 递来的两个向量，只调用它们的 `set`。
       * 相机绕着路口在 74 秒里摆过 ±0.18 弧度的弧，高度与半径各慢一拍呼吸；
       * 看向点锁在路口中心，y 在 0.5–1.9 之间轻轻点头，俯角因此跟着呼吸。
       * `t` 为 0（静止）时停在弧的中段，那一刻的构图按 16:9 核过。
       */
      rig: function (t, position, target) {
        var cycle = t * Math.PI * 2
        var swing = ORBIT_BEARING + Math.sin(cycle / ORBIT_PERIOD) * ORBIT_SWING
        var radius = ORBIT_RADIUS + Math.sin(cycle / (ORBIT_PERIOD * 1.6)) * 1.6
        var height = ORBIT_HEIGHT + Math.sin(cycle / (ORBIT_PERIOD * 1.15)) * 1.4
        var aimY = ORBIT_TARGET_Y + Math.sin(cycle / (ORBIT_PERIOD * 1.3)) * 0.7
        position.set(CROSS_X + Math.sin(swing) * radius, height, CROSS_Z + Math.cos(swing) * radius)
        target.set(CROSS_X, aimY, CROSS_Z)
      },
      setWeather: function (next) {
        weather = next.weather
        night = next.night
      },
      resize: function (width, height) {},
      update: function (dt, clock, palette) {
        // 招牌：夜里全亮并随窗灯再抬一档，白天只留一层薄光；雨雾里收一点，免得糊成一片。
        var haze = weather === 'rain' || weather === 'storm' || weather === 'snow' ? 0.86 : 1
        var signLevel = (night ? 0.94 + palette.windows * 0.16 : 0.32 + palette.windows * 0.26) * haze
        for (var s = 0; s < neonMaterials.length; s += 1) neonMaterials[s].color.setScalar(signLevel)
        for (var b = 0; b < billboards.length; b += 1) billboards[b].update(dt, night)
        // 楼面窗灯：夜里跟着 palette.windows 一起亮，白天只留一层余温。
        nearMaterial.emissiveIntensity = night ? 0.34 + palette.windows * 1.25 : 0.05 + palette.windows * 0.32
        farMaterial.emissiveIntensity = night ? 0.28 + palette.windows * 1.05 : 0.04 + palette.windows * 0.26
        // 环形屏与平台边：夜里是屏，白天只是带一点反光的深色玻璃。
        ringMaterial.uniforms.uTime.value = clock
        ringMaterial.uniforms.uNight.value = night ? 1 : 0.12
        ring.rotation.y = clock * 0.12
        deckMaterial.opacity = (night ? 0.62 : 0.18) + 0.08 * Math.sin(clock * 0.9)
        // 湿路面：粗糙度朝下、金属度朝上，招牌的反光在沥青上拖出一条；雨里再亮一档。
        var wet = weather === 'rain' || weather === 'storm' ? 1.25 : 1
        roadMaterial.roughness = night ? 0.16 : 0.32
        roadMaterial.metalness = night ? 0.94 : 0.78
        smearMaterial.opacity = (night ? 0.085 : 0.028) * wet
        signLightLeft.intensity = night ? 26 : 4
        signLightRight.intensity = night ? 24 : 3
        streetLight.intensity = night ? 14 : 6
        for (var bm = 0; bm < beams.length; bm += 1) {
          beams[bm].material.opacity = (night ? 0.38 : 0.1) + 0.05 * Math.sin(clock * 1.7 + bm)
        }
        beacons.material.opacity = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(clock * 2.1))
        for (var c = 0; c < crowdGroups.length; c += 1) crowdGroups[c].update(dt, night)
        // 脚下暗斑跟着人走：只取每个人两条腿里的第一条，把它的位置搬到地面上。
        for (var pair = 0; pair < crowdShadows.length; pair += 1) {
          var record = crowdShadows[pair]
          for (var soul = 0; soul < record.count; soul += 1) {
            record.walkers.getMatrixAt(soul * 2, matrix)
            position.set(matrix.elements[12], 0.07, matrix.elements[14])
            matrix.compose(position, flatQuat, contactScale)
            record.contact.setMatrixAt(soul, matrix)
          }
          record.contact.instanceMatrix.needsUpdate = true
        }
      },
      dispose: function () {
        group.traverse(function (object) {
          if (object.geometry) object.geometry.dispose()
          if (!object.material) return
          var materials = Array.isArray(object.material) ? object.material : [object.material]
          // 圆点贴图是 world 的，场景只借用，不跟着这里释放；招牌材质按词共享，重复释放无害。
          materials.forEach(function (material) {
            if (material.map && material.map !== api.dotTexture) material.map.dispose()
            if (material.emissiveMap && material.emissiveMap !== material.map) material.emissiveMap.dispose()
            material.dispose()
          })
        })
      },
    }
  }

  root.WxScenes = root.WxScenes || {}
  root.WxScenes.tokyo = create
})(window)
