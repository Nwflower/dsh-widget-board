#!/usr/bin/env node
/**
 * market.mjs — 组件市场原型：索引校验、打包与 Pages 产物（D30）。
 *
 * 索引是 `market/index.json`（格式 1），包是 `market/packages/<id>-<version>.dshw`。索引里的每个版本都
 * 写着包的 sha256 与字节数；`--check` 核对这三样与包内的 manifest 对不对得上，`--build` 从仓库里的
 * 组件目录打一份新的包并按内容改写索引。
 *
 * 用法：
 *   node scripts/market.mjs --check            校验提交的索引与包（CI 与 verify 用这一条）
 *   node scripts/market.mjs --build            重新打包并改写索引
 *   node scripts/market.mjs --out <dir>        把 market/ 复制成 Pages 产物里的一个子目录
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import Ajv from 'ajv'
import esbuild from 'esbuild'

const ROOT = path.resolve(import.meta.dirname, '..')
const MARKET = path.join(ROOT, 'market')
const INDEX = path.join(MARKET, 'index.json')
const PACKAGES = path.join(MARKET, 'packages')
const SCHEMA = path.join(ROOT, 'packages', 'contracts', 'market-index.schema.json')
const SCRATCH = path.join(ROOT, '.debug', 'market')

/**
 * 原型市场里的每个条目从哪里来。
 *
 * 包内的 manifest id 与市场条目的 id 不同：打包时把 id 换成带作者域的形式，其余文件原样带走。
 */
const SOURCES = {
  'nwflower.example-basic': { dir: path.join(ROOT, 'packages', 'widgets-examples', 'example-basic'), version: '1.0.0' },
  'nwflower.clock': { dir: path.join(ROOT, 'packages', 'widgets', 'clock'), version: '1.0.0' },
}

/**
 * 打一次包、读一次 manifest 的实现：直接用宿主半边的真代码，不在这里重写 zip 与校验。
 *
 * @returns 打包、解包与 manifest 校验的函数。
 */
async function tooling() {
  fs.mkdirSync(SCRATCH, { recursive: true })
  const outputs = [
    { entry: path.join(ROOT, 'packages', 'host', 'src', 'package.ts'), file: 'package.mjs' },
    { entry: path.join(ROOT, 'packages', 'host', 'src', 'library.ts'), file: 'library.mjs' },
  ]
  for (const output of outputs) {
    await esbuild.build({
      entryPoints: [output.entry],
      outfile: path.join(SCRATCH, output.file),
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      logLevel: 'silent',
    })
  }
  const packaged = await import(pathToFileURL(path.join(SCRATCH, 'package.mjs')).href)
  const library = await import(pathToFileURL(path.join(SCRATCH, 'library.mjs')).href)
  return { packWidget: packaged.packWidget, unpackWidget: packaged.unpackWidget, manifestProblem: library.manifestProblem }
}

/** 一个目录里的全部文件，相对路径（正斜杠）到字节。 */
function readTree(dir, prefix = '') {
  const files = []
  for (const entry of fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.name === 'node_modules') continue
    if (entry.isDirectory()) files.push(...readTree(dir, name))
    else if (entry.isFile()) files.push({ path: name, content: new Uint8Array(fs.readFileSync(path.join(dir, name))) })
  }
  return files
}

/** 索引里一条版本记录对应的包文件路径。 */
function packageFileOf(url) {
  return path.join(MARKET, url.replace(/^\.\//, ''))
}

/** 把一组问题打成一行。 */
function report(problems) {
  for (const problem of problems) console.error(`market: ${problem}`)
}

/**
 * 校验索引与它指向的包。
 *
 * @param toolingOf - 打包与校验函数。
 * @returns 问题清单；空表示通过。
 */
function check(toolingOf) {
  const problems = []
  const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'))
  const validate = new Ajv({ allErrors: true, strict: true }).compile(schema)
  let index
  try {
    index = JSON.parse(fs.readFileSync(INDEX, 'utf8'))
  } catch (error) {
    return [`索引读不出来：${error.message}`]
  }
  if (!validate(index)) {
    for (const error of validate.errors ?? []) {
      problems.push(`索引不合 schema：${error.instancePath || '/'} ${error.message ?? ''}`.trim())
    }
    return problems
  }
  const seen = new Set()
  for (const entry of index.widgets) {
    if (seen.has(entry.id)) problems.push(`${entry.id} 在索引里出现了两次`)
    seen.add(entry.id)
    for (const version of entry.versions) {
      const file = packageFileOf(version.package.url)
      if (!fs.existsSync(file)) {
        problems.push(`${entry.id}@${version.version} 的包不在：${path.relative(ROOT, file)}`)
        continue
      }
      const bytes = new Uint8Array(fs.readFileSync(file))
      const digest = createHash('sha256').update(bytes).digest('hex')
      if (digest !== version.package.sha256) problems.push(`${entry.id}@${version.version} 的 sha256 与索引不一致`)
      if (bytes.byteLength !== version.package.bytes) problems.push(`${entry.id}@${version.version} 的字节数与索引不一致`)
      let unpacked
      try {
        unpacked = toolingOf.unpackWidget(bytes)
      } catch (error) {
        problems.push(`${entry.id}@${version.version} 的包解不开：${error.message}`)
        continue
      }
      const manifest = unpacked.manifest
      if (manifest.id !== entry.id) problems.push(`${entry.id}@${version.version} 包内的 id 是 ${manifest.id}`)
      if (manifest.version !== version.version) problems.push(`${entry.id}@${version.version} 包内的版本是 ${manifest.version}`)
      const problem = toolingOf.manifestProblem(manifest)
      if (problem !== undefined) problems.push(`${entry.id}@${version.version} 的 manifest 不合格：${problem}`)
      const missingSizes = manifest.sizes.filter((size) => !version.sizes.includes(size))
      if (missingSizes.length > 0) problems.push(`${entry.id}@${version.version} 的 sizes 少了 ${missingSizes.join('、')}`)
      const declared = version.declares ?? {}
      const actual = {
        capabilities: manifest.capabilities ?? [],
        credentials: (manifest.credentials ?? []).map((credential) => credential.ref),
        hosts: manifest.permissions?.hosts ?? [],
      }
      for (const kind of ['capabilities', 'credentials', 'hosts']) {
        const missing = (declared[kind] ?? []).filter((item) => !actual[kind].includes(item))
        if (missing.length > 0) problems.push(`${entry.id}@${version.version} 的 declares.${kind} 里有 manifest 没有的 ${missing.join('、')}`)
      }
    }
  }
  return problems
}

/**
 * 从仓库里的组件目录重新打包，并按内容改写索引。
 *
 * @param toolingOf - 打包与校验函数。
 */
function build(toolingOf) {
  fs.mkdirSync(PACKAGES, { recursive: true })
  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'))
  for (const entry of index.widgets) {
    const source = SOURCES[entry.id]
    if (source === undefined) throw new Error(`market: 索引里的 ${entry.id} 没有对应的组件目录，补一条 SOURCES 或删掉这一条`)
    const files = readTree(source.dir)
    const manifestFile = files.find((file) => file.path === 'widget.json')
    if (manifestFile === undefined) throw new Error(`market: ${source.dir} 里没有 widget.json`)
    const manifest = JSON.parse(new TextDecoder().decode(manifestFile.content))
    manifest.id = entry.id
    // 发布版本由市场条目给出：同一个组件目录在这里发布成哪个版本，包内的 manifest 就写哪个。
    manifest.version = source.version
    manifestFile.content = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`)
    const bytes = toolingOf.packWidget(files)
    const digest = createHash('sha256').update(bytes).digest('hex')
    for (const version of entry.versions) {
      if (version.version !== source.version) continue
      const name = `${entry.id}-${version.version}.dshw`
      fs.writeFileSync(path.join(PACKAGES, name), bytes)
      version.package = { url: `packages/${name}`, sha256: digest, bytes: bytes.byteLength }
      version.sizes = [...manifest.sizes]
      version.declares = {
        ...(manifest.capabilities === undefined ? {} : { capabilities: [...manifest.capabilities] }),
        ...(manifest.credentials === undefined ? {} : { credentials: manifest.credentials.map((credential) => credential.ref) }),
        ...(manifest.permissions?.hosts === undefined ? {} : { hosts: [...manifest.permissions.hosts] }),
      }
    }
  }
  index.market.updatedAt = new Date().toISOString()
  fs.writeFileSync(INDEX, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  console.log(`market: 打包完成，${index.widgets.length} 个条目`)
}

/** 把 market/ 复制成 Pages 产物里的一个子目录。 */
function copyTo(out) {
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.cpSync(MARKET, out, { recursive: true })
  console.log(`market: 写出 ${out}`)
}

const argv = process.argv.slice(2)
const outFlag = argv.indexOf('--out')
const toolingOf = await tooling()
if (argv.includes('--build')) {
  build(toolingOf)
} else if (argv.includes('--check')) {
  const problems = check(toolingOf)
  if (problems.length > 0) {
    report(problems)
    console.error(`market: ${String(problems.length)} 处问题`)
    process.exit(1)
  }
  console.log('market: 索引与包一致')
} else if (outFlag !== -1) {
  const problems = check(toolingOf)
  if (problems.length > 0) {
    report(problems)
    process.exit(1)
  }
  copyTo(path.resolve(argv[outFlag + 1] ?? ''))
} else {
  console.error('用法：node scripts/market.mjs [--check | --build | --out <dir>]')
  process.exit(2)
}
