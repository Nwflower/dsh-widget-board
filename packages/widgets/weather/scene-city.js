/*
 * 场景「现代都市」：三层楼群、湿路面、街灯、车流、塔顶航空灯与探照灯。
 *
 * 每个场景都是同一个形状：`create(THREE, api)` 交回 `{ id, group, setWeather, resize, update, dispose }`，
 * 由 `world.js` 负责天空、雾、雨雪、镜头与逐帧调度。场景只搭几何与自己的动画（D7 的一份脚本）。
 */
;(function (root) {
  'use strict'

  /** 固定种子的随机序列：同一张卡每次重开都是同一座城。 */
  function seeded(seed) {
    var state = seed >>> 0
    return function () {
      state = (state * 1664525 + 1013904223) >>> 0
      return state / 4294967296
    }
  }

  /** 楼体外墙与窗灯：一张贴图同时当颜色与自发光，夜里亮的就是这些格子。 */
  function facadeTexture(THREE, seed, litRatio, warm) {
    var width = 128
    var height = 256
    var canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    var ctx = canvas.getContext('2d')
    var random = seeded(seed)
    ctx.fillStyle = '#0a0d13'
    ctx.fillRect(0, 0, width, height)
    var columns = 8
    var rows = 24
    var cellW = width / columns
    var cellH = height / rows
    for (var row = 0; row < rows; row += 1) {
      for (var column = 0; column < columns; column += 1) {
        var lit = random() < litRatio
        var x = column * cellW + 1
        var y = row * cellH + 1.5
        if (lit) {
          var tone = random()
          ctx.fillStyle = tone > 0.78 ? '#bfe0ff' : tone > 0.4 ? warm : '#ffd08a'
          ctx.globalAlpha = 0.55 + random() * 0.45
        } else {
          ctx.fillStyle = '#11161f'
          ctx.globalAlpha = 0.9
        }
        ctx.fillRect(x, y, cellW - 2.5, cellH - 4)
      }
      // 每层一道挑檐/阳台线：放大后楼面才不是一片格子。
      if (row % 4 === 3) {
        ctx.globalAlpha = 0.55
        ctx.fillStyle = '#1b2230'
        ctx.fillRect(0, (row + 0.86) * cellH, width, Math.max(1, cellH * 0.12))
      }
    }
    ctx.globalAlpha = 1
    var texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    return texture
  }

  function create(THREE, api) {
    var group = new THREE.Group()
    var weather = 'cloudy'
    var night = false

    /** 沥青路面：车辙、虚线车道与几处积水；积水在粗糙度贴图里更暗，于是更亮地反光。 */
    function streetTexture(seed) {
      var size = 512
      var canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      var ctx = canvas.getContext('2d')
      var random = seeded(seed)
      ctx.fillStyle = '#12161d'
      ctx.fillRect(0, 0, size, size)
      for (var i = 0; i < 2600; i += 1) {
        var shade = 16 + Math.round(random() * 22)
        ctx.fillStyle = 'rgba(' + shade + ',' + (shade + 3) + ',' + (shade + 8) + ',0.5)'
        ctx.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2)
      }
      // 车道虚线：沿 z 方向，两条。
      ctx.fillStyle = 'rgba(214,220,228,0.5)'
      for (var dash = 0; dash < 16; dash += 1) {
        ctx.fillRect(size * 0.32, dash * 32, 3, 16)
        ctx.fillRect(size * 0.68, dash * 32, 3, 16)
      }
      var rough = document.createElement('canvas')
      rough.width = size
      rough.height = size
      var rctx = rough.getContext('2d')
      rctx.fillStyle = '#9a9a9a'
      rctx.fillRect(0, 0, size, size)
      for (var p = 0; p < 14; p += 1) {
        var px = random() * size
        var py = random() * size
        var pr = 18 + random() * 54
        var gradient = rctx.createRadialGradient(px, py, 0, px, py, pr)
        gradient.addColorStop(0, 'rgba(28,28,28,0.9)')
        gradient.addColorStop(1, 'rgba(120,120,120,0)')
        rctx.fillStyle = gradient
        rctx.beginPath()
        rctx.arc(px, py, pr, 0, Math.PI * 2)
        rctx.fill()
      }
      var map = new THREE.CanvasTexture(canvas)
      map.colorSpace = THREE.SRGBColorSpace
      map.wrapS = THREE.RepeatWrapping
      map.wrapT = THREE.RepeatWrapping
      map.repeat.set(4, 4)
      var roughness = new THREE.CanvasTexture(rough)
      roughness.wrapS = THREE.RepeatWrapping
      roughness.wrapT = THREE.RepeatWrapping
      roughness.repeat.set(4, 4)
      return { map: map, roughness: roughness }
    }

    // 地面与街道。
    var streetSurface = streetTexture(515)
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      new THREE.MeshStandardMaterial({ color: 0x0a0e15, roughness: 0.32, metalness: 0.55 })
    )
    ground.rotation.x = -Math.PI / 2
    group.add(ground)

    var street = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 26),
      new THREE.MeshStandardMaterial({
        map: streetSurface.map,
        roughnessMap: streetSurface.roughness,
        roughness: 0.7,
        metalness: 0.55,
      })
    )
    street.rotation.x = -Math.PI / 2
    street.position.set(0, 0.02, -8)
    group.add(street)

    // 街灯：一条暖色的光带，照在湿地上。
    var lampGeometry = new THREE.SphereGeometry(0.16, 8, 8)
    var lampMaterial = new THREE.MeshBasicMaterial({ color: 0xffd9a0 })
    var lamps = new THREE.InstancedMesh(lampGeometry, lampMaterial, 24)
    var lampMatrix = new THREE.Matrix4()
    for (var l = 0; l < 24; l += 1) {
      var side = l % 2 === 0 ? -1 : 1
      lampMatrix.makeTranslation(side * 10.5, 3.1, 4 - Math.floor(l / 2) * 9)
      lamps.setMatrixAt(l, lampMatrix)
    }
    group.add(lamps)
    var lampLight = new THREE.PointLight(0xffc98a, 22, 40, 2)
    lampLight.position.set(-6, 3.4, -4)
    group.add(lampLight)
    var lampLight2 = new THREE.PointLight(0xffc98a, 18, 36, 2)
    lampLight2.position.set(7, 3.2, -16)
    group.add(lampLight2)

    // 车流：两排暖红与冷白的小灯，沿街来回。
    var carCount = 20
    var carGeometry = new THREE.BoxGeometry(0.5, 0.16, 1.9)
    var carMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
    var cars = new THREE.InstancedMesh(carGeometry, carMaterial, carCount)
    cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    var carState = []
    var carRandom = seeded(404)
    for (var i = 0; i < carCount; i += 1) {
      var lane = i % 4
      carState.push({
        x: lane < 2 ? -7.5 + lane * 1.6 : 5.2 + (lane - 2) * 1.7,
        z: -80 + carRandom() * 92,
        speed: (carRandom() > 0.5 ? 1 : -1) * (7 + carRandom() * 9),
      })
      cars.setColorAt(i, new THREE.Color(carRandom() > 0.42 ? 0xff6a3c : 0xf4f7ff))
    }
    group.add(cars)

    // 楼群：三层，越近越大；每层一份外墙贴图。
    var bands = [
      { count: 70, x: 170, zNear: -215, zFar: -135, minW: 5, maxW: 12, minH: 14, maxH: 58, lit: 0.22, seed: 7 },
      { count: 46, x: 115, zNear: -125, zFar: -78, minW: 6, maxW: 14, minH: 16, maxH: 62, lit: 0.3, seed: 19 },
      { count: 22, x: 78, zNear: -78, zFar: -42, minW: 7, maxW: 17, minH: 18, maxH: 52, lit: 0.36, seed: 31 },
    ]
    var buildings = []
    bands.forEach(function (band, index) {
      var texture = facadeTexture(THREE, band.seed, band.lit, index === 2 ? '#ffe2a8' : '#ffd08a')
      var material = new THREE.MeshStandardMaterial({
        map: texture,
        emissiveMap: texture,
        emissive: new THREE.Color(0xffd7a0),
        emissiveIntensity: 0.1,
        color: 0x0b1018,
        roughness: 0.62,
        metalness: 0.34,
      })
      var mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, band.count)
      var random = seeded(band.seed * 97)
      var matrix = new THREE.Matrix4()
      var color = new THREE.Color()
      for (var b = 0; b < band.count; b += 1) {
        var width = band.minW + random() * (band.maxW - band.minW)
        var depth = band.minW + random() * (band.maxW - band.minW)
        var height = band.minH + random() * (band.maxH - band.minH)
        // 中间留一条街的视线，楼不挡在窗正中。
        var x = -band.x + random() * band.x * 2
        if (Math.abs(x) < 16 + index * 5) x += (x < 0 ? -1 : 1) * (20 + index * 6)
        var z = band.zNear + random() * (band.zFar - band.zNear)
        matrix.makeScale(width, height, depth)
        matrix.setPosition(x, height / 2, z)
        mesh.setMatrixAt(b, matrix)
        var shade = 0.5 + random() * 0.5
        color.setRGB(shade * 0.5, shade * 0.58, shade * 0.7)
        mesh.setColorAt(b, color)
      }
      mesh.instanceMatrix.needsUpdate = true
      group.add(mesh)
      buildings.push({ mesh: mesh, material: material })
    })

    // 街边店面的暖光带：夜里最亮的一条，泛光会把它揉开。
    var shopGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(180, 1.1),
      new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
    )
    shopGlow.position.set(0, 1.15, -30)
    group.add(shopGlow)

    // 楼顶水箱与天线：近景剪影不再是一条平口。
    var clutterGeometry = new THREE.BoxGeometry(1, 1, 1)
    var clutterMaterial = new THREE.MeshStandardMaterial({ color: 0x161c26, roughness: 0.8, metalness: 0.2 })
    var clutter = new THREE.InstancedMesh(clutterGeometry, clutterMaterial, 14)
    var clutterMatrix = new THREE.Matrix4()
    var clutterRandom = seeded(733)
    for (var k = 0; k < 14; k += 1) {
      var cw = 1.4 + clutterRandom() * 2.6
      var ch = 0.6 + clutterRandom() * 1.6
      clutterMatrix.makeScale(cw, ch, cw)
      clutterMatrix.setPosition((clutterRandom() > 0.5 ? 1 : -1) * (22 + clutterRandom() * 34), 22 + clutterRandom() * 16, -50 - clutterRandom() * 22)
      clutter.setMatrixAt(k, clutterMatrix)
    }
    group.add(clutter)

    // 塔顶的航空灯：一点点红，慢慢眨。
    var beaconPositions = new Float32Array([
      -46, 46, -62, 38, 52, -70, -22, 41, -48, 18, 48, -58, 58, 44, -66,
      -68, 39, -80, 6, 54, -74, -12, 36, -40, 30, 38, -44, 70, 50, -84,
    ])
    var beaconGeometry = new THREE.BufferGeometry()
    beaconGeometry.setAttribute('position', new THREE.BufferAttribute(beaconPositions, 3))
    var beacons = new THREE.Points(beaconGeometry, new THREE.PointsMaterial({
      map: api.dotTexture, color: 0xff4a3d, size: 2.6, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    group.add(beacons)

    // 两道慢慢扫过的探照灯：夜里的城才有的那条光柱。
    var searchlights = []
    var beamGeometry = new THREE.ConeGeometry(7, 110, 24, 1, true)
    for (var beamIndex = 0; beamIndex < 2; beamIndex += 1) {
      var beamMaterial = new THREE.MeshBasicMaterial({
        color: 0xbfe3ff,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      var pivot = new THREE.Group()
      pivot.position.set(beamIndex === 0 ? -34 : 40, 46, beamIndex === 0 ? -58 : -74)
      var beam = new THREE.Mesh(beamGeometry, beamMaterial)
      beam.position.set(0, 40, 0)
      beam.rotation.z = beamIndex === 0 ? 0.38 : -0.3
      pivot.add(beam)
      group.add(pivot)
      searchlights.push(pivot)
    }

    var matrix = new THREE.Matrix4()
    var kit = root.WxCityKit

    // 街景的公共层：护栏、斑马线与路灯杆；人群；两块动画广告屏；两栋媒体立面楼。
    var furniture = kit.streetFurniture(THREE, { length: 120, seed: 61 })
    furniture.position.set(0, 0, -10)
    group.add(furniture)

    var walkers = kit.crowd(THREE, { count: 120, range: { x0: -9.5, x1: 9.5, z0: -46, z1: 6 }, seed: 77 })
    group.add(walkers.group)

    var screens = [
      { billboard: kit.billboard(THREE, { width: 16, height: 9, theme: 'tech' }), x: -15, y: 12, z: -24, rotation: 0.34 },
      { billboard: kit.billboard(THREE, { width: 12, height: 7, theme: 'news' }), x: 15, y: 16, z: -34, rotation: -0.34 },
    ]
    screens.forEach(function (entry) {
      entry.billboard.mesh.position.set(entry.x, entry.y, entry.z)
      entry.billboard.mesh.rotation.y = entry.rotation
      group.add(entry.billboard.mesh)
    })

    var media = [
      { x: -22, z: -52, w: 12, h: 52, kind: 'wave', a: '#39d0ff', b: '#7b5cff' },
      { x: 24, z: -62, w: 14, h: 60, kind: 'bars', a: '#ff8a3d', b: '#ff3d6e' },
    ]
    var mediaMeshes = []
    media.forEach(function (entry) {
      var material = kit.mediaMaterial(THREE, { kind: entry.kind, colorA: entry.a, colorB: entry.b })
      var mesh = new THREE.Mesh(new THREE.BoxGeometry(entry.w, entry.h, entry.w * 0.8), material)
      mesh.position.set(entry.x, entry.h / 2, entry.z)
      group.add(mesh)
      mediaMeshes.push(mesh)
    })

    // 招牌：几块竖排霓虹，挂在临街楼上。
    var signs = ['CBD', '京', '25H']
    signs.forEach(function (text, index) {
      var texture = kit.neonTexture(THREE, text, index === 0 ? '#5fe3ff' : index === 1 ? '#ff6a3d' : '#ff3d9a')
      var mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1), new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }))
      mesh.position.set(index % 2 === 0 ? -12 : 13, 9 + index * 7, -28 - index * 9)
      mesh.rotation.y = index % 2 === 0 ? 0.5 : -0.5
      group.add(mesh)
    })

    return {
      id: 'city',
      group: group,
      camera: { height: 10.4, distance: 36, targetY: 11.4, fov: 52 },
      look: { ambient: 0.62, exposure: 0.92, fog: 0.75, bloom: 0.34 },
      setWeather: function (next) {
        weather = next.weather
        night = next.night
      },
      resize: function () {},
      update: function (dt, clock, palette) {
        for (var b = 0; b < buildings.length; b += 1) {
          buildings[b].material.emissiveIntensity = (night ? 0.32 + palette.windows * 1.5 : 0.06 + palette.windows * 0.4) * (b === 2 ? 1.25 : 1)
        }
        beacons.material.opacity = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(clock * 2.2))
        shopGlow.material.opacity = (night ? 0.5 : 0.16) + 0.04 * Math.sin(clock * 1.3)
        for (var s = 0; s < searchlights.length; s += 1) {
          var pivot = searchlights[s]
          pivot.rotation.y = clock * (s === 0 ? 0.16 : -0.13) + s * 1.7
          pivot.children.forEach(function (beam) {
            beam.material.opacity = (0.05 + palette.windows * 0.09) * (weather === 'clear' ? 1 : 0.6)
          })
        }
        for (var c = 0; c < carState.length; c += 1) {
          var car = carState[c]
          car.z += car.speed * dt
          if (car.z > 14) car.z = -84
          if (car.z < -84) car.z = 14
          matrix.makeTranslation(car.x, 0.5, car.z)
          cars.setMatrixAt(c, matrix)
        }
        cars.instanceMatrix.needsUpdate = true
        walkers.update(dt, night)
        for (var s2 = 0; s2 < screens.length; s2 += 1) screens[s2].billboard.update(dt, night)
        for (var mm = 0; mm < mediaMeshes.length; mm += 1) {
          mediaMeshes[mm].material.visible = true
        }
      },
      dispose: function () {
        group.traverse(function (object) {
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
        streetSurface.map.dispose()
        streetSurface.roughness.dispose()
      },
    }
  }

  root.WxScenes = root.WxScenes || {}
  root.WxScenes.city = create
})(window)
