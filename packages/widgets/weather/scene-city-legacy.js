/*
 * 中国尊所在的 CBD：街景主体由 `city-beijing.js` 等城市档案给出，这一份只放通用街景。
 */
;(function (root) {
  'use strict'

  function create(THREE, api) {
    var group = new THREE.Group()
    var kit = root.WxCityKit

    // 远景天际线
    var facade = (function () {
      var canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 128
      var ctx = canvas.getContext('2d')
      ctx.fillStyle = '#0a0d13'
      ctx.fillRect(0, 0, 64, 128)
      for (var row = 0; row < 16; row += 1) {
        for (var column = 0; column < 6; column += 1) {
          ctx.fillStyle = Math.random() > 0.5 ? '#ffd08a' : '#11161f'
          ctx.fillRect(column * 10.6 + 1, row * 8 + 1.5, 8.6, 5)
        }
      }
      var texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      return texture
    })()
    var material = new THREE.MeshStandardMaterial({ map: facade, emissiveMap: facade, emissive: new THREE.Color(0xffd7a0), emissiveIntensity: 0.2, color: 0x0b1018, roughness: 0.6, metalness: 0.3 })
    var random = kit.seeded(19)
    var mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, 60)
    var matrix = new THREE.Matrix4()
    for (var i = 0; i < 60; i += 1) {
      var width = 6 + random() * 10
      var height = 18 + random() * 70
      var x = -150 + random() * 300
      if (Math.abs(x) < 24) x += (x < 0 ? -1 : 1) * 30
      engine: {
        matrix.makeScale(width, height, width)
        matrix.setPosition(x, height / 2, -95 - random() * 90)
        mesh.setMatrixAt(i, matrix)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    group.add(mesh)

    var look = { ambient: 0.95, exposure: 1, fog: 1, bloom: 0.3 }
    return {
      id: 'city',
      group: group,
      camera: { height: 10.4, distance: 36, targetY: 11.4, fov: 52 },
      look: look,
      setWeather: function () {},
      resize: function () {},
      update: function () {},
      dispose: function () {
        group.traverse(function (object) {
          if (object.geometry) object.geometry.dispose()
        })
        facade.dispose()
        material.dispose()
      },
    }
  }

  root.WxScenes = root.WxScenes || {}
  root.WxScenes.city = create
})(window)
