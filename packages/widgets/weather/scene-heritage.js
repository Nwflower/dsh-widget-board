/*
 * 场景「历史古建筑群」：高台上一座四层楼阁，塔前一座金顶大殿，檐角起翘；夜里窗与灯笼透暖光，
 * 远处殿宇压在雾里，两层远山兜住天边。墙面、瓦面、石台的贴图都用 canvas 现画，组件不联网。
 *
 * 每个场景都是同一个形状：`create(THREE, api)` 交回 `{ id, group, setWeather, resize, update, dispose }`，
 * 由 `world.js` 负责天空、雾、雨雪、镜头与逐帧调度。场景只搭几何与自己的动画（D7 的一份脚本）。
 */
;(function (root) {
  'use strict'

  /** 固定种子的随机序列：同一张卡每次重开都是同一面墙、同一道山脊。 */
  function seeded(seed) {
    var state = seed >>> 0
    return function () {
      state = (state * 1664525 + 1013904223) >>> 0
      return state / 4294967296
    }
  }

  /**
   * 一张 256 见方的画布出两份贴图：颜色按 SRGB 读，凹凸只取灰度当高度。
   * 凹凸设成 SRGB 会把高差压歪，所以另建一份按线性颜色空间解释。
   */
  function surface(THREE, draw, repeatX, repeatY) {
    var canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    draw(canvas.getContext('2d'))
    var map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    var bump = new THREE.CanvasTexture(canvas)
    bump.colorSpace = THREE.NoColorSpace
    map.wrapS = map.wrapT = bump.wrapS = bump.wrapT = THREE.RepeatWrapping
    map.repeat.set(repeatX, repeatY)
    bump.repeat.set(repeatX, repeatY)
    return { map: map, bump: bump }
  }

  /** 朱红墙面：抹灰的深浅斑叠一列列错缝的砖，檐下的红墙才有块面可看。 */
  function drawWall(ctx) {
    var random = seeded(17)
    ctx.fillStyle = '#8b3a28'
    ctx.fillRect(0, 0, 256, 256)
    for (var i = 0; i < 90; i += 1) {
      var tone = 30 + random() * 80
      ctx.fillStyle = 'rgba(' + ((tone + 96) | 0) + ',' + ((tone + 34) | 0) + ',' + ((tone + 14) | 0) + ',0.09)'
      ctx.fillRect(random() * 256, random() * 256, 18 + random() * 66, 12 + random() * 46)
    }
    // 砖缝：横缝整道拉过去，竖缝按行错开半块，才不会连成一张网格。
    for (var row = 0; row < 8; row += 1) {
      ctx.fillStyle = 'rgba(38,15,10,0.42)'
      ctx.fillRect(0, row * 32, 256, 2)
      for (var column = 0; column < 4; column += 1) ctx.fillRect((column * 64 + (row % 2) * 32) % 256, row * 32, 2, 32)
    }
  }

  /** 瓦面：一条条带高光的瓦垄，垄间压暗，再横几道椽头的线。`gold` 换成鎏金的一版。 */
  function drawTile(ctx, gold) {
    var random = seeded(gold ? 43 : 41)
    var stops = gold
      ? [['#6a4c1a', 0], ['#dcb469', 0.34], ['#a87c30', 0.7], ['#5a4116', 1]]
      : [['#1d232a', 0], ['#5d6770', 0.34], ['#39424a', 0.7], ['#171c22', 1]]
    for (var band = 0; band < 16; band += 1) {
      // 每垄一条横跨的渐变：左边背光、中间起脊反光、右边落进沟里。
      var gradient = ctx.createLinearGradient(band * 16, 0, band * 16 + 16, 0)
      for (var stop = 0; stop < 4; stop += 1) gradient.addColorStop(stops[stop][1], stops[stop][0])
      ctx.fillStyle = gradient
      ctx.fillRect(band * 16, 0, 16, 256)
    }
    ctx.fillStyle = 'rgba(18,22,26,0.32)'
    for (var line = 0; line < 8; line += 1) ctx.fillRect(0, line * 32 + 8, 256, 2)
    for (var speck = 0; speck < 60; speck += 1) {
      ctx.fillStyle = random() > 0.5 ? 'rgba(150,160,168,0.09)' : 'rgba(10,14,18,0.13)'
      ctx.fillRect(random() * 256, random() * 256, 3 + random() * 12, 2 + random() * 7)
    }
  }

  /** 石台：方块石板、铺装缝与磨痕，湿天里才有东西可反。 */
  function drawStone(ctx) {
    var random = seeded(73)
    ctx.fillStyle = '#8a8578'
    ctx.fillRect(0, 0, 256, 256)
    for (var i = 0; i < 48; i += 1) {
      var tone = 96 + random() * 84
      ctx.fillStyle = 'rgba(' + (tone | 0) + ',' + ((tone - 4) | 0) + ',' + ((tone - 14) | 0) + ',0.26)'
      ctx.fillRect(random() * 256, random() * 256, 22 + random() * 58, 16 + random() * 42)
      ctx.fillStyle = random() > 0.5 ? 'rgba(255,252,244,0.1)' : 'rgba(38,36,30,0.14)'
      ctx.fillRect(random() * 256, random() * 256, 2 + random() * 8, 2 + random() * 5)
    }
    ctx.fillStyle = 'rgba(54,50,43,0.5)'
    for (var seam = 0; seam < 4; seam += 1) {
      ctx.fillRect(0, seam * 64, 256, 2)
      ctx.fillRect(seam * 64, 0, 2, 256)
    }
  }

  /** 一道低山脊：把平面顶边按三条正弦压成起伏，一张几段的面片就够了。 */
  function ridgeGeometry(THREE, width, height, segments, seed) {
    var geometry = new THREE.PlaneGeometry(width, height, segments, 1)
    geometry.translate(0, height / 2, 0)
    var position = geometry.attributes.position
    var phase = seeded(seed)() * Math.PI * 2
    for (var i = 0; i < position.count; i += 1) {
      if (position.getY(i) < height - 0.01) continue
      var x = position.getX(i) / width
      // 三条频率不同的正弦叠起来，山脊才有宽窄不一的峰，不是一排半圆。
      var bump = 0.5 + 0.3 * Math.sin(x * 8.3 + phase) + 0.2 * Math.sin(x * 3.7 - phase * 0.7) + 0.12 * Math.sin(x * 15.1 + phase * 1.7)
      position.setY(i, height * (0.36 + Math.max(0.06, bump) * 0.64))
    }
    // 顶边挪过了，包围球要重算，否则低角度时整片山会被裁掉。
    geometry.computeBoundingSphere()
    return geometry
  }

  /** 四棱锥压扁成坡屋面：四个面，远看就是一座歇山顶。 */
  function roofGeometry(THREE, width, depth, height) {
    var geometry = new THREE.ConeGeometry(1, 1, 4)
    geometry.rotateY(Math.PI / 4)
    geometry.scale(width / Math.SQRT2, height, depth / Math.SQRT2)
    return geometry
  }

  function create(THREE, api) {
    var group = new THREE.Group()
    var weather = 'cloudy'
    var night = false
    var wet = 0.8, wetTarget = 0.8
    // 一个盒子撑起墙、檐、台基，一根柱子撑起檐廊：几何只有这几份，其余全靠缩放。
    var unitBox = new THREE.BoxGeometry(1, 1, 1)
    var columnGeometry = new THREE.CylinderGeometry(0.34, 0.4, 1, 8)
    var lanternGeometry = new THREE.SphereGeometry(0.42, 10, 8)
    var spireGeometry = new THREE.CylinderGeometry(0.1, 0.34, 3.2, 6)
    var orbGeometry = new THREE.SphereGeometry(0.4, 8, 6)
    // 三份贴图给三处主面。重复次数按墙面与台面的实际尺寸定，砖石才不会被拉长。
    var wallMaps = surface(THREE, drawWall, 4, 1.4)
    var tileMaps = surface(THREE, drawTile, 2, 2)
    var stoneMaps = surface(THREE, drawStone, 3, 3)
    // 颜色都画在贴图里，材质的 color 留白：两层颜色相乘会把红墙压成暗褐色。
    var stoneMaterial = new THREE.MeshStandardMaterial({ map: stoneMaps.map, bumpMap: stoneMaps.bump, bumpScale: 0.6, roughness: 0.8, metalness: 0.06 })
    var redMaterial = new THREE.MeshStandardMaterial({ map: wallMaps.map, bumpMap: wallMaps.bump, bumpScale: 0.35, roughness: 0.66, metalness: 0.04 })
    var tileMaterial = new THREE.MeshStandardMaterial({ map: tileMaps.map, bumpMap: tileMaps.bump, bumpScale: 0.8, roughness: 0.5, metalness: 0.22 })
    // 金顶单独画一版金色瓦垄：贴着屋面的光几乎是正面光，只靠凹凸看不出垄，得让颜色自己出垄。
    var goldMaps = surface(THREE, function (ctx) { drawTile(ctx, true) }, 5, 3)
    var goldMaterial = new THREE.MeshStandardMaterial({ map: goldMaps.map, bumpMap: goldMaps.bump, bumpScale: 1.1, roughness: 0.5, metalness: 0.3 })
    var windowMaterial = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.7, emissive: 0xff9a4a, emissiveIntensity: 0.05 })
    var lanternMaterial = new THREE.MeshStandardMaterial({ color: 0x3a1c0c, roughness: 0.6, emissive: 0xff9a4a, emissiveIntensity: 0.2 })
    // 远处的殿宇与山脊不吃灯：剪影只该有天色，受光就会被照成近处建筑的亮度。
    var farMaterial = new THREE.MeshBasicMaterial({ color: 0x2c3038 })
    var nearRidgeMaterial = new THREE.MeshBasicMaterial({ color: 0x2a3441 })
    var farRidgeMaterial = new THREE.MeshBasicMaterial({ color: 0x3a4553 })
    var farBase = new THREE.Color(0x2c3038), nearBase = new THREE.Color(0x2a3441), farRidgeBase = new THREE.Color(0x3a4553)

    /** 一块盒子：位置取中心，尺寸按世界单位给，几何共用一份。 */
    function addBox(material, width, height, depth, x, y, z, shape) {
      var mesh = new THREE.Mesh(shape || unitBox, material)
      mesh.scale.set(width, height, depth)
      mesh.position.set(x, y, z)
      group.add(mesh)
      return mesh
    }

    // 地面：整片暗下去，把视线留给台基上的建筑；石台与踏跺湿天里会压出反光。
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: 0x24231d, roughness: 0.88 }))
    ground.rotation.x = -Math.PI / 2
    group.add(ground)
    addBox(stoneMaterial, 58, 1.2, 50, 0, 0.6, -18)
    addBox(stoneMaterial, 34, 0.9, 3.2, 0, 0.45, 8.6)
    addBox(stoneMaterial, 34, 0.58, 2.6, 0, 0.29, 11.4)

    // 大殿：一排檐柱撑起外挑檐口，屋面是两块斜板对拼，屋脊落在正中。
    addBox(stoneMaterial, 27, 0.9, 15, 0, 1.65, -9)
    addBox(redMaterial, 20, 4.2, 10.5, 0, 4.2, -9.1)
    addBox(windowMaterial, 12.4, 2, 0.18, 0, 4.05, -3.78)
    addBox(tileMaterial, 24.5, 0.8, 14.5, 0, 6.6, -9)
    var hallRise = 3.6
    var hallSlope = Math.atan(hallRise / 7.5)
    for (var slope = 0; slope < 2; slope += 1) {
      var face = addBox(goldMaterial, 25.5, 0.5, Math.hypot(7.5, hallRise), 0, 6.95 + hallRise / 2, -9 + (slope === 0 ? -3.75 : 3.75))
      face.rotation.x = slope === 0 ? -hallSlope : hallSlope
    }
    // 正脊一道、两端各一只上翘的鸱吻：屋脊收住两个坡面，屋面的边才不是软边。
    addBox(tileMaterial, 25.8, 0.5, 0.9, 0, hallRise + 7.02, -9)
    for (var horn = 0; horn < 2; horn += 1) {
      var finial = addBox(goldMaterial, 0.62, 1.15, 0.42, horn === 0 ? -12.9 : 12.9, hallRise + 7.45, -9)
      finial.rotation.z = horn === 0 ? 0.34 : -0.34
    }
    // 檐角起翘：细长盒子绕 z 抬起一点，再绕 y 转到对角，往外一挑就是翘角。
    for (var hallCorner = 0; hallCorner < 4; hallCorner += 1) {
      var ex = (hallCorner < 2 ? -1 : 1) * 12.25
      var ez = (hallCorner % 2 === 0 ? -1 : 1) * 7.25
      var hallTip = addBox(tileMaterial, 2.6, 0.24, 0.24, ex, 6.82, -9 + ez)
      hallTip.rotation.y = Math.atan2(-ez, ex)
      hallTip.rotation.z = 0.34
    }
    for (var column = 0; column < 7; column += 1) {
      var postX = -9 + column * 3
      addBox(redMaterial, 1.1, 4.4, 1.1, postX, 4.3, -3.4, columnGeometry)
      // 柱础：柱子落在石鼓上，而不是直接插进台面。
      addBox(stoneMaterial, 1.7, 0.4, 1.7, postX, 2.25, -3.4, columnGeometry)
    }
    // 檐下的暖光：夜里把朱红柱子与石台照出来，强度只在灯亮时给。
    var porchLight = new THREE.PointLight(0xffb070, 0, 28, 2)
    porchLight.position.set(0, 4.8, -1.4)
    group.add(porchLight)
    // 塔基：三级石台把楼阁抬到殿顶之上，镜头才看得见每一层。
    addBox(stoneMaterial, 28, 3.2, 26, 0, 2.8, -30)
    addBox(stoneMaterial, 23, 2.6, 21, 0, 5.7, -30)
    addBox(stoneMaterial, 18, 3.5, 16, 0, 8.75, -30)

    // 斗拱：檐口下一圈挑出来的小方块，一次实例化摆完全部檐口，省下上百次绘制。
    var brackets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.52, 0.86), tileMaterial, 168)
    var bracketMatrix = new THREE.Matrix4()
    var bracketIndex = 0
    function addBracket(x, y, z, yaw) {
      bracketMatrix.makeRotationY(yaw).setPosition(x, y, z)
      brackets.setMatrixAt(bracketIndex, bracketMatrix)
      bracketIndex += 1
    }
    for (var hallBracket = 0; hallBracket < 7; hallBracket += 1) addBracket(-9 + hallBracket * 3, 6.32, -3.3, 0)

    // 楼阁：四层逐层收窄，每层一段朱红墙身、一圈外挑檐口、四根起翘的檐角。
    for (var tier = 0; tier < 4; tier += 1) {
      var width = 13 - tier * 1.9
      var bottom = 10.5 + tier * 4.9
      var eaveWidth = width + 2.6
      var eaveY = bottom + 4.55
      addBox(redMaterial, width, 4.2, width, 0, bottom + 2.1, -30)
      addBox(windowMaterial, width * 0.5, 2.2, 0.2, 0, bottom + 2.2, -30 + width / 2 + 0.07)
      addBox(tileMaterial, eaveWidth, 0.7, eaveWidth, 0, eaveY, -30)
      // 每面摆 8 只斗拱：檐下那圈阴影里有了重复的小构件，檐口才显得挑得出去。
      for (var side = 0; side < 4; side += 1) {
        for (var slot = 0; slot < 8; slot += 1) {
          var offset = -eaveWidth / 2 + 1 + slot * ((eaveWidth - 2) / 7)
          var edge = eaveWidth / 2 - 0.45
          if (side < 2) addBracket(offset, eaveY - 0.55, -30 + (side === 0 ? edge : -edge), 0)
          else addBracket(side === 2 ? edge : -edge, eaveY - 0.55, -30 + offset, Math.PI / 2)
        }
      }
      for (var tip = 0; tip < 4; tip += 1) {
        var sx = tip < 2 ? -1 : 1
        var sz = tip % 2 === 0 ? -1 : 1
        var eaveTip = addBox(tileMaterial, 2.1, 0.22, 0.22, sx * eaveWidth / 2, eaveY + 0.22, -30 + sz * eaveWidth / 2)
        eaveTip.rotation.y = Math.atan2(-sz, sx)
        eaveTip.rotation.z = 0.42
      }
    }
    brackets.count = bracketIndex
    brackets.instanceMatrix.needsUpdate = true
    group.add(brackets)
    // 顶层屋面、四条垂脊与塔刹。
    addBox(tileMaterial, 1, 1, 1, 0, 31.9, -30, roofGeometry(THREE, 10.4, 10.4, 3.6))
    for (var hip = 0; hip < 4; hip += 1) {
      // 从宝顶拉到檐角的薄脊：四条脊把四个坡面分开，远看才不是一块锥面。
      var hx = (hip < 2 ? -1 : 1) * 5.2
      var hz = (hip % 2 === 0 ? -1 : 1) * 5.2
      addBox(tileMaterial, 0.24, 0.24, Math.hypot(hx, 3.6, hz), hx / 2, 31.9, -30 + hz / 2).lookAt(hx, 30.1, -30 + hz)
    }
    addBox(goldMaterial, 1, 1, 1, 0, 35.3, -30, spireGeometry)
    addBox(goldMaterial, 1, 1, 1, 0, 37.2, -30, orbGeometry)

    // 栏杆：台面前沿一排望柱加扶手，中间让出台阶口。
    for (var rail = 0; rail < 17; rail += 1) {
      var railX = -24 + rail * 3
      if (railX > -5.5 && railX < 5.5) continue
      addBox(stoneMaterial, 0.34, 0.9, 0.34, railX, 1.65, 6.8)
    }
    addBox(stoneMaterial, 18.5, 0.16, 0.2, -14.75, 2.06, 6.8)
    addBox(stoneMaterial, 18.5, 0.16, 0.2, 14.75, 2.06, 6.8)

    // 灯笼：小自发光球挂在大殿檐下与楼阁首层檐角，外加一圈柔光。
    var lanternSpots = [[-7.4, 6, -3.2], [0, 6, -3.2], [7.4, 6, -3.2], [-5.6, 14.5, -22.4], [5.6, 14.5, -22.4]]
    var lanterns = []
    var glowPositions = new Float32Array(lanternSpots.length * 3)
    for (var spot = 0; spot < lanternSpots.length; spot += 1) {
      var swing = new THREE.Group()
      swing.position.set(lanternSpots[spot][0], lanternSpots[spot][1], lanternSpots[spot][2])
      var bulb = new THREE.Mesh(lanternGeometry, lanternMaterial)
      bulb.position.y = -0.5
      swing.add(bulb)
      group.add(swing)
      lanterns.push(swing)
      glowPositions[spot * 3] = lanternSpots[spot][0]
      glowPositions[spot * 3 + 1] = lanternSpots[spot][1] - 0.5
      glowPositions[spot * 3 + 2] = lanternSpots[spot][2]
    }
    var glowGeometry = new THREE.BufferGeometry()
    glowGeometry.setAttribute('position', new THREE.BufferAttribute(glowPositions, 3))
    // 只有这层柔光不写深度：它是加色光晕，写深度会把身后的灯笼本身挡掉。
    var lanternGlow = new THREE.Points(glowGeometry, new THREE.PointsMaterial({
      map: api.dotTexture, color: 0xffb066, size: 4.2, sizeAttenuation: true, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    group.add(lanternGlow)

    /** 远处的殿宇：矮体块、坡顶、一道正脊，剪影才读得出是殿不是棚。 */
    function farPavilion(x, z, scale) {
      addBox(farMaterial, 30 * scale, 8 * scale, 16 * scale, x, 4 * scale, z)
      addBox(farMaterial, 1, 1, 1, x, 12 * scale, z, roofGeometry(THREE, 36 * scale, 20 * scale, 8 * scale))
      addBox(farMaterial, 7 * scale, 1.6 * scale, 1.4 * scale, x, 16.6 * scale, z)
    }

    /** 远处的塔：四层盒子逐层收窄，檐口出一圈挑头，顶上压一只锥顶。 */
    function farPagoda(x, z, scale) {
      addBox(farMaterial, 18 * scale, 4 * scale, 18 * scale, x, 2 * scale, z)
      for (var level = 0; level < 4; level += 1) {
        var base = (4 + level * 4.1) * scale
        var side = (13 - level * 2.2) * scale
        addBox(farMaterial, side, 3.4 * scale, side, x, base + 1.7 * scale, z)
        addBox(farMaterial, side + 2.2 * scale, 0.7 * scale, side + 2.2 * scale, x, base + 3.75 * scale, z)
      }
      var cap = new THREE.Mesh(roofGeometry(THREE, 7 * scale, 7 * scale, 3.2 * scale), farMaterial)
      cap.position.set(x, 22 * scale, z)
      group.add(cap)
    }
    farPavilion(-42, -86, 1.1)
    farPavilion(36, -100, 1.25)
    farPagoda(46, -146, 1.35)
    // 远山：两层很低的起伏面片，一层压在前，颜色跟着雾走。
    var nearRidge = new THREE.Mesh(ridgeGeometry(THREE, 320, 22, 28, 91), nearRidgeMaterial)
    nearRidge.position.set(0, 0, -158)
    group.add(nearRidge)
    var farRidge = new THREE.Mesh(ridgeGeometry(THREE, 440, 34, 24, 37), farRidgeMaterial)
    farRidge.position.set(-30, 0, -232)
    group.add(farRidge)

    return {
      id: 'heritage',
      group: group,
      camera: { height: 11, distance: 40, targetY: 12, fov: 50 },
      // 古建靠朱红与金顶撑场面：压环境光、收雾，颜色才不糊成灰。
      look: { ambient: 0.34, exposure: 0.88, fog: 0.52, bloom: 0.3 },
      setWeather: function (next) {
        weather = next.weather
        night = next.night
        // 雨与雷暴把台面打湿：反光只交给 roughness，颜色不动。
        wetTarget = weather === 'rain' || weather === 'storm' ? 0.24 : 0.8
      },
      resize: function () {},
      update: function (dt, clock, palette) {
        // 窗与灯笼：夜里跟着 palette.windows 一起亮，白天只留一点余温。
        var lit = night ? 0.16 + palette.windows * 0.95 : 0.02 + palette.windows * 0.35
        windowMaterial.emissiveIntensity = lit
        lanternMaterial.emissiveIntensity = lit * 1.5
        lanternGlow.material.opacity = (night ? 0.22 : 0.04) + palette.windows * (night ? 0.7 : 0.1)
        // 檐下溢光：只在夜里给，光落在台面上，楼身不会被整栋点亮。
        porchLight.intensity = night ? 1.5 + palette.windows * 7 : palette.windows * 2
        // 湿台面：roughness 朝下走、metalness 朝上走，天光在上面拖出一条反光。
        wet += (wetTarget - wet) * Math.min(1, dt * 2.2)
        stoneMaterial.roughness = wet
        stoneMaterial.metalness = 0.06 + (0.8 - wet) * 0.34
        // 远景混进天色：不混的话，夜里的塔影比雾还黑。
        farMaterial.color.copy(palette.haze).lerp(farBase, 0.42)
        nearRidgeMaterial.color.copy(palette.haze).lerp(nearBase, 0.5)
        farRidgeMaterial.color.copy(palette.haze).lerp(farRidgeBase, 0.34)
        // 灯笼轻晃：整组一起摆，火苗才有挂在檐下的感觉。
        for (var i = 0; i < lanterns.length; i += 1) {
          lanterns[i].rotation.z = Math.sin(clock * 1.1 + i * 1.7) * 0.09
        }
      },
      dispose: function () {
        group.traverse(function (object) {
          if (object.geometry) object.geometry.dispose()
          if (!object.material) return
          var materials = Array.isArray(object.material) ? object.material : [object.material]
          // 圆点贴图是 world 的，场景只借用，不能跟着这里释放。
          materials.forEach(function (material) {
            if (material.map && material.map !== api.dotTexture) material.map.dispose()
            if (material.bumpMap) material.bumpMap.dispose()
            material.dispose()
          })
        })
      },
    }
  }

  root.WxScenes = root.WxScenes || {}
  root.WxScenes.heritage = create
})(window)
