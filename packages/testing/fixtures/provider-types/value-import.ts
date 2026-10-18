/**
 * 反向判据：`dsh-widget-board/service` 只有类型，取值导入必须在编译期失败。
 *
 * 如果哪天这份入口带上了运行时代码，下面这条 `@ts-expect-error` 会变成「没有用到的抑制」而报错。
 */

// @ts-expect-error 服务入口只发布类型，没有 WIDGET_BOARD_API_VERSION 这个值。
import { WIDGET_BOARD_API_VERSION } from 'dsh-widget-board/service'

/** 让上面那条导入被使用；这个值本身只出现在类型检查里。 */
export const wrongVersion: number = WIDGET_BOARD_API_VERSION
