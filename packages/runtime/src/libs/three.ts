/**
 * 精选库 `three`：Three.js 渲染库，以 `window.THREE` 交给组件（D7）。
 *
 * 同时挂上组件用得到的后期处理与环境光模块：`window.THREE_ADDONS` 里是泛光、合成器与
 * RoomEnvironment。它们共用同一份 Three.js 实例，所以组件里可以混用两个全局。
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

;(globalThis as typeof globalThis & { THREE?: typeof THREE }).THREE = THREE

;(globalThis as typeof globalThis & { THREE_ADDONS?: Record<string, unknown> }).THREE_ADDONS = {
  EffectComposer,
  RenderPass,
  UnrealBloomPass,
  OutputPass,
  RoomEnvironment,
}
