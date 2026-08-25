import { Component, type ErrorInfo, type ReactNode } from "react";

interface NexusModuleBoundaryProps {
  readonly moduleId: string;
  readonly children: ReactNode;
}

interface NexusModuleBoundaryState {
  readonly error: Error | undefined;
}

/** Keeps one faulty page contribution from taking down the root shell. */
export class NexusModuleBoundary extends Component<NexusModuleBoundaryProps, NexusModuleBoundaryState> {
  state: NexusModuleBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: unknown): NexusModuleBoundaryState {
    return { error: error instanceof Error ? error : new Error("模块渲染失败。") };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[Shadow Nexus] module ${this.props.moduleId} crashed`, error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error === undefined) return this.props.children;
    return <div className="sn-page"><div className="sn-empty sn-module-error">
      <span>!</span><h2>这个模块暂时无法显示</h2><p>{this.state.error.message}</p>
      <button className="sn-primary" type="button" onClick={() => this.setState({ error: undefined })}>重试模块</button>
    </div></div>;
  }
}
