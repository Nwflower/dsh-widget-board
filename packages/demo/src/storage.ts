/**
 * 演示宿主的存储：浏览器里 IndexedDB 的一个键（D25）。
 *
 * 看板的布局与卡片状态写在这里，刷新之后还在。Service Worker 读不到 `localStorage`，页面和
 * Service Worker 都能打开同一个 IndexedDB，所以存储放在这一个键上，两边共用这几个函数。
 */
import type { Board } from '@dsh-widget-board/contracts'

const DATABASE = 'dsh-widget-board-demo'
const STORE = 'workspace'
const KEY = 'current'

/** 存下来的工作区：它来自哪份默认看板（`seed`），以及看板本身。 */
export interface StoredWorkspace {
  seed: string
  active: string
  boards: Board[]
}

/** 把一次 IndexedDB 请求变成 Promise。 */
function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => { resolve(request.result) }
    request.onerror = () => { reject(request.error ?? new Error('IndexedDB 请求失败')) }
  })
}

/** 打开数据库；第一次打开时建出存放工作区的那个对象仓库。 */
function open(): Promise<IDBDatabase> {
  const request = indexedDB.open(DATABASE, 1)
  request.onupgradeneeded = () => { request.result.createObjectStore(STORE) }
  return settled(request)
}

/**
 * 在一次事务里对工作区这个键做一件事。
 *
 * @param mode - 事务模式。
 * @param run - 拿到对象仓库后发出请求。
 * @returns 请求的结果。
 */
async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await open()
  try {
    return await settled(run(database.transaction(STORE, mode).objectStore(STORE)))
  } finally {
    database.close()
  }
}

/**
 * 读存下来的工作区。
 *
 * @returns 工作区；还没有存过时是 `undefined`。
 */
export async function readStored(): Promise<StoredWorkspace | undefined> {
  return await withStore('readonly', (store) => store.get(KEY) as IDBRequest<StoredWorkspace | undefined>)
}

/**
 * 存下工作区。
 *
 * @param workspace - 要存的工作区。
 */
export async function writeStored(workspace: StoredWorkspace): Promise<void> {
  await withStore('readwrite', (store) => store.put(workspace, KEY))
}

/** 清掉存下来的工作区：下一次读取回到默认看板。 */
export async function clearStored(): Promise<void> {
  await withStore('readwrite', (store) => store.delete(KEY))
}
