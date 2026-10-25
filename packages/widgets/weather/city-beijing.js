/*
 * 场景「北京国贸」：从另一栋楼的屋顶俯瞰 CBD。
 * 三层景深——下缘是脚下这栋楼的女儿墙、屋顶设备与红色航空灯；中部是中国尊与国贸三期，两塔之间留一道天际线；
 * 上缘是密集的远景楼群与晨雾。镜头不走街道，交给 `rig` 从左侧高处横移并微降，看向点钉在两塔之间。
 * 与 `scene-city.js` 同一种形状：`create(THREE, api)` 交回 `{ id, group, camera, look, rig, setWeather, resize, update, dispose }`，
 * 天空、雾、雨雪由 `world.js` 管；公共零件取自 `WxCityKit`，这里只写这座城的轮廓、地标与配色（D7 的一份脚本）。
 */
;(function (root) {
  'use strict'

  /** 中国尊的幕墙：密排竖棂加横向楼板线；同一张图当自发光，夜里塔身是一道竖起来的蓝光。 */
  function finTexture(THREE) {
    var canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    var ctx = canvas.getContext('2d')
    ctx.fillStyle = '#0a1119'
    ctx.fillRect(0, 0, 128, 128)
    for (var x = 0; x < 128; x += 5) {
      ctx.fillStyle = x % 15 === 0 ? 'rgba(120,185,255,0.6)' : 'rgba(90,150,230,0.24)'
      ctx.fillRect(x, 0, 1.6, 128)
    }
    ctx.fillStyle = 'rgba(70,110,160,0.42)'
    for (var y = 0; y < 128; y += 12) ctx.fillRect(0, y, 128, 1.6)
    var texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(8, 7)
    return texture
  }

  /**
   * 楼群共用的窗格贴图：一张画布同时当颜色与自发光，夜里亮的就是这些格子。
   * 一张图上十六层窗、不到八列，一栋楼绕几遍就有几十层，比一栋一张贴图省得多。
   */
  function windowTexture(THREE, random, litRatio, warm) {
    var canvas = document.createElement('canvas')
    canvas.width = 192
    canvas.height = 256
    var ctx = canvas.getContext('2d')
    ctx.fillStyle = '#080b11'
    ctx.fillRect(0, 0, 192, 256)
    for (var row = 0; row < 16; row += 1) {
      // 整层一次决定亮不亮：俯瞰时一层层的亮窗比一间间的更像一座城的屋顶。
      var floorLit = random() < litRatio
      for (var column = 0; column < 8; column += 1) {
        var lit = floorLit && random() < 0.62
        ctx.globalAlpha = lit ? 0.5 + random() * 0.5 : 0.9
        ctx.fillStyle = lit ? (random() > 0.7 ? '#c2e6ff' : warm) : '#0d1218'
        ctx.fillRect(column * 24 + 5, row * 14 + 3, 15, 8)
      }
      // 每四层一道挑檐与一条楼板线，楼面才有层次，不然只是一片格子。
      ctx.globalAlpha = 0.5
      ctx.fillStyle = '#151b24'
      ctx.fillRect(0, row * 14 + 12.6, 192, 1.4)
      if (row % 4 === 3) ctx.fillRect(0, row * 14 + 13.4, 192, 2.6)
    }
    var texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    return texture
  }

  /** 屋顶面的铺装：混凝土方格、一块找坡、几处污渍。屋顶是近景的主色，白天与夜里都得扛得住看。 */
  function roofTexture(THREE, random) {
    var canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    var ctx = canvas.getContext('2d')
    ctx.fillStyle = '#39424e'
    ctx.fillRect(0, 0, 256, 256)
    for (var i = 0; i < 1400; i += 1) {
      var shade = 48 + Math.round(random() * 22)
      ctx.fillStyle = 'rgb(' + shade + ',' + (shade + 4) + ',' + (shade + 10) + ')'
      ctx.fillRect(random() * 256, random() * 256, 1 + random() * 2, 1 + random() * 2)
    }
    ctx.strokeStyle = 'rgba(16,20,26,0.7)'
    ctx.lineWidth = 2
    for (var line = 0; line <= 256; line += 64) {
      ctx.beginPath()
      ctx.moveTo(line, 0)
      ctx.lineTo(line, 256)
      ctx.moveTo(0, line)
      ctx.lineTo(256, line)
      ctx.stroke()
    }
    var map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    map.wrapS = THREE.RepeatWrapping
    map.wrapT = THREE.RepeatWrapping
    map.repeat.set(6, 7)
    return map
  }

  /**
   * 画面左上角的一层暗：月亮就落在那个角，城市自己的光才该是画面的亮部。
   * 贴图按画面比例铺满，渐变从左上角起、到画面中部归零，夜里才叠上去。
   */
  function cornerShadeTexture(THREE) {
    var size = 256
    var canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    var ctx = canvas.getContext('2d')
    var gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.72)
    gradient.addColorStop(0, 'rgba(3,6,11,0.95)')
    gradient.addColorStop(0.32, 'rgba(5,9,16,0.6)')
    gradient.addColorStop(0.68, 'rgba(7,12,20,0.2)')
    gradient.addColorStop(1, 'rgba(7,12,20,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
    var texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  /** 顶面斜切的方塔：把顶面顶点按 x 削掉一截，国贸三期那道斜口一次成型，帧里不再动。 */
  function shearedTower(THREE, width, height, depth, drop) {
    var geometry = new THREE.BoxGeometry(width, height, depth)
    var position = geometry.getAttribute('position')
    for (var i = 0; i < position.count; i += 1) {
      if (position.getY(i) > 0) position.setY(i, position.getY(i) - (position.getX(i) / width + 0.5) * drop)
    }
    position.needsUpdate = true
    geometry.computeVertexNormals()
    return geometry
  }

  /**
   * 镜头轨道：从左侧高处横移，缓缓降到略低于起点，看向点始终落在中国尊与国贸三期之间。
   *
   * 横移的周期取一百四十秒，四十到六十秒里走的是这条弧的前三分之一，画面不停、也不回头；
   * 高度再叠两组不同相的慢正弦，看起来才像手持吊臂，不像按轨道走的模型。
   * `t = 0` 时位置在左端、略微下降后的高度，指针在画面中央；静止时 `motion` 只画一帧，`t` 就是 0。
   *
   * `veil` 是画面左上角那层暗：它挂在镜头前六米、随镜头一起转，所以始终贴在画面同一个角上。
   * 位置由这里写，帧里不新建任何向量。
   */
  function makeRig(veil) {
    var origin = { x: 0, y: 56, z: 104 }
    // 看向点落在两塔之间、略高于塔腰：塔身因此沉到中线之下、塔尖落在上部，近景的屋顶仍只占画面的下缘。
    var aim = { x: 3.5, y: 48, z: -40 }
    return function rig(t, position, target) {
      var sweep = Math.sin(Math.PI * 2 * t / 140)
      var drop = 0.5 - 0.5 * Math.cos(Math.PI * 2 * t / 140)
      var breatheY = Math.sin(t * 0.17) * 1.1 + Math.sin(t * 0.11 + 1.3) * 0.6
      var breatheX = Math.sin(t * 0.13 + 0.4) * 0.9
      position.x = origin.x - 16 + sweep * 16 + breatheX
      position.y = origin.y - drop * 9 + breatheY
      position.z = origin.z - 12 * Math.sin(Math.PI * 2 * t / 190)
      target.x = aim.x + Math.sin(t * 0.07) * 1.4
      target.y = aim.y + Math.sin(t * 0.09 + 0.8) * 0.8
      target.z = aim.z
      var dx = target.x - position.x
      var dy = target.y - position.y
      var dz = target.z - position.z
      var reach = 6 / Math.sqrt(dx * dx + dy * dy + dz * dz)
      veil.position.set(position.x + dx * reach, position.y + dy * reach, position.z + dz * reach)
      veil.lookAt(target.x, target.y, target.z)
    }
  }

  function create(THREE, api) {
    var kit = root.WxCityKit
    var group = new THREE.Group()
    var weather = 'cloudy'
    var night = false
    // 帧循环里复用同一份矩阵：每帧新建会让走动的人群与车流上出现周期性的顿挫。
    var matrix = new THREE.Matrix4()
    var random = kit.seeded(2008)

    // 底色：地面被夜雾与楼影压得很沉，城市自己的灯才是画面里的亮部。
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ color: 0x080c12, roughness: 0.62, metalness: 0.4 }))
    ground.rotation.x = -Math.PI / 2
    group.add(ground)

    // 楼群的两张贴图：中景冷白偏蓝，远景偏暖偏暗，靠颜色分层。
    var towerSkin = windowTexture(THREE, kit.seeded(57), 0.2, '#ffe0a8')
    var towerMaterial = new THREE.MeshStandardMaterial({
      map: towerSkin, emissiveMap: towerSkin, emissive: new THREE.Color(0xffe0a8),
      emissiveIntensity: 0.1, color: 0x0b1119, roughness: 0.58, metalness: 0.42,
    })
    var farSkin = windowTexture(THREE, kit.seeded(83), 0.26, '#ffd79a')
    var farMaterial = new THREE.MeshStandardMaterial({
      map: farSkin, emissiveMap: farSkin, emissive: new THREE.Color(0xffd7a0),
      emissiveIntensity: 0.1, color: 0x0a0f17, roughness: 0.74, metalness: 0.26,
    })

    // 中景的楼群：围绕两座地标的中层楼与两栋挂屏的楼，楼间留缝，天际线才有呼吸。
    var midBoxes = [
      { x: -118, z: -96, w: 22, d: 22, h: 62 },
      { x: -92, z: -120, w: 18, d: 18, h: 48 },
      { x: -74, z: -84, w: 20, d: 20, h: 55 },
      { x: -40, z: -114, w: 16, d: 16, h: 44 },
      { x: -58, z: -66, w: 14, d: 14, h: 38 },
      { x: -52, z: -50, w: 14, d: 14, h: 34 },
      { x: 10, z: -92, w: 18, d: 18, h: 52 },
      { x: 34, z: -112, w: 16, d: 16, h: 46 },
      { x: 62, z: -80, w: 22, d: 22, h: 58 },
      { x: 52, z: -116, w: 18, d: 18, h: 50 },
      { x: 92, z: -102, w: 24, d: 24, h: 66 },
      { x: 118, z: -72, w: 20, d: 20, h: 44 },
      { x: -14, z: -140, w: 26, d: 26, h: 58 },
      { x: 76, z: -148, w: 20, d: 20, h: 56 },
    ]
    var midBody = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), towerMaterial, midBoxes.length)
    for (var m = 0; m < midBoxes.length; m += 1) {
      var mid = midBoxes[m]
      matrix.makeScale(mid.w, mid.h, mid.d)
      matrix.setPosition(mid.x, mid.h / 2, mid.z)
      midBody.setMatrixAt(m, matrix)
    }
    group.add(midBody)
    // 一栋中景楼顶的机坪边灯，两点暖色，给屋顶一点城市感。
    var roofDeck = new THREE.Mesh(new THREE.BoxGeometry(18, 1.2, 18), towerMaterial)
    roofDeck.position.set(-40, 44.6, -114)
    group.add(roofDeck)

    // 媒体立面：国贸一带的夜有一半是屏撑起来的，这几块只挂朝镜头的一面，四面都亮会把整栋楼读成灯管。
    var media = []
    function mediaPanel(options) {
      var material = kit.mediaMaterial(THREE, { kind: options.kind, colorA: options.colorA, colorB: options.colorB })
      var panel = new THREE.Mesh(new THREE.PlaneGeometry(options.width, options.height), material)
      panel.position.set(options.x, options.y, options.z)
      panel.rotation.y = options.rotation || 0
      group.add(panel)
      media.push(material)
    }
    mediaPanel({ width: 26, height: 20, x: 76, y: 36, z: -138, kind: 'bars', colorA: '#2ea8ff', colorB: '#ff3d8f' })
    mediaPanel({ width: 18, height: 34, x: 50, y: 30, z: -104.9, kind: 'wave', colorA: '#39d0ff', colorB: '#7a5cff' })
    mediaPanel({ width: 20, height: 26, x: -44.9, y: 26, z: -50, kind: 'grid', colorA: '#ff3d9a', colorB: '#39d0ff', rotation: Math.PI / 2 })

    // 中国尊：四段棱台上下相接，底宽、腰窄、顶略张；双曲面靠段与段的斜率差凑出来。居左偏中。
    var zunSkin = finTexture(THREE)
    var zunMaterial = new THREE.MeshStandardMaterial({
      map: zunSkin, emissiveMap: zunSkin, emissive: new THREE.Color(0x2f7dff),
      emissiveIntensity: 0.08, color: 0x0b1420, roughness: 0.34, metalness: 0.74,
    })
    var zun = new THREE.Group()
    zun.position.set(-18, 0, -78)
    var zunY = 0
    var zunTiers = [
      { bottom: 23, top: 16, height: 21, sides: 20 },
      { bottom: 16, top: 12, height: 19, sides: 20 },
      { bottom: 12, top: 13, height: 15, sides: 20 },
      { bottom: 13, top: 15.4, height: 13, sides: 20 },
    ]
    // 每段塔身外面套一块屏，按这一段的棱台尺寸贴合、比实体大 0.5、比这一段矮 0.7：
    // 段与段之间露出塔身，屏的亮度也分段（腰段最暗），收腰的轮廓才立得住，不然整座塔是一根直筒。
    var zunScreenTiers = [
      { kind: 'wave', colorA: '#4fd0f0', colorB: '#7f6dff' },
      { kind: 'wave', colorA: '#2d84b4', colorB: '#4f52d0' },
      { kind: 'wave', colorA: '#1a4e68', colorB: '#282f86' },
      { kind: 'wave', colorA: '#42bce4', colorB: '#7d63ff' },
    ]
    var zunScreens = zunScreenTiers.map(function (spec) {
      var material = kit.mediaMaterial(THREE, spec)
      media.push(material)
      return material
    })
    zunTiers.forEach(function (tier, index) {
      var centerY = zunY + tier.height / 2
      var shell = new THREE.Mesh(kit.frustum(THREE, tier), zunMaterial)
      shell.position.y = centerY
      zun.add(shell)
      var skin = new THREE.Mesh(kit.frustum(THREE, {
        bottom: tier.bottom + 0.5, top: tier.top + 0.5, height: tier.height - 0.7, sides: tier.sides,
      }), zunScreens[index])
      skin.position.y = centerY
      zun.add(skin)
      zunY += tier.height
    })
    // 顶部一圈发光带、收口平台与天线：夜里认出这座塔靠的就是这一圈。
    var crownMaterial = new THREE.MeshBasicMaterial({ color: 0x9fe4ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
    var crownRing = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 8.5, 1.8, 20, 1, true), crownMaterial)
    crownRing.position.y = zunY - 1.4
    zun.add(crownRing)
    var deck = new THREE.Mesh(new THREE.BoxGeometry(10, 1.6, 10), zunMaterial)
    deck.position.y = zunY + 0.9
    zun.add(deck)
    var antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.42, 9, 6), zunMaterial)
    antenna.position.y = zunY + 5.8
    zun.add(antenna)
    group.add(zun)
    // 国贸三期：挺拔的方塔，顶面斜切，塔身横过一道亮带。居右，塔尖比中国尊高。
    var guomao = new THREE.Mesh(shearedTower(THREE, 30, 84, 28, 12), towerMaterial)
    guomao.position.set(34, 42, -84)
    group.add(guomao)
    // 三期塔身横过的亮带：四段断续的光，各段长短不一；整条亮到头上会变成一根横杠，压着看。
    var bandMaterial = new THREE.MeshBasicMaterial({
      color: 0x8fd8f0, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    })
    var bandSegments = [[-10.4, 6.4], [-2.6, 5.2], [4.6, 4.4], [11.2, 5.6]]
    bandSegments.forEach(function (segment) {
      var piece = new THREE.Mesh(new THREE.PlaneGeometry(segment[1], 1.1), bandMaterial)
      piece.position.set(34 + segment[0], 66, -69.85)
      group.add(piece)
    })
    // 三期朝镜头的一面整幅挂屏：夜里看得清图案，白天只是一面更深的玻璃；上缘留出亮带的位置。
    mediaPanel({ width: 22, height: 48, x: 34, y: 39, z: -69.4, kind: 'streak', colorA: '#2ea8ff', colorB: '#ff3d8f' })

    // 远景：两排高楼夹着更远的一圈，越远越密，只给体量与窗点，细节一概不留。
    var ringBoxes = []
    for (var r = 0; r < 74; r += 1) {
      var ringAngle = -Math.PI * 0.94 + random() * Math.PI * 0.88
      var ringRadius = 205 + random() * 145
      var ringWidth = 16 + random() * 22
      var ringHeight = 40 + random() * 92
      ringBoxes.push({
        x: Math.cos(ringAngle) * ringRadius,
        z: -120 + Math.sin(ringAngle) * ringRadius,
        w: ringWidth, d: ringWidth * (0.7 + random() * 0.5), h: ringHeight,
      })
    }
    for (var row = 0; row < 58; row += 1) {
      var rowX = -210 + random() * 420
      var rowHeight = (34 + random() * 58) * (0.6 + 0.7 * Math.max(0.25, 1 - Math.abs(rowX) / 250))
      var rowWidth = 12 + random() * 18
      ringBoxes.push({ x: rowX, z: -168 - random() * 62, w: rowWidth, d: rowWidth, h: rowHeight })
    }
    var skyline = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), farMaterial, ringBoxes.length)
    var skyTint = new THREE.Color()
    for (var b = 0; b < ringBoxes.length; b += 1) {
      var box = ringBoxes[b]
      matrix.makeScale(box.w, box.h, box.d)
      matrix.setPosition(box.x, box.h / 2, box.z)
      skyline.setMatrixAt(b, matrix)
      // 楼色压成雾里的青灰，远处不抢塔身的颜色。
      var distance = Math.sqrt(box.x * box.x + box.z * box.z) / 300
      skyTint.setRGB(0.2 + random() * 0.14, 0.23 + random() * 0.16, 0.3 + random() * 0.2)
      skyTint.multiplyScalar(1 - 0.35 * Math.min(1, distance))
      skyline.setColorAt(b, skyTint)
    }
    group.add(skyline)

    // 远景里整面亮着的媒体塔：屏幕的着色器按世界坐标取图、不读 `instanceMatrix`，这几栋只好单独成网格。
    var heroTowers = [
      { x: -96, z: -196, w: 20, h: 88, kind: 'wave', colorA: '#39d0ff', colorB: '#7a5cff' },
      { x: 4, z: -212, w: 24, h: 104, kind: 'grid', colorA: '#3ad0ff', colorB: '#ff3d9a' },
      { x: 92, z: -200, w: 18, h: 92, kind: 'streak', colorA: '#7cf3d0', colorB: '#2f7dff' },
      { x: -150, z: -228, w: 22, h: 70, kind: 'bars', colorA: '#ffb347', colorB: '#ff3d9a' },
    ]
    heroTowers.forEach(function (tower) {
      var material = kit.mediaMaterial(THREE, { kind: tower.kind, colorA: tower.colorA, colorB: tower.colorB })
      var body = new THREE.Mesh(new THREE.BoxGeometry(tower.w, tower.h, tower.w * 0.8), material)
      body.position.set(tower.x, tower.h / 2, tower.z)
      group.add(body)
      media.push(material)
    })

    // 近景：脚下这栋楼的屋顶。屋顶在镜头之下、朝镜头一侧一直铺出画面，远处被女儿墙截住，中景就从这个缺口里看过去。
    var roofMaterial = new THREE.MeshStandardMaterial({
      map: roofTexture(THREE, kit.seeded(404)), color: 0xd6dee9, roughness: 0.7, metalness: 0.26,
      emissive: new THREE.Color(0x1b2734), emissiveIntensity: 0.3,
    })
    var nearRoof = new THREE.Mesh(new THREE.BoxGeometry(164, 6, 96), roofMaterial)
    nearRoof.position.set(-38, 27.2, -22)
    group.add(nearRoof)
    // 屋顶上的设备：十六组机组、四台冷却塔、两处桅杆，近景的体积全靠它们。
    var plantMaterial = new THREE.MeshStandardMaterial({
      color: 0x49525f, roughness: 0.56, metalness: 0.52,
      emissive: new THREE.Color(0x1f2b38), emissiveIntensity: 0.2,
    })
    var plantBoxes = []
    for (var p = 0; p < 16; p += 1) {
      var plantWidth = 3 + random() * 7
      var plantHeight = 1.2 + random() * 2.6
      plantBoxes.push({
        w: plantWidth, h: plantHeight, d: 3 + random() * 6,
        x: -96 + random() * 118, y: 30.2 + plantHeight / 2, z: -58 + random() * 62,
      })
    }
    // 四台冷却塔：圆柱体，屋顶上的标志物。
    for (var fan = 0; fan < 4; fan += 1) {
      var fanX = -84 + fan * 26 + random() * 6
      var fanZ = -66 + random() * 24
      var housing = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 1.6, 12), plantMaterial)
      housing.position.set(fanX, 31.0, fanZ)
      group.add(housing)
      var fanRing = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.18, 12), crownMaterial)
      fanRing.position.set(fanX, 31.9, fanZ)
      group.add(fanRing)
    }
    group.add(new THREE.Mesh(kit.mergeBoxes(THREE, plantBoxes), plantMaterial))
    // 两处桅杆与横臂：近景的轮廓里要有直的东西，顶上的灯才有落脚处。
    var mastBoxes = [
      { w: 0.5, h: 24, d: 0.5, x: 24, y: 42, z: -34 },
      { w: 0.4, h: 17, d: 0.4, x: -62, y: 38.5, z: -52 },
      { w: 26, h: 0.6, d: 0.6, x: -8, y: 53.4, z: -34 },
      { w: 0.6, h: 0.6, d: 14, x: -62, y: 46.6, z: -52 },
    ]
    group.add(new THREE.Mesh(kit.mergeBoxes(THREE, mastBoxes), plantMaterial))
    // 女儿墙贴着屋顶三条边，压住中景的楼脚；顶上一道压顶，远处的屋顶排布才不会越界进来。
    var parapetBoxes = [
      { w: 164, h: 1.9, d: 1.1, x: -38, y: 32.1, z: -69.6 },
      { w: 1.1, h: 1.9, d: 96, x: -119.6, y: 32.1, z: -22 },
      { w: 1.1, h: 1.9, d: 96, x: 43.6, y: 32.1, z: -22 },
      { w: 164, h: 0.5, d: 1.5, x: -38, y: 33.3, z: -69.6 },
    ]
    group.add(new THREE.Mesh(kit.mergeBoxes(THREE, parapetBoxes), plantMaterial))
    // 屋顶边沿的暖光带：夜里女儿墙内侧的一条线，把近景与中景分开。
    var roofEdgeLight = new THREE.Mesh(new THREE.PlaneGeometry(160, 0.9), new THREE.MeshBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0.24, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
    roofEdgeLight.rotation.x = -Math.PI / 2
    roofEdgeLight.position.set(-38, 30.32, -68.6)
    group.add(roofEdgeLight)
    // 屋顶上的四摊灯：设备之间的暖色光摊开在混凝土上，机组才有影子与轮廓，不再是黑块。
    var roofGlowMaterial = new THREE.MeshBasicMaterial({
      map: api.dotTexture, color: 0xffb277, transparent: true, opacity: 0.26,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    })
    var roofGlowSpots = [[-58, -46, 74], [-12, -30, 64], [18, -54, 52], [-88, -60, 48]]
    roofGlowSpots.forEach(function (spot) {
      var pool = new THREE.Mesh(new THREE.PlaneGeometry(spot[2], spot[2] * 0.72), roofGlowMaterial)
      pool.rotation.x = -Math.PI / 2
      pool.position.set(spot[0], 30.26, spot[1])
      group.add(pool)
    })
    // 屋顶的检修灯：六盏挂在桅杆与机组边，俯瞰时靠它们读出屋顶的高度层次。
    var roofLampMaterial = new THREE.MeshBasicMaterial({ color: 0xffe4b8, toneMapped: false })
    var roofLamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.34, 0.42), roofLampMaterial, 6)
    var lampSpots = [[24, 42.4, -34], [-62, 38.6, -52], [-86, 31.2, -44], [-40, 31.2, -28], [4, 31.2, -62], [-16, 31.2, -46]]
    for (var lampIndex = 0; lampIndex < lampSpots.length; lampIndex += 1) {
      matrix.makeTranslation(lampSpots[lampIndex][0], lampSpots[lampIndex][1], lampSpots[lampIndex][2])
      roofLamps.setMatrixAt(lampIndex, matrix)
    }
    group.add(roofLamps)

    // 塔顶与屋顶的航空灯：几点慢慢眨的红，都落在已知的塔尖与楼顶。
    var beaconGeometry = new THREE.BufferGeometry()
    beaconGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -18, 68.4, -78, 34, 84.4, -84, -96, 88, -196, 4, 104, -212, 92, 92, -200, -150, 70, -228,
      -40, 45.4, -114, 92, 66, -102,
    ]), 3))
    var beacons = new THREE.Points(beaconGeometry, new THREE.PointsMaterial({
      map: api.dotTexture, color: 0xff4a3d, size: 2.4, sizeAttenuation: true,
      transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    group.add(beacons)
    // 近处的航空灯大一号，站在两处桅杆顶与右外墙沿上，画面下缘才有从屋顶看出去的那点红。
    var nearBeaconGeometry = new THREE.BufferGeometry()
    nearBeaconGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      24, 54.2, -34, -62, 47.2, -52, 43.6, 34.2, -22,
    ]), 3))
    var nearBeacons = new THREE.Points(nearBeaconGeometry, new THREE.PointsMaterial({
      map: api.dotTexture, color: 0xff3a2a, size: 5.2, sizeAttenuation: true,
      transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    group.add(nearBeacons)

    // 中景楼脚下的一点地面光：俯瞰时看不见街道，只看得见一圈圈暖色与冷色的晕。
    var plateGlow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: api.dotTexture, color: 0xffb066, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }), 9)
    var glowSpots = [[10, -92], [62, -80], [34, -112], [-74, -84], [-118, -96], [92, -102], [-52, -50], [52, -116], [-40, -114]]
    var glowMatrix = new THREE.Matrix4()
    var glowQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
    var glowScale = new THREE.Vector3()
    var glowPosition = new THREE.Vector3()
    for (var g = 0; g < glowSpots.length; g += 1) {
      glowPosition.set(glowSpots[g][0], 0.4, glowSpots[g][1])
      glowScale.set(46, 46, 1)
      glowMatrix.compose(glowPosition, glowQuat, glowScale)
      plateGlow.setMatrixAt(g, glowMatrix)
    }
    group.add(plateGlow)

    // 近处两栋矮楼顶上的暖色信标：屋顶到中景之间原本是一片空的，靠这两点在雾里补上纵深。
    var chimneys = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -140, 12, 30, -96, 34, 46, 60, 18, 20, 104, 26, -12, -160, 44, -40,
    ]), 3)), new THREE.PointsMaterial({
      map: api.dotTexture, color: 0xffd9a0, size: 2.6, sizeAttenuation: true,
      transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    group.add(chimneys)
    // 两处桅杆顶的对空闪光灯：帧里极慢地闪，俯瞰的屋顶才不呆板。
    var strobes = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      24, 54.9, -34, -62, 47.9, -52,
    ]), 3)), new THREE.PointsMaterial({
      map: api.dotTexture, color: 0xfff2d6, size: 3.2, sizeAttenuation: true,
      transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    group.add(strobes)
    // 屋顶设备之间的两点工作灯：暖色那盏照机组，冷色那盏勾女儿墙，屋顶面因此分出前后。
    var roofLight = new THREE.PointLight(0xffb980, 190, 150, 2)
    roofLight.position.set(-52, 34, -52)
    group.add(roofLight)
    var roofLightB = new THREE.PointLight(0x9fd6ff, 118, 120, 2)
    roofLightB.position.set(16, 36, -40)
    group.add(roofLightB)

    // 一层地平线薄雾：两块拉长的软光片，远楼的楼脚从这里长出去，天与地不硬接。
    var hazeMaterial = new THREE.MeshBasicMaterial({
      map: api.dotTexture, color: 0x6c88a8, transparent: true, opacity: 0.22,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    })
    var hazeLeft = new THREE.Mesh(new THREE.PlaneGeometry(760, 90), hazeMaterial)
    hazeLeft.position.set(-60, 22, -250)
    group.add(hazeLeft)
    var hazeRight = new THREE.Mesh(new THREE.PlaneGeometry(700, 70), hazeMaterial)
    hazeRight.position.set(120, 40, -300)
    group.add(hazeRight)

    // 落雪与闪电都由 `world.js` 按天气决定，覆盖天空会把它们一起改掉，所以这里不碰 `sky`；
    // 夜里那一轮月亮交给画面左上角这层暗，位置由 `rig` 每帧跟着镜头写。
    var veil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({
      map: cornerShadeTexture(THREE), transparent: true, opacity: 0.5,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }))
    group.add(veil)
    var nightMix = 0

    /** 暗角层按画面比例铺满：它离镜头六米，画面在那个距离上的半高就是六乘取景角的一半。 */
    function fitVeil(width, height) {
      var aspect = Math.max(0.4, width / Math.max(1, height))
      // `world.js` 在竖屏时把 fov 加十度，这里跟着同一套取景。
      var halfHeight = 6 * Math.tan((aspect < 0.9 ? 56 : 46) * Math.PI / 360)
      // 这层背对镜头（`lookAt` 把 +z 指向看向点），局部 x 要镜像过来，贴图左边才落在画面左边。
      veil.scale.set(-halfHeight * aspect, halfHeight, 1)
    }
    fitVeil(1, 1)

    return {
      id: 'beijing',
      group: group,
      // 轨道自己写相机位置，`camera` 只给出生值、竖屏加与取景范围用（`world.js` 读这几项）。
      camera: { height: 56, distance: 104, targetY: 48, fov: 46 },
      // 亮部交给窗灯、媒体立面与屋顶自己的灯：环境光抬起来，设备才不至于沉进黑色。
      look: { ambient: 0.86, exposure: 1.0, fog: 0.3, bloom: 0.55 },
      rig: makeRig(veil),
      setWeather: function (next) {
        weather = next.weather
        night = next.night
      },
      resize: function (width, height) {
        fitVeil(width, height)
      },
      update: function (dt, clock, palette) {
        // 昼夜按帧率无关的速率靠近：切换昼夜与换场景时，屏与灯不会跳一下。
        nightMix += ((night ? 1 : 0) - nightMix) * (1 - Math.exp(-dt * 2.6))
        // 夜里媒体立面最亮，窗灯只作底子；白天两座塔只剩体量，自发光几乎归零。
        var lit = nightMix * (0.55 + palette.windows * 0.45)
        for (var i = 0; i < media.length; i += 1) media[i].uniforms.uNight.value = nightMix
        zunMaterial.emissiveIntensity = 0.05 + lit * 0.9
        towerMaterial.emissiveIntensity = 0.08 + lit * 1.25
        farMaterial.emissiveIntensity = 0.06 + lit * 0.7
        crownMaterial.opacity = 0.22 + nightMix * 0.5 * (0.8 + 0.2 * Math.sin(clock * 1.9))
        // 屋顶与设备：夜里自己的自发光与两盏工作灯一起，读出机组的轮廓。
        roofMaterial.emissiveIntensity = 0.24 + nightMix * 0.5
        plantMaterial.emissiveIntensity = 0.14 + nightMix * 0.42
        roofGlowMaterial.opacity = 0.04 + nightMix * 0.3
        // 航空灯：远处几点慢闪；近处三点不同相、更慢一档，俯瞰时才不会整片屋顶一起眨眼。
        beacons.material.opacity = 0.28 + 0.62 * (0.5 + 0.5 * Math.sin(clock * 1.8))
        nearBeacons.material.opacity = 0.32 + 0.6 * (0.5 + 0.5 * Math.sin(clock * 1.3 + 0.7))
        chimneys.material.opacity = 0.2 + 0.34 * (0.5 + 0.5 * Math.sin(clock * 0.9))
        strobes.material.opacity = 0.12 + 0.6 * Math.pow(0.5 + 0.5 * Math.sin(clock * 2.7), 6)
        roofEdgeLight.material.opacity = 0.1 + nightMix * 0.44
        plateGlow.material.opacity = 0.05 + nightMix * 0.3
        // 亮带只到 0.34；暗角层夜里才叠，同时别再让它进阴影贴图。
        bandMaterial.opacity = 0.1 + nightMix * 0.24
        // 月亮精灵的亮度按天气走：晴夜最亮，阴雨夜里几乎看不见，暗角跟着一起收放。
        var moon = weather === 'clear' ? 0.8 : weather === 'cloudy' ? 0.58 : weather === 'snow' ? 0.5 : 0.4
        veil.material.opacity = nightMix * moon
        veil.castShadow = false
        roofLight.intensity = 40 + nightMix * 150
        roofLightB.intensity = 22 + nightMix * 96
        // 雨雪天雾更多，远景收到只留剪影；晴天的晨雾最薄，也是这座城最好看的时候。
        var murk = weather === 'rain' || weather === 'storm' ? 1.5 : weather === 'snow' ? 1.2 : 0.85
        hazeMaterial.opacity = (0.12 + nightMix * 0.1) * murk
      },
      dispose: function () {
        // 公共零件每次调用都新建几何与贴图、又没有释放入口，一并在这里收掉。
        group.traverse(function (object) {
          if (object.geometry) object.geometry.dispose()
          if (!object.material) return
          var materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach(function (material) {
            // `dotTexture` 是 `world.js` 的共用贴图，场景关掉时它还留着给下一个用。
            if (material.map && material.map !== api.dotTexture) material.map.dispose()
            if (material.emissiveMap && material.emissiveMap !== material.map) material.emissiveMap.dispose()
            material.dispose()
          })
        })
      },
    }
  }

  root.WxScenes = root.WxScenes || {}
  root.WxScenes.beijing = create
})(window)
