/*
 * 场景「上海」：站在外滩江边，隔着黄浦江看陆家嘴。
 *
 * 三层：下缘是石砌护栏、江边灯柱与近处的水面波纹；中段是整幅江面，映着对岸的灯；
 * 上部是东方明珠、上海中心、环球金融中心与金茂，背后压一排楼群剪影。
 * 镜头不走街道：`rig` 让机位沿江岸横移，看向点锁在三件套中段并做一次很慢的仰头。
 * 逐帧只改已有矩阵、材质强度与着色器均匀量，不在循环里造几何、材质与颜色（D7 的一份脚本）。
 */
;(function (root) {
  'use strict'

  var TAU = Math.PI * 2

  function create(THREE, api) {
    var kit = root.WxCityKit
    var group = new THREE.Group()
    var weather = 'cloudy'
    var night = false

    // 江岸在世界里的位置：x 沿江，z = BUND_Z 是护栏所在，江面朝 -z 铺到对岸。
    var BUND_Z = 0
    var WATER_Y = -0.35
    var FAR_BANK_Z = -62
    // 江岸地面比水面高出一截，护栏压在这个高度上：站在这条岸上，护栏正好压在画面下缘。
    var SHORE_Y = -1.0
    // 看向点：仰头时视线从塔基升到塔尖，就沿这一竖走。
    var FRAME_Z = FAR_BANK_Z - 20
    // 视线停在三件套的中段偏下：塔身占满画面中上部，江面落在下半。仰头只升到塔腰，再往上塔尖就出去了。
    var FRAME_Y = 16
    var FRAME_RISE = 30
    // 看向点横向跟随机位的比例：完全跟随，机位平移时塔群留在画面里的位置不动。
    var FRAME_SHARE = 1
    // 四座塔共用一个缩放：卡片最窄的 4:3 盒子里也排得下、互不遮挡；塔基压到水线以下，由对岸的岸线挡住。
    var TOWER_SCALE = 0.4
    var TOWER_Y = -5

    /** 江面用的水波法线：两条方向不同的正弦叠成高低起伏，平铺后看不出接缝。 */
    function waterNormal() {
      var size = 256
      var canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      var ctx = canvas.getContext('2d')
      var image = ctx.createImageData(size, size)
      var random = kit.seeded(3311)
      for (var y = 0; y < size; y += 1) {
        for (var x = 0; x < size; x += 1) {
          var u = x / size, v = y / size
          // 斜率：一条横向长波、一条斜向碎波，横条的倒影才被拉宽而不是打散。
          var slopeX = Math.cos((u * 3 + v * 1) * TAU) * 0.55 + Math.cos((u * 7 - v * 2) * TAU) * 0.25
          var slopeY = Math.sin((u * 3 + v * 1) * TAU) * 0.2 + Math.sin((u * 7 - v * 2) * TAU) * 0.16
          var length = Math.sqrt(slopeX * slopeX + slopeY * slopeY + 1)
          var offset = (y * size + x) * 4
          image.data[offset] = Math.round(((-slopeX / length) * 0.5 + 0.5) * 255)
          image.data[offset + 1] = Math.round(((-slopeY / length) * 0.5 + 0.5) * 255)
          image.data[offset + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255)
          image.data[offset + 3] = 255
        }
      }
      // 细碎的闪点：水面上几点跳动的碎光，尺寸小到不抢倒影。
      for (var dot = 0; dot < 90; dot += 1) {
        var dx = Math.floor(random() * size), dy = Math.floor(random() * size)
        var at = (dy * size + dx) * 4
        image.data[at] = 255
        image.data[at + 1] = Math.round(120 + random() * 60)
      }
      ctx.putImageData(image, 0, 0)
      var texture = new THREE.CanvasTexture(canvas)
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping
      texture.repeat.set(6, 4)
      return texture
    }

    /** 一条上下淡出的软光带：护栏灯、灯柱光晕这类贴近地面的光用它，免得画成一条实色横杠。 */
    function softBandTexture(color) {
      var canvas = document.createElement('canvas')
      canvas.width = 4
      canvas.height = 64
      var ctx = canvas.getContext('2d')
      var gradient = ctx.createLinearGradient(0, 64, 0, 0)
      gradient.addColorStop(0, 'rgba(0,0,0,0)')
      gradient.addColorStop(0.5, color)
      gradient.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, 4, 64)
      var texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      return texture
    }

    /** 江面倒影的底光：沿水深渐变的一张窄图，靠对岸最亮，两端淡出，平铺后不留硬边。 */
    function sheenTexture() {
      var size = 128
      var canvas = document.createElement('canvas')
      canvas.width = 4
      canvas.height = size
      var ctx = canvas.getContext('2d')
      var gradient = ctx.createLinearGradient(0, size, 0, 0)
      gradient.addColorStop(0, 'rgba(255,170,104,0)')
      gradient.addColorStop(0.42, 'rgba(255,178,112,0.3)')
      gradient.addColorStop(0.8, 'rgba(255,198,144,0.85)')
      gradient.addColorStop(1, 'rgba(255,214,170,0.1)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, 4, size)
      var texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      return texture
    }

    /** 石砌护栏用的石料：横向砌块与两道压顶缝，粗糙度跟着砌缝走。 */
    function stoneWallTextures() {
      var size = 256
      var canvas = document.createElement('canvas')
      var rough = document.createElement('canvas')
      canvas.width = canvas.height = rough.width = rough.height = size
      var ctx = canvas.getContext('2d')
      var rctx = rough.getContext('2d')
      var random = kit.seeded(4127)
      ctx.fillStyle = '#8b8577'
      ctx.fillRect(0, 0, size, size)
      rctx.fillStyle = '#c8c8c8'
      rctx.fillRect(0, 0, size, size)
      var rows = 5, courseH = size / rows
      for (var row = 0; row < rows; row += 1) {
        var offset = (row % 2) * courseH * 0.8
        for (var course = 0; course < 4; course += 1) {
          var x = offset + course * courseH * 1.6
          var shade = 128 + Math.round(random() * 34)
          ctx.fillStyle = 'rgb(' + shade + ',' + (shade - 6) + ',' + (shade - 18) + ')'
          ctx.fillRect(x + 2, row * courseH + 2, courseH * 1.6 - 4, courseH - 4)
        }
        // 砌缝：颜色压深，粗糙度抬高，光在缝里不反。
        ctx.fillStyle = 'rgba(44,40,34,0.55)'
        ctx.fillRect(0, row * courseH, size, 2.5)
        rctx.fillStyle = '#ffffff'
        rctx.fillRect(0, row * courseH, size, 2.5)
      }
      // 水汽熏出来的暗斑，越靠下越重。
      var gradient = ctx.createLinearGradient(0, size * 0.55, 0, size)
      gradient.addColorStop(0, 'rgba(28,32,30,0)')
      gradient.addColorStop(1, 'rgba(28,32,30,0.5)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, size, size)
      var map = new THREE.CanvasTexture(canvas), roughness = new THREE.CanvasTexture(rough)
      map.colorSpace = THREE.SRGBColorSpace
      map.wrapS = map.wrapT = roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping
      map.repeat.set(14, 1)
      roughness.repeat.set(14, 1)
      return { map: map, roughness: roughness }
    }

    var stoneWall = stoneWallTextures()

    // —— 近景：江岸、石砌护栏、灯柱 ——

    // 江岸铺面：一条从镜头底下伸到护栏的窄带，铺面比水面高，镜头压在它上方十米。
    var promenade = new THREE.Mesh(new THREE.PlaneGeometry(900, 62), new THREE.MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.82, metalness: 0.08 }))
    promenade.rotation.x = -Math.PI / 2
    promenade.position.set(0, SHORE_Y - 0.5, BUND_Z + 31)
    group.add(promenade)

    // 护栏：一道从水面接到压顶的砌石矮墙、一条压顶石、一排栏杆柱，全部合成一块几何。
    // 墙面比水面高出两米多：机位七米高，这道墙才在画面下缘占出一条实心的石带，而不是一道细线。
    var bundBoxes = []
    bundBoxes.push({ w: 700, h: 1.1, d: 1.4, x: 0, y: SHORE_Y + 1.15, z: BUND_Z })
    bundBoxes.push({ w: 700, h: 0.2, d: 1.5, x: 0, y: SHORE_Y + 1.8, z: BUND_Z })
    for (var post = -30; post <= 30; post += 1) {
      bundBoxes.push({ w: 0.34, h: 1, d: 0.34, x: post * 9, y: SHORE_Y + 1.1, z: BUND_Z })
    }
    var bundMaterial = new THREE.MeshStandardMaterial({
      map: stoneWall.map, roughnessMap: stoneWall.roughness, color: 0xe6e2d8, roughness: 0.82, metalness: 0.05,
    })
    var bundWall = new THREE.Mesh(kit.mergeBoxes(THREE, bundBoxes), bundMaterial)
    group.add(bundWall)

    // 栏杆柱顶的灯：一排小球，夜里连成下缘的一条光带；再罩一层加色光带，柱子之间也亮。
    var pillarCount = 61
    var pillarLights = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.26, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd9a4 }),
      pillarCount,
    )
    var scratchMatrix = new THREE.Matrix4()
    for (var pillar = 0; pillar < pillarCount; pillar += 1) {
      scratchMatrix.makeTranslation((pillar - 30) * 9, SHORE_Y + 1.75, BUND_Z)
      pillarLights.setMatrixAt(pillar, scratchMatrix)
    }
    group.add(pillarLights)
    var railGlowMaterial = new THREE.MeshBasicMaterial({ map: softBandTexture('#ffd9a4'), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false })
    var railGlow = new THREE.Mesh(new THREE.PlaneGeometry(760, 2.6), railGlowMaterial)
    railGlow.position.set(0, SHORE_Y + 1.75, BUND_Z + 0.8)
    group.add(railGlow)

    // 江边灯柱：六米高，立在护栏里侧，杆顶挑一盏灯，灯下的光晕是一枚贴片。
    // 机位会横移到 ±30，沿整条岸摆开，每个机位画面上都有两三根杆子从下缘伸进来。
    var lampPoles = []
    var lampGlows = []
    var glowGeometry = new THREE.PlaneGeometry(3.2, 3.2)
    for (var lampIndex = 0; lampIndex < 7; lampIndex += 1) {
      var lampX = -128 + lampIndex * 44
      lampPoles.push({ w: 0.3, h: 6, d: 0.3, x: lampX, y: SHORE_Y + 3, z: BUND_Z + 8 })
      lampPoles.push({ w: 2.6, h: 0.16, d: 0.16, x: lampX - 1.2, y: SHORE_Y + 5.9, z: BUND_Z + 8 })
      var lampGlow = new THREE.Mesh(glowGeometry, new THREE.MeshBasicMaterial({
        map: api.dotTexture, color: 0xffcf94, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
      }))
      lampGlow.position.set(lampX - 2.5, SHORE_Y + 5.75, BUND_Z + 7.9)
      group.add(lampGlow)
      lampGlows.push(lampGlow)
    }
    var poleMaterial = new THREE.MeshStandardMaterial({ color: 0x23282f, roughness: 0.55, metalness: 0.7 })
    group.add(new THREE.Mesh(kit.mergeBoxes(THREE, lampPoles), poleMaterial))

    // —— 中景：黄浦江 ——

    // 水面：一整块带法线贴图的金属面。镜头低，看到的多是掠射角，粗糙度压低才有对岸的反光。
    var waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x050c16, normalMap: waterNormal(), normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.24, metalness: 0.55, envMapIntensity: 0.16,
    })
    // 水面从护栏底下铺到对岸：机位收到岸前 41 个单位，水面再多铺一截就会漫到镜头脚下。
    var water = new THREE.Mesh(new THREE.PlaneGeometry(900, 160), waterMaterial)
    water.rotation.x = -Math.PI / 2
    water.position.set(0, WATER_Y, -79.5)
    water.receiveShadow = false
    group.add(water)

    // 倒影：一层贴着水面的发光带，加色混合，从对岸一直铺到镜头前；单靠反光条江面站不住。
    // 用一张沿水深渐变的贴图而不是平涂：靠对岸最亮，朝两头淡出，水面上才不留一道硬边。
    var sheenMaterial = new THREE.MeshBasicMaterial({ map: sheenTexture(), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
    var sheen = new THREE.Mesh(new THREE.PlaneGeometry(330, 58), sheenMaterial)
    sheen.rotation.x = -Math.PI / 2
    sheen.position.set(6, WATER_Y + 0.05, -36)
    group.add(sheen)

    // 横向反光条：一行行短横条，深浅冷暖交替。它们把倒影切成一段一段，水波打断倒影就靠这个。
    var stripRandom = kit.seeded(7717)
    var stripCount = 220
    var reflectionStrips = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
      stripCount,
    )
    reflectionStrips.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    var stripColors = [0xffb87a, 0xffd8a0, 0x9fd8ff, 0xff9ecb, 0xfff0c8, 0xffc7a0]
    var stripState = []
    var stripColor = new THREE.Color()
    var stripQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
    var stripScale = new THREE.Vector3()
    var stripPosition = new THREE.Vector3()
    var stripMatrix = new THREE.Matrix4()
    for (var strip = 0; strip < stripCount; strip += 1) {
      var stripZ = -5 - stripRandom() * 56
      stripState.push({
        x: -150 + stripRandom() * 300,
        z: stripZ,
        width: 8 + stripRandom() * 28,
        depth: 0.9 + stripRandom() * 1.8,
        phase: stripRandom() * TAU,
        // 近处的水面在画面下缘，反光条要更亮一档，江面才不是一条细线。
        boost: stripZ > -28 ? 1.5 : 1,
      })
      stripColor.setHex(stripColors[strip % stripColors.length])
      reflectionStrips.setColorAt(strip, stripColor)
    }
    group.add(reflectionStrips)

    // 过江的船：一只小船体，篷顶一盏灯，灯光在船尾拉出一条尾巴。
    var boats = []
    var boatHullGeometry = new THREE.BoxGeometry(9, 1.5, 3.2)
    var boatCabinGeometry = new THREE.BoxGeometry(4.2, 1.5, 2.4)
    var boatHullMaterial = new THREE.MeshStandardMaterial({ color: 0x161b22, roughness: 0.6, metalness: 0.4 })
    var boatLightMaterial = new THREE.MeshBasicMaterial({ color: 0xfff2c4 })
    var boatWakeMaterial = new THREE.MeshBasicMaterial({ color: 0xcfe4ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false })
    for (var boatIndex = 0; boatIndex < 2; boatIndex += 1) {
      var boat = new THREE.Group()
      boat.add(new THREE.Mesh(boatHullGeometry, boatHullMaterial))
      var cabin = new THREE.Mesh(boatCabinGeometry, boatHullMaterial)
      cabin.position.set(-0.6, 1.4, 0)
      boat.add(cabin)
      var boatLamp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), boatLightMaterial)
      boatLamp.position.set(-0.6, 2.5, 0)
      boat.add(boatLamp)
      var wake = new THREE.Mesh(new THREE.PlaneGeometry(16, 1.6), boatWakeMaterial)
      wake.rotation.x = -Math.PI / 2
      wake.position.set(-12, -0.7, 0)
      boat.add(wake)
      boat.position.set(-40 + boatIndex * 70, WATER_Y + 0.5, -30 - boatIndex * 16)
      group.add(boat)
      boats.push({ group: boat, speed: boatIndex === 0 ? 2.4 : -1.7 })
    }

    // —— 远景：三件套与陆家嘴楼群 ——

    /**
     * 东方明珠：三颗球由一根立柱串起来，下面两条斜腿张开落地，柱顶接一根天线。
     * 球与柱的比例按镜头百来个单位外能认出来定：球的间距要留出比球宽还长的一截柱子，
     * 否则三颗球挤成一串糖葫芦，读不出那座塔的骨架。骨架共用一份带自发光的钢，夜里也亮。
     */
    function orientalPearl() {
      var tower = new THREE.Group()
      var steel = new THREE.MeshStandardMaterial({ color: 0xa8b2c0, emissive: new THREE.Color(0x9fb6d4), emissiveIntensity: 0.06, roughness: 0.38, metalness: 0.85 })
      // 立柱：从下球底下一直顶到天线，三颗球都挂在它上面。
      var mast = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.8, 92, 10), steel)
      mast.position.y = 66
      tower.add(mast)
      var legGeometry = new THREE.CylinderGeometry(2.2, 4.2, 46, 8)
      for (var leg = 0; leg < 2; leg += 1) {
        var mesh = new THREE.Mesh(legGeometry, steel)
        mesh.position.set(leg === 0 ? -5.5 : 5.5, 23, 0)
        mesh.rotation.z = leg === 0 ? 0.14 : -0.14
        tower.add(mesh)
      }
      // 两根斜撑把腿与地面之间补成三角：腿细了才站得住，也才有那副张开的轮廓。
      var braceGeometry = new THREE.CylinderGeometry(1.2, 2.2, 58, 6)
      for (var brace = 0; brace < 2; brace += 1) {
        var strut = new THREE.Mesh(braceGeometry, steel)
        strut.position.set(brace === 0 ? -11 : 11, 26, 0)
        strut.rotation.z = brace === 0 ? 0.34 : -0.34
        tower.add(strut)
      }
      var orbMaterial = new THREE.MeshStandardMaterial({ color: 0x3a2f52, emissive: new THREE.Color(0x7b4cff), emissiveIntensity: 0.18, roughness: 0.34, metalness: 0.6 })
      var bandMaterial = new THREE.MeshBasicMaterial({ color: 0xb07bff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false })
      // 三颗球：下小球、中球、上球依次变大，球与球之间留出二十多个单位的立柱。
      var orbs = [{ radius: 8.4, y: 46 }, { radius: 10.2, y: 76 }, { radius: 12, y: 106 }]
      orbs.forEach(function (entry) {
        var orb = new THREE.Mesh(new THREE.SphereGeometry(entry.radius, 20, 16), orbMaterial)
        orb.position.y = entry.y
        tower.add(orb)
        var band = new THREE.Mesh(new THREE.TorusGeometry(entry.radius * 0.98, 0.42, 6, 28), bandMaterial)
        band.rotation.x = Math.PI / 2
        band.position.y = entry.y
        tower.add(band)
      })
      var spire = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 2.4, 18, 6), steel)
      spire.position.y = 121
      tower.add(spire)
      return { group: tower, orbs: orbMaterial, bands: bandMaterial, steel: steel }
    }

    /** 上海中心：四段圆台逐段旋拧、逐段收分，幕墙交给媒体立面，夜里它自己是块屏。 */
    function shanghaiTower(material) {
      var tower = new THREE.Group()
      var radii = [13.4, 11.8, 10.1, 8.4, 6.7]
      var twist = 0
      for (var i = 0; i < 4; i += 1) {
        var segment = new THREE.Mesh(kit.frustum(THREE, { bottom: radii[i], top: radii[i + 1], height: 36, sides: 16 }), material)
        segment.position.y = 18 + i * 36
        // 每段多转一点：接缝处的棱线连起来，塔身就是拧着的。
        twist += 0.24
        segment.rotation.y = twist
        tower.add(segment)
      }
      var crown = new THREE.Mesh(kit.frustum(THREE, { bottom: 6.7, top: 3.8, height: 14, sides: 16 }), material)
      crown.rotation.y = twist + 0.2
      crown.position.y = 151
      tower.add(crown)
      return { group: tower }
    }

    /** 环球金融中心：阶梯收分的塔身，顶上两条斜臂夹出「开瓶器」的洞，一道横梁封口。 */
    function worldFinancial() {
      var building = new THREE.Group()
      var bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x1d2b3c, emissive: new THREE.Color(0x2f6d9e), emissiveIntensity: 0.1, roughness: 0.3, metalness: 0.7 })
      var steps = []
      for (var step = 0; step < 5; step += 1) steps.push({ w: 36 - step * 2.9, h: 20.6, d: 15, x: 0, y: 10.3 + step * 20.6, z: 0 })
      building.add(new THREE.Mesh(kit.mergeBoxes(THREE, steps), bodyMaterial))
      var armGeometry = new THREE.BoxGeometry(5.5, 36, 15)
      for (var arm = 0; arm < 2; arm += 1) {
        var piece = new THREE.Mesh(armGeometry, bodyMaterial)
        piece.position.set(arm === 0 ? -9.8 : 9.8, 120, 0)
        piece.rotation.z = arm === 0 ? -0.2 : 0.2
        building.add(piece)
      }
      var beam = new THREE.Mesh(new THREE.BoxGeometry(17.8, 3.6, 15), bodyMaterial)
      beam.position.y = 138
      building.add(beam)
      return { group: building, body: bodyMaterial }
    }

    /**
     * 金茂大厦：八边形塔身逐段收分，顶上收成一根细针，颜色取一点香槟金。
     * 塔身比另外三座暗，夜里容易糊进天空；所以底色用浅一档的香槟石色，自发光抬起来。
     */
    function jinMao() {
      var tower = new THREE.Group()
      var material = new THREE.MeshStandardMaterial({ color: 0xc6b99c, emissive: new THREE.Color(0xffdfae), emissiveIntensity: 0.14, roughness: 0.52, metalness: 0.34 })
      var radii = [13, 11.4, 9.9, 8.5, 7.2, 5.6]
      for (var tier = 0; tier < 5; tier += 1) {
        var mesh = new THREE.Mesh(kit.frustum(THREE, { bottom: radii[tier], top: radii[tier + 1], height: 19.2, sides: 8 }), material)
        mesh.position.y = 9.6 + tier * 19.2
        tower.add(mesh)
      }
      var needle = new THREE.Mesh(kit.frustum(THREE, { bottom: 5.6, top: 0.6, height: 30, sides: 8 }), material)
      needle.position.y = 111
      tower.add(needle)
      return { group: tower, material: material }
    }

    // 塔身一块着色器材质给四段共用：一份 uniform 更新，四段一起亮。
    var towerMedia = kit.mediaMaterial(THREE, { kind: 'wave', colorA: '#6fd8ff', colorB: '#b47bff' })
    // 四座塔沿江排开：东方明珠偏左，金茂与金融中心居中，上海中心最高、偏右；前后错开一截。
    // x 与 z 按收紧后的机位（z 41–55、fov 42）重排：东方明珠整座落在左下温度文字右边，
    // 上海中心不压右侧天气图标，金茂站在两者的空档里，谁也不挡谁。
    var pearl = orientalPearl()
    pearl.group.position.set(-20, TOWER_Y, -74)
    pearl.group.scale.setScalar(TOWER_SCALE)
    group.add(pearl.group)
    var shanghai = shanghaiTower(towerMedia)
    shanghai.group.position.set(42, TOWER_Y, -100)
    shanghai.group.scale.setScalar(TOWER_SCALE)
    group.add(shanghai.group)
    var financial = worldFinancial()
    financial.group.position.set(16, TOWER_Y, -88)
    financial.group.scale.setScalar(TOWER_SCALE)
    group.add(financial.group)
    var jinmao = jinMao()
    jinmao.group.position.set(-4, TOWER_Y, -80)
    jinmao.group.scale.setScalar(TOWER_SCALE)
    group.add(jinmao.group)

    // 对岸楼群：贴着江的一道密排，越远越低，夜里只剩剪影与前面的窗灯。
    // 三件套那几段留空，剪影不去跟塔身抢轮廓。
    var skylineBoxes = []
    var skylineRandom = kit.seeded(616)
    for (var block = 0; block < 50; block += 1) {
      var blockX = -350 + block * 14 + skylineRandom() * 6
      if (blockX > -30 && blockX < 98) continue
      var blockHeight = 12 + skylineRandom() * 34
      skylineBoxes.push({
        w: 9 + skylineRandom() * 12, h: blockHeight, d: 9, x: blockX,
        y: blockHeight / 2 + TOWER_Y, z: FAR_BANK_Z - 6 - skylineRandom() * 16,
      })
    }
    group.add(new THREE.Mesh(kit.mergeBoxes(THREE, skylineBoxes), new THREE.MeshStandardMaterial({ color: 0x0e1724, roughness: 0.9, metalness: 0.1 })))

    // 对岸的岸线：一条压在水面上的浅色石带，水面与楼群之间才有交界。
    var farBank = new THREE.Mesh(new THREE.PlaneGeometry(700, 4.5), new THREE.MeshStandardMaterial({ color: 0x222a33, roughness: 0.75, metalness: 0.15 }))
    farBank.rotation.x = -Math.PI / 2
    farBank.position.set(0, WATER_Y + 0.12, FAR_BANK_Z + 1)
    group.add(farBank)

    // 窗灯：撒在楼群前面的一层光点，加色混合，白天几乎看不见。
    var farPositions = []
    var farRandom = kit.seeded(909)
    for (var light = 0; light < 130; light += 1) farPositions.push(-225 + farRandom() * 450, 3 + farRandom() * 30, FAR_BANK_Z - 4 - farRandom() * 18)
    var farGeometry = new THREE.BufferGeometry()
    farGeometry.setAttribute('position', new THREE.Float32BufferAttribute(farPositions, 3))
    var farPoints = new THREE.Points(farGeometry, new THREE.PointsMaterial({
      map: api.dotTexture, color: 0xffcf9a, size: 1.6, sizeAttenuation: true,
      transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    group.add(farPoints)

    var lampWarm = new THREE.PointLight(0xffc98a, 22, 44, 2)
    lampWarm.position.set(24, SHORE_Y + 5.6, BUND_Z + 8)
    group.add(lampWarm)

    var nightMix = 0

    // 轨道：机位离护栏四十来个单位、七米高，沿江岸慢慢横移（±12）并前后溜（41–55），看向点跟着平移。
    // 40 秒一次的仰头让视线从塔基升到塔腰再回落；横移与仰头共用相位 `pan`（240 秒一圈），走完一程再倒回来。
    // `t` 由 `world.js` 给（`still` 时为 0，此刻机位最近、视线压在塔基，塔身撑满中上部、江面与护栏占下半）。
    function rig(t, position, target) {
      var pan = t * (TAU / 240)
      var lift = 0.5 - 0.5 * Math.cos(t * (TAU / 40))
      var sway = Math.sin(pan)
      var push = Math.cos(pan)
      position.set(
        sway * 12,
        7 + (1 - push) * 0.9 + Math.sin(t * 0.07) * 0.3,
        BUND_Z + 48 - push * 7
      )
      target.set(sway * 12 * FRAME_SHARE, FRAME_Y + lift * FRAME_RISE + Math.sin(t * 0.05) * 0.8, FRAME_Z)
    }

    return {
      id: 'shanghai',
      group: group,
      camera: { height: 8, distance: 48, targetY: 24, fov: 42 },
      look: { ambient: 0.44, exposure: 0.94, fog: 0.62, bloom: 0.44 },
      setWeather: function (next) {
        weather = next.weather
        night = next.night
        // 雨雪天江面更碎更糙，倒影散得更开；其余天气回到偏镜面的水面。
        var wet = weather === 'rain' || weather === 'storm'
        waterMaterial.roughness = wet ? 0.34 : 0.16
        waterMaterial.normalScale.setScalar(wet ? 1.0 : 0.55)
      },
      rig: rig,
      resize: function () {},
      update: function (dt, clock, palette) {
        // 昼夜按帧率无关的速度过渡，材质强度才有渐变而不是一跳。
        nightMix += ((night ? 1 : 0) - nightMix) * Math.min(1, dt * 2.2)
        towerMedia.uniforms.uTime.value = clock
        towerMedia.uniforms.uNight.value = nightMix
        pearl.orbs.emissiveIntensity = 0.16 + nightMix * 0.9
        pearl.bands.opacity = 0.16 + nightMix * 0.62
        pearl.steel.emissiveIntensity = 0.06 + nightMix * 0.6
        financial.body.emissiveIntensity = 0.08 + nightMix * 0.5
        jinmao.material.emissiveIntensity = 0.14 + nightMix * 0.72
        farPoints.material.opacity = 0.12 + nightMix * 0.8
        lampWarm.intensity = 4 + nightMix * 12
        pillarLights.material.color.setRGB(0.5 + nightMix * 0.5, 0.4 + nightMix * 0.57, 0.3 + nightMix * 0.56)
        railGlowMaterial.opacity = 0.03 + nightMix * (0.34 + 0.05 * Math.sin(clock * 1.1))

        // 灯柱的光晕：白天只是一点暗光，夜里张开。
        for (var glow = 0; glow < lampGlows.length; glow += 1) {
          lampGlows[glow].material.opacity = 0.06 + nightMix * (0.62 + 0.12 * Math.sin(clock * 1.7 + glow * 1.3))
          // 光晕始终正对镜头：贴片绕 y 转，掠射角才不把它压成一条线。
          lampGlows[glow].rotation.y = Math.atan2(BUND_Z + 86 - lampGlows[glow].position.z, -lampGlows[glow].position.x)
        }

        // 倒影：整条光带的亮度随夜色与水面一起起伏，贴片缓慢摆动。
        waterMaterial.normalMap.offset.x = clock * 0.004
        waterMaterial.normalMap.offset.y = -clock * 0.011
        sheenMaterial.opacity = 0.1 + nightMix * 0.5
        sheen.position.z = -36 + Math.sin(clock * 0.11) * 4
        sheen.scale.x = 1 + Math.sin(clock * 0.09) * 0.08

        // 横向反光条：每条按自己的相位横向漂一点、亮度呼吸一下，倒影看起来是被水波打断的。
        for (var s = 0; s < stripCount; s += 1) {
          var entry = stripState[s]
          var sway = entry.x + Math.sin(clock * 0.26 + entry.phase) * 1.6
          stripPosition.set(sway, WATER_Y + 0.04 + (s % 7) * 0.006, entry.z + Math.sin(clock * 0.14 + entry.phase) * 0.8)
          stripScale.set(entry.width * (1 + 0.14 * Math.sin(clock * 0.9 + entry.phase)), entry.depth, 1)
          stripMatrix.compose(stripPosition, stripQuat, stripScale)
          reflectionStrips.setMatrixAt(s, stripMatrix)
          stripColor.setHex(stripColors[s % stripColors.length])
          reflectionStrips.setColorAt(s, stripColor.multiplyScalar((0.16 + nightMix * (0.66 + 0.26 * Math.sin(clock * 1.9 + entry.phase))) * entry.boost))
        }
        reflectionStrips.instanceMatrix.needsUpdate = true
        reflectionStrips.instanceColor.needsUpdate = true
        reflectionStrips.material.opacity = 0.18 + nightMix * 0.7

        // 船：沿江横过，出画就从另一头回来；船身随水轻轻起伏，船灯的尾巴跟着晃。
        for (var b = 0; b < boats.length; b += 1) {
          var boat = boats[b]
          boat.group.position.x += boat.speed * dt
          if (boat.group.position.x > 190) boat.group.position.x = -190
          if (boat.group.position.x < -190) boat.group.position.x = 190
          boat.group.rotation.z = Math.sin(clock * 0.9 + b * 2) * 0.014
          boat.group.position.y = WATER_Y + 0.5 + Math.sin(clock * 0.8 + b) * 0.06
        }
      },
      dispose: function () {
        group.traverse(function (object) {
          if (object.geometry) object.geometry.dispose()
          if (!object.material) return
          var materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach(function (material) {
            // `api.dotTexture` 是 world.js 的，由它自己释放，这里碰了会让雨雪重传一遍。
            if (material.map && material.map !== api.dotTexture) material.map.dispose()
            if (material.emissiveMap && material.emissiveMap !== material.map) material.emissiveMap.dispose()
            if (material.roughnessMap) material.roughnessMap.dispose()
            if (material.normalMap) material.normalMap.dispose()
            material.dispose()
          })
        })
      },
    }
  }

  root.WxScenes = root.WxScenes || {}
  root.WxScenes.shanghai = create
})(window)
