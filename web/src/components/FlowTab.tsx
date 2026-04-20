import { Link } from 'react-router-dom';
import { ExternalLink, Workflow } from 'lucide-react';
import type { Entity } from '../lib/types';
import {
  edgeLabelPosition,
  edgeOffsetTransform,
  edgePath,
  ensureFlowSpec,
  getNodeDimensions,
  isMockNode,
  mockContentClasses,
  mockContentStyle,
  mockShapeLabel,
  nodeColor,
  nodeSubtitle,
  renderMockNodeShell,
} from '../lib/flow';

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

function flowHref(entity: Entity, mode: 'view' | 'edit') {
  const params = new URLSearchParams({
    flow: entity.metadata.name,
    namespace: entity.metadata.namespace || 'default',
    mode,
  });
  return `/flow?${params.toString()}`;
}

function nodeTitle(node: Parameters<typeof nodeColor>[0]): string {
  return isMockNode(node) ? node.label : node.entityRef.name;
}

export default function FlowTab({ entity }: { entity: Entity }) {
  const flowSpec = ensureFlowSpec(entity.spec);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Workflow className="h-4 w-4 text-[var(--gantry-text-secondary)]" />
              <h3 className="text-sm font-semibold text-[var(--gantry-text-primary)]">Flow Diagram</h3>
            </div>
            <p className="mt-2 text-sm text-[var(--gantry-text-secondary)]">
              This Flow entity is best experienced in the Flow plugin, where you can browse the full diagram or edit it on the shared canvas.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={flowHref(entity, 'view')}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--gantry-border)] px-3 py-2 text-sm font-medium text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)]"
            >
              <ExternalLink className="h-4 w-4" />
              Open in Flow
            </Link>
            <Link
              to={flowHref(entity, 'edit')}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--gantry-accent)] px-3 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)]"
            >
              <Workflow className="h-4 w-4" />
              Edit in Flow
            </Link>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
        <div className="flex items-center justify-between border-b border-[var(--gantry-border)] px-6 py-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--gantry-text-primary)]">Preview</h3>
            <p className="mt-1 text-xs text-[var(--gantry-text-secondary)]">
              Read-only diagram preview from this Flow entity.
            </p>
          </div>
          <div className="text-xs text-[var(--gantry-text-secondary)]">
            {flowSpec.nodes.length} node{flowSpec.nodes.length === 1 ? '' : 's'} · {flowSpec.edges.length} edge{flowSpec.edges.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="overflow-auto bg-[var(--gantry-bg-secondary)] p-4">
          <div
            className="relative rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]"
            style={{
              width: CANVAS_WIDTH,
              height: CANVAS_HEIGHT,
              backgroundImage: 'linear-gradient(rgba(148, 163, 184, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.08) 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
          >
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
              <defs>
                <marker id="catalog-flow-arrow-end" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748B" />
                </marker>
                <marker id="catalog-flow-arrow-start" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748B" />
                </marker>
              </defs>
              {flowSpec.edges.map((edge) => {
                const source = flowSpec.nodes.find((node) => node.id === edge.source);
                const target = flowSpec.nodes.find((node) => node.id === edge.target);
                if (!source || !target) return null;
                const path = edgePath(source, target);
                const labelPos = edgeLabelPosition(source, target);
                const twoWay = edge.direction === 'two-way';
                const forwardTransform = twoWay ? edgeOffsetTransform(source, target, 3) : undefined;
                const reverseTransform = twoWay ? edgeOffsetTransform(source, target, -3) : undefined;

                return (
                  <g key={edge.id}>
                    {!twoWay && (
                      <path
                        d={path}
                        fill="none"
                        stroke="#64748B"
                        strokeWidth={2}
                        strokeDasharray={edge.animated ? '8 8' : undefined}
                        markerEnd="url(#catalog-flow-arrow-end)"
                      >
                        {edge.animated && <animate attributeName="stroke-dashoffset" from="16" to="0" dur="1s" repeatCount="indefinite" />}
                      </path>
                    )}
                    {twoWay && (
                      <>
                        <path
                          d={path}
                          fill="none"
                          transform={forwardTransform}
                          stroke="#64748B"
                          strokeWidth={2.1}
                          strokeDasharray={edge.animated ? '8 8' : undefined}
                          markerEnd="url(#catalog-flow-arrow-end)"
                        >
                          {edge.animated && <animate attributeName="stroke-dashoffset" from="16" to="0" dur="1s" repeatCount="indefinite" />}
                        </path>
                        <path
                          d={path}
                          fill="none"
                          transform={reverseTransform}
                          stroke="#94A3B8"
                          strokeWidth={1.9}
                          strokeDasharray={edge.animated ? '8 8' : undefined}
                          markerStart="url(#catalog-flow-arrow-start)"
                        >
                          {edge.animated && <animate attributeName="stroke-dashoffset" from="0" to="16" dur="1s" repeatCount="indefinite" />}
                        </path>
                      </>
                    )}
                    <rect
                      x={labelPos.x - (twoWay ? 44 : 30)}
                      y={labelPos.y - 17}
                      width={twoWay ? 88 : 60}
                      height={22}
                      rx={11}
                      fill="var(--gantry-bg-primary)"
                      stroke={twoWay ? '#64748B' : 'var(--gantry-border)'}
                    />
                    <text x={labelPos.x} y={labelPos.y - 2} textAnchor="middle" className="fill-[var(--gantry-text-secondary)] text-[11px] font-medium">
                      {twoWay ? `${edge.label || edge.relation} <->` : edge.label || edge.relation}
                    </text>
                  </g>
                );
              })}
            </svg>

            {flowSpec.nodes.map((node) => {
              const color = nodeColor(node);
              const badge = isMockNode(node) ? mockShapeLabel(node.shape) : node.entityRef.kind;
              const baseBorderColor = 'var(--gantry-border)';
              const nodeSize = getNodeDimensions(node);
              return (
                <div
                  key={node.id}
                  className="absolute rounded-2xl shadow-sm"
                  style={{
                    left: node.position.x,
                    top: node.position.y,
                    width: nodeSize.width,
                    height: nodeSize.height,
                  }}
                >
                  <div className="relative h-full w-full">
                    {isMockNode(node) ? (
                      renderMockNodeShell(node.shape, baseBorderColor, color, nodeSize.width, nodeSize.height)
                    ) : (
                      <div className="absolute inset-0 rounded-2xl border" style={{ borderColor: baseBorderColor, background: 'var(--gantry-bg-primary)' }} />
                    )}

                    {isMockNode(node) ? (
                      <div className={`relative flex h-full flex-col ${mockContentClasses(node.shape)}`}>
                        <div
                          className={`${node.shape === 'diamond' ? 'w-full space-y-2' : ''} min-w-0`}
                          style={mockContentStyle(node.shape, nodeSize.width)}
                        >
                          <div
                            className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold"
                            style={{ backgroundColor: `${color}1A`, color }}
                          >
                            {badge}
                          </div>
                          <div className={`mt-2 break-words whitespace-pre-wrap text-sm font-semibold leading-5 text-[var(--gantry-text-primary)] ${node.shape === 'diamond' ? 'text-center' : ''}`}>
                            {nodeTitle(node)}
                          </div>
                        </div>
                        <div
                          className={`min-w-0 break-words whitespace-pre-wrap text-xs leading-4 text-[var(--gantry-text-secondary)] ${node.shape === 'diamond' ? 'text-center' : ''}`}
                          style={mockContentStyle(node.shape, nodeSize.width)}
                        >
                          {nodeSubtitle(node)}
                        </div>
                      </div>
                    ) : (
                      <div className="relative flex h-full flex-col justify-between p-3">
                        <div>
                          <div className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `${color}1A`, color }}>
                            {badge}
                          </div>
                          <div className="mt-2 break-words text-sm font-semibold leading-5 text-[var(--gantry-text-primary)]">
                            {nodeTitle(node)}
                          </div>
                        </div>
                        <div className="break-words text-xs leading-4 text-[var(--gantry-text-secondary)]">
                          {nodeSubtitle(node)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {flowSpec.nodes.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                <Workflow className="h-8 w-8 text-[var(--gantry-text-secondary)] opacity-40" />
                <div>
                  <h3 className="text-lg font-semibold text-[var(--gantry-text-primary)]">No diagram nodes</h3>
                  <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
                    Open this entity in Flow to start building out the canvas.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
