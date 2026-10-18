/**
 * 卡片设置弹窗的宿主半边（D22）：读一份卡的设置、保存 props、写一项凭据。
 *
 * 三条路由都只从人的界面调用：`GET` 给弹窗读模型，`props` 与 `credential` 由弹窗保存。凭据值从请求
 * 体进宿主的凭据服务，响应里只有状态；看板文件、导出包与工具结果都不经过这里（D6、D22）。
 */
import type {
  CardSettings,
  CredentialSetting,
  Grant,
  HostCredentials,
  InstanceCredentialRequest,
  InstancePropsRequest,
} from '@dsh-widget-board/contracts'
import { readJson } from './body'
import { permissionMatches } from './grants'
import { isRecord } from './guards'
import { Refusal } from './refusal'
import { json } from './response'
import type { Route, RouteContext } from './routes'
import { propsIssues } from './schema'
import { withInstancePatched } from './state'

/** 保存 props 的请求体上限：一张卡的表单值，几十 KB 足够。 */
const PROPS_LIMIT = 32 * 1024

/** 写凭据的请求体上限：密钥是一小段文本。 */
const CREDENTIAL_LIMIT = 8 * 1024

/**
 * 一张卡的读模型；组件不在库里、卡片不在看板上都拒绝。
 *
 * @param context - 路由上下文。
 * @param id - 卡片实例的 id。
 * @returns 弹窗要读的全部内容。
 * @throws {Refusal} 没有这张卡或这个组件。
 */
async function settingsOf(context: RouteContext, id: string): Promise<CardSettings> {
  const found = context.workspace.findInstance(id)
  if (found === undefined) throw new Refusal(404, `看板上没有这张卡：${id}`)
  const { instance } = found
  const record = context.records.get(instance.widget)
  if (record === undefined) throw new Refusal(404, `组件 ${instance.widget} 不在组件库里`)

  const grants: Grant[] = context.grants.all().filter((grant) => grant.hash === record.hash && grant.widget === record.manifest.id)
  const sourceId = instance.source
  let source: CardSettings['source']
  let sourceError: string | undefined
  if (sourceId !== undefined && sourceId !== '') {
    const resolved = context.sources.resolveDataSource(sourceId)
    if (resolved === undefined) {
      sourceError = `没有数据源 ${sourceId}，提供它的插件可能没有安装`
    } else {
      const permission = resolved.registration.permission
      const granted = permission === undefined || grants.some((grant) => grant.kind === 'source'
        && grant.id === sourceId
        && permissionMatches(permission, grant.permission))
      source = {
        id: sourceId,
        provider: resolved.provider,
        ...(permission === undefined ? {} : { permission }),
        granted,
      }
    }
  }

  const credentials = context.credentials?.()
  const declared = record.manifest.credentials ?? []
  const credentialSettings: CredentialSetting[] = []
  for (const credential of declared) {
    if (credentials === undefined) {
      credentialSettings.push({ ...credential, unavailable: '宿主没有凭据服务' })
      continue
    }
    try {
      credentialSettings.push({ ...credential, info: await credentials.describe(credential.ref) })
    } catch (error) {
      credentialSettings.push({ ...credential, unavailable: (error as Error).message })
    }
  }

  return {
    instance,
    widget: {
      title: record.manifest.title,
      ...(record.manifest.description === undefined ? {} : { description: record.manifest.description }),
      version: record.manifest.version,
      hash: record.hash,
      source: record.source,
      ...(record.provider === undefined ? {} : { provider: record.provider }),
      ...(record.manifest.props === undefined ? {} : { propsSchema: record.manifest.props }),
      ...(record.manifest.text === undefined ? {} : { text: record.manifest.text }),
      ...(record.manifest.refresh === undefined ? {} : { refresh: record.manifest.refresh }),
    },
    ...(source === undefined ? {} : { source }),
    ...(sourceError === undefined ? {} : { sourceError }),
    grants,
    credentials: credentialSettings,
    credentialsAvailable: credentials !== undefined,
  }
}

/**
 * 凭据服务缺席时的拒绝；有服务时返回它。
 *
 * @param context - 路由上下文。
 * @returns 凭据服务。
 * @throws {Refusal} 宿主没有安装凭据服务。
 */
function credentialsOfRoute(context: RouteContext): HostCredentials {
  const credentials = context.credentials?.()
  if (credentials === undefined) throw new Refusal(503, '宿主没有凭据服务，存不了密钥')
  return credentials
}

/**
 * 设置弹窗的三条路由。
 *
 * @returns 路由表。
 */
export function settingsRoutes(): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/instance\/([^/]+)\/settings$/,
      limit: 0,
      async handle(context, _request, response, match) {
        const id = decodeURIComponent(match[1] as string)
        json(response, 200, await settingsOf(context, id))
      },
    },
    {
      method: 'POST',
      pattern: /^\/instance\/([^/]+)\/props$/,
      limit: PROPS_LIMIT,
      async handle(context, request, response, match) {
        const id = decodeURIComponent(match[1] as string)
        const body = await readJson(request, PROPS_LIMIT)
        if (!isRecord(body) || !isRecord(body.props)) throw new Refusal(400, 'props 要放在 props 里，且是普通对象')
        const wanted = body as unknown as InstancePropsRequest
        const found = context.workspace.findInstance(id)
        if (found === undefined) throw new Refusal(404, `看板上没有这张卡：${id}`)
        const record = context.records.get(found.instance.widget)
        if (record === undefined) throw new Refusal(404, `组件 ${found.instance.widget} 不在组件库里`)
        const issues = propsIssues(record.manifest.props, wanted.props)
        if (issues !== undefined) throw new Refusal(400, `props 与 ${record.manifest.id} 的 props schema 不符`, { issues })
        await context.workspace.save(found.board.id, (current) => withInstancePatched(current, id, { props: wanted.props }), {
          event: () => ({ type: 'instance', id, props: wanted.props }),
        })
        json(response, 200, { props: wanted.props })
      },
    },
    {
      method: 'POST',
      pattern: /^\/instance\/([^/]+)\/credential$/,
      limit: CREDENTIAL_LIMIT,
      async handle(context, request, response, match) {
        const id = decodeURIComponent(match[1] as string)
        const body = await readJson(request, CREDENTIAL_LIMIT)
        if (!isRecord(body)
          || typeof body.ref !== 'string'
          || (body.action !== 'set' && body.action !== 'unset')) {
          throw new Refusal(400, '凭据请求要写明 ref 与 action（set 或 unset）')
        }
        const wanted = body as unknown as InstanceCredentialRequest
        if (wanted.action === 'set' && (typeof wanted.value !== 'string' || wanted.value.trim() === '')) {
          throw new Refusal(400, '要保存的密钥不能是空串；要移除请用 unset')
        }
        const found = context.workspace.findInstance(id)
        if (found === undefined) throw new Refusal(404, `看板上没有这张卡：${id}`)
        const record = context.records.get(found.instance.widget)
        if (record === undefined) throw new Refusal(404, `组件 ${found.instance.widget} 不在组件库里`)
        const declared = record.manifest.credentials?.some((credential) => credential.ref === wanted.ref) === true
        if (!declared) throw new Refusal(400, `组件 ${record.manifest.id} 没有声明凭据 ${wanted.ref}`)
        const credentials = credentialsOfRoute(context)
        const info = await credentials.describe(wanted.ref)
        if (!info.writable) throw new Refusal(409, `${wanted.ref} 由启动环境提供，不能在这里修改`)
        try {
          if (wanted.action === 'set') await credentials.set(wanted.ref, wanted.value as string)
          else await credentials.unset(wanted.ref)
        } catch (error) {
          throw new Refusal(409, (error as Error).message)
        }
        json(response, 200, { info: await credentials.describe(wanted.ref) })
      },
    },
  ]
}
