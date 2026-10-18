/**
 * 授权表与授权闸门（D6）。
 *
 * 授权只由人给出，绑在组件版本的内容哈希上；组件换了内容要重新问一次。这些测试盯住读取、写入、
 * 撤下与「权限变了要重问」这几条。
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Board } from '@dsh-widget-board/contracts'
import { createRegistries } from '../src/sources'
import { GRANTS_FORMAT, openGrants, permissionMatches } from '../src/grants'
import { requireGrant } from '../src/permissions'

const roots: string[] = []

/** 一个临时目录。 */
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-widget-board-grants-'))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (dir) => { await rm(dir, { recursive: true, force: true }) }))
})

/** 一张只有一张卡的看板。 */
function boardWith(widget: string): Board {
  return {
    version: 2,
    id: 'board',
    title: '看板',
    revision: 0,
    layoutRevision: 0,
    instances: [{ id: 'card', widget, hash: 'h1', props: {}, data: null, state: null, layout: { x: 0, y: 0, w: 1, h: 22 } }],
  }
}

describe('授权表', () => {
  it('没有文件时按空表算', async () => {
    const store = await openGrants(join(await scratch(), 'grants.json'))
    expect(store.all()).toEqual([])
    expect(store.has('action', 'h1', 'test.run')).toBe(false)
  })

  it('记下的授权跨重启还在', async () => {
    const file = join(await scratch(), 'grants.json')
    const store = await openGrants(file)
    await store.grant({ kind: 'action', id: 'test.run', hash: 'h1', widget: 'test-native', provider: 'p', permission: { hosts: ['example.invalid'] } })
    const reopened = await openGrants(file)
    expect(reopened.has('action', 'h1', 'test.run')).toBe(true)
    expect(reopened.all()[0]?.permission).toEqual({ hosts: ['example.invalid'] })
    const stored = JSON.parse(await readFile(file, 'utf8')) as { version: number }
    expect(stored.version).toBe(GRANTS_FORMAT)
  })

  it('同一个版本同一个名字只记一条', async () => {
    const store = await openGrants(join(await scratch(), 'grants.json'))
    const first = await store.grant({ kind: 'action', id: 'test.run', hash: 'h1', widget: 'test-native' })
    const again = await store.grant({ kind: 'action', id: 'test.run', hash: 'h1', widget: 'test-native' })
    expect(again).toBe(first)
    expect(store.all()).toHaveLength(1)
  })

  it('撤掉一条之后不再有', async () => {
    const store = await openGrants(join(await scratch(), 'grants.json'))
    await store.grant({ kind: 'source', id: 'test.count', hash: 'h1', widget: 'test-native' })
    expect(await store.revoke('source', 'h1', 'test.count')).toBe(true)
    expect(await store.revoke('source', 'h1', 'test.count')).toBe(false)
    expect(store.all()).toEqual([])
  })

  it('按提供方一次清掉它留下的授权', async () => {
    const store = await openGrants(join(await scratch(), 'grants.json'))
    await store.grant({ kind: 'action', id: 'a', hash: 'h1', widget: 'w', provider: 'gone' })
    await store.grant({ kind: 'action', id: 'b', hash: 'h1', widget: 'w', provider: 'stays' })
    expect(await store.forget({ provider: 'gone' })).toBe(1)
    expect(store.all().map((grant) => grant.id)).toEqual(['b'])
  })

  it('格式版本对不上时抛出，不读进来', async () => {
    const { writeFile } = await import('node:fs/promises')
    const file = join(await scratch(), 'grants.json')
    await writeFile(file, JSON.stringify({ version: 99, grants: [] }), 'utf8')
    await expect(openGrants(file)).rejects.toThrow(/格式版本/)
  })
})

describe('权限一致', () => {
  it('两边列的顺序不影响判定', () => {
    expect(permissionMatches({ hosts: ['a', 'b'] }, { hosts: ['b', 'a'] })).toBe(true)
  })

  it('授权时没有、现在有了，算不一致', () => {
    expect(permissionMatches({ commands: ['python'] }, undefined)).toBe(false)
  })

  it('两边都没有权限，算一致', () => {
    expect(permissionMatches(undefined, undefined)).toBe(true)
  })
})

describe('授权闸门', () => {
  const hashes = new Map([['test-native', 'h1']])
  /** 一次注册用的版本号。 */
  const apiVersion = 2

  it('动作没有权限要求时不必问人', async () => {
    const grants = await openGrants(join(await scratch(), 'grants.json'))
    expect(() => { requireGrant({ board: boardWith('test-native'), hashes, grants }, 'card', 'action', 'bump', undefined, 'p') }).not.toThrow()
  })

  it('看板自己的数据源不拦', async () => {
    const grants = await openGrants(join(await scratch(), 'grants.json'))
    expect(() => { requireGrant({ board: boardWith('test-native'), hashes, grants }, 'card', 'source', 'service:taskBoard', undefined, 'dsh-widget-board') }).not.toThrow()
  })

  it('要权限的动作在授权前被拒绝，拒绝里带着缺的那一条', async () => {
    const grants = await openGrants(join(await scratch(), 'grants.json'))
    let thrown: unknown
    try {
      requireGrant({ board: boardWith('test-native'), hashes, grants }, 'card', 'action', 'test.run', { hosts: ['example.invalid'] }, 'p')
    } catch (error) {
      thrown = error
    }
    expect((thrown as { status: number }).status).toBe(403)
    expect((thrown as { extra: { code: string, id: string } }).extra).toMatchObject({ code: 'grant-required', id: 'test.run' })
  })

  it('给过授权之后就放行', async () => {
    const grants = await openGrants(join(await scratch(), 'grants.json'))
    await grants.grant({ kind: 'action', id: 'test.run', hash: 'h1', widget: 'test-native', permission: { hosts: ['example.invalid'] } })
    expect(() => { requireGrant({ board: boardWith('test-native'), hashes, grants }, 'card', 'action', 'test.run', { hosts: ['example.invalid'] }, 'p') }).not.toThrow()
  })

  it('组件换了内容之后授权不再算数', async () => {
    const grants = await openGrants(join(await scratch(), 'grants.json'))
    await grants.grant({ kind: 'action', id: 'test.run', hash: 'old', widget: 'test-native', permission: { hosts: ['example.invalid'] } })
    expect(() => { requireGrant({ board: boardWith('test-native'), hashes, grants }, 'card', 'action', 'test.run', { hosts: ['example.invalid'] }, 'p') }).toThrow(/先由人给出授权/)
  })

  it('提供方把动作要的权限改大之后要重问', async () => {
    const grants = await openGrants(join(await scratch(), 'grants.json'))
    await grants.grant({ kind: 'action', id: 'test.run', hash: 'h1', widget: 'test-native', permission: { hosts: ['a'] } })
    expect(() => { requireGrant({ board: boardWith('test-native'), hashes, grants }, 'card', 'action', 'test.run', { hosts: ['a', 'b'] }, 'p') }).toThrow(/重新给出授权/)
  })

  it('不要权限的数据源不拦', async () => {
    const grants = await openGrants(join(await scratch(), 'grants.json'))
    expect(() => { requireGrant({ board: boardWith('test-native'), hashes, grants }, 'card', 'source', 'demo:count', undefined, 'demo') }).not.toThrow()
  })

  it('要权限的数据源在授权前被拦下，给过之后放行', async () => {
    const grants = await openGrants(join(await scratch(), 'grants.json'))
    const permission = { commands: ['python'] }
    expect(() => { requireGrant({ board: boardWith('test-native'), hashes, grants }, 'card', 'source', 'demo:run', permission, 'demo') }).toThrow(/先由人给出授权/)
    await grants.grant({ kind: 'source', id: 'demo:run', hash: 'h1', widget: 'test-native', provider: 'demo', permission })
    expect(() => { requireGrant({ board: boardWith('test-native'), hashes, grants }, 'card', 'source', 'demo:run', permission, 'demo') }).not.toThrow()
  })

  it('数据源把权限改大之后也要重问', async () => {
    const grants = await openGrants(join(await scratch(), 'grants.json'))
    await grants.grant({ kind: 'source', id: 'demo:run', hash: 'h1', widget: 'test-native', provider: 'demo', permission: { commands: ['python'] } })
    expect(() => { requireGrant({ board: boardWith('test-native'), hashes, grants }, 'card', 'source', 'demo:run', { commands: ['python', 'rm'] }, 'demo') }).toThrow(/重新给出授权/)
  })
})

describe('注册表的归属', () => {
  it('跨提供方重名时后到的被拒绝并说明原因', () => {
    const registries = createRegistries()
    registries.registerAction({ apiVersion: 2, provider: 'one', id: 'run', run: () => null })
    expect(() => registries.registerAction({ apiVersion: 2, provider: 'two', id: 'run', run: () => null })).toThrow(/已经由 one 注册过/)
  })

  it('用「提供方:名字」点名其中一个', () => {
    const registries = createRegistries()
    registries.registerDataSource({ apiVersion: 2, provider: 'one', id: 'count', read: () => 1 })
    expect(registries.resolveDataSource('one:count')?.provider).toBe('one')
    expect(registries.resolveDataSource('two:count')).toBeUndefined()
    expect(registries.resolveDataSource('count')?.provider).toBe('one')
  })

  it('释放之后名字空出来', () => {
    const registries = createRegistries()
    const dispose = registries.registerAction({ apiVersion: 2, provider: 'one', id: 'run', run: () => null })
    expect(registries.resolveAction('run')).toBeDefined()
    dispose()
    expect(registries.resolveAction('run')).toBeUndefined()
  })

  it('按提供方列出它名下的名字', () => {
    const registries = createRegistries()
    registries.registerDataSource({ apiVersion: 2, provider: 'one', id: 'a', read: () => null })
    registries.registerAction({ apiVersion: 2, provider: 'one', id: 'b', run: () => null })
    registries.registerAction({ apiVersion: 2, provider: 'two', id: 'c', run: () => null })
    expect(registries.namesOf('one')).toEqual({ dataSources: ['a'], actions: ['b'] })
  })
})
