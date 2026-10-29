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
  let parent: FSWatcher | null = null
  try {
    parent = watch(dirname(target), (_event, name) => {
      if (name !== null && name.toString() !== basename(target)) return
      fire()
      arm()
    })
  } catch {
    // 父目录也还不存在（用户组件目录第一次使用时才会建）：监视退化成只在目录已在时生效。
    parent = null
  }
  return () => {
    clearTimeout(timer)
    parent?.close()
    tree?.close()
  }
}

/** 按目录共享的监视：同一个目录只有一个底层监视，最后一个把手释放时才停掉。 */
export interface WatchRegistry {
  /**
   * 取一份这个目录的监视。
   *
   * @param dir - 目录。
   * @returns 释放这一份的函数；重复调用只算一次。
   */
  acquire(dir: string): () => void
  /** 现在挂着监视的目录数。 */
  readonly size: number
  /** 停掉全部监视；拆除时用。 */
  stopAll(): void
}

/**
 * 建一份按目录共享的监视。
 *
 * 多个提供方可以注册同一个目录（D17）：谁先注册谁挂上监视，后到的共用它。先释放的一方只交还自己那
 * 一份，最后一份交还时才停掉监视并删掉记录——否则先卸载的提供方会顺手停掉另一家的监视。
 *
 * @param start - 真正挂上一份监视；由它给出停止函数。
 * @returns 共享监视。
 */
export function createWatchRegistry(start: (dir: string) => () => void): WatchRegistry {
  const held = new Map<string, { count: number, stop: () => void }>()

  return {
    acquire(dir) {
      const entry = held.get(dir) ?? { count: 0, stop: start(dir) }
      entry.count += 1
      held.set(dir, entry)
      let released = false
      return () => {
        if (released) return
        released = true
        entry.count -= 1
        if (entry.count > 0) return
        held.delete(dir)
        entry.stop()
      }
    },
    get size() {
      return held.size
    },
    stopAll() {
      for (const entry of held.values()) entry.stop()
      held.clear()
    },
  }
}
