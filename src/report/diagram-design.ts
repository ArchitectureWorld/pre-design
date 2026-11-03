import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'

/** An opt-in semantic composition. The author owns both paths and every label. */
export interface PrimarySecondaryPresentation {
  readonly kind: 'primary-secondary'
  readonly primaryNodeIds: readonly string[]
  readonly secondaryNodeIds: readonly string[]
  readonly primaryLabel: string
  readonly secondaryLabel: string
}
export interface EditorialDiagramPresentation {
  readonly kind:'editorial'
  readonly topology:'flow'|'branch'|'convergence'|'cycle'|'matrix'
  readonly groups:readonly {readonly label:string;readonly nodeIds:readonly string[]}[]
  readonly primaryNodeIds:readonly string[]
}
export type DiagramPresentation=PrimarySecondaryPresentation|EditorialDiagramPresentation
export const diagramPresentationSchema:ObjectJsonSchema={type:'object',additionalProperties:false,
  required:['kind','primaryNodeIds'],properties:{
    kind:{type:'string',enum:['primary-secondary','editorial']},primaryNodeIds:{type:'array',items:{type:'string'}},
    secondaryNodeIds:{type:'array',items:{type:'string'}},primaryLabel:{type:'string'},secondaryLabel:{type:'string'},
    topology:{type:'string',enum:['flow','branch','convergence','cycle','matrix']},
    groups:{type:'array',items:{type:'object',additionalProperties:false,required:['label','nodeIds'],properties:{label:{type:'string'},nodeIds:{type:'array',items:{type:'string'}}}}},
  }}
export const DIAGRAM_AESTHETICS = '图件先表达主次与阅读方向，再定几何。主线同基线、直接贯通；辅助关系用较细线型及不同节点形状表达，黑白时仍可区分。节点用紧凑标识与开放文字，不把短标签装进巨大等大卡片。线条不为文字无意义绕行，关系标签有明确归属，同类连续关系可由作者用一处组名概括。统一同级字号、线重、箭头、间距和色彩角色；图注对齐图边或中心。留白检查整图疏密、重心及与正文的关系。不同拓扑选择适合的构图，不强套主辅双层。审查须说明画面中具体的层级、走线、标签与疏密问题，不用没有遮挡或个人喜好代替判断。'
export const DIAGRAM_PRESENTATION_GUIDANCE = '每张关系图必须显式提交presentation，禁止旧大卡片回退。通常选{kind:"editorial",topology:"flow"|"branch"|"convergence"|"cycle"|"matrix",groups:[{label,nodeIds}],primaryNodeIds}。flow表达顺序，branch分流，convergence汇聚，cycle闭环，matrix对象与任务对应。groups由你决定有意义的2至4个阶段/类别，每组1至4节点，覆盖全部节点且不重复；matrix各组为一行，其余层级图各组为一列。cycle的组内顺序决定环上顺序。primaryNodeIds列需要强调的节点，其余用轻量节点。程序用开放短标签和细线实现，不画等大框。全部语义、节点及连线由你撰写并保持准确，不为美观增删关系或硬凑闭环。节点≤12字、边标签≤8字、组名≤10字。复杂图可简化为有明确对应关系的矩阵，不能把所有节点堆成一条线。若确实是一主一辅两条路径，可沿用primary-secondary，其两路径必须完整覆盖原有节点与边。';
