import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

/** 原生组件的错误边界要画的东西。 */
export interface NativeBoundaryProps {
  /** 出错时显示的说法。 */
  label: string
  children: ReactNode
}

/** 边界的状态。 */
interface NativeBoundaryState {
  failure: string | null
}

/**
 * 原生组件的错误边界（D3）：提供方的组件抛错时只废掉这一张卡，其余卡片照常。
 *
 * 组件在父页面里运行，错误边界是看板唯一能替它做的隔离；错误原因写在卡片上，用户不必去翻控制台。
 */
export class NativeBoundary extends Component<NativeBoundaryProps, NativeBoundaryState> {
  state: NativeBoundaryState = { failure: null }

  /**
   * 记下这一处失败。
   *
   * @param error - 抛出来的错误。
   * @returns 新的状态。
   */
  static getDerivedStateFromError(error: unknown): NativeBoundaryState {
    return { failure: error instanceof Error ? error.message : String(error) }
  }

  /**
   * 把原因报到控制台：边界接住错误之后浏览器的 `pageerror` 不会再报一次。
   *
   * @param error - 抛出来的错误。
   * @param info - React 给出的组件栈。
   */
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`widget-board: 原生组件出错：${error.message}`, info.componentStack)
  }

  /**
   * 出错时画一张说明，否则画组件。
   *
   * @returns 卡片的内容。
   */
  render(): ReactNode {
    if (this.state.failure !== null) {
      return <p className="dsh-widget-board__failure-strip" role="status">{`${this.props.label}：${this.state.failure}`}</p>
    }
    return this.props.children
  }
}
