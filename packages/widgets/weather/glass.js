/*
 * 玻璃：背后的世界、雨雪落上去之后的流动、水珠的折射、水雾与颗粒。
 *
 * 一块画布画一帧。水珠分两种：小的用烘好的贴图，一枚一次 drawImage；大到 2.4 像素以上的真折射，
 * 从倒置放大的世界取样，逐颗裁剪。这样一帧的绘制成本主要花在可见的大水珠上，数量可控。
 *
 * 世界模糊后的一层与倒置的一层在换天、改尺寸时各烘一次，逐帧不再重算（D10 的动效令牌只管
 * 时长与曲线，像素工作按盒子的实际大小算）。
 */
;(function (root) {
  /** 一枚小水珠的贴图：亮心、底部焦散、上缘暗边与高光。 */
  function dropSprite(make, radius) {
    var pad = 2.5
    var size = (radius + pad) * 2
    var made = make(size, size, 3)
    var ctx = made.ctx
    var c = size / 2
    ctx.save()
    ctx.beginPath()
    ctx.arc(c, c, radius, 0, Math.PI * 2)
    ctx.clip()
    var body = ctx.createRadialGradient(c - radius * 0.3, c - radius * 0.35, radius * 0.05, c, c, radius)
    body.addColorStop(0, 'rgba(232,246,255,0.7)')
    body.addColorStop(0.5, 'rgba(186,214,240,0.4)')
    body.addColorStop(0.86, 'rgba(120,165,205,0.28)')
    body.addColorStop(1, 'rgba(40,70,100,0.44)')
    ctx.fillStyle = body
    ctx.fillRect(0, 0, size, size)
    // 底部焦散：光穿过水珠聚在下缘
    var caustic = ctx.createRadialGradient(c, c + radius * 0.55, 0, c, c + radius * 0.55, radius * 0.85)
    caustic.addColorStop(0, 'rgba(255,253,240,0.55)')
    caustic.addColorStop(1, 'rgba(255,253,240,0)')
    ctx.fillStyle = caustic
    ctx.fillRect(0, 0, size, size)
    // 上缘暗边：水与空气界面把顶光折走
    ctx.lineWidth = Math.max(0.4, radius * 0.3)
    ctx.strokeStyle = 'rgba(20,36,52,0.4)'
    ctx.beginPath()
    ctx.arc(c, c, radius - ctx.lineWidth * 0.5, Math.PI * 1.05, Math.PI * 1.95)
    ctx.stroke()
    ctx.restore()
    // 下缘亮弧与高光
    ctx.lineWidth = Math.max(0.45, radius * 0.24)
    ctx.strokeStyle = 'rgba(246,253,255,0.6)'
    ctx.beginPath()
    ctx.arc(c, c, radius - ctx.lineWidth * 0.5, Math.PI * 0.1, Math.PI * 0.9)
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.beginPath()
    ctx.ellipse(c - radius * 0.32, c - radius * 0.36, Math.max(0.35, radius * 0.2), Math.max(0.3, radius * 0.14), -0.5, 0, Math.PI * 2)
    ctx.fill()
    return { canvas: made.canvas, size: size, r: radius }
  }

  /** 一条滑痕的贴图：中间亮、两侧散开、两头渐隐。 */
  function trailSprite(make) {
    var width = 32
    var height = 128
    var made = make(width, height)
    var ctx = made.ctx
    var across = ctx.createLinearGradient(0, 0, width, 0)
    across.addColorStop(0, 'rgba(226,240,255,0)')
    across.addColorStop(0.34, 'rgba(226,240,255,0.3)')
    across.addColorStop(0.5, 'rgba(242,251,255,0.56)')
    across.addColorStop(0.66, 'rgba(226,240,255,0.3)')
    across.addColorStop(1, 'rgba(226,240,255,0)')
    ctx.fillStyle = across
    ctx.fillRect(0, 0, width, height)
    var along = ctx.createLinearGradient(0, 0, 0, height)
    along.addColorStop(0, 'rgba(0,0,0,0)')
    along.addColorStop(0.16, 'rgba(0,0,0,0.85)')
    along.addColorStop(0.82, 'rgba(0,0,0,1)')
    along.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalCompositeOperation = 'destination-in'
    ctx.fillStyle = along
    ctx.fillRect(0, 0, width, height)
    ctx.globalCompositeOperation = 'source-over'
    return made.canvas
  }

  /** 一颗贴在玻璃上的水珠。 */
  function newDrop(rand, w, h) {
    return {
      x: rand(-6, w + 6),
      y: rand(0, h),
      r: rand(0.8, 2.4),
      vy: 0,
      slide: false,
      // 长到多大才开始滑：每颗不一样，玻璃上就不会整片一起动
      slideAt: rand(2.5, 3.8),
      sq: rand(0.82, 1),
      wobble: rand(0, 6.28),
      wobbleAmp: rand(0.3, 1.1),
      wobbleFreq: rand(0.6, 2.2),
      grow: rand(0.25, 0.8)
    }
  }

  /**
   * 造一块玻璃的画面。
   *
   * @param options.make - 造画布：`(w, h, dpr)` 或 `(size)`，返回 `{ canvas, ctx }`。
   * @param options.rand - 随机源。
   * @returns 画玻璃的一组函数与状态。
   */
  function createGlass(options) {
    var make = options.make
    var rand = options.rand
    var state = {
      w: 0,
      h: 0,
      blurredSky: null,
      blurredGround: null,
      sky: null,
      ground: null,
      flipped: null,
      grain: null,
      mists: null,
      sprites: [],
      trailSprite: null,
      drops: [],
      trails: [],
      flakes: [],
      world: null
    }

    /**
     * 按盒子与天空重建离屏资源。
     *
     * 天空与地面各糊一份：云要夹在两者之间，只能分开糊。水珠里的世界用合起来的那一份。
     *
     * @param w - CSS 像素宽。
     * @param h - CSS 像素高。
     * @param dpr - 像素比。
     * @param scene - 当前的天。
     * @param night - 是否夜里。
     * @param sky - 画好的天（清晰的那一份）。
     * @param ground - 画好的地面（清晰的那一份，上方透明）。
     * @param world - 天与地面合起来的一份，供水珠折射。
     */
    function rebuild(w, h, dpr, scene, night, sky, ground, world) {
      state.w = w
      state.h = h
      state.sky = sky
      state.ground = ground
      state.world = world
      var blur = 'blur(' + Math.max(3, Math.round(h * 0.016)) + 'px)'
      state.blurredSky = make(w, h, dpr)
      state.blurredSky.ctx.filter = blur
      state.blurredSky.ctx.drawImage(sky, 0, 0, w, h)
      state.blurredSky.ctx.filter = 'none'
      state.blurredGround = make(w, h, dpr)
      state.blurredGround.ctx.filter = blur
      state.blurredGround.ctx.drawImage(ground, 0, 0, w, h)
      state.blurredGround.ctx.filter = 'none'

      // 水珠里的世界：倒置并放大，一次烘好
      var zoom = 2.1
      state.flipped = make(w, h, dpr)
      state.flipped.ctx.filter = 'blur(3px)'
      state.flipped.ctx.translate(w, h)
      state.flipped.ctx.scale(-zoom, -zoom)
      state.flipped.ctx.drawImage(world, -w / zoom, -h / zoom, w / zoom, h / zoom)
      state.flipped.ctx.filter = 'none'

      // 颗粒：低分辨率噪点放大，省一次全图循环
      state.grain = make(Math.ceil(w / 2), Math.ceil(h / 2), 1)
      var noise = state.grain.ctx.createImageData(state.grain.canvas.width, state.grain.canvas.height)
      for (var i = 0; i < noise.data.length; i += 4) {
        var value = 110 + Math.random() * 145
        noise.data[i] = value
        noise.data[i + 1] = value
        noise.data[i + 2] = value
        noise.data[i + 3] = 14
      }
      state.grain.ctx.putImageData(noise, 0, 0)

      // 水雾：靠边浓、中间透，整张预烘。只有下雨下雪的日子才真的起雾。
      state.mists = make(w, h, dpr)
      var wet = scene === 'rain' || scene === 'storm' || scene === 'snow'
      if (wet) {
        var mist = state.mists.ctx.createRadialGradient(w * 0.5, h * 0.4, h * 0.12, w * 0.5, h * 0.52, h * 1.05)
        mist.addColorStop(0, 'rgba(224,238,252,0.04)')
        mist.addColorStop(0.55, 'rgba(224,238,252,0.11)')
        mist.addColorStop(1, 'rgba(236,246,255,0.26)')
        state.mists.ctx.fillStyle = mist
        state.mists.ctx.fillRect(0, 0, w, h)
      }

      state.sprites = [1.2, 1.8, 2.6, 3.6, 5].map(function (r) { return dropSprite(make, r) })
      state.trailSprite = trailSprite(make)
      seed(scene)
    }

    /**
     * 一批水珠与雪的初值。
     *
     * 雨天的玻璃上要一直有水珠：补到目标数量，分布上密下疏，和雨打在玻璃上的样子一致。
     */
    function seed(scene) {
      state.drops = []
      state.trails = []
      state.flakes = []
      if (scene === 'snow') {
        for (var f = 0; f < 90; f += 1) {
          state.flakes.push({
            x: rand(0, state.w),
            y: rand(0, state.h),
            r: rand(0.7, 2.4),
            vy: rand(8, 30),
            sway: rand(0.4, 1.4),
            phase: rand(0, 6.28),
            alpha: rand(0.45, 0.95)
          })
        }
        return
      }
      if (scene !== 'rain' && scene !== 'storm') return
      refill(scene === 'storm' ? 210 : 160)
    }

    /** 把玻璃上的水珠补到目标数量，补进来的直接落在玻璃上。 */
    function refill(target) {
      var missing = target - state.drops.length
      while (missing > 0) {
        var drop = newDrop(rand, state.w, state.h)
        drop.y = Math.pow(Math.random(), 1.35) * state.h
        drop.r = rand(0.9, 3.4)
        state.drops.push(drop)
        missing -= 1
      }
    }

    /** 推进一帧：水珠长大、滑动、掉渣，水痕蒸发，雪飘。 */
    function advance(dt, scene) {
      var w = state.w
      var h = state.h
      if (scene === 'snow') {
        for (var f = 0; f < state.flakes.length; f += 1) {
          var flake = state.flakes[f]
          flake.phase += dt * flake.sway
          flake.y += flake.vy * dt
          flake.x += Math.sin(flake.phase) * dt * 14
          if (flake.y > h + 4) {
            flake.y = -4
            flake.x = rand(0, w)
          }
          if (flake.x < -4) flake.x = w + 4
          if (flake.x > w + 4) flake.x = -4
        }
        return
      }
      var storm = scene === 'storm'
      var wet = storm || scene === 'rain'
      if (wet) refill(storm ? 190 : 140)
      for (var i = state.drops.length - 1; i >= 0; i -= 1) {
        var drop = state.drops[i]
        if (!drop.slide) {
          drop.r += dt * drop.grow
          if (drop.r > drop.slideAt) {
            drop.slide = true
            drop.vy = rand(8, 18)
          }
          continue
        }
        // 速度封顶：水在玻璃上爬，不是自由落体，否则一瞬间就滑出画面，玻璃上永远留不住水
        drop.vy = Math.min(drop.vy + dt * 90, storm ? 150 : 120)
        drop.wobble += dt * drop.wobbleFreq
        var vx = Math.sin(drop.wobble) * drop.wobbleAmp * 12
        var previousY = drop.y
        drop.y += drop.vy * dt
        drop.x += vx * dt
        drop.r -= dt * rand(0.02, 0.1)
        if (drop.y - previousY > 0.4) {
          state.trails.push({ x: drop.x, y0: previousY - drop.r, y1: drop.y, w: Math.max(0.9, drop.r * 0.66), life: 1 })
          if (state.trails.length > 160) state.trails.shift()
        }
        // 滑瘦了就停下来，重新当一颗静止的水珠；掉出玻璃才移除
        if (drop.r < 0.9) {
          drop.slide = false
          drop.vy = 0
          drop.r = rand(0.9, 1.6)
          drop.slideAt = rand(2.5, 3.8)
        }
        if (drop.y > h + 12 || drop.x < -24 || drop.x > w + 24) state.drops.splice(i, 1)
      }
      for (var j = state.trails.length - 1; j >= 0; j -= 1) {
        state.trails[j].life -= dt * 0.12
        if (state.trails[j].life <= 0) state.trails.splice(j, 1)
      }
    }

    /** 大的水珠真折射：从倒置并放大的世界取样，边缘压暗，下缘聚光。 */
    function drawLens(ctx, drop) {
      var ry = drop.r
      var rx = drop.r * drop.sq
      ctx.save()
      ctx.beginPath()
      ctx.ellipse(drop.x, drop.y, rx, ry, 0, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(state.flipped.canvas, 0, 0, state.w, state.h)
      var sphere = ctx.createRadialGradient(drop.x - rx * 0.34, drop.y - ry * 0.36, ry * 0.04, drop.x, drop.y, ry * 1.02)
      sphere.addColorStop(0, 'rgba(255,255,255,0.24)')
      sphere.addColorStop(0.45, 'rgba(150,190,225,0.05)')
      sphere.addColorStop(1, 'rgba(8,18,28,0.55)')
      ctx.fillStyle = sphere
      ctx.fillRect(drop.x - rx, drop.y - ry, rx * 2, ry * 2)
      var caustic = ctx.createRadialGradient(drop.x, drop.y + ry * 0.6, 0, drop.x, drop.y + ry * 0.6, rx * 0.85)
      caustic.addColorStop(0, 'rgba(255,252,238,0.6)')
      caustic.addColorStop(1, 'rgba(255,252,238,0)')
      ctx.fillStyle = caustic
      ctx.fillRect(drop.x - rx, drop.y - ry, rx * 2, ry * 2)
      ctx.restore()
      ctx.lineWidth = Math.max(0.6, ry * 0.22)
      ctx.strokeStyle = 'rgba(246,253,255,0.6)'
      ctx.beginPath()
      ctx.ellipse(drop.x, drop.y, Math.max(0.4, rx - ctx.lineWidth * 0.5), Math.max(0.4, ry - ctx.lineWidth * 0.5), 0, Math.PI * 0.1, Math.PI * 0.9)
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.94)'
      ctx.beginPath()
      ctx.ellipse(drop.x - rx * 0.32, drop.y - ry * 0.36, Math.max(0.4, rx * 0.2), Math.max(0.3, ry * 0.14), -0.5, 0, Math.PI * 2)
      ctx.fill()
    }

    /**
     * 画玻璃后的那一层天。
     *
     * 晴天的天空是一幅清楚的画，糊了就成了一片雾，所以那几天直接画清楚的那一份；
     * 阴雨雪天要的就是隔着玻璃看出去的朦胧，画糊过的那一份。
     *
     * @param ctx - 卡片上的那块画布。
     * @param sharp - 是否画清楚的那一份。
     */
    function paintBackdrop(ctx, sharp) {
      if (state.sky === null) return
      var source = sharp === true ? state.sky : state.blurredSky.canvas
      ctx.drawImage(source, 0, 0, state.w, state.h)
    }

    /**
     * 画地面那一层，叠在云之上，城市就挡住了云。
     *
     * @param ctx - 卡片上的那块画布。
     * @param sharp - 是否画清楚的那一份。
     */
    function paintGround(ctx, sharp) {
      if (state.ground === null) return
      var source = sharp === true ? state.ground : state.blurredGround.canvas
      ctx.drawImage(source, 0, 0, state.w, state.h)
    }

    /**
     * 画玻璃上的东西：水痕、水珠、雪，最后是水雾与颗粒。
     *
     * @param ctx - 卡片上的那块画布。
     * @param scene - 当前的天。
     * @param lensBudget - 这一帧最多做几次真折射。
     */
    function paint(ctx, scene, lensBudget) {
      var w = state.w
      var h = state.h
      if (state.world === null) return

      if (state.trails.length > 0 && state.trailSprite !== null) {
        for (var t = 0; t < state.trails.length; t += 1) {
          var trail = state.trails[t]
          var height = trail.y1 - trail.y0
          if (height < 0.5) continue
          ctx.globalAlpha = Math.max(0, trail.life) * 0.5
          ctx.drawImage(state.trailSprite, trail.x - trail.w * 1.6, trail.y0, trail.w * 3.2, height)
        }
        ctx.globalAlpha = 1
      }

      var budget = lensBudget
      for (var d = 0; d < state.drops.length; d += 1) {
        var drop = state.drops[d]
        if (drop.r >= 2.4 && budget > 0) {
          budget -= 1
          drawLens(ctx, drop)
          continue
        }
        var sprite = state.sprites[0]
        for (var k = 0; k < state.sprites.length; k += 1) {
          if (Math.abs(state.sprites[k].r - drop.r) < Math.abs(sprite.r - drop.r)) sprite = state.sprites[k]
        }
        var size = sprite.size * (drop.r / sprite.r)
        if (size < 1) continue
        ctx.drawImage(sprite.canvas, drop.x - size / 2, drop.y - size / 2, size, size)
      }

      // 雪：不透光的小点，飘着落
      for (var f = 0; f < state.flakes.length; f += 1) {
        var flake = state.flakes[f]
        ctx.globalAlpha = flake.alpha
        ctx.fillStyle = 'rgba(252,254,255,0.95)'
        ctx.beginPath()
        ctx.arc(flake.x, flake.y, flake.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      ctx.drawImage(state.mists.canvas, 0, 0, w, h)
      ctx.drawImage(state.grain.canvas, 0, 0, w, h)
    }

    return { state: state, rebuild: rebuild, advance: advance, paintBackdrop: paintBackdrop, paintGround: paintGround, paint: paint }
  }

  root.WxGlass = { createGlass: createGlass }
})(window)
