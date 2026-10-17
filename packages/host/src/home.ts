/**
 * `$DSH_HOME` 的位置：环境变量优先，否则平台的 home 目录下的 `.dsh`。
 *
 * 与宿主自身的判定一致；组件库、看板与其他插件共享同一个 home（D7）。
 */
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/**
 * 算出 `$DSH_HOME`。
 *
 * @param env - 进程环境。
 * @param home - 平台 home 目录。
 * @returns 绝对路径。
 */
export function dshHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const raw = env.DSH_HOME?.trim()
  if (raw === undefined || raw === '') return join(home, '.dsh')
  return isAbsolute(raw) ? raw : join(process.cwd(), raw)
}
