import { FLUX3_IMAGE_CONFIG } from '../app/src/service-defaults.mjs'
import { researchError } from '../app/src/research-contract.mjs'

export function materializeImageRuntime(policy, credentials = {}, { required = false } = {}) {
  const fail = (code, reason) => {
    if (required) throw researchError(code, reason, 503)
    return { imageAvailability: { status: 'not_ready', code, reason }, imageBackend: null, env: {} }
  }
  const route = policy?.routes?.image
  if (!route?.primary) return fail('IMAGE_POLICY_NOT_READY', '管理员尚未配置图像服务。')
  if ([route.primary, ...route.fallbacks].some(row => row.provider !== 'Comfyui-PIC' || row.model !== 'Klein')) {
    return fail('IMAGE_BACKEND_UNAVAILABLE', '当前图像路由未安装对应适配器。请配置已接入的 ComfyUI Flux3 工作流。')
  }
  const companionRef = policy.routes.imageLlm?.primary
  const companion = policy.models.find(row => row.provider === companionRef?.provider && row.model === companionRef?.model)
  if (!companion || companion.status !== 'verified' || !companion.capabilities.text || !companion.capabilities.tools) {
    return fail('IMAGE_COMPANION_NOT_READY', '生图配套 LLM 尚未配置或未通过工具能力验证。')
  }
  if (policy.routes.imageLlm.fallbacks.length) return fail('IMAGE_COMPANION_FALLBACK_UNSUPPORTED', '本版生图只使用已选配套 LLM；请清空其备用链，避免出图结果未知后换模型重复提交。')
  const model = policy.models.find(row => row.provider === 'Comfyui-PIC' && row.model === 'Klein'), config = model?.imageConfig
  if (model?.status !== 'verified') return fail('IMAGE_POLICY_NOT_READY', 'Flux3 图像服务尚未验证。')
  if (!config || ['modelFile', 'textToImageWorkflow', 'referenceImageWorkflow'].some(key => config[key] !== FLUX3_IMAGE_CONFIG[key])) {
    return fail('IMAGE_WORKFLOW_NOT_READY', '图像工作流与本次提供的 Flux3 版本不一致。')
  }
  if (!config.baseURL) return fail('IMAGE_ENDPOINT_REQUIRED', '管理员尚未填写 ComfyUI 服务地址。')
  const env = {}, imageBackend = { baseURL: config.baseURL, timeoutMs: config.timeoutMs ?? FLUX3_IMAGE_CONFIG.timeoutMs,
    pollIntervalMs: config.pollIntervalMs ?? FLUX3_IMAGE_CONFIG.pollIntervalMs }
  if (model.credentialRef) {
    const ref = model.credentialRef, credential = credentials?.refs?.[ref] ?? credentials?.refs?.[ref.replace(/^credential:/u, '')]
    if (typeof credential !== 'string' || !credential.trim()) return fail('IMAGE_CREDENTIAL_MISSING', 'ComfyUI 指定的凭据引用不存在。')
    env.PRE_WEB_COMFY_CREDENTIAL = credential
    imageBackend.credentialEnv = 'PRE_WEB_COMFY_CREDENTIAL'
  }
  return { imageAvailability: { status: 'ready', code: 'IMAGE_CONFIGURED', reason: '已配置 Flux3 工作流；每次生成前检查节点与模型，实际连通以调用结果为准。' }, imageBackend, env }
}
