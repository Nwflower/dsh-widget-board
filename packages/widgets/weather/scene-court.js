/*
 * 场景「中式庭院」：粉墙月洞门、瓦檐、朱红廊柱与灯笼，右侧一株树，左侧一块太湖石。
 * 与其它场景同一个形状，天空、雾、雨雪与镜头都由 `world.js` 负责。质感来自三张现画的贴图：
 * 粉墙的颜色与斑驳、瓦垄的凹凸、石板的颜色与缝隙粗糙度。
 */
;(function (root) {
  'use strict'

  // 画贴图用的固定种子随机序列：同一张卡每次重开都是同一面墙、同一片瓦。粉墙的细裂纹由 cracks 画：竖向的折线，加了它近看才不像一块塑料板。
  function seeded(seed) {
    var state = seed >>> 0
    return function () {
      state = (state * 1664525 + 1013904223) >>> 0
      return state / 4294967296
    }
  }

  /**
   * 一张空白画布与它的贴图。颜色贴图按 sRGB 解释，data 为真的凹凸、粗糙度图留在线性空间，
   * 否则起伏会被 gamma 拉平一半；wide 为真时左右两向平铺，瓦垄只沿一个方向重复。
   */
  function canvasOf(THREE, size, data, wide) {
    var canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    var texture = new THREE.CanvasTexture(canvas)
    if (!data) texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    if (wide) texture.wrapT = THREE.RepeatWrapping
    return { canvas: canvas, ctx: canvas.getContext('2d'), texture: texture }
  }

  function cracks(ctx, random, count) {
    ctx.strokeStyle = 'rgba(88,86,80,0.08)'
    ctx.lineWidth = 0.6
    for (var i = 0; i < count; i += 1) {
      var x = random() * 256
      var y = random() * 256
      ctx.beginPath()
      ctx.moveTo(x, y)
      for (var k = 0; k < 4; k += 1) {
        x += (random() - 0.5) * 10
        y += 6 + random() * 10
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }

  /** 粉墙：灰白底上叠细颗粒、返潮的水渍、竖向雨痕与细裂纹，同一张图兼作凹凸。 */
  function wallTexture(THREE) {
    var sheet = canvasOf(THREE, 256, false, true)
    var ctx = sheet.ctx
    var random = seeded(7)
    ctx.fillStyle = '#d3cec3'
    ctx.fillRect(0, 0, 256, 256)
    for (var i = 0; i < 2400; i += 1) {
      ctx.fillStyle = 'rgba(96,92,84,0.06)'
      if (random() > 0.5) ctx.fillStyle = 'rgba(255,255,255,0.07)'
      ctx.fillRect(random() * 256, random() * 256, 2 + random() * 2, 2)
    }
    // 墙根返潮：越靠下越湿，颜色往下压，光打上去才有一层深色的潮脚。
    for (var y = 150; y < 256; y += 1) {
      ctx.fillStyle = 'rgba(120,124,118,' + ((y - 150) / 106 * 0.16).toFixed(3) + ')'
      ctx.fillRect(0, y, 256, 1)
    }
    // 雨痕：从檐口往下拖的淡色竖条，长短不一。
    ctx.fillStyle = 'rgba(108,106,98,0.08)'
    for (var s = 0; s < 10; s += 1) {
      ctx.fillRect(random() * 256, 0, 1 + random() * 2, 60 + random() * 150)
    }
    cracks(ctx, random, 10)
    sheet.texture.repeat.set(3.4, 1.6)
    return sheet
  }

  /** 瓦面：一条条瓦垄的明暗与苔痕，凹凸贴图用同一套条纹，让高光在垄上滚。 */
  function tileTexture(THREE) {
    var sheet = canvasOf(THREE, 128, false, true)
    var ctx = sheet.ctx
    var random = seeded(31)
    ctx.fillStyle = '#23262b'
    ctx.fillRect(0, 0, 128, 128)
    for (var x = 0; x < 128; x += 1) {
      // 十六像素一个周期、半个周期的余弦：垄心亮、垄沟暗，凹凸贴图读的是这张图的亮度。
      var shade = 0.5 + 0.5 * Math.cos(((x % 16) / 16) * Math.PI * 2)
      ctx.fillStyle = 'rgb(' + Math.round(28 + shade * 62) + ',' + Math.round(30 + shade * 66) + ',' + Math.round(35 + shade * 70) + ')'
      ctx.fillRect(x, 0, 1, 128)
    }
    // 苔痕与积垢：偶尔一片绿，别的地方一片灰。
    for (var i = 0; i < 90; i += 1) {
      ctx.fillStyle = random() > 0.72 ? 'rgba(110,116,86,0.18)' : 'rgba(70,74,82,0.2)'
      ctx.beginPath()
      ctx.ellipse(random() * 128, random() * 128, 2 + random() * 6, 1 + random() * 3, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    sheet.texture.repeat.set(12, 1)
    return sheet
  }

  /** 青石板：错缝的板面、板缝、磨痕与水渍；粗糙度图里缝是白的，再湿的水也先显出缝。 */
  function pavingTexture(THREE) {
    var sheet = canvasOf(THREE, 256, false, true)
    var rough = canvasOf(THREE, 256, true, true)
    var ctx = sheet.ctx
    var rctx = rough.ctx
    var random = seeded(23)
    rctx.fillStyle = '#969696'
    rctx.fillRect(0, 0, 256, 256)
    ctx.fillStyle = '#333942'
    ctx.fillRect(0, 0, 256, 256)
    var cell = 256 / 6
    // 每行左右各多铺一块，也铺到下一行去，接缝处才看不出来。
    for (var row = -1; row < 7; row += 1) {
      for (var column = -1; column < 7; column += 1) {
        var x = column * cell + (row % 2 === 0 ? 0 : cell / 2)
        var y = row * cell
        var grey = Math.round(78 + random() * 26)
        ctx.fillStyle = 'rgb(' + grey + ',' + (grey + 4) + ',' + (grey + 10) + ')'
        ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4)
        rctx.fillRect(x + 2, y + 2, cell - 4, cell - 4)
      }
    }
    // 水渍：板面上几团更暗的湿斑，与磨痕的亮线一起把板面分成几块。
    ctx.fillStyle = 'rgba(30,36,44,0.16)'
    for (var w = 0; w < 14; w += 1) {
      ctx.beginPath()
      ctx.ellipse(random() * 256, random() * 256, 8 + random() * 18, 5 + random() * 12, random() * Math.PI, 0, Math.PI * 2)
      ctx.fill()
    }
    // 磨痕：板面上几道很淡的亮线，湿了以后正是水光拉开的地方。
    ctx.strokeStyle = 'rgba(190,196,205,0.07)'
    ctx.lineWidth = 1
    for (var k = 0; k < 18; k += 1) {
      ctx.beginPath()
      ctx.moveTo(random() * 256, random() * 256)
      ctx.lineTo(random() * 256, random() * 256)
      ctx.stroke()
    }
    sheet.texture.repeat.set(5, 5)
    rough.texture.repeat.set(5, 5)
    return { map: sheet.texture, roughness: rough.texture }
  }

  /**
   * 太湖石：面数低、起伏深，离卡片的字也远。二十面体按顶点位置抖动，同位置的重复顶点得到同一个量，面才不会裂开；
   * 两个频率叠出深凹的孔，法线平滑后是连续起伏而不是一排尖角。
   */
  function stoneGeometry(THREE) {
    var geometry = new THREE.IcosahedronGeometry(1.6, 1)
    var position = geometry.attributes.position
    for (var i = 0; i < position.count; i += 1) {
      var x = position.getX(i)
      var y = position.getY(i)
      var z = position.getZ(i)
      var wobble = 0.74 + Math.abs(Math.sin(x * 3.1 + y * 5.7 + z * 4.3)) * 0.34 + Math.abs(Math.sin(x * 11 + z * 9)) * 0.16
      position.setXYZ(i, x * wobble, y * wobble * 1.4, z * wobble)
    }
    geometry.computeVertexNormals()
    return geometry
  }

  /** 建一整个院子，交回按帧调用的几个函数。贴图登记在 owned 里：dispose 逐个释放，api.dotTexture 归调用方。 */
  function create(THREE, api) {
    var group = new THREE.Group()
    var weather = 'cloudy'
    var night = false
    var lanternEnergy = 0.55
    var lanterns = []
    var lanternLights = []
    var lanternGlows = []
    var owned = []
    // 摆位用的临时对象只建一次，构造期与帧循环都复用。
    var tileMatrix = new THREE.Matrix4()
    var tilePosition = new THREE.Vector3()
    var tileQuaternion = new THREE.Quaternion()
    var tileAligned = new THREE.Vector3(1, 1, 1)

    // 地面：整座院子的青石板。颜色与粗糙度分两张，湿地降低整个材质的粗糙度时缝仍然比板面粗。
    var paving = pavingTexture(THREE)
    owned.push(paving.map, paving.roughness)
    var groundMaterial = new THREE.MeshStandardMaterial({ map: paving.map, roughnessMap: paving.roughness, color: 0xb8bec8, roughness: 0.7, metalness: 0.12 })
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), groundMaterial)
    ground.rotation.x = -Math.PI / 2
    group.add(ground)
    // 粉墙与月洞门：矩形挖掉一个圆，挤出厚度；门后是下一进院子，洞里不能是一块死黑。门洞多给些分段，石券压在弧上才没有折线。
    var wallShape = new THREE.Shape()
    wallShape.moveTo(-21, 0)
    wallShape.lineTo(21, 0)
    wallShape.lineTo(21, 13)
    wallShape.lineTo(-21, 13)
    wallShape.holes.push(new THREE.Path().absarc(0, 4.5, 3.15, 0, Math.PI * 2, true))
    var wallSheet = wallTexture(THREE)
    owned.push(wallSheet.texture)
    var wallMaterial = new THREE.MeshStandardMaterial({ map: wallSheet.texture, bumpMap: wallSheet.texture, bumpScale: 0.6, color: 0xe4dfd4, roughness: 0.94, metalness: 0.02 })
    var wall = new THREE.Mesh(new THREE.ExtrudeGeometry(wallShape, { depth: 1.2, bevelEnabled: false, curveSegments: 48 }), wallMaterial)
    wall.position.z = -16.2
    var inner = new THREE.Mesh(new THREE.PlaneGeometry(18, 15), new THREE.MeshStandardMaterial({ color: 0x151820, roughness: 1, metalness: 0 }))
    inner.position.set(0, 6.4, -21)
    var silhouette = new THREE.Mesh(new THREE.BoxGeometry(9.4, 1.1, 1.2), new THREE.MeshStandardMaterial({ color: 0x101319, roughness: 1 }))
    silhouette.position.set(0, 8.6, -19.2)
    var innerLamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffd2a0, emissive: 0xffa250, emissiveIntensity: 1.4, roughness: 0.6 }))
    var innerGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: api.dotTexture, color: 0xffb070, transparent: true, opacity: 0.42, depthWrite: false, blending: THREE.AdditiveBlending }))
    innerGlow.scale.set(4.6, 4.6, 1)
    innerGlow.position.copy(innerLamp.position)
    group.add(wall, inner, silhouette, innerLamp, innerGlow)
    // 石阶两级、一级比一级窄，连同门套共用一份青石材质；门洞外一圈石券加一道只放大一圈的细线脚（线脚共用石券的几何）。
    var stoneMaterial = new THREE.MeshStandardMaterial({ color: 0x6d737c, roughness: 0.84, metalness: 0.08 })
    var stepDepths = [3.4, 2.2]
    for (var st = 0; st < 2; st += 1) {
      var step = new THREE.Mesh(new THREE.BoxGeometry(43, st === 0 ? 0.2 : 0.4, stepDepths[st]), stoneMaterial)
      step.position.set(0, st === 0 ? 0.1 : 0.2, st === 0 ? -13.6 : -15.1)
      group.add(step)
    }
    var arch = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.2, 8, 48), stoneMaterial)
    arch.position.set(0, 4.5, -14.94)
    var band = new THREE.Mesh(arch.geometry, stoneMaterial)
    band.position.set(0, 4.5, -15.03)
    band.scale.setScalar(1.1)
    group.add(arch, band)    // 两侧的院墙与它们的瓦檐：从粉墙往镜头这边收，院子才是围起来的。
    var tileSheet = tileTexture(THREE)
    owned.push(tileSheet.texture)
    var tileMaterial = new THREE.MeshStandardMaterial({ map: tileSheet.texture, bumpMap: tileSheet.texture, bumpScale: 0.8, color: 0x9aa0aa, roughness: 0.7, metalness: 0.2 })
    var sideMaterial = new THREE.MeshStandardMaterial({ map: wallSheet.texture, bumpMap: wallSheet.texture, bumpScale: 0.6, color: 0xd6d1c6, roughness: 0.95, metalness: 0.02 })
    var sideGeometry = new THREE.BoxGeometry(1.4, 11, 26)
    var sideEaveGeometry = new THREE.BoxGeometry(3.4, 0.5, 26)
    for (var s = 0; s < 2; s += 1) {
      var side = new THREE.Mesh(sideGeometry, sideMaterial)
      side.position.set(s === 0 ? -20.5 : 20.5, 5.5, -3)
      var sideEave = new THREE.Mesh(sideEaveGeometry, tileMaterial)
      sideEave.position.set(side.position.x, 11.15, -3)
      group.add(side, sideEave)
    }
    // 墙顶的瓦檐：外挑的扁盒当屋面，瓦垄与檐口的瓦当、滴水都用实例化小构件，比真瓦便宜得多。
    // 瓦当正对镜头，滴水错开半垄挂在檐口下沿；实例的摆位借用顶上的临时矩阵。
    var eave = new THREE.Mesh(new THREE.BoxGeometry(43.6, 0.55, 3.8), tileMaterial)
    eave.position.set(0, 13.3, -15.6)
    var ridge = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 0.17, 3.7), tileMaterial, 46)
    var tileEnd = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.15, 0.12, 8), tileMaterial, 46)
    var drip = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.26, 0.1), tileMaterial, 46)
    tileQuaternion.setFromEuler(new THREE.Euler(-Math.PI / 2.4, 0, 0))
    for (var t = 0; t < 46; t += 1) {
      var ridgeX = -21.4 + t * 0.95
      ridge.setMatrixAt(t, tileMatrix.makeTranslation(ridgeX, 13.66, -15.6))
      tileEnd.setMatrixAt(t, tileMatrix.compose(tilePosition.set(ridgeX, 13.42, -13.68), tileQuaternion, tileAligned))
      drip.setMatrixAt(t, tileMatrix.makeTranslation(ridgeX + 0.47, 13.22, -13.72))
    }
    ridge.instanceMatrix.needsUpdate = tileEnd.instanceMatrix.needsUpdate = drip.instanceMatrix.needsUpdate = true
    group.add(eave, ridge, tileEnd, drip)

    // 廊下两根朱红柱子，柱间一道深色额枋；枋下挂挂落、柱头配雀替，檐口才有阴影可依。
    var columnGeometry = new THREE.CylinderGeometry(0.4, 0.5, 11, 12)
    var columnMaterial = new THREE.MeshStandardMaterial({ color: 0x9c3a2b, roughness: 0.55, metalness: 0.06 })
    for (var c = 0; c < 2; c += 1) {
      var column = new THREE.Mesh(columnGeometry, columnMaterial)
      column.position.set(c === 0 ? -6.4 : 6.4, 5.5, -9.4)
      group.add(column)
    }
    var beam = new THREE.Mesh(new THREE.BoxGeometry(13.6, 0.7, 0.9), new THREE.MeshStandardMaterial({ color: 0x3a2b24, roughness: 0.8, metalness: 0.05 }))
    var latticeMaterial = new THREE.MeshStandardMaterial({ color: 0x4a352a, roughness: 0.85, metalness: 0.04 })
    var latticeRail = new THREE.Mesh(new THREE.BoxGeometry(12, 0.09, 0.09), latticeMaterial)
    latticeRail.position.set(0, 9.95, -9.4)
    var slat = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.32, 0.07), latticeMaterial, 22)
    for (var sl = 0; sl < 22; sl += 1) {
      slat.setMatrixAt(sl, tileMatrix.makeTranslation(-5.7 + sl * 0.54, 9.75, -9.4))
    }
    slat.instanceMatrix.needsUpdate = true
    group.add(latticeRail, slat, beam)
    // 雀替：斜在柱头内侧的两块小斗拱，挂在额枋与柱子的交接处；挂落是横杆加下垂的短条。
    var bracketGeometry = new THREE.BoxGeometry(1.5, 0.3, 0.5)
    for (var br = 0; br < 2; br += 1) {
      var bracket = new THREE.Mesh(bracketGeometry, latticeMaterial)
      bracket.position.set(br === 0 ? -5.6 : 5.6, 10.1, -9.4)
      bracket.rotation.z = br === 0 ? 0.32 : -0.32
      group.add(bracket)
    }
    // 灯笼：自发光椭球加一盏暖色点光，全场就这两盏点光。挂点靠柱子，月洞门与上方的天空留出来；
    // 灯脚离粉墙五米多，光衰减下去时墙上正好留下一圈由亮到暗的暖斑。
    var lanternMaterial = new THREE.MeshStandardMaterial({ color: 0x7d2418, emissive: 0xffa25a, emissiveIntensity: 1.2, roughness: 0.58, metalness: 0.04 })
    var lanternGeometry = new THREE.SphereGeometry(0.82, 16, 12)
    var cordMaterial = new THREE.MeshStandardMaterial({ color: 0x241915, roughness: 0.9 })
    var cordGeometry = new THREE.CylinderGeometry(0.035, 0.035, 2.6, 6)
    for (var l = 0; l < 2; l += 1) {
      var lantern = new THREE.Group()
      lantern.position.set(l === 0 ? -5 : 5, 9.9, -8.2)
      var cord = new THREE.Mesh(cordGeometry, cordMaterial)
      cord.position.y = -1.3
      var body = new THREE.Mesh(lanternGeometry, lanternMaterial)
      body.scale.set(1, 1.22, 1)
      var glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: api.dotTexture, color: 0xffb070, transparent: true, opacity: 0.36, depthWrite: false, blending: THREE.AdditiveBlending }))
      glow.scale.set(6.4, 6.4, 1)
      var light = new THREE.PointLight(0xffb070, 8, 40, 2)
      light.position.set(0, -3.1, -0.6)
      body.position.y = glow.position.y = -3.1
      lantern.add(cord, body, glow, light)
      group.add(lantern)
      lanterns.push(lantern)
      lanternLights.push(light)
      lanternGlows.push(glow)
    }

    // 右侧的树：直干顶上分两杈，五簇墨绿球冠挂在一个组上，风来时整簇一起晃。
    var trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x3b3029, roughness: 0.95, metalness: 0.02 })
    var canopyMaterial = new THREE.MeshStandardMaterial({ color: 0x2c4033, roughness: 0.9, metalness: 0.02 })
    var blobs = [[0, 0.9, 0, 2.5], [-2.2, 0.1, 0.5, 1.8], [2, 0.2, -0.4, 1.9], [-1, 2.1, -0.3, 1.7], [1.3, 1.9, 0.6, 1.5]]
    var canopy = new THREE.Group()
    canopy.position.set(13.2, 8.4, -4)
    var canopyGeometry = new THREE.SphereGeometry(1, 12, 9)
    var branchGeometry = new THREE.CylinderGeometry(0.09, 0.2, 3.6, 7)
    for (var bl = 0; bl < blobs.length; bl += 1) {
      var blob = new THREE.Mesh(canopyGeometry, canopyMaterial)
      blob.position.set(blobs[bl][0], blobs[bl][1], blobs[bl][2])
      blob.scale.set(blobs[bl][3], blobs[bl][3] * 0.78, blobs[bl][3])
      canopy.add(blob)
    }
    var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.62, 7, 9), trunkMaterial)
    trunk.position.set(13.2, 3.5, -4)
    trunk.rotation.z = -0.05
    for (var b = 0; b < 2; b += 1) {
      var branch = new THREE.Mesh(branchGeometry, trunkMaterial)
      branch.position.set(b === 0 ? 12.1 : 14.3, 7.3, -4)
      branch.rotation.z = b === 0 ? 0.5 : -0.44
      group.add(branch)
    }
    group.add(trunk, canopy)
    // 左侧的太湖石：面数低、起伏深，离卡片的字也远。
    var stone = new THREE.Mesh(stoneGeometry(THREE), new THREE.MeshStandardMaterial({ color: 0x5b6068, roughness: 0.9, metalness: 0.05 }))
    stone.position.set(-12.4, 2.2, -5.5)
    stone.rotation.set(0.2, 0.7, 0.1)
    group.add(stone)

    return {
      id: 'court',
      group: group,
      camera: { height: 8, distance: 26, targetY: 7, fov: 54 },
      // 院子要对比：环境光压低、雾收一点，粉墙与灯笼才立得住；泛光略提，灯笼出光晕。
      look: { ambient: 0.36, exposure: 0.86, fog: 0.5, bloom: 0.3 },
      setWeather: function (next) {
        weather = next.weather
        night = next.night
        // 雨雪粒子不归这里管；湿只落到材质参数上。石板的粗糙度贴图里缝是白的，湿面上仍先显出石板缝。
        var wet = weather === 'rain' || weather === 'storm'
        groundMaterial.roughness = stoneMaterial.roughness = wet ? 0.26 : 0.72
        groundMaterial.metalness = stoneMaterial.metalness = wet ? 0.78 : 0.1
        groundMaterial.color.setScalar(wet ? 0.62 : 0.74)
      },
      resize: function () {},
      update: function (dt, clock, palette) {
        // 灯笼是夜里的主光源：强度朝目标缓过去，呼吸只在已有对象上改属性。
        var target = (night ? 1 : 0.14 + palette.windows * 0.34) * (weather === 'storm' ? 0.7 : 1)
        lanternEnergy += (target - lanternEnergy) * (1 - Math.exp(-dt * 2.6))
        var breath = 0.88 + 0.12 * Math.sin(clock * 1.9) + 0.04 * Math.sin(clock * 5.3)
        lanternMaterial.emissiveIntensity = 0.7 + lanternEnergy * 1.9 * breath
        for (var i = 0; i < lanternLights.length; i += 1) {
          lanternLights[i].intensity = lanternEnergy * 40 * breath
          lanternGlows[i].material.opacity = 0.1 + lanternEnergy * 0.4 * breath
          // 灯挂得松，跟着夜风轻轻地摆；幅度小，卡片里才不显轻浮。
          lanterns[i].rotation.z = Math.sin(clock * 0.7 + i * 1.1) * 0.03
        }
        // 门后的那盏小灯跟着昼夜走，白天的院子也不至于把门洞读成一张黑纸。
        innerLamp.material.emissiveIntensity = 0.45 + palette.windows * 1.5
        innerGlow.material.opacity = 0.12 + palette.windows * 0.46
        canopy.rotation.z = Math.sin(clock * 0.5) * 0.026
      },
      dispose: function () {
        group.traverse(function (object) {
          if (object.geometry) object.geometry.dispose()
          if (!object.material) return
          var materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach(function (material) { material.dispose() })
        })
        owned.forEach(function (texture) { texture.dispose() })
        group.clear()
      },
    }
  }

  root.WxScenes = root.WxScenes || {}
  root.WxScenes.court = create
})(window)
