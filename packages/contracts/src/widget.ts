/**
 * 组件 manifest 的形状与它的 JSON Schema（D7）。
 *
 * 内置组件、用户组件、agent 生成的组件、导入的组件与插件提供的组件共用这一份：宿主读
 * `widget.json`，用 Ajv 按下面的 schema 校验，不合格的不进组件库，错误原样回给作者（D17）。
 */

/** 组件可以声明的尺寸族：网格族、位置族（D16）。 */
export const WIDGET_FAMILIES = ['s', 'm', 'l', 'wide', 'xl', 'hero', 'expanded', 'inline', 'rail'] as const

/** 一个尺寸族。 */
export type WidgetFamily = (typeof WIDGET_FAMILIES)[number]

/** 看板给组件的宽度档：窄列、常规、宽卡。 */
export const WIDGET_BOX_WIDTHS = ['narrow', 'regular', 'wide'] as const

/** 一个宽度档。 */
export type WidgetBoxWidth = (typeof WIDGET_BOX_WIDTHS)[number]

/** 看板给组件的高度档：矮、常规、高。 */
export const WIDGET_BOX_HEIGHTS = ['short', 'regular', 'tall'] as const

/** 一个高度档。 */
export type WidgetBoxHeight = (typeof WIDGET_BOX_HEIGHTS)[number]

/** 组件拿到的盒子档位：两个方向各自判定，组件按组合取舍内容。 */
export interface WidgetBoxClasses {
  width: WidgetBoxWidth
  height: WidgetBoxHeight
}

/** 宽度档的边界：小于它是窄列，大于等于宽卡边界是宽卡。 */
export const BOX_WIDTH_NARROW = 320

/** 宽卡的宽度边界。 */
export const BOX_WIDTH_WIDE = 600

/** 矮盒子的高度边界。 */
export const BOX_HEIGHT_SHORT = 260

/** 高盒子的高度边界。 */
export const BOX_HEIGHT_TALL = 360

/**
 * 按像素盒给出宽度与高度档位（D16）。
 *
 * 两个方向分开判定：一张两列宽、14rem 高的卡片是 `wide/short`，组件可以只加宽、不加高。
 *
 * @param width - 内容盒的像素宽度。
 * @param height - 内容盒的像素高度。
 * @returns 两个方向的档位。
 */
export function boxClassesOf(width: number, height: number): WidgetBoxClasses {
  return {
    width: width < BOX_WIDTH_NARROW ? 'narrow' : width >= BOX_WIDTH_WIDE ? 'wide' : 'regular',
    height: height < BOX_HEIGHT_SHORT ? 'short' : height >= BOX_HEIGHT_TALL ? 'tall' : 'regular',
  }
}

/**
 * 组件库的一个来源：包内的内置组件与示例、用户目录、市场安装、插件注册（D17）。
 *
 * 按优先级排列：同一个 id 只认排在前面的来源。`market` 是市场插件装进来的组件，排在 `plugin` 之前；
 * `example` 是给 agent 的写法样例，排在最后，不覆盖任何可用的来源。
 */
export const WIDGET_SOURCES = ['builtin', 'user', 'market', 'plugin', 'example'] as const

/** 一个来源。 */
export type WidgetSource = (typeof WIDGET_SOURCES)[number]

/** 一段双语文案。 */
export interface LocalizedText {
  zh: string
  en: string
}

/**
 * 组件 id 的形状（D7、D8）：扁平名字，或市场条目的 `<作者域>.<名字>`。
 *
 * 扁平的 id 是本地组件的写法，继续有效；市场条目的 id 必须带作者域，安装时不覆盖本地同名组件。
 * 正则也用于 manifest 校验与 `widget_define` 的工具参数。
 */
export const WIDGET_ID_PATTERN = '^[a-z][a-z0-9-]{1,39}(?:\\.[a-z][a-z0-9-]{1,39})?$'

/**
 * manifest 里声明的动作：组件按下时发出的名字（D6）。
 *
 * `id` 是看板自己的动作名，或者 `提供方:名字` 点名某个插件注册的动作。声明过的动作还要有人给出
 * 授权才能真的跑起来；这一点不由 manifest 决定（D6）。
 */
export interface WidgetAction {
  id: string
  label?: LocalizedText
}

/**
 * 组件声明的一项凭据（D27）：值由宿主的凭据服务保存，组件只拿到它想用到的名字。
 *
 * 密钥不写进 props 与 state：设置弹窗按这条声明画输入框，提供方的数据源或动作按同一个 `ref`
 * 解析。`label` 与 `description` 是设置弹窗里的文案，`required` 决定未配置时要不要醒目提示。
 */
export interface WidgetCredential {
  /** 环境变量形状的名字，例如 `DEEPSEEK_API_KEY`。 */
  ref: string
  label: LocalizedText
  description?: LocalizedText
  required?: boolean
}

/**
 * 组件声明的权限（D6）：没有声明的动作、主机与命令一律拒绝。
 *
 * 这是组件作者写下来的意图，界面上用它把授权说清楚；真正拦人的是宿主上的授权表。
 */
export interface WidgetPermissions {
  hosts?: string[]
  commands?: string[]
}

/** 刷新策略：按需，或按一个固定的间隔（D6）。 */
export const WIDGET_REFRESH_MODES = ['onDemand', 'interval'] as const

/** 一种刷新策略。 */
export type WidgetRefreshMode = (typeof WIDGET_REFRESH_MODES)[number]

/**
 * 组件声明的刷新策略（D6）。
 *
 * `onDemand`（省略时就是它）表示只有人按下刷新、或数据源被显式读一次时才读；`interval` 表示看板
 * 有人看着的时候按 `everyMs` 定时读。没有观众的实例一律不读——宿主上不该有没人看的轮询（D5）。
 */
export interface WidgetRefresh {
  mode: WidgetRefreshMode
  /** `interval` 时的间隔毫秒数；低于下限时按下限算。 */
  everyMs?: number
}

/** 定时刷新允许的最短间隔：再密就是拿组件自己的频率换宿主的读写。 */
export const REFRESH_MIN_MS = 1000

/** 省略 `everyMs` 时的间隔。 */
export const REFRESH_DEFAULT_MS = 30_000

/** 宿主代发 HTTP 请求的数据源名（D6）；manifest 里写 `"source": "http"` 并给出 `request.url`。 */
export const HTTP_DATA_SOURCE = 'http'

/** 宿主代发请求时允许的方法。 */
export const WIDGET_REQUEST_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

/** 一种请求方法。 */
export type WidgetRequestMethod = (typeof WIDGET_REQUEST_METHODS)[number]

/**
 * 把一项凭据附在请求上的方式。
 *
 * `bearer` 与 `basic` 写 `authorization` 头；`header` 写 `header` 指定的那个头。值只由宿主读，
 * 不经过组件代码（D28）。
 */
export interface WidgetRequestAuth {
  /** 凭据的 `ref`，必须是 manifest 的 `credentials` 里声明过的一项。 */
  credential: string
  scheme: 'bearer' | 'basic' | 'header'
  /** `scheme` 是 `header` 时写入的请求头名，例如 `x-api-key`。 */
  header?: string
}

/**
 * 组件让宿主代发的一次 HTTP 请求（D6、D28）。
 *
 * 组件自己拿不到网络，所以地址写在 manifest 里，由宿主请求；URL 与请求体里的 `{名字}` 在读取
 * 时换成卡片 props 里的同名值，没有时换 props schema 给这个属性的默认值。只有 `permissions.hosts`
 * 里列出的主机能访问。
 */
export interface WidgetRequest {
  url: string
  /** 请求方法；省略时是 `GET`。 */
  method?: WidgetRequestMethod
  /** 一起发出去的固定请求头；`auth` 要写的那个头由宿主拼。 */
  headers?: Record<string, string>
  /** 请求体（JSON 文本，`{名字}` 同样会被换成 props 里同名的值）；`GET` 与 `DELETE` 不带。 */
  body?: string
  /** 附一项凭据；省略时不带认证。 */
  auth?: WidgetRequestAuth
  /**
   * 同一个地址的响应缓存多久（毫秒）；省略或为 0 时不缓存。
   *
   * 缓存只活在这一份宿主进程里；按解析后的完整 URL 区分，地址相同就是同一条缓存。
   */
  cacheMs?: number
}

/** 请求体的上限：请求是组件自己写的，不能让它拿宿主的连接发一大块过去。 */
export const REQUEST_BODY_LIMIT = 32 * 1024

/** 响应缓存允许的最长时间：再久就不该指望它还是当下的数据。 */
export const HTTP_CACHE_MAX_MS = 86_400_000

/**
 * 看板上这张卡最小能缩到多大：跨列数与根字号的倍数（D16）。
 *
 * 缺省时按看板的通用下限。声明它让组件在缩到很小的时候仍然排得下自己的内容。
 */
export interface WidgetMinBox {
  w: number
  h: number
}

/** 一个组件的 `widget.json`。 */
export interface WidgetManifest {
  id: string
  title: LocalizedText
  description?: LocalizedText
  author?: string
  version: string
  sizes: WidgetFamily[]
  /** props 与 data 的 JSON Schema；数据源按它校验推给组件的数据（D6）。 */
  props?: Record<string, unknown>
  data?: Record<string, unknown>
  /**
   * 这个组件的默认数据源（D17）：加卡片时用它读第一次数据。
   *
   * 数据源不在时卡片照样加得进来，数据留空——提供方可能只是还没装好。`"http"`（或写全的
   * `"dsh-widget-board:http"`）是宿主自己的数据源，需要同时给出 `request`。
   */
  source?: string
  /** `source` 是 `"http"` 时，宿主代发的那次请求（D6）。 */
  request?: WidgetRequest
  actions?: WidgetAction[]
  /**
   * 这个组件会调用的宿主能力（D24）：每项是能力注册表里的名字，需要时写成 `提供方:名字`。
   *
   * 声明只是允许调用的白名单；真正调用时宿主还会按能力的输入/输出 schema 校验，并按它的
   * `permission` 要一份人给出的授权。
   */
  capabilities?: string[]
  /** 设置弹窗要显示的凭据（D27）；值由宿主的凭据服务保存，不随卡片走。 */
  credentials?: WidgetCredential[]
  permissions?: WidgetPermissions
  /** 刷新策略（D6）；省略时按需。 */
  refresh?: WidgetRefresh
  libs?: string[]
  /**
   * 组件目录里的额外脚本，按顺序排在 `main.js` 之前（D7）。
   *
   * 路径相对组件目录，如 `world.js`；组件写到需要按职责拆开时用它，不必把全部逻辑塞进一份。
   * 这些文件与 `main.js` 同处一个文档、同一个全局作用域，互相只能靠约定的全局名字通信。
   */
  scripts?: string[]
  text?: Record<string, LocalizedText>
  /** 看板上的最小盒子（D16）。 */
  minBox?: WidgetMinBox
  /** 加卡片时的默认盒子；省略时是一列宽、22rem 高（D16）。 */
  defaultBox?: WidgetMinBox
}

/**
 * 组件库里的一个来源目录。
 *
 * `provider` 是插件来源的包名；内置与用户来源没有它。
 */
export interface WidgetRoot {
  dir: string
  source: WidgetSource
  provider?: string
}

/**
 * 组件库里的一个组件类型，浏览器半边据此画添加面板与不可用的卡片。
 *
 * `error` 有值时这个类型不可用：添加面板把它列在最后并说明原因，已有的卡片照着同一个原因显示
 * 占位（D17）。
 */
export interface WidgetLibraryEntry {
  id: string
  source: WidgetSource
  provider?: string
  title: LocalizedText
  description?: LocalizedText
  sizes: WidgetFamily[]
  /** 当前版本的哈希；类型不合格时没有。 */
  hash?: string
  error?: string
}

/**
 * 一个读不出来的组件目录或一次失败的注册。
 *
 * `id` 在 manifest 都已经读不出时为空，这时用 `dir` 指出是哪一个目录。
 */
export interface WidgetLibraryError {
  source: WidgetSource
  provider?: string
  dir: string
  id?: string
  message: string
}

/** 一段双语文案的 JSON Schema：manifest 与市场条目的 `$defs.text` 共用这一份。 */
export const LOCALIZED_TEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['zh', 'en'],
  properties: {
    zh: { type: 'string', minLength: 1 },
    en: { type: 'string', minLength: 1 },
  },
} as const

/** 校验 manifest 用的 JSON Schema；与 `WidgetManifest` 一一对应。 */
export const WIDGET_MANIFEST_SCHEMA = {
  $id: 'https://dsh-widget-board/widget.json',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'version', 'sizes'],
  properties: {
    id: { type: 'string', pattern: WIDGET_ID_PATTERN },
    title: { $ref: '#/$defs/text' },
    description: { $ref: '#/$defs/text' },
    author: { type: 'string', minLength: 1, maxLength: 80 },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$' },
    sizes: { type: 'array', minItems: 1, uniqueItems: true, items: { enum: WIDGET_FAMILIES } },
    props: { type: 'object' },
    data: { type: 'object' },
    source: { type: 'string', pattern: '^[a-z][a-z0-9.-]{1,39}(?::[a-z][a-z0-9.-]{1,39})?$' },
    credentials: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ref', 'label'],
        properties: {
          ref: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$', maxLength: 128 },
          label: { $ref: '#/$defs/text' },
          description: { $ref: '#/$defs/text' },
          required: { type: 'boolean' },
        },
      },
    },
    request: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: { type: 'string', minLength: 1, maxLength: 2048 },
        method: { enum: WIDGET_REQUEST_METHODS as unknown as string[] },
        headers: {
          type: 'object',
          maxProperties: 8,
          additionalProperties: { type: 'string', maxLength: 512 },
        },
        body: { type: 'string', maxLength: 32768 },
        auth: {
          type: 'object',
          additionalProperties: false,
          required: ['credential', 'scheme'],
          properties: {
            credential: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$', maxLength: 128 },
            scheme: { enum: ['bearer', 'basic', 'header'] },
            header: { type: 'string', pattern: '^[a-z0-9-]{1,64}$' },
          },
        },
        cacheMs: { type: 'integer', minimum: 0, maximum: HTTP_CACHE_MAX_MS },
      },
    },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9.-]{1,39}(?::[a-z][a-z0-9.-]{1,39})?$' },
          label: { $ref: '#/$defs/text' },
        },
      },
    },
    capabilities: {
      type: 'array',
      maxItems: 16,
      uniqueItems: true,
      items: { type: 'string', pattern: '^[a-z][a-z0-9.-]{1,39}(?::[a-z][a-z0-9.-]{1,39})?$' },
    },
    permissions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        hosts: { type: 'array', items: { type: 'string', minLength: 1 } },
        commands: { type: 'array', items: { type: 'string', minLength: 1 } },
      },
    },
    refresh: {
      type: 'object',
      additionalProperties: false,
      required: ['mode'],
      properties: {
        mode: { enum: WIDGET_REFRESH_MODES },
        everyMs: { type: 'integer', minimum: REFRESH_MIN_MS },
      },
    },
    libs: { type: 'array', items: { type: 'string', minLength: 1 } },
    scripts: { type: 'array', items: { type: 'string', minLength: 1 } },
    text: { type: 'object', additionalProperties: { $ref: '#/$defs/text' } },
    minBox: { $ref: '#/$defs/box' },
    defaultBox: { $ref: '#/$defs/box' },
  },
  allOf: [
    {
      if: { properties: { source: { type: 'string', pattern: `(^|:)${HTTP_DATA_SOURCE}$` } }, required: ['source'] },
      // `properties` 在这里只是让 Ajv 的严格模式认得 `required` 指的那一项。
      then: { required: ['request'], properties: { request: {} } },
    },
  ],
  $defs: {
    text: LOCALIZED_TEXT_SCHEMA,
    box: {
      type: 'object',
      additionalProperties: false,
      required: ['w', 'h'],
      properties: {
        w: { type: 'integer', minimum: 1, maximum: 4 },
        h: { type: 'number', minimum: 1, maximum: 200 },
      },
    },
  },
} as const
