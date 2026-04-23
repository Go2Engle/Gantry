import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Workflow } from 'lucide-react';
import { api } from '../lib/api';
import { useFlowHealth } from '../hooks/useFlowHealth';
import type { Entity } from '../lib/types';
import {
  connectedEdgeHealth,
  edgeStrokeForHealth,
  edgeLabelPosition,
  edgeOffsetTransform,
  edgePath,
  ensureFlowSpec,
  FLOW_EDGE_HEALTHY_STROKE,
  FLOW_EDGE_STROKE,
  FLOW_EDGE_UNHEALTHY_STROKE,
  getAbsolutePosition,
  getNodeDimensions,
  isMockNode,
  mockContentClasses,
  mockContentStyle,
  nodeBadge,
  nodeColor,
  nodeSubtitle,
  renderMockNodeShell,
} from '../lib/flow';

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const FIT_PADDING = 32;

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
  const [availableEntities, setAvailableEntities] = useState<Entity[]>([]);
  const healthStatuses = useFlowHealth(flowSpec.nodes, availableEntities);

  useEffect(() => {
    let active = true;

    const loadEntities = async () => {
      try {
        const entities = await api.listEntities();
        if (!active) return;
        setAvailableEntities((entities || []).filter((candidate) => candidate.kind !== 'Flow'));
      } catch {
        if (active) setAvailableEntities([]);
      }
    };

    void loadEntities();
    return () => {
      active = false;
    };
  }, []);

  // Compute fit-view transform so all nodes are visible within the fixed canvas.
  const nodeMap = new Map(flowSpec.nodes.map((n) => [n.id, n]));
  let fitScale = 1;
  let fitTx = 0;
  let fitTy = 0;
  if (flowSpec.nodes.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of flowSpec.nodes) {
      const size = getNodeDimensions(node);
      const abs = getAbsolutePosition(node, nodeMap);
      minX = Math.min(minX, abs.x);
      minY = Math.min(minY, abs.y);
      maxX = Math.max(maxX, abs.x + size.width);
      maxY = Math.max(maxY, abs.y + size.height);
    }
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const availW = CANVAS_WIDTH - FIT_PADDING * 2;
    const availH = CANVAS_HEIGHT - FIT_PADDING * 2;
    fitScale = Math.min(1, availW / contentW, availH / contentH);
    fitTx = (CANVAS_WIDTH - contentW * fitScale) / 2 - minX * fitScale;
    fitTy = (CANVAS_HEIGHT - contentH * fitScale) / 2 - minY * fitScale;
  }

  // Track container width to scale the fixed-size virtual canvas into available space.
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(CANVAS_WIDTH);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const containerScale = Math.min(1, containerWidth / CANVAS_WIDTH);
  const displayHeight = CANVAS_HEIGHT * containerScale;

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
        <div ref={containerRef} className="bg-[var(--gantry-bg-secondary)] p-4">
          <div
            className="relative overflow-hidden rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]"
            style={{
              width: '100%',
              height: displayHeight,
              backgroundImage: 'linear-gradient(rgba(148, 163, 184, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.08) 1px, transparent 1px)',
              backgroundSize: `${32 * fitScale * containerScale}px ${32 * fitScale * containerScale}px`,
              backgroundPosition: `${fitTx * containerScale}px ${fitTy * containerScale}px`,
            }}
          >
           <div className="absolute origin-top-left" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, transform: `scale(${containerScale})` }}>
            <div style={{ transform: `translate(${fitTx}px, ${fitTy}px) scale(${fitScale})`, transformOrigin: '0 0', width: CANVAS_WIDTH / fitScale, height: CANVAS_HEIGHT / fitScale }}>
            <svg className="pointer-events-none absolute inset-0 overflow-visible" style={{ width: CANVAS_WIDTH / fitScale, height: CANVAS_HEIGHT / fitScale }}>
              <defs>
                {[
                  ['default', FLOW_EDGE_STROKE],
                  ['healthy', FLOW_EDGE_HEALTHY_STROKE],
                  ['unhealthy', FLOW_EDGE_UNHEALTHY_STROKE],
                ].map(([suffix, fill]) => (
                  <g key={suffix}>
                    <marker id={`catalog-flow-arrow-end-${suffix}`} markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
                      <path d="M 0 0 L 10 5 L 0 10 z" fill={fill} />
                    </marker>
                    <marker id={`catalog-flow-arrow-start-${suffix}`} markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto-start-reverse">
                      <path d="M 0 0 L 10 5 L 0 10 z" fill={fill} />
                    </marker>
                  </g>
                ))}
              </defs>
              {(() => {
                return flowSpec.edges.map((edge) => {
                const source = flowSpec.nodes.find((node) => node.id === edge.source);
                const target = flowSpec.nodes.find((node) => node.id === edge.target);
                if (!source || !target) return null;
                const sourceAbs = getAbsolutePosition(source, nodeMap);
                const targetAbs = getAbsolutePosition(target, nodeMap);
                const sourceSize = getNodeDimensions(source);
                const targetSize = getNodeDimensions(target);
                const path = edgePath(sourceAbs, sourceSize, targetAbs, targetSize, edge.sourceHandle, edge.targetHandle);
                const labelPos = edgeLabelPosition(sourceAbs, sourceSize, targetAbs, targetSize, edge.sourceHandle, edge.targetHandle);
                const twoWay = edge.direction === 'two-way';
                const health = connectedEdgeHealth(edge, nodeMap, healthStatuses);
                const edgeColor = edgeStrokeForHealth(health);
                const markerVariant = health === true ? 'healthy' : health === false ? 'unhealthy' : 'default';
                const forwardTransform = twoWay ? edgeOffsetTransform(sourceAbs, sourceSize, targetAbs, targetSize, 3, edge.sourceHandle, edge.targetHandle) : undefined;
                const reverseTransform = twoWay ? edgeOffsetTransform(sourceAbs, sourceSize, targetAbs, targetSize, -3, edge.sourceHandle, edge.targetHandle) : undefined;

                return (
                  <g key={edge.id}>
                    {!twoWay && (
                      <path
                        d={path}
                        fill="none"
                        stroke={edgeColor}
                        strokeWidth={2}
                        strokeDasharray={edge.animated ? '8 8' : undefined}
                        markerEnd={`url(#catalog-flow-arrow-end-${markerVariant})`}
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
                          stroke={edgeColor}
                          strokeWidth={2.1}
                          strokeDasharray={edge.animated ? '8 8' : undefined}
                          markerEnd={`url(#catalog-flow-arrow-end-${markerVariant})`}
                        >
                          {edge.animated && <animate attributeName="stroke-dashoffset" from="16" to="0" dur="1s" repeatCount="indefinite" />}
                        </path>
                        <path
                          d={path}
                          fill="none"
                          transform={reverseTransform}
                          stroke={edgeColor}
                          strokeWidth={1.9}
                          strokeDasharray={edge.animated ? '8 8' : undefined}
                          markerStart={`url(#catalog-flow-arrow-start-${markerVariant})`}
                        >
                          {edge.animated && <animate attributeName="stroke-dashoffset" from="0" to="16" dur="1s" repeatCount="indefinite" />}
                        </path>
                      </>
                    )}
                    <rect
                      x={labelPos.x - 30}
                      y={labelPos.y - 17}
                      width={60}
                      height={22}
                      rx={11}
                      fill="var(--gantry-bg-primary)"
                      stroke={health === undefined ? (twoWay ? FLOW_EDGE_STROKE : 'var(--gantry-border)') : edgeColor}
                    />
                    <text x={labelPos.x} y={labelPos.y - 2} textAnchor="middle" className="fill-[var(--gantry-text-secondary)] text-[11px] font-medium">
                      {edge.label || edge.relation}
                    </text>
                  </g>
                );
              });
              })()}
            </svg>

            {flowSpec.nodes.map((node) => {
              const color = nodeColor(node);
              const badge = nodeBadge(node);
              const subtitle = nodeSubtitle(node);
              const baseBorderColor = 'var(--gantry-border)';
              const nodeSize = getNodeDimensions(node);
              const absPos = getAbsolutePosition(node, nodeMap);
              return (
                <div
                  key={node.id}
                  className="absolute rounded-2xl shadow-sm"
                  style={{
                    left: absPos.x,
                    top: absPos.y,
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
                          {badge && (
                            <div
                              className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold"
                              style={{ backgroundColor: `${color}1A`, color }}
                            >
                              {badge}
                            </div>
                          )}
                          <div className={`${badge ? 'mt-2' : ''} break-words whitespace-pre-wrap text-sm font-semibold leading-5 text-[var(--gantry-text-primary)] ${node.shape === 'diamond' ? 'text-center' : ''}`}>
                            {nodeTitle(node)}
                          </div>
                        </div>
                        {subtitle && (
                          <div
                            className={`min-w-0 break-words whitespace-pre-wrap text-xs leading-4 text-[var(--gantry-text-secondary)] ${node.shape === 'diamond' ? 'text-center' : ''}`}
                            style={mockContentStyle(node.shape, nodeSize.width)}
                          >
                            {subtitle}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="relative flex h-full flex-col justify-between p-3">
                        <div>
                          {badge && (
                            <div className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `${color}1A`, color }}>
                              {badge}
                            </div>
                          )}
                          <div className={`${badge ? 'mt-2' : ''} break-words text-sm font-semibold leading-5 text-[var(--gantry-text-primary)]`}>
                            {nodeTitle(node)}
                          </div>
                        </div>
                        {subtitle && (
                          <div className="break-words text-xs leading-4 text-[var(--gantry-text-secondary)]">
                            {subtitle}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            </div>

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
    </div>
  );
}
