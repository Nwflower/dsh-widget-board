/*
 * 窗外的一幅景：天光、太阳或月亮、云、远山、城市天际线与灯火。
 *
 * 晴天与多云是一幅清朗的画：蓝天、太阳或月亮、一朵朵有明暗的积云，全部烘进这一层，逐帧只搬动
 * 近处几朵云的位置，所以画面不会闪。阴雨雪天改用一层柔云，配合玻璃上的雨雪。
 *
 * 这里不碰卡片的状态：所有函数都按传进来的画布与尺寸作画，给 main.js 调用（D7 的组件目录里可以
 * 有多份脚本，同处一个全局作用域）。
 */
;(function (root) {
  /**
   * 一种天空的配色。
   *
   * 浅色主题是白天、深色主题压暗一档，夜里再压一档。晴天给足蓝，阴雨天转灰。
   */
  function paletteOf(scene, night, dark) {
    if (night) {
      var nightTable = {
        clear: ['#040a1e', '#0b1a38', '#173056', '#27496f'],
        cloudy: ['#050c20', '#0d1c3a', '#1a3157', '#2a4a70'],
        overcast: ['#080f17', '#131d27', '#1f2b38', '#33414f'],
        rain: ['#070d14', '#111a23', '#1d2936', '#2f4152'],
        snow: ['#0b1420', '#1a2838', '#2d4054', '#46596e'],
        storm: ['#05090e', '#0c141b', '#151f28', '#28323d']
      }
      var nightRow = nightTable[scene] || nightTable.cloudy
      return { top: nightRow[0], mid: nightRow[1], low: nightRow[2], haze: nightRow[3] }
    }
    var table = dark
      ? {
          clear: ['#123a63', '#2a6091', '#5b8db4', '#9fb9cd'],
          cloudy: ['#1d3b57', '#3a6183', '#6b8ba6', '#a3b8c9'],
          overcast: ['#101a24', '#1b2833', '#2b3b4a', '#4a5c6e'],
          rain: ['#111b25', '#1d2b38', '#2f4052', '#56697d'],
          snow: ['#192634', '#31445a', '#5c738b', '#8fa3b6'],
          storm: ['#080d13', '#111a23', '#202c37', '#3f5163']
        }
      : {
          clear: ['#2b7cc4', '#6fb2e2', '#b7dcf2', '#e8f4fb'],
          cloudy: ['#4a7fa8', '#7fa8c6', '#b3c9da', '#dde8f0'],
          overcast: ['#7a8b9b', '#97a6b4', '#b8c4cf', '#d6dee6'],
          rain: ['#54697c', '#6d8295', '#93a5b5', '#c0ccd8'],
          snow: ['#9db1c4', '#bfcddb', '#dde7ef', '#f4f8fb'],
          storm: ['#333f4c', '#45535f', '#5d6d7c', '#8b98a5']
        }
    var row = table[scene] || table.cloudy
    return { top: row[0], mid: row[1], low: row[2], haze: row[3] }
  }

  /**
   * 一朵积云的五种颜色。
   *
   * `lit` 到 `deep` 是受光面到最深处，用来把每个圆球画成有圆面的球；`rim` 是上缘那道受光的亮线。
   */
  function cloudTone(scene, night, dark) {
    if (night) return { lit: '#e9effc', mid: '#b3c4da', shade: '#63788f', deep: '#3c5068', rim: 'rgba(255,255,255,0.72)' }
    if (dark) return { lit: '#ffffff', mid: '#d7e4f2', shade: '#93aac0', deep: '#6d859c', rim: 'rgba(255,255,255,0.8)' }
    return { lit: '#ffffff', mid: '#eaf3fb', shade: '#b4cadd', deep: '#93aec5', rim: 'rgba(255,255,255,0.92)' }
  }

  /** 一个可复现的伪随机：同一张卡每次重画得到同一片天。 */
  function seeded(seed) {
    var value = seed
    return function () {
      value = (value * 1103515245 + 12345) % 2147483648
      return value / 2147483648
    }
  }

  /** 天光：从顶到底的一段渐变。 */
  function paintSkyGradient(ctx, w, h, palette) {
    var sky = ctx.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, palette.top)
    sky.addColorStop(0.5, palette.mid)
    sky.addColorStop(0.78, palette.low)
    sky.addColorStop(1, palette.haze)
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, w, h)
  }

  /**
   * 太阳或月亮。
   *
   * 日轮与月轮不画成实心圆：从中心到边缘一路渐隐，否则它和天空之间会出现一圈硬边。
   *
   * @param ctx - 已经按像素比设好变换的 2D 上下文。
   * @param w - CSS 像素宽。
   * @param h - CSS 像素高。
   * @param night - 是否夜里。
   * @param scene - 当前的天；阴雨雪天太阳在云后，只剩一团光。
   * @param pulse - 0 到 1 的呼吸位置。
   * @param alpha - 整体不透明度。
   * @param haloOnly - 只画光晕，不画日轮。
   */
  function paintCelestial(ctx, w, h, night, scene, pulse, alpha, haloOnly) {
    var radius = h * (night ? 0.095 : 0.125)
    var cx = w * (night ? 0.76 : 0.74)
    var cy = h * (night ? 0.24 : 0.22)
    var veiled = scene === 'rain' || scene === 'snow' || scene === 'storm' || scene === 'overcast'
    ctx.save()
    // 调用方可能已经压过一层不透明度，这里乘上去而不是覆盖它。
    ctx.globalAlpha = ctx.globalAlpha * (alpha === undefined ? 1 : alpha)
    var scale = 1 + pulse * 0.04
    var halo = ctx.createRadialGradient(cx, cy, radius * 0.6, cx, cy, radius * 6 * scale)
    halo.addColorStop(0, night ? 'rgba(206,226,255,0.22)' : 'rgba(255,246,214,0.3)')
    halo.addColorStop(0.2, night ? 'rgba(190,216,250,0.1)' : 'rgba(255,238,190,0.13)')
    halo.addColorStop(0.5, night ? 'rgba(175,205,245,0.035)' : 'rgba(255,232,175,0.045)')
    halo.addColorStop(1, night ? 'rgba(150,185,235,0)' : 'rgba(255,226,160,0)')
    ctx.fillStyle = halo
    ctx.fillRect(cx - radius * 7, cy - radius * 7, radius * 14, radius * 14)
    if (haloOnly === true) {
      ctx.restore()
      return
    }
    if (!veiled) {
      var bodyRadius = radius * (1 + pulse * 0.012)
      var body = ctx.createRadialGradient(cx, cy, 0, cx, cy, bodyRadius)
      if (night) {
        body.addColorStop(0, 'rgba(250,252,255,0.95)')
        body.addColorStop(0.72, 'rgba(238,245,255,0.85)')
        body.addColorStop(0.92, 'rgba(214,230,250,0.35)')
        body.addColorStop(1, 'rgba(200,220,245,0)')
      } else {
        body.addColorStop(0, 'rgba(255,252,238,0.97)')
        body.addColorStop(0.68, 'rgba(255,246,216,0.9)')
        body.addColorStop(0.9, 'rgba(255,238,190,0.32)')
        body.addColorStop(1, 'rgba(255,232,175,0)')
      }
      ctx.fillStyle = body
      ctx.beginPath()
      ctx.arc(cx, cy, bodyRadius, 0, Math.PI * 2)
      ctx.fill()
    } else {
      var glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * (2.2 + pulse * 0.1))
      glow.addColorStop(0, night ? 'rgba(226,238,255,0.22)' : 'rgba(255,250,232,0.3)')
      glow.addColorStop(0.45, night ? 'rgba(214,232,252,0.09)' : 'rgba(255,248,226,0.12)')
      glow.addColorStop(1, night ? 'rgba(200,220,245,0)' : 'rgba(255,246,220,0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(cx, cy, radius * 2.4, 0, Math.PI * 2)
      ctx.fill()
    }
    // 月面暗斑只在看得见月轮的时候画：云后只剩一团柔光时画上去会变成浮着的几个小圆。
    if (night && !veiled) {
      ctx.fillStyle = 'rgba(206,220,240,0.5)'
      var craters = [[-0.28, -0.18, 0.24], [0.16, 0.22, 0.18], [-0.05, 0.42, 0.13]]
      for (var c = 0; c < craters.length; c += 1) {
        ctx.beginPath()
        ctx.arc(cx + craters[c][0] * radius, cy + craters[c][1] * radius, craters[c][2] * radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  /**
   * 星：逐帧画，好让它们慢慢闪。
   *
   * @param ctx - 已经按像素比设好变换的 2D 上下文。
   * @param w - CSS 像素宽。
   * @param h - CSS 像素高。
   * @param time - 已经过去的秒数。
   * @param alpha - 整体不透明度。
   */
  function paintStars(ctx, w, h, time, alpha) {
    var star = seeded(17)
    var base = alpha === undefined ? 1 : alpha
    ctx.save()
    for (var s = 0; s < 150; s += 1) {
      var x = star() * w
      var y = Math.pow(star(), 1.6) * h * 0.66
      var size = star() * 1.25 + 0.22
      var phase = star() * 6.28
      // 每颗星自己的闪烁节拍，很慢；凑在一处时也不整齐划一。
      var twinkle = 0.55 + 0.45 * Math.sin(time * (0.18 + (s % 7) * 0.05) + phase)
      ctx.globalAlpha = base * (0.3 + 0.7 * twinkle)
      ctx.fillStyle = 'rgba(232,242,255,1)'
      ctx.beginPath()
      ctx.arc(x, y, size, 0, Math.PI * 2)
      ctx.fill()
      // 亮一点的星带一圈很淡的光
      if (size > 1.15) {
        var halo = ctx.createRadialGradient(x, y, 0, x, y, size * 4)
        halo.addColorStop(0, 'rgba(214,232,255,0.5)')
        halo.addColorStop(1, 'rgba(214,232,255,0)')
        ctx.globalAlpha = base * 0.5
        ctx.fillStyle = halo
        ctx.beginPath()
        ctx.arc(x, y, size * 4, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  /**
   * 一朵积云的轮廓：底下平、上面鼓，由几个圆叠出来。
   *
   * @param ctx - 2D 上下文；调用后路径已就绪，由调用方决定填充还是裁剪。
   * @param shape - 一组 `[相对横坐标, 相对纵坐标, 相对半径]`，来自 `cumulusShape`。
   */
  function cumulusPath(ctx, x, y, size, shape) {
    ctx.beginPath()
    for (var i = 0; i < shape.length; i += 1) {
      var lobe = shape[i]
      var cx = x + lobe[0] * size
      var cy = y + lobe[1] * size
      var r = lobe[2] * size
      ctx.moveTo(cx + r, cy)
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
    }
  }

  /**
   * 一朵积云的形状：底下平、上面鼓，两侧各有几个小圆，轮廓才不是一条圆弧。
   *
   * @param seed - 决定这一朵的起伏，同一个种子每次都得到同一朵。
   * @returns 一组 `[相对横坐标, 相对纵坐标, 相对半径]`。
   */
  function cumulusShape(seed) {
    var rand = seeded(seed)
    var shape = []
    var count = 9
    for (var i = 0; i < count; i += 1) {
      var t = i / (count - 1)
      var across = (t - 0.5) * 0.96
      // 中间几个圆最高，两侧收下去，底边压在 0 附近
      var bump = Math.sin(Math.pow(t, 0.85) * Math.PI)
      var up = -bump * 0.3 - rand() * 0.06
      var radius = 0.13 + bump * 0.16 + rand() * 0.05
      shape.push([across, up, radius])
    }
    return shape
  }

  /**
   * 画一朵有体积的积云。
   *
   * 三层叠出体积：整团沿光的方向从受光面渐变到背光面；每个圆鼓出来的地方补一点高光，
   * 云面才不是一块平色；下缘再压深，云底才有厚度。最后沿上缘描一道亮线。
   *
   * @param ctx - 2D 上下文。
   * @param x - 云心的横坐标。
   * @param y - 云底的纵坐标。
   * @param size - 云的宽度。
   * @param tone - 由 `cloudTone` 给的五种颜色。
   * @param shape - 由 `cumulusShape` 给的轮廓。
   * @param light - 指向光源的单位向量，由日月的位置算出来；不给时当光在左上方。
   */
  function paintCumulus(ctx, x, y, size, tone, shape, light) {
    var lx = light === undefined ? -0.4 : light.x
    var ly = light === undefined ? -0.5 : light.y
    // 外圈亮边：先把整个轮廓铺满亮色，再用缩小一点的云体盖住，剩下的一圈就是亮边。
    // 不能描边：轮廓是几个圆叠出来的，描边会把每个圆的整圈都画出来，云面就成了一张网。
    var rim = ctx.createLinearGradient(0, y - size * 0.56, 0, y + size * 0.04)
    rim.addColorStop(0, tone.rim)
    rim.addColorStop(0.55, 'rgba(255,255,255,0.06)')
    rim.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.save()
    cumulusPath(ctx, x, y, size, shape)
    ctx.fillStyle = rim
    ctx.fill()
    ctx.restore()

    ctx.save()
    ctx.translate(x, y)
    ctx.scale(0.962, 0.962)
    ctx.translate(-x, -y)
    cumulusPath(ctx, x, y, size, shape)
    ctx.clip()
    // 整团：沿光的方向从受光面渐变到背光面
    var reach = size * 0.62
    var body = ctx.createLinearGradient(x - lx * reach, y - ly * reach, x + lx * reach, y + ly * reach)
    body.addColorStop(0, tone.lit)
    body.addColorStop(0.42, tone.mid)
    body.addColorStop(0.78, tone.shade)
    body.addColorStop(1, tone.deep)
    ctx.fillStyle = body
    ctx.fillRect(x - size, y - size, size * 2, size * 2)
    // 表面：每个圆鼓出来的地方补一点高光
    for (var i = 0; i < shape.length; i += 1) {
      var lobe = shape[i]
      var cx = x + lobe[0] * size
      var cy = y + lobe[1] * size
      var r = lobe[2] * size
      var hx = cx - lx * r * 0.5
      var hy = cy - ly * r * 0.5
      var bump = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 1.45)
      bump.addColorStop(0, 'rgba(255,255,255,0.42)')
      bump.addColorStop(0.5, 'rgba(255,255,255,0.12)')
      bump.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = bump
      ctx.beginPath()
      ctx.arc(hx, hy, r * 1.45, 0, Math.PI * 2)
      ctx.fill()
    }
    // 下缘压深，云底才有厚度
    var form = ctx.createLinearGradient(0, y - size * 0.5, 0, y + size * 0.12)
    form.addColorStop(0, 'rgba(255,255,255,0.14)')
    form.addColorStop(0.5, 'rgba(0,0,0,0)')
    form.addColorStop(1, 'rgba(8,16,28,0.34)')
    ctx.fillStyle = form
    ctx.fillRect(x - size, y - size, size * 2, size * 2)
    ctx.restore()
  }

  /**
   * 把一朵积云烘成贴图，之后每帧只搬位置。
   *
   * @param make - 造一块 `w × h` 的画布，返回 `{ canvas, ctx }`。
   * @param size - 云的宽度。
   * @param tone - 由 `cloudTone` 给的五种颜色。
   * @param seed - 决定这一朵的形状。
   * @param light - 指向光源的单位向量。
   */
  function cumulusSprite(make, size, tone, seed, light) {
    var pad = size * 0.34
    var width = Math.ceil(size + pad * 2)
    var height = Math.ceil(size * 0.8 + pad)
    var made = make(width, height, 1)
    var ctx = made.ctx
    // 烘的时候糊一点，边缘才不像剪纸
    ctx.filter = 'blur(' + Math.max(1, size * 0.018).toFixed(1) + 'px)'
    paintCumulus(ctx, width / 2, height - pad * 0.55, size, tone, cumulusShape(seed), light)
    ctx.filter = 'none'
    return made.canvas
  }

  /**
   * 一团柔云：阴雨雪天的云层用它在小画布上烘出来，之后每帧只搬位置。
   *
   * @param make - 造一块 `size` 见方的画布，返回 `{ canvas, ctx }`。
   * @param radius - 云团半径。
   * @param tint - 形状是 `rgba(r,g,b,A)`，`A` 由这里换成每一圈的不透明度。
   */
  function cloudSprite(make, radius, tint) {
    var size = Math.ceil(radius * 2.6)
    var made = make(size, size, 1)
    var ctx = made.ctx
    var lobes = [[0, 0, 1], [-0.42, 0.16, 0.62], [0.44, 0.14, 0.68], [-0.16, -0.3, 0.58], [0.2, -0.26, 0.5]]
    for (var i = 0; i < lobes.length; i += 1) {
      var lobe = lobes[i]
      var x = size / 2 + lobe[0] * radius
      var y = size / 2 + lobe[1] * radius
      var r = radius * lobe[2]
      var gradient = ctx.createRadialGradient(x, y, 0, x, y, r)
      gradient.addColorStop(0, tint.replace('A', '0.55'))
      gradient.addColorStop(0.55, tint.replace('A', '0.22'))
      gradient.addColorStop(1, tint.replace('A', '0'))
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    return made.canvas
  }

  /** 远山：一道很淡的起伏，给城市一个背景。 */
  function paintRidge(ctx, w, h, night) {
    ctx.fillStyle = night ? 'rgba(18,30,46,0.55)' : 'rgba(96,118,140,0.26)'
    ctx.beginPath()
    ctx.moveTo(0, h * 0.66)
    for (var x = 0; x <= w; x += Math.max(6, w / 26)) {
      ctx.lineTo(x, h * (0.62 + Math.sin((x / w) * 3.4 + 1.2) * 0.035))
    }
    ctx.lineTo(w, h)
    ctx.lineTo(0, h)
    ctx.closePath()
    ctx.fill()
  }

  /** 城市：三层楼，越近越暗；窗子亮着，夜里更多。 */
  function paintCity(ctx, w, h, night) {
    var build = seeded(7)
    var layers = night
      ? [[0.64, 0.42, 'rgba(26,38,52,0.72)'], [0.72, 0.58, 'rgba(16,26,38,0.86)'], [0.82, 0.72, 'rgba(6,12,20,0.94)']]
      : [[0.64, 0.36, 'rgba(78,98,120,0.62)'], [0.72, 0.52, 'rgba(54,72,92,0.76)'], [0.82, 0.68, 'rgba(32,46,62,0.88)']]
    for (var l = 0; l < layers.length; l += 1) {
      var layer = layers[l]
      ctx.fillStyle = layer[2]
      var cursor = -w * 0.04
      while (cursor < w * 1.06) {
        var width = w * (0.035 + build() * 0.065)
        var height = h * (0.05 + build() * 0.16) * layer[1]
        var top = h * layer[0] - height
        ctx.fillRect(cursor, top, width, height + h * 0.4)
        var cols = Math.max(1, Math.floor(width / 7.5))
        var rows = Math.max(1, Math.floor(height / 9))
        for (var col = 0; col < cols; col += 1) {
          for (var row = 0; row < rows; row += 1) {
            if (build() < (night ? 0.38 : 0.58)) continue
            ctx.fillStyle = night
              ? 'rgba(255,208,140,' + (0.45 + build() * 0.5).toFixed(3) + ')'
              : 'rgba(255,244,214,' + (0.5 + build() * 0.45).toFixed(3) + ')'
            ctx.fillRect(cursor + 2 + col * 7.5, top + 3 + row * 9, 3, 3.8)
          }
        }
        ctx.fillStyle = layer[2]
        cursor += width + w * 0.005
      }
    }
  }

  /** 地面的灯：几团焦外光斑，玻璃一糊就成暖色光团。 */
  function paintLamps(ctx, w, h) {
    var lamp = seeded(53)
    for (var k = 0; k < 6; k += 1) {
      var x = lamp() * w
      var y = h * (0.76 + lamp() * 0.16)
      var radius = h * (0.03 + lamp() * 0.05)
      var warm = k % 3 !== 2
      var glow = ctx.createRadialGradient(x, y, 0, x, y, radius)
      glow.addColorStop(0, warm ? 'rgba(255,226,168,0.95)' : 'rgba(196,228,255,0.85)')
      glow.addColorStop(0.45, warm ? 'rgba(255,206,140,0.45)' : 'rgba(160,205,245,0.35)')
      glow.addColorStop(1, warm ? 'rgba(255,200,140,0)' : 'rgba(150,200,240,0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  /** 阴雨雪天的一层厚云：几条横着的柔光带，压在城市上方。 */
  function paintCloudBank(ctx, w, h, tone, seed) {
    var rand = seeded(seed)
    for (var i = 0; i < 7; i += 1) {
      var x = rand() * w
      var y = h * (0.06 + rand() * 0.4)
      var radius = h * (0.2 + rand() * 0.26)
      var band = ctx.createRadialGradient(x, y, 0, x, y, radius)
      band.addColorStop(0, tone.mid)
      band.addColorStop(0.6, tone.shade)
      band.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalAlpha = 0.5
      ctx.fillStyle = band
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  /**
   * 画天：天光、太阳或月亮、云。城市挡在它前面，所以云要画在这一层。
   *
   * @param ctx - 已经按像素比设好变换的 2D 上下文。
   * @param w - CSS 像素宽。
   * @param h - CSS 像素高。
   * @param scene - `clear`、`cloudy`、`overcast`、`rain`、`snow` 或 `storm`。
   * @param night - 是否夜里。
   * @param dark - 是否深色主题。
   */
  function paintSky(ctx, w, h, scene, night, dark) {
    var palette = paletteOf(scene, night, dark)
    var tone = cloudTone(scene, night, dark)
    paintSkyGradient(ctx, w, h, palette)
    paintCelestial(ctx, w, h, night, scene, 0, 1)
    var bodyX = w * (night ? 0.76 : 0.74)
    var bodyY = h * (night ? 0.24 : 0.22)
    if (scene === 'clear' || scene === 'cloudy') {
      // 远处几朵积云烘进这一层：它们不动，动的是 main.js 逐帧搬的近处那几朵。
      // 烘的时候避开日轮与月轮：晴天里那轮日月是主角，不能被云盖住。
      var rand = seeded(scene === 'clear' ? 11 : 23)
      var count = scene === 'clear' ? 4 : 6
      var clearance = h * 0.26
      for (var i = 0; i < count; i += 1) {
        var size = h * (0.26 + rand() * 0.22)
        var x = rand() * w
        var y = h * (0.12 + rand() * 0.26)
        for (var attempt = 0; attempt < 6; attempt += 1) {
          var dx = x - bodyX
          var dy = y - bodyY
          if (Math.sqrt(dx * dx + dy * dy) > clearance + size * 0.5) break
          x = rand() * w
          y = h * (0.12 + rand() * 0.26)
        }
        // 光从日月那一侧打过来，云才知道哪一面该亮
        var vx = bodyX - x
        var vy = bodyY - y
        var len = Math.max(1, Math.sqrt(vx * vx + vy * vy))
        ctx.save()
        ctx.globalAlpha = 0.94
        paintCumulus(ctx, x, y, size, tone, cumulusShape(100 + i * 7), { x: vx / len, y: vy / len })
        ctx.restore()
      }
      // 日月从云后透出来的那圈光：压在云上，云就有被照透的感觉。烘一次，不逐帧叠。
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      var bloom = ctx.createRadialGradient(bodyX, bodyY, 0, bodyX, bodyY, h * (night ? 0.44 : 0.52))
      bloom.addColorStop(0, night ? 'rgba(198,216,248,0.3)' : 'rgba(255,246,214,0.34)')
      bloom.addColorStop(0.42, night ? 'rgba(170,198,240,0.11)' : 'rgba(255,238,190,0.13)')
      bloom.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = bloom
      ctx.fillRect(0, 0, w, h)
      ctx.restore()
    } else {
      paintCloudBank(ctx, w, h, tone, scene === 'storm' ? 41 : 29)
    }
  }

  /**
   * 画地面：远山、城市天际线与灯火。上面是透明的，叠在云之上，城市就挡住了云。
   *
   * @param ctx - 已经按像素比设好变换的 2D 上下文。
   * @param w - CSS 像素宽。
   * @param h - CSS 像素高。
   * @param night - 是否夜里。
   */
  function paintGround(ctx, w, h, night) {
    paintRidge(ctx, w, h, night)
    paintCity(ctx, w, h, night)
    paintLamps(ctx, w, h)
  }

  root.WxWorld = {
    paintSky: paintSky,
    paintGround: paintGround,
    paletteOf: paletteOf,
    cloudTone: cloudTone,
    paintCelestial: paintCelestial,
    paintStars: paintStars,
    cumulusSprite: cumulusSprite,
    cloudSprite: cloudSprite,
    seeded: seeded
  }
})(window)
