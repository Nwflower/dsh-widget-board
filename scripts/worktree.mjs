#!/usr/bin/env node
/**
 * worktree.mjs — 把 `.debug/` 下的临时工作树收掉，不碰它借来的目录。
 *
 * 临时工作树借主树的 `node_modules` 用一条目录链接，自己不必装一遍。`git worktree remove` 在
 * Windows 上会跟着这条链接走：链接被当成普通目录递归删掉，删下去是主树的 `node_modules`，再
 * 下一跳是 npm 工作区链接指向的 `packages/*`。所以先把顶层的链接摘掉，再把目录交给 git。
 *
 * 只接受本仓库 `.debug/` 下、`git worktree list` 登记过的链接型工作树；主工作树不是候选。
 *
 * 用法：node scripts/worktree.mjs remove <路径> [--dry-run]
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')

/**
 * 本仓库登记的工作树。
 *
 * @returns 小写的绝对路径集合。
 */
export function linkedWorktrees() {
  const listed = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })
  return new Set(listed.split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => path.resolve(line.slice('worktree '.length)).toLowerCase()))
}

/**
 * 工作树顶层的链接。目录链接在这里同样算链接，摘掉它不会动它指向的目录。
 *
 * @param worktree - 工作树目录。
 * @returns 链接的绝对路径。
 */
export function topLevelLinks(worktree) {
  if (!fs.existsSync(worktree)) return []
  return fs.readdirSync(worktree).flatMap((name) => {
    const full = path.join(worktree, name)
    return fs.lstatSync(full).isSymbolicLink() ? [full] : []
  })
}

/**
 * 收掉一个工作树：先摘顶层的链接，再交给 git 删目录。
 *
 * @param worktree - 工作树目录。
 * @param options - `dryRun` 只报出要摘的链接，什么都不动。
 * @returns 摘掉的链接条数。
 */
export function removeWorktree(worktree, options = {}) {
  const dryRun = options.dryRun === true
  const links = topLevelLinks(worktree)
  for (const link of links) {
    console.log(`${dryRun ? '将摘掉' : '摘掉'} ${path.relative(ROOT, link)} -> ${fs.readlinkSync(link)}`)
    if (!dryRun) fs.unlinkSync(link)
  }
  if (dryRun) return links.length
  execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: ROOT, stdio: 'inherit' })
  return links.length
}

/**
 * 命令行入口：校验路径，再收掉那个工作树。
 *
 * @param argv - 命令行的参数，`remove` 之后是路径。
 */
function main(argv) {
  const [action, target, ...flags] = argv
  if (action !== 'remove' || target === undefined) {
    console.error('用法：node scripts/worktree.mjs remove <路径> [--dry-run]')
    process.exit(2)
  }
  const worktree = path.resolve(ROOT, target)
  const debug = `${path.join(ROOT, '.debug')}${path.sep}`.toLowerCase()
  if (!worktree.toLowerCase().startsWith(debug)) {
    console.error(`worktree: ${worktree} 不在 .debug/ 下；主工作树不在这里收`)
    process.exit(1)
  }
  if (!linkedWorktrees().has(worktree.toLowerCase())) {
    console.error(`worktree: ${worktree} 不是本仓库登记的链接型工作树`)
    process.exit(1)
  }
  const dryRun = flags.includes('--dry-run')
  const count = removeWorktree(worktree, { dryRun })
  console.log(`worktree: ${dryRun ? '会收掉' : '已收掉'} ${path.relative(ROOT, worktree)}（先摘掉 ${count} 条链接）`)
}

// 测试会导入上面的函数，所以只在被当作脚本运行时走命令行。
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
}
