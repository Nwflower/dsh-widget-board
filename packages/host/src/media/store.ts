/** 媒体文件按内容寻址；上传凭据仅在成功提交后消费。 */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MEDIA_CHUNK_BYTES, MEDIA_TOTAL_BYTES, type InstanceMedia, type MediaBinding, type MediaChunk, type MediaRole, type MediaUploaded } from '@dsh-widget-board/contracts'
import { Refusal } from '../refusal'
import type { Workspace } from '../workspace'
import { processImage } from './process'

const HASH = /^[0-9a-f]{64}$/
const TTL = 10 * 60 * 1000
const ORPHAN_TTL = 24 * 60 * 60 * 1000
interface Session { target: string, expires: number }
interface Ticket { session: string, role: MediaRole, ref: string, expires: number }
export interface MediaStore {
  session(target: string): string
  upload(session: string, role: MediaRole, bytes: Buffer, mime: string): Promise<MediaUploaded>
  bind<T>(target: string, binding: MediaBinding, commit: (media: InstanceMedia | undefined) => Promise<T>, consume?: boolean, beforeBind?: () => void): Promise<T>
  read(instanceId: string, ref: string, offset: number, length: number): Promise<MediaChunk>
  bytes(ref: string): Promise<Buffer>
  put(bytes: Buffer): Promise<string>
  import<T>(resources: ReadonlyMap<string, Buffer>, commit: () => Promise<T>): Promise<T>
  collect(): Promise<number>
  copy(source: string, target: string, binding: MediaBinding): Promise<MediaBinding>
  preview(session: string, ticket: string): Promise<Buffer>
}

/** 未信任的引用表只允许两种角色与 SHA-256。 */
export function checkedMedia(value: unknown): InstanceMedia {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Refusal(400, 'media 必须是角色到资源的对象')
  const entries = Object.entries(value)
  if (entries.some(([role, ref]) => !['background', 'icon'].includes(role) || typeof ref !== 'string' || !HASH.test(ref))) throw new Refusal(400, '媒体角色或资源 hash 不合法')
  return Object.fromEntries(entries) as InstanceMedia
}

/** 存储只接受宿主给出的根目录；不从请求接收路径。 */
export function createMediaStore(dir: string, workspace: Workspace, now = Date.now): MediaStore {
  const sessions = new Map<string, Session>()
  const tickets = new Map<string, Ticket>()
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = queue.then(operation)
    queue = run.catch(() => undefined) // 一次提交失败不阻塞后续独立事务，错误仍交给调用者。
    return run
  }
  const expire = (): void => {
    for (const [id, value] of sessions) if (value.expires <= now()) sessions.delete(id)
    for (const [id, value] of tickets) if (value.expires <= now()) tickets.delete(id)
  }
  const ready = async (): Promise<void> => {
    await mkdir(dir, { recursive: true })
    if ((await lstat(dir)).isSymbolicLink()) throw new Refusal(400, '媒体目录不能是目录链接')
  }
  const fileOf = (ref: string): string => {
    if (!HASH.test(ref)) throw new Refusal(400, '媒体 hash 不合法')
    return join(dir, `${ref}.webp`)
  }
  const bytesOf = async (ref: string): Promise<Buffer> => {
    await ready()
    const file = fileOf(ref)
    const stat = await lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Refusal(400, '媒体文件不合法')
    const bytes = await readFile(file)
    if (createHash('sha256').update(bytes).digest('hex') !== ref) throw new Refusal(400, '媒体文件 hash 不匹配')
    return bytes
  }
  const put = async (bytes: Buffer): Promise<string> => {
    await ready()
    const ref = createHash('sha256').update(bytes).digest('hex')
    const files = await readdir(dir)
    let total = 0
    for (const file of files) {
      if (!/^[0-9a-f]{64}\.webp$/.test(file)) continue
      total += (await lstat(join(dir, file))).size
    }
    if (!files.includes(`${ref}.webp`) && (files.length >= 64 || total + bytes.length > MEDIA_TOTAL_BYTES)) throw new Refusal(413, '媒体存储已满，请先整理未使用资源')
    try { await writeFile(fileOf(ref), bytes, { flag: 'wx' }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (!(await bytesOf(ref)).equals(bytes)) throw new Refusal(400, '已有媒体与 hash 不一致')
    }
    return ref
  }
  const store: MediaStore = {
    session(target) {
      expire()
      if (sessions.size >= 32) throw new Refusal(429, '同时编辑媒体的会话过多')
      const id = randomUUID()
      sessions.set(id, { target, expires: now() + TTL })
      return id
    },
    async upload(session, role, bytes, mime) {
      return await serial(async () => {
        expire()
        if (!sessions.has(session)) throw new Refusal(403, '媒体编辑会话已过期')
        if (tickets.size >= 64) throw new Refusal(429, '未提交上传过多')
        const result = await processImage(bytes, mime, role)
        const ref = await put(result.bytes)
        const uploadTicket = randomUUID()
        tickets.set(uploadTicket, { session, role, ref, expires: now() + TTL })
        return { ref, uploadTicket, mime: 'image/webp', bytes: result.bytes.length, width: result.width, height: result.height }
      })
    },
    async bind(target, binding, commit, consume = true, beforeBind) {
      return await serial(async () => {
        beforeBind?.()
        expire()
        const existing = workspace.findInstance(target)?.instance.media
        if (binding.media === undefined) return await commit(existing)
        const media = checkedMedia(binding.media)
        const used: string[] = []
        for (const [role, ref] of Object.entries(media)) {
          if (existing?.[role as MediaRole] === ref) continue
          const id = binding.mediaTickets?.[role as MediaRole]
          const ticket = id === undefined ? undefined : tickets.get(id)
          const session = binding.mediaSession === undefined ? undefined : sessions.get(binding.mediaSession)
          if (!ticket || !session || ticket.session !== binding.mediaSession || session.target !== target || ticket.ref !== ref || ticket.role !== role) throw new Refusal(403, '媒体未归属此实例或当前编辑会话')
          used.push(id as string)
        }
        for (const ref of Object.values(media)) await bytesOf(ref)
        const result = await commit(media)
        if (consume) for (const id of used) tickets.delete(id)
        return result
      })
    },
    async copy(source, target, binding) {
      // 原 ticket 保持可重试；新会话只授权目标看板的这一次人工复制。
      const result = await store.bind(source, binding, async media => {
        if (tickets.size + Object.keys(media ?? {}).length > 64) throw new Refusal(429, '未提交上传过多')
        const session = store.session(target)
        const mediaTickets: Partial<Record<MediaRole, string>> = {}
        for (const [role, ref] of Object.entries(media ?? {})) {
          const ticket = randomUUID()
          tickets.set(ticket, { session, role: role as MediaRole, ref, expires: now() + TTL })
          mediaTickets[role as MediaRole] = ticket
        }
        return { media: media ?? {}, mediaSession: session, mediaTickets }
      }, false)
      return result
    },
    async preview(session, id) {
      expire()
      const ticket = tickets.get(id)
      if (!sessions.has(session) || !ticket || ticket.session !== session) throw new Refusal(403, '图片预览会话已过期')
      return await bytesOf(ticket.ref)
    },
    async read(instanceId, ref, offset, length) {
      const media = workspace.findInstance(instanceId)?.instance.media
      const resolved = media?.[ref as MediaRole] ?? ref
      if (!media || !Object.values(media).includes(resolved)) throw new Refusal(403, '媒体不可读取')
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > MEDIA_CHUNK_BYTES) throw new Refusal(400, '媒体分块范围不合法')
      const bytes = await bytesOf(resolved)
      if (offset >= bytes.length) throw new Refusal(400, '媒体分块超出总长度')
      return { mime: 'image/webp', total: bytes.length, offset, base64: bytes.subarray(offset, offset + length).toString('base64') }
    },
    bytes: bytesOf,
    put: async bytes => await serial(async () => await put(bytes)),
    async import(resources, commit) {
      return await serial(async () => {
        const created: string[] = []
        try {
          for (const [ref, bytes] of resources) {
            try { await bytesOf(ref) } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
              const actual = await put(bytes)
              created.push(actual)
              if (actual !== ref) throw new Refusal(400, '媒体 hash 不匹配')
            }
          }
          return await commit()
        } catch (error) {
          const bound = new Set(workspace.list().flatMap(board => board.instances.flatMap(instance => Object.values(instance.media ?? {}))))
          for (const ref of created) if (!bound.has(ref)) await unlink(fileOf(ref))
          throw error
        }
      })
    },
    async collect() {
      return await serial(async () => {
        expire()
        await ready()
        const used = new Set(workspace.list().flatMap(board => board.instances.flatMap(instance => Object.values(instance.media ?? {}))))
        for (const ticket of tickets.values()) used.add(ticket.ref)
        let removed = 0
        for (const file of await readdir(dir)) {
          if (!/^[0-9a-f]{64}\.webp$/.test(file) || used.has(file.slice(0, 64))) continue
          const target = join(dir, file)
          const stat = await lstat(target)
          if (!stat.isFile() || stat.isSymbolicLink() || now() - stat.mtimeMs < ORPHAN_TTL) continue
          await unlink(target)
          removed++
        }
        return removed
      })
    },
  }
  return store
}
