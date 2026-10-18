/**
 * 授权表：`$DSH_HOME/widget-board/grants.json`（D6）。
 *
 * 一条授权把一个组件版本（内容哈希）与一个数据源或动作的名字绑在一起，只由人给出。组件变了内容，
 * 哈希就变了，之前给出的授权不再匹配——要重新问一次。看板自己是唯一写入者，写入串行。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ActionPermission, Grant, GrantKind } from '@dsh-widget-board/contracts'
import { GRANT_KINDS, grantKey } from '@dsh-widget-board/contracts'

/** 授权表的格式版本。 */
export const GRANTS_FORMAT = 1

/** 磁盘上的形状。 */
interface StoredGrants {
  version: number
  grants: Grant[]
}

/** 授权表。 */
export interface GrantStore {
  /** 当前全部授权，按 key 索引。 */
  all(): readonly Grant[]
  /** 有没有这一条授权。 */
  has(kind: GrantKind, hash: string, id: string): boolean
  /** 记下一条授权；已经有同一条时返回原有的那条。 */
  grant(input: Omit<Grant, 'key' | 'at'> & { at?: string }): Promise<Grant>
  /** 撤掉一条授权；本来就没有时返回假。 */
  revoke(kind: GrantKind, hash: string, id: string): Promise<boolean>
  /** 撤掉符合条件的那几条授权；返回撤掉了几条。条件之间是「且」，都不给时不撤任何一条。 */
  forget(options: { hashes?: readonly string[], kind?: GrantKind, id?: string, provider?: string }): Promise<number>
}

/** 一条记录的形状对不对；读盘时用它挡掉手改坏的记录。 */
function isGrant(value: unknown): value is Grant {
  if (typeof value !== 'object' || value === null) return false
  const grant = value as Record<string, unknown>
  return typeof grant.key === 'string'
    && typeof grant.id === 'string'
    && typeof grant.hash === 'string'
    && typeof grant.widget === 'string'
    && typeof grant.at === 'string'
    && (GRANT_KINDS as readonly string[]).includes(grant.kind as string)
}

/**
 * 打开授权表。
 *
 * 文件不存在时按空表算；文件在但读不出来、或格式版本对不上时抛出，保留原文件（D11）。
 *
 * @param file - `grants.json` 的路径。
 * @returns 授权表。
 * @throws {Error} 文件读不出来或格式不对。
 */
export async function openGrants(file: string): Promise<GrantStore> {
  const grants = new Map<string, Grant>()
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as StoredGrants
    if (raw.version !== GRANTS_FORMAT) throw new Error(`${file} 的格式版本是 ${String(raw.version)}，这一版读的是 ${String(GRANTS_FORMAT)}`)
    for (const grant of raw.grants ?? []) {
      if (isGrant(grant)) grants.set(grant.key, grant)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  let writing: Promise<void> = Promise.resolve()
  const flush = (): Promise<void> => {
    const run = writing.then(async () => {
      await mkdir(dirname(file), { recursive: true })
      const temporary = `${file}.tmp`
      await writeFile(temporary, `${JSON.stringify({ version: GRANTS_FORMAT, grants: [...grants.values()] } satisfies StoredGrants)}\n`, 'utf8')
      await rename(temporary, file)
    })
    writing = run.then(() => undefined, () => undefined)
    return run
  }

  return {
    all() {
      return [...grants.values()]
    },
    has(kind, hash, id) {
      return grants.has(grantKey(kind, hash, id))
    },
    async grant(input) {
      const key = grantKey(input.kind, input.hash, input.id)
      const existing = grants.get(key)
      if (existing !== undefined) return existing
      const grant: Grant = {
        key,
        kind: input.kind,
        id: input.id,
        hash: input.hash,
        widget: input.widget,
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.permission === undefined ? {} : { permission: input.permission }),
        at: input.at ?? new Date().toISOString(),
      }
      grants.set(key, grant)
      await flush()
      return grant
    },
    async revoke(kind, hash, id) {
      const key = grantKey(kind, hash, id)
      if (!grants.delete(key)) return false
      await flush()
      return true
    },
    async forget(options) {
      if (options.hashes === undefined && options.kind === undefined && options.id === undefined && options.provider === undefined) return 0
      let removed = 0
      for (const [key, grant] of [...grants]) {
        const byHash = options.hashes === undefined || options.hashes.includes(grant.hash)
        const byKind = options.kind === undefined || grant.kind === options.kind
        const byId = options.id === undefined || grant.id === options.id
        const byProvider = options.provider === undefined || grant.provider === options.provider
        if (byHash && byKind && byId && byProvider) {
          grants.delete(key)
          removed += 1
        }
      }
      if (removed > 0) await flush()
      return removed
    },
  }
}

/**
 * 一个动作要的权限是不是在这条授权里。
 *
 * 动作自己声明的权限必须被授权覆盖：授权时看到的权限与现在的不一致，说明提供的动作换过要的东西，
 * 要重新问一次。
 *
 * @param registered - 注册的动作声明的权限。
 * @param granted - 授权时记下的权限。
 * @returns 一致时为真。
 */
export function permissionMatches(registered: ActionPermission | undefined, granted: ActionPermission | undefined): boolean {
  const same = (left: readonly string[] | undefined, right: readonly string[] | undefined): boolean => {
    const a = [...(left ?? [])].sort()
    const b = [...(right ?? [])].sort()
    return a.length === b.length && a.every((value, index) => value === b[index])
  }
  return same(registered?.hosts, granted?.hosts) && same(registered?.commands, granted?.commands)
}
