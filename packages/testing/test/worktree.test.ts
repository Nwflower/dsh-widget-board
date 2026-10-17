/**
 * 收尾临时工作树的护栏（D13）：`.debug/` 下的临时工作树借主树的 `node_modules` 用一条目录链接，
 * 而 `git worktree remove` 在 Windows 上会跟着链接走，把链接指向的目录递归删掉。这里拿一份自建的
 * 链接目标验证：护栏先摘链接，再交给 git，链接指向的目录原封不动，工作树本身被移除。
 *
 * 链接目标是自己建的，所以在护栏失效时被删掉的也只有它，主树的 `node_modules` 与 `packages/*`
 * 不在这条测试的作用范围里。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { removeWorktree, topLevelLinks } from '../../../scripts/worktree.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SCRIPT = path.join(ROOT, 'scripts', 'worktree.mjs')
const SCRATCH = path.join(ROOT, '.debug', `worktree-guard-${String(process.pid)}`)
const WORKTREE = path.join(SCRATCH, 'wt')
/** Windows 上建目录链接要指定 junction，别的平台上用普通的目录符号链接。 */
const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir'

/**
 * 跑一次 git。
 *
 * @param args - 参数。
 */
function git(args) {
  execFileSync('git', args, { cwd: ROOT, stdio: 'ignore' })
}

/**
 * 跑一次护栏的命令行。
 *
 * @param args - 参数。
 * @returns 退出码与两种输出。
 */
function guard(args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' })
  return { status: result.status, out: result.stdout, err: result.stderr }
}

afterEach(() => {
  // 测试自己失败时也要把自建的东西收干净：先摘链接再让 git 放手；摘不动就整份删掉。
  try {
    if (fs.existsSync(WORKTREE)) removeWorktree(WORKTREE)
  } catch {
    // 收尾而已，失败就交给下面的整份删除与 prune。
  }
  fs.rmSync(SCRATCH, { recursive: true, force: true })
  git(['worktree', 'prune'])
})

describe('临时工作树的收尾', () => {
  it('先摘掉顶层链接再交给 git：链接指向的目录不动，工作树被移除', () => {
    // 链接目标里再嵌一条链接，形状与主树的 node_modules 里那些 npm 工作区链接一致。
    const target = path.join(SCRATCH, 'target')
    const inner = path.join(SCRATCH, 'inner')
    fs.mkdirSync(inner, { recursive: true })
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(inner, 'keep.txt'), 'keep\n')
    fs.writeFileSync(path.join(target, 'keep.txt'), 'keep\n')
    fs.symlinkSync(inner, path.join(target, 'linked-package'), LINK_TYPE)
    git(['worktree', 'add', '--detach', WORKTREE, 'HEAD'])
    fs.symlinkSync(target, path.join(WORKTREE, 'node_modules'), LINK_TYPE)

    // 目录链接在 Node 眼里同样是链接：护栏靠这一点认出它。
    expect(topLevelLinks(WORKTREE)).toEqual([path.join(WORKTREE, 'node_modules')])

    expect(removeWorktree(WORKTREE)).toBe(1)
    expect(fs.existsSync(path.join(target, 'keep.txt'))).toBe(true)
    expect(fs.existsSync(path.join(inner, 'keep.txt'))).toBe(true)
    expect(fs.existsSync(WORKTREE)).toBe(false)
  })

  it('不收 .debug/ 之外的目录', () => {
    const refused = guard(['remove', 'packages/client'])
    expect(refused.status).toBe(1)
    expect(refused.err).toContain('.debug/')
    expect(fs.existsSync(path.join(ROOT, 'packages', 'client', 'package.json'))).toBe(true)
  })

  it('不收 .debug/ 下不是链接型工作树的目录', () => {
    const plain = path.join(SCRATCH, 'plain')
    fs.mkdirSync(plain, { recursive: true })
    const refused = guard(['remove', path.relative(ROOT, plain)])
    expect(refused.status).toBe(1)
    expect(refused.err).toContain('不是本仓库登记的链接型工作树')
    expect(fs.existsSync(plain)).toBe(true)
  })

  it('参数不全时说清用法', () => {
    const refused = guard(['remove'])
    expect(refused.status).toBe(2)
    expect(refused.err).toContain('用法')
  })
})
