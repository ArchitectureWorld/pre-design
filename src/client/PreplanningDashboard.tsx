import type { PreplanningPresentationStatus, PreplanningStatusEventData } from '../session/events.ts'

export interface PreplanningDashboardProps {
  readonly status: PreplanningStatusEventData
}

const panel = {
  border: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
  borderRadius: 12,
  padding: 12,
} as const

const boundarySources = {
  approved_site_plan: '已批总平图',
  approved_redline: '已批红线图',
  closed_coordinates: '闭合坐标',
  geojson: 'GeoJSON',
} as const

function presentationLabel(status: PreplanningPresentationStatus): string {
  switch (status.state) {
    case 'synced':
      return `Presentation：已同步 Revision ${status.syncedRevision}`
    case 'pending':
      return `Presentation：等待同步（Pre ${status.currentRevision} / 已同步 ${status.syncedRevision}）`
    case 'syncing':
      return `Presentation：正在同步 Revision ${status.currentRevision}`
    case 'migration_required':
      return 'Presentation：需要迁移；执行 /preplan-presentation-sync --force'
    case 'external_changes':
      return 'Presentation：检测到外部修改，未覆盖'
    case 'error':
      return `Presentation：同步失败：${status.message ?? '未知错误'}`
  }
}

export function PreplanningDashboard({ status }: PreplanningDashboardProps) {
  const total = status.chapters.reduce((sum, chapter) => sum + chapter.total, 0)
  const completed = status.chapters.reduce((sum, chapter) => sum + chapter.completed, 0)
  return (
    <section aria-label="前期策划项目总览" style={{ display: 'grid', gap: 12 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <small style={{ color: '#24844b', fontWeight: 700 }}>● 插件正常运行</small>
          <h3 style={{ fontSize: 18, margin: '4px 0' }}>{status.projectName}</h3>
          <span>{status.mode === 'automatic' ? '全自动完成' : '人工确认'} · Revision {status.revision}</span>
        </div>
        <strong style={{ alignSelf: 'center', fontSize: 17 }}>8 章 · {total} 项</strong>
      </header>
      <div style={{ ...panel, display: 'grid', gap: 6 }}>
        <strong>模型路由</strong>
        <span>主流程：{status.modelRoute.primary}</span>
        <span>概念表现图：{status.modelRoute.visual}</span>
      </div>
      <div style={{ ...panel, display: 'grid', gap: 6 }}>
        <strong>场地边界</strong>
        <span>{status.boundary.label}</span>
        {status.boundary.source === undefined ? null : <span>来源：{boundarySources[status.boundary.source]}</span>}
        <span>{status.boundary.nextAction}</span>
      </div>
      <div aria-label="章节进度" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))' }}>
        {status.chapters.map(chapter => (
          <article key={chapter.id} style={panel}>
            <strong>第 {chapter.id} 章</strong>
            <div>{chapter.completed}/{chapter.total} 项</div>
            <small>Gate：{chapter.gateStatus}</small>
          </article>
        ))}
      </div>
      <div style={{ ...panel, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <span>全流程 {completed}/{total}</span>
        <span>阻断 {status.blocked}</span>
        <span>视觉候选 {status.visual.candidates}</span>
        <span>已采用 {status.visual.adopted}</span>
        <span>视觉阻断 {status.visual.blocked}</span>
      </div>
      {status.presentation === undefined ? null : (
        <div
          aria-label="Presentation 同步状态"
          style={{
            ...panel,
            display: 'grid',
            gap: 4,
            borderColor: status.presentation.state === 'synced'
              ? 'color-mix(in srgb, #24844b 45%, transparent)'
              : status.presentation.state === 'error'
                || status.presentation.state === 'migration_required'
                || status.presentation.state === 'external_changes'
                ? 'color-mix(in srgb, #c56b1a 50%, transparent)'
                : panel.border,
          }}
        >
          <strong>{presentationLabel(status.presentation)}</strong>
          {status.presentation.message === undefined
            || status.presentation.state === 'migration_required'
            || status.presentation.state === 'external_changes'
            ? null
            : <small>{status.presentation.message}</small>}
        </div>
      )}
      {status.reportPackage === undefined ? (
        <div style={panel}><strong>甲方汇报成果</strong><div>尚未发布；完成必要 Gate 和视觉采用后生成。</div></div>
      ) : (
        <div style={{ ...panel, display: 'grid', gap: 8 }}>
          <strong>甲方汇报成果 · Revision {status.revision}</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <a href={status.reportPackage.pptx}>下载 PPTX</a>
            <a href={status.reportPackage.pdf}>下载 PDF</a>
            <a href={status.reportPackage.html}>浏览 HTML</a>
          </div>
        </div>
      )}
    </section>
  )
}
