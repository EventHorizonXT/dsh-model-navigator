/**
 * dsh-model-navigator 的 Host 半边。
 *
 * 三级界面、目录读取、原子提交与偏好持久化全部发生在 Client 半边；
 * 这里刻意保持最小：只提供一个不带配置项的插件行，让 bundle 能被
 * Cordis 正常加载与卸载，不注册任何服务、不触碰任何宿主设置。
 *
 * 契约（见 @deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development）：
 * Host 入口只能二选一——`export function apply(ctx, config)`
 * 或默认导出一个 Service class。本插件用前者。
 */

/** 本插件不引入任何配置项：偏好由 Client 半边通过 settingsScope 保存。 */
export const inject = [];

/**
 * 插件入口。当前没有宿主侧资源需要管理，
 * 因此不注册 effect / event，也不返回清理函数。
 *
 * @param {unknown} _ctx Cordis 根上下文（本插件不使用）。
 */
export function apply(_ctx) {
  // 有意为空：所有行为都在 Client 半边，宿主侧只负责让这一行存在于插件图中。
}
