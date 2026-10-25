/*
 * 赛博朋克霓虹峡谷：两侧楼墙贴到街边，招牌叠成几层，光从缝里漏下来。
 *
 * 全部交给公共层的零件：媒体立面做楼身、霓虹做招牌、光带横过街面、人群与车流做底；这一份只排位置
 * 与配色（D7 的一份脚本）。
 */
;(function (root) {
  'use strict'

  function create(THREE, api) {
    var kit = root.WxCityKit
    var group = new THREE.Group()
    var weather = 'cloudy'
    var night = false
    var random = kit.seeded(2049)

    // 两侧楼墙：一直贴到街边，留 14–18 的缝做峡谷。
    var mediaKinds = ['streak', 'bars', 'grid']
    var mediaPalette = [['#39d0ff', '#ff2fd0'], ['#7b5cff', '#00ffc6'], ['#ff6a3d', '#39d0ff'], ['#ff2fd0', '#ffd166']]
    // 楼身是暗的混凝土与钢：整面发光的墙会把街读成一根灯管，屏只开在楼身的一侧或一条腰带上。
    var wallMaterial = new THREE.MeshStandardMaterial({ color: 0x0b0e15, roughness: 0.78, metalness: 0.24 })
    var windowTexture = (function () {
      var canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 128
      var ctx = canvas.getContext('2d')
      ctx.fillStyle = '#080b11'
      ctx.fillRect(0, 0, 64, 128)
      var random2 = kit.seeded(412)
      for (var row = 0; row < 20; row += 1) {
        for (var col = 0; col < 5; col += 1) {
          if (random2() > 0.62) {
            ctx.fillStyle = random2() > 0.5 ? 'rgba(255,214,150,0.9)' : 'rgba(150,230,255,0.85)'
            ctx.fillRect(col * 12 + 2, row * 6.2 + 1, 9, 3.6)
          }
        }
      }
      var texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      return texture
    })()
    var litMaterial = new THREE.MeshStandardMaterial({ map: windowTexture, emissiveMap: windowTexture, emissive: new THREE.Color(0xffd9a0), emissiveIntensity: 0.28, color: 0x121722, roughness: 0.7, metalness: 0.2 })
    var towers = []
    var signs = []
    var screens = []
    var beams = []
    var rowGroups = []

    // 街景按 56 个单位分成若干段，每一段是一圈楼与招牌；车往前开时这一段循环回到远处。
    var SEGMENT = 56
    var SEGMENTS = 4
    var words = ['拉麺', '電脳', 'CYBER', 'NEON', '2049', '酒場', 'HOTEL', '夜市']
    var signColours = ['#5fe3ff', '#ff2fd0', '#ffd166', '#7b5cff', '#00ffc6', '#ff6a3d']
    for (var segment = 0; segment < SEGMENTS; segment += 1) {
      var row = new THREE.Group()
      row.userData.base = -segment * SEGMENT
      var z = 0
      while (z > -SEGMENT) {
        for (var sideIndex2 = 0; sideIndex2 < 2; sideIndex2 += 1) {
          var side2 = sideIndex2 === 0 ? -1 : 1
          var height = 22 + random() * 40
          var width = 8 + random() * 6
          var depth = 8 + random() * 6
          var body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), random() > 0.45 ? litMaterial : wallMaterial)
          var x = side2 * (17 + random() * 3)
          body.position.set(x, height / 2, z - depth / 2)
          row.add(body)
          towers.push(body)
          if (random() > 0.55) {
            var colours = mediaPalette[Math.floor(random() * mediaPalette.length)]
            var media = new THREE.Mesh(
              new THREE.PlaneGeometry(width * (0.2 + random() * 0.22), height * 0.5),
              kit.mediaMaterial(THREE, { kind: mediaKinds[Math.floor(random() * mediaKinds.length)], colorA: colours[0], colorB: colours[1] })
            )
            media.position.set(x + (side2 === -1 ? width / 2 + 0.06 : -width / 2 - 0.06), height * (0.5 + random() * 0.22), z - depth / 2 + (random() - 0.5) * depth * 0.4)
            media.rotation.y = side2 === -1 ? Math.PI / 2 : -Math.PI / 2
            row.add(media)
          }
          // 招牌：竖排霓虹贴在楼面上，三层高度错落。
          var signPanel = kit.neonPanel(THREE, {
            text: words[signs.length % words.length],
            color: signColours[signs.length % signColours.length],
            width: 1.9,
            height: 6.4,
            vertical: true,
          })
          signPanel.mesh.position.set(side2 * (16.4 + random() * 1.2), 3 + (signs.length % 4) * 6.4 + random() * 3, z - depth * 0.5)
          signPanel.mesh.rotation.y = side2 === -1 ? 0.32 : -0.32
          row.add(signPanel.mesh)
          signs.push(signPanel)
        }
        z -= 14 + random() * 5
      }
      // 每段一道横过街道的光带与一块广告屏：车往前开时它们从头顶掠过。
      var beam = kit.lightBeam(THREE, { radius: 0.06, length: 34, color: segment % 2 === 0 ? 0x5fe3ff : 0xff2fd0 })
      beam.position.set(0, 7 + (segment % 3) * 4, -SEGMENT * 0.5)
      row.add(beam)
      beams.push(beam)
      if (segment % 2 === 0) {
        var screen = kit.billboard(THREE, { width: 12, height: 7, theme: segment === 0 ? 'tech' : 'anime' })
        screen.mesh.position.set(segment % 4 === 0 ? -16 : 16, 14, -SEGMENT * 0.6)
        screen.mesh.rotation.y = segment % 4 === 0 ? 0.38 : -0.38
        row.add(screen.mesh)
        screens.push(screen)
      }
      group.add(row)
      rowGroups.push(row)
    }

    // 地面：湿沥青；这条路很长，车一直往前开，街景在两侧后退。
    var groundMaterial = new THREE.MeshStandardMaterial({ color: 0x0a0d14, roughness: 0.22, metalness: 0.85 })
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 900), groundMaterial)
    ground.rotation.x = -Math.PI / 2
    ground.position.z = -300
    group.add(ground)

    // 车头：从驾驶位看出去，仪表台与引擎盖压住画面下缘。
    var dashMaterial = new THREE.MeshStandardMaterial({ color: 0x090c12, roughness: 0.5, metalness: 0.4 })
    var dash = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 1.6), dashMaterial)
    dash.position.set(0, 0.86, -1.2)
    group.add(dash)
    var hood = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 2.2), new THREE.MeshStandardMaterial({ color: 0x111722, roughness: 0.24, metalness: 0.7 }))
    hood.position.set(0, 0.74, -2.6)
    hood.rotation.x = 0.06
    group.add(hood)
    // 雨刷：两根横在挡风玻璃下缘的细杆，慢慢摆。
    var wipers = []
    for (var wipe = 0; wipe < 2; wipe += 1) {
      var pivot = new THREE.Group()
      pivot.position.set(wipe === 0 ? -0.6 : 0.6, 0.95, -1.9)
      var blade = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.03, 0.04), new THREE.MeshStandardMaterial({ color: 0x1b222e, roughness: 0.6 }))
      blade.position.x = 0.45
      pivot.add(blade)
      group.add(pivot)
      wipers.push(pivot)
    }
    // 挡风玻璃上的雨痕：一层贴在前方的加色细条，跟着车速抖。
    var glassTexture = (function () {
      var canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 128
      var ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, 256, 128)
      var random2 = kit.seeded(88)
      for (var d = 0; d < 70; d += 1) {
        var x = random2() * 256
        var y = random2() * 128
        ctx.strokeStyle = 'rgba(190,225,255,' + (0.06 + random2() * 0.14).toFixed(3) + ')'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + 2, y + 8 + random2() * 22)
        ctx.stroke()
      }
      var texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      return texture
    })()
    var glassRain = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 8),
      new THREE.MeshBasicMaterial({ map: glassTexture, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })
    )
    glassRain.position.set(0, 2.2, -4.2)
    group.add(glassRain)

    // 车流：两侧各三排细长车身，远处一串尾灯。
    var carCount = 30
    var cars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.5, 3.2), new THREE.MeshBasicMaterial({ color: 0x151b26 }), carCount)
    cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    var carState = []
    for (var c = 0; c < carCount; c += 1) {
      var lane = c % 6
      // 车流全部朝前开，按车道分快慢；远处的一直在更远处。
      carState.push({
        x: -7.4 + lane * 2.9,
        z: -20 - random() * 150,
        speed: lane < 3 ? 26 + random() * 8 : 16 + random() * 6,
        depth: lane,
      })
    }
    group.add(cars)

    // 尾灯：每辆车后面两点红，夜里也亮。
    var tailCount = carCount * 2
    var tailGeometry = new THREE.BufferGeometry()
    var tailPositions = new Float32Array(tailCount * 3)
    tailGeometry.setAttribute('position', new THREE.BufferAttribute(tailPositions, 3))
    var tails = new THREE.Points(tailGeometry, new THREE.PointsMaterial({ map: api.dotTexture, color: 0xff2b40, size: 0.9, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    group.add(tails)

    // 街面反光：招牌颜色被湿路面拉成一条条竖影。
    var strips = kit.reflectionStrips(THREE, { colors: signColours, seed: 45, span: 160 })
    group.add(strips.group)

    // 远景：极密的塔楼剪影与顶部红灯。
    var farMaterial = new THREE.MeshStandardMaterial({ color: 0x070a10, roughness: 0.9, metalness: 0.2 })
    var far = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), farMaterial, 70)
    var matrix = new THREE.Matrix4()
    var beaconPositions = []
    for (var t = 0; t < 70; t += 1) {
      var towerHeight = 30 + random() * 70
      var towerWidth = 6 + random() * 12
      var towerX = -120 + random() * 240
      if (Math.abs(towerX) < 20) towerX += (towerX < 0 ? -1 : 1) * 26
      matrix.makeScale(towerWidth, towerHeight, towerWidth)
      matrix.setPosition(towerX, towerHeight / 2, -70 - random() * 80)
      far.setMatrixAt(t, matrix)
      if (random() > 0.35) beaconPositions.push(towerX, towerHeight + 1.2, -70 - random() * 80)
    }
    far.instanceMatrix.needsUpdate = true
    group.add(far)
    var beaconGeometry = new THREE.BufferGeometry()
    beaconGeometry.setAttribute('position', new THREE.Float32BufferAttribute(beaconPositions, 3))
    var beacons = new THREE.Points(beaconGeometry, new THREE.PointsMaterial({ map: api.dotTexture, color: 0xff3b30, size: 1.4, transparent: true, depthWrite: false }))
    group.add(beacons)

    // 街心的彩色点光：把地面积水与人群染上招牌的颜色。
    var lights = [
      { light: new THREE.PointLight(0x5fe3ff, 34, 42, 2), x: -4, y: 6, z: -16 },
      { light: new THREE.PointLight(0xff2fd0, 30, 40, 2), x: 5, y: 8, z: -28 },
      { light: new THREE.PointLight(0x7b5cff, 26, 36, 2), x: 0, y: 5, z: -44 },
    ]
    lights.forEach(function (entry) {
      entry.light.position.set(entry.x, entry.y, entry.z)
      group.add(entry.light)
    })

    var carMatrix = new THREE.Matrix4()

    return {
      id: 'cyberpunk',
      group: group,
      camera: { height: 1.55, distance: 0, targetY: 1.4, fov: 62 },
      // 这座城始终在雾与霓虹里：晴天也按阴天调色，光靠招牌与屏幕出。
      // 这座城始终在薄雾里：晴天也按阴天调色，并把雾压到能看见街的程度。
      sky: { weather: 'overcast', fog: 0.55 },
      look: { ambient: 0.5, exposure: 0.9, fog: 1.15, bloom: 0.44 },
      setWeather: function (next) {
        weather = next.weather
        night = next.night
        var wet = weather === 'rain' || weather === 'storm'
        groundMaterial.roughness = wet ? 0.12 : 0.22
        groundMaterial.metalness = wet ? 0.9 : 0.85
      },
      rig: function (t, position, target) {
        // 驾驶位：车在路上轻微起伏，转弯时侧倾；看向前方 40 个单位的街面。
        var bump = Math.sin(t * 11) * 0.02 + Math.sin(t * 23) * 0.012
        position.set(Math.sin(t * 0.21) * 0.35, 1.55 + bump, 0)
        target.set(Math.sin(t * 0.21) * 4.5, 1.3 + Math.sin(t * 0.13) * 0.25, -42)
      },
      resize: function () {},
      update: function (dt, clock, palette) {
        // 招牌依次眨：每块按自己的相位亮暗，像真正的霓虹。
        for (var s = 0; s < signs.length; s += 1) {
          var flicker = 0.72 + 0.28 * Math.sin(clock * (2 + (s % 3)) + s)
          signs[s].mesh.material.opacity = night ? 0.55 + 0.45 * flicker : 0.5
        }
        for (var b2 = 0; b2 < beams.length; b2 += 1) {
          beams[b2].material.opacity = (night ? 0.38 : 0.16) + 0.1 * Math.sin(clock * 1.7 + b2)
        }
        // 车景：镜头跟车走，路与楼在后头退。世界时间与车同速，所以只要让街景纵向循环。
        for (var rw = 0; rw < rowGroups.length; rw += 1) {
          var row = rowGroups[rw]
          row.position.z = ((row.userData.base - clock * 22) % 56 + 56) % 56 - 56
        }
        for (var c2 = 0; c2 < carState.length; c2 += 1) {
          var car = carState[c2]
          car.z += (car.speed - 22) * dt
          if (car.z > 6) car.z = -170
          if (car.z < -176) car.z = 6
          carMatrix.makeTranslation(car.x, 0.3, car.z)
          cars.setMatrixAt(c2, carMatrix)
        }
        cars.instanceMatrix.needsUpdate = true
        // 尾灯跟着车走：更新一份位置缓冲就行，不新增对象。
        var position = tailGeometry.getAttribute('position')
        for (var t2 = 0; t2 < carState.length; t2 += 1) {
          position.setXYZ(t2 * 2, carState[t2].x - 0.3, 0.42, carState[t2].z + 1.4)
          position.setXYZ(t2 * 2 + 1, carState[t2].x + 0.3, 0.42, carState[t2].z + 1.4)
        }
        position.needsUpdate = true
        // 雨刷：两根同时摆，摆到边再回；玻璃上的雨痕随车速轻抖。
        var sweep = Math.sin(clock * 1.6) * 0.9
        for (var wp = 0; wp < wipers.length; wp += 1) wipers[wp].rotation.y = sweep
        glassRain.material.opacity = (weather === 'rain' || weather === 'storm' ? 0.55 : 0.18) + 0.08 * Math.sin(clock * 9)
        glassRain.position.x = Math.sin(clock * 13) * 0.04
        strips.update(clock, night)
        for (var sc = 0; sc < screens.length; sc += 1) screens[sc].update(dt, night)
        beacons.material.opacity = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(clock * 2.6))
        for (var l = 0; l < lights.length; l += 1) lights[l].light.intensity = (night ? 1 : 0.35) * (30 + l * 3) * (weather === 'storm' ? 1.25 : 1)
      },
      dispose: function () {
        for (var s3 = 0; s3 < signs.length; s3 += 1) signs[s3].dispose()
        for (var sc2 = 0; sc2 < screens.length; sc2 += 1) screens[sc2].texture.dispose()
        strips.dispose()
        group.traverse(function (object) {
          if (object.geometry && object !== tails) object.geometry.dispose()
          if (object.material) {
            var materials = Array.isArray(object.material) ? object.material : [object.material]
            materials.forEach(function (material) {
              if (material.map && material.map !== api.dotTexture) material.map.dispose()
              material.dispose()
            })
          }
        })
      },
    }
  }

  root.WxScenes = root.WxScenes || {}
  root.WxScenes.cyberpunk = create
})(window)
