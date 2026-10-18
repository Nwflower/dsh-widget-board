/**
 * 状态补丁的一层合并（D5、D23）：宿主、页面与待写队列共用这一条规则。
 *
 * 两边都是普通的 JSON 对象时合并一层，其余情况整体替换。三处必须给出同一个结果，否则页面上的
 * 状态、队列合并后的补丁与宿主存下的那一份会分叉。
 */

/** 普通的 JSON 对象。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 把一条补丁并进当前的状态。
 *
 * @param current - 当前的状态。
 * @param patch - 新来的一条补丁。
 * @returns 合并后的状态。
 */
export function mergeState(current: unknown, patch: unknown): unknown {
  return isRecord(current) && isRecord(patch) ? { ...current, ...patch } : patch
}
