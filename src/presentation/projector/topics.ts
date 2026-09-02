import type { ProjectionTopicDefinition } from './types.ts'

export const DEFAULT_PRESENTATION_TOPICS = Object.freeze([
  Object.freeze({
    key: 'project_brief',
    title: '项目认知与任务',
    order: 10,
  }),
  Object.freeze({
    key: 'diagnosis',
    title: '现状与核心问题',
    order: 20,
  }),
  Object.freeze({
    key: 'opportunity',
    title: '发展机会',
    order: 30,
  }),
  Object.freeze({
    key: 'positioning',
    title: '项目定位与目标',
    order: 40,
  }),
  Object.freeze({
    key: 'program_product',
    title: '产品与功能体系',
    order: 50,
  }),
  Object.freeze({
    key: 'spatial_strategy',
    title: '空间策略',
    order: 60,
  }),
  Object.freeze({
    key: 'delivery_model',
    title: '运营、投资与实施',
    order: 70,
  }),
  Object.freeze({
    key: 'decision_next_steps',
    title: '决策事项与下一步',
    order: 80,
  }),
] satisfies readonly ProjectionTopicDefinition[])
