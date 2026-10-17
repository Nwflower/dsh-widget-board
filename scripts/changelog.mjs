#!/usr/bin/env node
/**
 * changelog.mjs — 把 docs/changes/ 里待发布的条目组装成 CHANGELOG.md 的 [Unreleased] 段。
 *
 * 一次改动在 docs/changes/ 下加一个小 JSON 文件，从不手改 CHANGELOG：文件里写着分组、在组内的
 * 次序、是否动了对外契约、落地的日期，以及中英两条文案。本脚本把这些文件变成读者看到的那一段，
 * 所以这一段不可能与改动本身对不上。发布时同一份组装变成那个版本的段，文件随之清空。
 *
 * 用法：node scripts/changelog.mjs [--check | --release <版本> [--date <YYYY-MM-DD>]]
 *       --check 不写文件，在提交的段落与 docs/changes/ 不一致时失败。
 *       --release 把待发布的条目变成那个版本的段、放在旧段之上，并清空 docs/changes/。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const CHANGES = path.join(ROOT, 'docs', 'changes')
const FILE = path.join(ROOT, 'CHANGELOG.md')

/** 分组按固定次序出现，以及两种语言各自的标题。 */
const GROUPS = [
  { key: 'new', zh: '新增功能', en: 'New Features' },
  { key: 'improvements', zh: '体验优化', en: 'Improvements' },
  { key: 'fixes', zh: '问题修复', en: 'Bug Fixes' },
  { key: 'security', zh: '安全', en: 'Security' },
  { key: 'removals', zh: '移除', en: 'Removals' },
  { key: 'chores', zh: '其他变更', en: 'Chores' },
]

/** 每一条待发布的改动，读进来并校验；发布清空目录，git 不留空目录，所以没目录就是没有待发布。 */
function readFragments() {
  const fragments = []
  if (!fs.existsSync(CHANGES)) return fragments
  for (const name of fs.readdirSync(CHANGES)) {
    if (name.startsWith('.')) continue
    if (!/^[a-z0-9][a-z0-9-]*\.json$/.test(name)) throw new Error(`changelog: docs/changes/${name} 不是 <slug>.json`)
    const fragment = JSON.parse(fs.readFileSync(path.join(CHANGES, name), 'utf8'))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fragment.at ?? '')) throw new Error(`changelog: docs/changes/${name} 需要 "at" 日期（YYYY-MM-DD）`)
    if (!GROUPS.some((group) => group.key === fragment.group)) throw new Error(`changelog: docs/changes/${name} 的 group 是 "${fragment.group}"，不在 ${GROUPS.map((group) => group.key).join('、')} 里`)
    if (!Number.isSafeInteger(fragment.order) || fragment.order < 0) throw new Error(`changelog: docs/changes/${name} 需要 "order"，从 0 开始的整数，说明它在组内排第几`)
    if (typeof fragment.external !== 'boolean') throw new Error(`changelog: docs/changes/${name} 需要 "external"，true 或 false`)
    for (const language of ['zh', 'en']) {
      const text = fragment[language]
      if (typeof text !== 'string' || text.trim() === '') throw new Error(`changelog: docs/changes/${name} 没有 "${language}" 文案`)
      if (text.includes('\n')) throw new Error(`changelog: docs/changes/${name} 的 "${language}" 文案必须是一行`)
    }
    fragments.push({ name, ...fragment })
  }
  return fragments.sort((a, b) => a.at === b.at ? a.name.localeCompare(b.name) : a.at.localeCompare(b.at))
}

/**
 * 段的正文：先按次序排中文各组，再排英文各组。
 *
 * 每种语言的第一个标题带上那种语言的行指向的锚点，锚点因此留在哪一组在最前都能用。
 *
 * @param fragments - 读入的改动条目。
 * @returns 若干行。
 */
function body(fragments) {
  const lines = []
  for (const [language, anchor] of [['zh', 'cn-unreleased'], ['en', 'en-unreleased']]) {
    const groups = GROUPS.filter((group) => fragments.some((fragment) => fragment.group === group.key))
    groups.forEach((group, at) => {
      const heading = language === 'zh' ? group.zh : group.en
      lines.push('', at === 0 ? `<h3 id="${anchor}">${heading}</h3>` : `### ${heading}`, '')
      const entries = fragments
        .filter((entry) => entry.group === group.key)
        .sort((a, b) => a.order === b.order ? a.name.localeCompare(b.name) : a.order - b.order)
      for (const fragment of entries) lines.push(`- ${fragment[language]}`)
    })
  }
  return lines
}

/** 整段 [Unreleased]：标题、语言行、各组，以及它后面的空行。 */
function section(fragments) {
  if (fragments.length === 0) return '## [Unreleased]\n\n'
  return `${['## [Unreleased]', '', '[中文](#cn-unreleased) | [English](#en-unreleased)', ...body(fragments)].join('\n')}\n\n`
}

/** 一个已发布版本的段，锚点用它自己的版本号。 */
function releaseSection(fragments, version, date) {
  const lines = [`## [${version}] - ${date}`, '', `[中文](#cn-${version}) | [English](#en-${version})`, ...body(fragments)]
  return `${lines.join('\n').split('cn-unreleased').join(`cn-${version}`).split('en-unreleased').join(`en-${version}`)}\n\n`
}

/** 把 CHANGELOG.md 拆成「[Unreleased] 之前」「这一段」「之后」。 */
function split(changelog) {
  const start = changelog.indexOf('## [Unreleased]')
  if (start === -1) throw new Error('changelog: CHANGELOG.md 里没有 "## [Unreleased]" 这一段')
  const next = changelog.indexOf('\n## [', start)
  return { start, body: changelog.slice(start, next === -1 ? changelog.length : next + 1), rest: changelog.slice(next === -1 ? changelog.length : next + 1) }
}

const fragments = readFragments()
const changelog = fs.readFileSync(FILE, 'utf8')
const { start, body: currentSection, rest } = split(changelog)

if (process.argv.includes('--check')) {
  if (currentSection !== section(fragments)) throw new Error('changelog: CHANGELOG.md 的 [Unreleased] 段与 docs/changes/ 说的不一致；跑 `npm run changelog`')
  console.log(`changelog: ${fragments.length} 条待发布的改动，段落是最新的`)
} else if (process.argv.includes('--release')) {
  const version = process.argv[process.argv.indexOf('--release') + 1]
  if (version === undefined || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('changelog: --release 需要一个像 0.1.0 的版本号')
  const dateAt = process.argv.indexOf('--date')
  const date = dateAt === -1 ? new Date().toISOString().slice(0, 10) : process.argv[dateAt + 1]
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('changelog: --date 需要一个像 2026-10-16 的日期')
  if (fragments.length === 0) throw new Error('changelog: docs/changes/ 里没有可发布的改动')
  fs.writeFileSync(FILE, changelog.slice(0, start) + section([]) + releaseSection(fragments, version, date) + rest)
  for (const fragment of fragments) fs.rmSync(path.join(CHANGES, fragment.name))
  console.log(`changelog: 把 ${fragments.length} 条改动发布为 ${version}（${date}）；docs/changes/ 已清空`)
} else {
  fs.writeFileSync(FILE, changelog.slice(0, start) + section(fragments) + rest)
  console.log(`changelog: 把 ${fragments.length} 条待发布的改动组装进 [Unreleased] 段`)
}
