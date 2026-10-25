/*
 * 场景「水墨」：六层山脊退到雾里，中景一座塔挑着两盏窗灯，下方是水，整幅压在宣纸上。
 *
 * 与 `scene-city.js` 同一种形状：`create(THREE, api)` 交回 `{ id, group, camera, setWeather, resize, update, dispose }`，
 * 天光、雾、雨雪与镜头由 `world.js` 负责，这里只搭纸上的墨与自己的慢动作（D7 的一份脚本）。
 */
;(function (root) {
  'use strict'

  var TAU = Math.PI * 2

  function clamp(value, low, high) { return value < low ? low : value > high ? high : value }

  /** 固定种子的随机序列：同一张卡每次重开都是同一幅画。 */
  function seeded(seed) {
    var state = seed >>> 0
    return function () {
      state = (state * 1664525 + 1013904223) >>> 0
      return state / 4294967296
    }
  }

  /** 墨与雾都现画：给一张空白画布，交给 painter 落笔，再包成贴图；不联网、不加载图片。 */
  function inkTexture(THREE, width, height, painter) {
    var canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    var ctx = canvas.getContext('2d')
    painter(ctx, width, height)
    var texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  /** 一层山：一条脊线由两条频率不成整数倍的正弦叠成，上沿化开、底部压实。 */
  function ridgePath(ctx, width, height, seed) {
    var random = seeded(seed)
    var phase = random() * TAU
    var turns = 1.1 + random() * 1.4
    var base = 0.5 + random() * 0.22
    ctx.save()
    ctx.filter = 'blur(3px)'
    ctx.beginPath()
    ctx.moveTo(-10, height)
    for (var i = 0; i <= 56; i += 1) {
      var t = i / 56
      var y = (base + 0.24 * Math.sin(t * TAU * turns + phase) + 0.08 * Math.sin(t * TAU * turns * 2.7 + phase * 1.6)) * height
      ctx.lineTo(t * width, y)
    }
    ctx.lineTo(width + 10, height)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  /** 一层山的一笔：主山之下是实墨，背后垫一层更淡更矮的远峰；山脚压几道横皴，最后镂空擦出飞白。 */
  function ridgeTexture(THREE, seed) {
    return inkTexture(THREE, 512, 200, function (ctx, width, height) {
      var random = seeded(seed + 101)
      // 远峰：画在脊线根部的下方，只从主峰上方探出一截，像主山背后的另一重山。
      ctx.fillStyle = 'rgba(255,255,255,0.34)'
      ctx.save()
      ctx.translate(0, height * 0.3)
      ctx.scale(0.72, 0.6)
      ridgePath(ctx, width, height, seed + 7)
      ctx.restore()
      // 主山：上沿淡、山脚浓，同一笔里的浓淡差把平贴图撑出体积。
      var wash = ctx.createLinearGradient(0, 0, 0, height)
      wash.addColorStop(0, 'rgba(255,255,255,0.46)')
      wash.addColorStop(0.5, 'rgba(255,255,255,0.8)')
      wash.addColorStop(0.86, 'rgba(255,255,255,1)')
      wash.addColorStop(1, 'rgba(255,255,255,0.62)')
      ctx.fillStyle = wash
      ridgePath(ctx, width, height, seed)
      // 山脚横皴：几道断续的短笔叠在底部，近看有笔触，远看只是山脚的重量。
      ctx.fillStyle = 'rgba(255,255,255,0.2)'
      ctx.filter = 'blur(1.6px)'
      for (var s = 0; s < 16; s += 1) {
        ctx.fillRect(random() * width, height * (0.86 + random() * 0.13), 20 + random() * 60, 1.2 + random() * 1.8)
      }
      ctx.filter = 'none'
      ctx.globalCompositeOperation = 'destination-out'
      for (var d = 0; d < 70; d += 1) {
        ctx.globalAlpha = 0.1 + random() * 0.35
        ctx.beginPath()
        ctx.ellipse(random() * width, height * (0.58 + random() * 0.36), 8 + random() * 34, 0.7 + random() * 2.4, 0, 0, TAU)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    })
  }

  /** 一团软的白：糊开的圆，压扁了当雾，拉长了当水纹，两样都用这一张。 */
  function softTexture(THREE, seed) {
    return inkTexture(THREE, 512, 128, function (ctx, width, height) {
      var random = seeded(seed)
      // 靠一次大模糊把边化开，比一层层叠径向渐变省下大半的绘制。
      ctx.filter = 'blur(9px)'
      ctx.fillStyle = 'rgba(255,255,255,0.15)'
      for (var i = 0; i < 16; i += 1) {
        ctx.beginPath()
        ctx.ellipse(width * (0.18 + random() * 0.64), height * (0.3 + random() * 0.4), width * (0.07 + random() * 0.1), height * (0.12 + random() * 0.22), 0, 0, TAU)
        ctx.fill()
      }
    })
  }

  /** 宣纸：极淡的细横纹与打散的噪点；不透明度压得极低，近看有质地，远看不抢墨。 */
  function paperTexture(THREE) {
    return inkTexture(THREE, 256, 256, function (ctx, width, height) {
      var random = seeded(77)
      ctx.fillStyle = 'rgb(255,255,255)'
      ctx.fillRect(0, 0, width, height)
      var hair = ctx.createLinearGradient(0, 0, 0, height)
      hair.addColorStop(0, 'rgba(150,150,150,0.18)')
      hair.addColorStop(0.4, 'rgba(150,150,150,0.1)')
      hair.addColorStop(1, 'rgba(150,150,150,0.2)')
      ctx.fillStyle = hair
      for (var y = 0; y < height; y += 2) ctx.fillRect(0, y, width, 1)
      for (var i = 0; i < 4200; i += 1) {
        var tone = random() > 0.42 ? 130 + random() * 90 : 240 + random() * 15
        ctx.fillStyle = 'rgba(' + (tone | 0) + ',' + (tone | 0) + ',' + (tone | 0) + ',' + (0.05 + random() * 0.16).toFixed(2) + ')'
        ctx.fillRect(random() * width, random() * height, 1, 1)
      }
    })
  }

  /** 塔的剪影：三层檐、翘起的檐角、塔刹上的相轮，白色画在透明的画布上，颜色交给材质。 */
  function pagodaTexture(THREE) {
    return inkTexture(THREE, 128, 256, function (ctx) {
      ctx.fillStyle = '#ffffff'
      ctx.filter = 'blur(0.6px)'
      /** 一片檐：两端翘起的一道弧，中间厚、尖上薄，像压着一层瓦；两端再挑出一点檐角。 */
      function eave(cx, top, half, thick) {
        ctx.beginPath()
        ctx.moveTo(cx - half, top + thick * 1.9)
        ctx.quadraticCurveTo(cx, top - thick * 2.4, cx + half, top + thick * 1.9)
        ctx.quadraticCurveTo(cx, top + thick * 1.2, cx - half, top + thick * 1.9)
        ctx.fill()
        ctx.beginPath()
        ctx.ellipse(cx - half, top + thick * 1.4, 3.6, 1.4, -0.5, 0, TAU)
        ctx.fill()
        ctx.beginPath()
        ctx.ellipse(cx + half, top + thick * 1.4, 3.6, 1.4, 0.5, 0, TAU)
        ctx.fill()
      }
      // 自下而上：塔基、三层塔身、塔刹。tiers 是 [左, 顶, 宽, 高, 檐半宽]，每层檐都比塔身宽。
      ctx.fillRect(36, 238, 56, 18)
      var tiers = [[44, 192, 40, 46, 40], [50, 152, 28, 40, 30], [55, 118, 18, 34, 22]]
      for (var t = 0; t < tiers.length; t += 1) {
        ctx.fillRect(tiers[t][0], tiers[t][1], tiers[t][2], tiers[t][3])
        eave(tiers[t][0] + tiers[t][2] / 2, tiers[t][1], tiers[t][4], 5)
      }
      // 塔刹：细锥、相轮与顶上的宝珠。
      ctx.beginPath()
      ctx.moveTo(64, 74)
      ctx.lineTo(68, 116)
      ctx.lineTo(60, 116)
      ctx.fill()
      ctx.fillRect(54, 82, 20, 2.4)
      ctx.fillRect(57, 92, 14, 2.4)
      ctx.beginPath()
      ctx.arc(64, 72, 3.2, 0, TAU)
      ctx.fill()
      ctx.filter = 'none'
    })
  }

  /** 芦苇与水草：一丛细笔，茎向上收细，叶是压扁的弧；只用上沿，免得压到卡片底部的文字。 */
  function reedTexture(THREE) {
    return inkTexture(THREE, 256, 128, function (ctx, width, height) {
      var random = seeded(41)
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#ffffff'
      for (var i = 0; i < 15; i += 1) {
        var x = width * (0.12 + random() * 0.76)
        var tall = height * (0.42 + random() * 0.5)
        var lean = (random() - 0.5) * 14
        ctx.lineWidth = 1 + random() * 1.6
        ctx.beginPath()
        ctx.moveTo(x, height)
        ctx.quadraticCurveTo(x + lean * 0.4, height - tall * 0.6, x + lean, height - tall)
        ctx.stroke()
        for (var k = 0; k < 2; k += 1) {
          var at = height - tall * (0.35 + random() * 0.45)
          ctx.beginPath()
          ctx.ellipse(x + lean * 0.5 + (random() - 0.5) * 8, at, 1.4, 5 + random() * 5, (random() - 0.5) * 1.2, 0, TAU)
          ctx.fill()
        }
      }
    })
  }

  function create(THREE, api) {
    var group = new THREE.Group()
    var weather = 'cloudy'
    var night = false

    // 自己建的贴图登记在这里：材质 dispose 不带贴图，得自己放；调用方的 dotTexture 不在此列。
    var textures = []
    function own(texture) { textures.push(texture); return texture }

    /** 一张朝镜头的贴片：山、塔、雾都按这个形状摆，颜色与不透明度留给逐帧改。 */
    function sheet(material, width, height, x, y, z) {
      var mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material)
      mesh.position.set(x, y, z)
      group.add(mesh)
      return mesh
    }

    // 水面：一层很淡的墨，宽到出画；近处继续留白给卡片底部的文字。
    var waterMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })
    var water = new THREE.Mesh(new THREE.PlaneGeometry(560, 320), waterMaterial)
    water.rotation.x = -Math.PI / 2
    water.position.set(0, 0, -60)
    water.renderOrder = -1
    group.add(water)

    // 水纹：几张拉长的软片贴在近处水面，动得极慢；快一点就成了水面在抖。
    var rippleMap = own(softTexture(THREE, 21))
    var ripples = [0, 1, 2, 3].map(function (i) {
      var material = new THREE.MeshBasicMaterial({ map: rippleMap, transparent: true, depthWrite: false })
      var ripple = sheet(material, 52 + i * 22, 8 + i * 4, i % 2 === 0 ? -7 : 10, 0.05, 4 - i * 10)
      ripple.rotation.x = -Math.PI / 2
      return { material: material, mesh: ripple, baseX: ripple.position.x }
    })
    // 山：由近到远六层，越远越淡；最前一层是岸，压住塔脚。
    var layers = [
      { z: -30, base: -0.6, w: 120, h: 11, fade: 0.9, seed: 3 },
      { z: -58, base: 0, w: 160, h: 30, fade: 0.82, seed: 13 },
      { z: -80, base: 1, w: 190, h: 36, fade: 0.66, seed: 29 },
      { z: -106, base: 3, w: 230, h: 42, fade: 0.5, seed: 43 },
      { z: -138, base: 5, w: 280, h: 50, fade: 0.36, seed: 61 },
      { z: -178, base: 8, w: 340, h: 58, fade: 0.24, seed: 79 },
    ]
    var ridges = layers.map(function (layer) {
      var material = new THREE.MeshBasicMaterial({ map: own(ridgeTexture(THREE, layer.seed)), transparent: true, depthWrite: false })
      sheet(material, layer.w, layer.h, 0, layer.base + layer.h / 2, layer.z)
      return { material: material, fade: layer.fade }
    })

    // 岸边的芦苇：只在最前一层山前露一截，笔触最浓，给近景一点手写的松。
    var reedMaterial = new THREE.MeshBasicMaterial({ map: own(reedTexture(THREE)), transparent: true, depthWrite: false })
    sheet(reedMaterial, 26, 13, -21, 5.9, -27)

    // 塔：中景最浓的一笔；窗灯是整幅画里唯一的暖色，夜里才亮成灯。
    var pagodaMaterial = new THREE.MeshBasicMaterial({ map: own(pagodaTexture(THREE)), transparent: true, depthWrite: false })
    sheet(pagodaMaterial, 14, 28, 10, 14, -40)
    var windowMaterial = new THREE.SpriteMaterial({ map: api.dotTexture, color: 0xffc47a, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending })
    ;[10, 13.2].forEach(function (y) {
      var sprite = new THREE.Sprite(windowMaterial)
      sprite.position.set(10, y, -39.2)
      sprite.scale.set(3.2, 3.2, 1)
      group.add(sprite)
    })

    // 月亮夜里才浮出来，外面一圈极淡的晕；水面上是竖拉长的一道倒影，倒影里再压两道断续亮纹。
    var moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: api.dotTexture, color: 0xdbe7ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }))
    moon.position.set(-16, 56, -150)
    moon.scale.set(22, 22, 1)
    group.add(moon)
    var halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: api.dotTexture, color: 0xc4d6ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }))
    halo.position.copy(moon.position)
    halo.scale.set(78, 78, 1)
    group.add(halo)
    var moonPath = new THREE.Sprite(moon.material.clone())
    moonPath.position.set(-4, -3, -8)
    moonPath.scale.set(7, 30, 1)
    group.add(moonPath)
    // 倒影里的两道断续亮纹：横着，比倒影本身更淡。
    var glints = [0, 1].map(function (i) {
      var material = new THREE.MeshBasicMaterial({ map: rippleMap, color: 0xdbe7ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
      var glint = sheet(material, 16 + i * 6, 1.6, -3 + i * 2, 0.06, -4 - i * 4)
      glint.rotation.x = -Math.PI / 2
      return { material: material, mesh: glint, baseX: glint.position.x }
    })

    // 雾：三层，远宽慢、近窄快；远的淡而冷，近的稍厚。
    var softMaps = [own(softTexture(THREE, 3)), own(softTexture(THREE, 8))]
    var mists = [
      { z: -26, y: 5, w: 230, h: 22, x: 0, speed: 0.5, amount: 1 },
      { z: -62, y: 10, w: 280, h: 26, x: -50, speed: 0.34, amount: 0.8 },
      { z: -112, y: 16, w: 340, h: 30, x: 40, speed: 0.22, amount: 0.6 },
    ].map(function (spec, index) {
      var material = new THREE.MeshBasicMaterial({ map: softMaps[index % 2], transparent: true, depthWrite: false })
      var mesh = sheet(material, spec.w, spec.h, spec.x, spec.y, spec.z)
      return { material: material, mesh: mesh, x: spec.x, speed: spec.speed, amount: spec.amount }
    })

    // 纸：最前面一层，盖住整幅画；压在墨上只留一点纤维与细纹。
    var paperMaterial = new THREE.MeshBasicMaterial({ map: own(paperTexture(THREE)), transparent: true, depthWrite: false, opacity: 0.06 })
    var paper = sheet(paperMaterial, 120, 64, 0, 12, 4)
    paper.renderOrder = 10

    // 帧循环里复用的颜色：每秒六十次 new 出来的垃圾会在低端机器上变成掉帧。
    var ink = new THREE.Color()
    var cool = new THREE.Color()

    return {
      id: 'ink',
      group: group,
      camera: { height: 10, distance: 34, targetY: 10, fov: 52 },
      // 水墨要平：环境光足、雾略多，远山才有化开的感觉。
      // 水墨要平：环境光足、雾略多，远山才有化开的感觉；泛光极轻，墨色不该发光。
      look: { ambient: 0.8, exposure: 0.98, fog: 0.86, bloom: 0.12 },
      setWeather: function (next) {
        weather = next.weather
        night = next.night
      },
      resize: function (width, height, aspect) {
        // 窄卡片里把雾加宽，两侧才不露出没有墨的空档；纸跟着卡片比例铺，不被拉歪。
        var ratio = aspect || width / Math.max(1, height)
        for (var i = 0; i < mists.length; i += 1) mists[i].mesh.scale.x = ratio < 1.1 ? 1.3 : 1
        paper.scale.set(ratio < 1.1 ? 1.2 : 1, ratio > 1.6 ? 1.12 : 1, 1)
      },
      update: function (dt, clock, palette) {
        // 阴雨把墨压浓：最浓也留一线透光，压成黑块就不是水墨了。
        var damp = weather === 'storm' ? 1 : weather === 'rain' ? 0.8 : weather === 'overcast' ? 0.55 : weather === 'snow' ? 0.3 : weather === 'cloudy' ? 0.2 : 0
        // 墨色每帧只推一次：灰度取自天光；白天偏米白与淡墨，夜里偏靛青。
        var luma = palette.mid.r * 0.3 + palette.mid.g * 0.59 + palette.mid.b * 0.11
        var value = clamp(luma * (night ? 0.3 : 0.17), 0.012, 0.28) / (1 + damp * 0.55)
        ink.setRGB(value * (night ? 0.66 : 1.08), value * (night ? 0.84 : 1), value * (night ? 1.24 : 0.94))

        waterMaterial.color.copy(palette.low).lerp(ink, night ? 0.55 : 0.2)
        waterMaterial.opacity = night ? 0.66 : 0.44
        for (var i = 0; i < ripples.length; i += 1) {
          ripples[i].material.color.copy(ink).multiplyScalar(1.6)
          ripples[i].material.opacity = (night ? 0.42 : 0.32) * (0.8 + damp * 0.5)
          ripples[i].mesh.position.x = ripples[i].baseX + Math.sin(clock * 0.07 + i * 1.3) * 1.6
        }
        for (var l = 0; l < ridges.length; l += 1) {
          ridges[l].material.color.copy(ink)
          ridges[l].material.opacity = Math.min(1, ridges[l].fade * (0.92 + damp * 0.3))
        }
        // 岸与塔比山更浓，窗灯跟 palette.windows 走：白天是纸上一点赭，夜里亮成一盏。
        reedMaterial.color.copy(ink).multiplyScalar(1.16)
        reedMaterial.opacity = night ? 0.46 : 0.38
        pagodaMaterial.color.copy(ink).multiplyScalar(0.7)
        windowMaterial.opacity = clamp(0.1 + palette.windows * 0.62, 0, 0.95) * (1 - damp * 0.35)

        var moonUp = night ? clamp(1 - damp * 1.2, 0, 1) : 0
        moon.material.opacity = moonUp * (0.8 + Math.sin(clock * 0.3) * 0.08)
        halo.material.opacity = moonUp * (0.16 + Math.sin(clock * 0.21 + 0.8) * 0.03)
        moonPath.material.opacity = moonUp * (0.24 + Math.sin(clock * 0.24) * 0.05)
        for (var g = 0; g < glints.length; g += 1) {
          glints[g].material.opacity = moonUp * (0.2 - g * 0.06 + Math.sin(clock * 0.5 + g * 2.3) * 0.06)
          glints[g].mesh.position.x = glints[g].baseX + Math.sin(clock * 0.11 + g) * 1.1
        }
        for (var m = 0; m < mists.length; m += 1) {
          var mist = mists[m]
          // 雾只横着漂，每层自己的相位与速度：一层一样快就看得出是贴片。
          mist.mesh.position.x = mist.x + Math.sin(clock * 0.05 * mist.speed + m * 2.1) * 34
          // 夜里雾偏冷：往靛青拉，而不是往墨里压。
          cool.copy(palette.haze).lerp(ink, night ? 0.4 : 0.14)
          if (night) cool.b = Math.min(1, cool.b + 0.05)
          mist.material.color.copy(cool)
          mist.material.opacity = ((night ? 0.13 : 0.2) + damp * 0.09) * mist.amount
        }
        paperMaterial.color.copy(palette.low).lerp(ink, 0.25)
        paperMaterial.opacity = night ? 0.05 : 0.06
      },
      dispose: function () {
        group.traverse(function (object) {
          if (object.geometry) object.geometry.dispose()
          if (object.material) object.material.dispose()
        })
        // 贴图有多处共用，按登记表各放一次；重复 dispose 同一张在有的浏览器里会留警告。
        textures.forEach(function (texture) { texture.dispose() })
      },
    }
  }

  root.WxScenes = root.WxScenes || {}
  root.WxScenes.ink = create
})(window)
