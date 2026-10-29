/**
 * 一份只在内存里的授权表：判定授权与订阅的测试不碰磁盘（D6）。
 *
 * 形状与 `openGrants` 相同，写入同样是串行的；不同的只是不落盘、不留临时文件。
 */
import type { Grant } from '@dsh-widget-board/contracts'
import { grantKey } from '@dsh-widget-board/contracts'
import type { GrantStore } from '../src/grants'

/**
 * 建一份内存授权表。
 *
 * @returns 授权表。
 */
export function memoryGrants(): GrantStore {
  const grants = new Map<string, Grant>()
  return {
    all: () => [...grants.values()],
    has: (kind, hash, id) => grants.has(grantKey(kind, hash, id)),
    async grant(input) {
      const key = grantKey(input.kind, input.hash, input.id)
      const existing = grants.get(key)
      if (existing !== undefined) return existing
      const grant: Grant = { key, ...input, at: input.at ?? '2026-01-01T00:00:00.000Z' }
      grants.set(key, grant)
      return grant
    },
    async revoke(kind, hash, id) {
      return grants.delete(grantKey(kind, hash, id))
    },
    async forget(options) {
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
      return removed
    },
  }
}
