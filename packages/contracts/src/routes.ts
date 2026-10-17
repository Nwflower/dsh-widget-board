/**
 * 插件私有路由（D1、D3）。
 *
 * 宿主的浏览器半边按内容哈希取组件文档，宿主把整棵子树交给这一条前缀路由；每条请求先过宿主的
 * 请求栅栏。路径只在这里写一次。
 */

/** 插件全部路由的前缀。 */
export const PLUGIN_ROUTE = '/plugins/dsh-widget-board'

/** 看板快照：客户端从这里读看板与实例。 */
export const BOARD_PATH = '/board'

/**
 * 某个版本组件的文档地址。
 *
 * @param hash - 组件内容的哈希（D7）。
 * @returns 文档的绝对路径。
 */
export const widgetDocumentPath = (hash: string): string => `/widget/${hash}/document`

/**
 * 某个版本组件的资源地址，路径相对组件目录。
 *
 * @param hash - 组件内容的哈希。
 * @param asset - 组件目录内的相对路径。
 * @returns 资源的绝对路径。
 */
export const widgetAssetPath = (hash: string, asset: string): string => `/widget/${hash}/asset/${asset}`
