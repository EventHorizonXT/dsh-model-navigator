/**
 * 模型身份（纯逻辑，无宿主依赖）。
 *
 * 唯一键必须保留 provider 与 model 的原始字符串：不做去前缀、不折叠大小写、
 * 不裁量后缀。同名模型来自不同供应商时必须能同时存在。
 */

/** 稳定唯一键：JSON 元组，避免把 id 拼成 "provider/model" 再拆回来。 */
export function stableKeyOf(ref) {
  return JSON.stringify([ref.providerId, ref.modelId]);
}
