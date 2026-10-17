/**
 * 监视 `lib/`：构建写出来的组件库与运行时一改，就让宿主重读一次（D7）。
 *
 * 构建会先把 `lib/` 整个删掉再写回来，递归监视因此会随目录一起失效；父目录上的那一次改动把递归
 * 监视重新挂上。改动彼此挨得近时只重读一次。
 */
import { watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'

/** 改动安静下来这么久之后才重读。 */
const SETTLE_MS = 150

/**
 * 监视一棵目录树。
 *
 * @param target - 要监视的目录。
 * @param onChange - 安静下来之后调一次。
 * @returns 停止监视的函数。
 */
export function watchTree(target: string, onChange: () => void): () => void {
  let timer: NodeJS.Timeout | undefined
  let tree: FSWatcher | null = null
  const fire = (): void => {
    clearTimeout(timer)
    timer = setTimeout(onChange, SETTLE_MS)
  }
  const arm = (): void => {
    tree?.close()
    tree = null
    try {
      tree = watch(target, { recursive: true }, fire)
    } catch {
      // 目录此刻不在（构建正在重写它）：父目录上的那次改动会把监视重新挂上。
      tree = null
    }
  }
  arm()
  const parent = watch(dirname(target), (_event, name) => {
    if (name !== null && name.toString() !== basename(target)) return
    fire()
    arm()
  })
  return () => {
    clearTimeout(timer)
    parent.close()
    tree?.close()
  }
}
