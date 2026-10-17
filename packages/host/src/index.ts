import { PACKAGE_NAME } from '@dsh-widget-board/contracts'

/** 插件名：宿主的加载器按它登记这一行。 */
export const name = PACKAGE_NAME

/**
 * 宿主半边。看板、实例与组件库的唯一权威在这里（D5），存储域、组件库目录、路由、数据源与模型
 * 工具按 PLAN 的步骤 4、6、8、9 依次加进来；眼下这一份只承载插件身份。
 */
export function apply(): void {}
