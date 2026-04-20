import { type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Workflow } from 'lucide-react';
import type { Entity, FlowEdge, FlowEntityNode, FlowMockNode, FlowMockShape, FlowNode, FlowSpec } from '../lib/types';

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const ENTITY_NODE_WIDTH = 208;
const ENTITY_NODE_HEIGHT = 92;
const MAX_NODE_WIDTH = 440;
const MIN_NODE_HEIGHT = 92;
const MOCK_SHAPE_OPTIONS: FlowMockShape[] = ['box', 'pill', 'diamond', 'note'];

const kindColors: Record<string, string> = {
  Service: '#3B82F6',
  API: '#10B981',
  Infrastructure: '#F59E0B',
  Team: '#8B5CF6',
  Environment: '#06B6D4',
  Documentation: '#EC4899',
  Action: '#EF4444',
  Flow: '#0EA5E9',
};

function ensureFlowSpec(spec: Record<string, any> | undefined): FlowSpec {
  const viewport = spec?.viewport || {};
  const nodes = Array.isArray(spec?.nodes) ? spec.nodes : [];
  const edges = Array.isArray(spec?.edges) ? spec.edges : [];

  return {
    viewport: {
      x: typeof viewport.x === 'number' ? viewport.x : 0,
      y: typeof viewport.y === 'number' ? viewport.y : 0,
      zoom: typeof viewport.zoom === 'number' ? viewport.zoom : 1,
    },
    nodes: nodes
      .filter((node: any) => node && typeof node === 'object')
      .map((node: any): FlowNode | null => {
        const position = {
          x: typeof node.position?.x === 'number' ? node.position.x : 0,
          y: typeof node.position?.y === 'number' ? node.position.y : 0,
        };
        if (node.nodeType === 'mock') {
          return {
            id: typeof node.id === 'string' ? node.id : crypto.randomUUID(),
            nodeType: 'mock',
            label: typeof node.label === 'string' && node.label.trim() ? node.label : 'Mock Node',
            subtitle: typeof node.subtitle === 'string' ? node.subtitle : '',
            shape: MOCK_SHAPE_OPTIONS.includes(node.shape) ? node.shape : 'box',
            color: typeof node.color === 'string' && node.color.trim() ? node.color : '#64748B',
            width: typeof node.width === 'number' ? node.width : undefined,
            height: typeof node.height === 'number' ? node.height : undefined,
            position,
          };
        }

        const entityNode: FlowEntityNode = {
          id: typeof node.id === 'string' ? node.id : crypto.randomUUID(),
          nodeType: 'entity',
          entityRef: {
            kind: String(node.entityRef?.kind || ''),
            name: String(node.entityRef?.name || ''),
            namespace: typeof node.entityRef?.namespace === 'string' ? node.entityRef.namespace : undefined,
          },
          position,
        };

        return entityNode.entityRef.kind && entityNode.entityRef.name ? entityNode : null;
      })
      .filter((node): node is FlowNode => Boolean(node)),
    edges: edges
      .filter((edge: any) => edge && typeof edge === 'object')
      .map((edge: any): FlowEdge => ({
        id: typeof edge.id === 'string' ? edge.id : crypto.randomUUID(),
        source: String(edge.source || ''),
        target: String(edge.target || ''),
        relation: String(edge.relation || 'calls'),
        direction: edge.direction === 'two-way' ? 'two-way' : 'one-way',
        label: typeof edge.label === 'string' ? edge.label : '',
        animated: typeof edge.animated === 'boolean' ? edge.animated : true,
      }))
      .filter((edge) => Boolean(edge.source && edge.target && edge.relation)),
  };
}

function isMockNode(node: FlowNode): node is FlowMockNode {
  return node.nodeType === 'mock';
}

function nodeColor(node: FlowNode): string {
  return isMockNode(node) ? node.color || '#64748B' : kindColors[node.entityRef.kind] || '#64748B';
}

function nodeTitle(node: FlowNode): string {
  return isMockNode(node) ? node.label : node.entityRef.name;
}

function nodeSubtitle(node: FlowNode): string {
  return isMockNode(node) ? node.subtitle || 'Mockup' : (node.entityRef.namespace && node.entityRef.namespace !== 'default' ? node.entityRef.namespace : 'default');
}

function mockShapeLabel(shape: FlowMockShape): string {
  switch (shape) {
    case 'pill':
      return 'Mock Pill';
    case 'diamond':
      return 'Mock Diamond';
    case 'note':
      return 'Mock Note';
    default:
      return 'Mock Box';
  }
}

function withAlpha(color: string, alpha: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return `${color}${alpha}`;
  }
  return color;
}

function mockFoldFill(color: string): string {
  return withAlpha(color, '22');
}

function estimateWrappedLines(text: string, charsPerLine: number): number {
  if (!text.trim()) return 0;
  return text
    .split(/\r?\n/)
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.trim().length / Math.max(1, charsPerLine))), 0);
}

function getNodeDimensions(node: FlowNode): { width: number; height: number } {
  if (!isMockNode(node)) {
    return { width: ENTITY_NODE_WIDTH, height: ENTITY_NODE_HEIGHT };
  }

  const title = node.label.trim();
  const subtitle = (node.subtitle || '').trim();
  const longestText = Math.max(title.length, subtitle.length, 12);

  switch (node.shape) {
    case 'pill': {
      const baseWidth = Math.min(340, Math.max(188, 188 + Math.max(0, longestText - 12) * 7));
      const width = Math.min(MAX_NODE_WIDTH, Math.max(node.width || 0, baseWidth));
      const charsPerLine = Math.max(12, Math.floor((width - 44) / 8));
      const titleLines = estimateWrappedLines(title, charsPerLine);
      const subtitleLines = estimateWrappedLines(subtitle, charsPerLine);
      const height = Math.max(node.height || 0, 84, 48 + titleLines * 18 + subtitleLines * 16 + 18);
      return { width, height };
    }
    case 'diamond': {
      const baseWidth = Math.min(MAX_NODE_WIDTH, Math.max(272, 272 + Math.max(0, longestText - 10) * 10));
      const width = Math.min(MAX_NODE_WIDTH, Math.max(node.width || 0, baseWidth));
      const charsPerLine = Math.max(9, Math.floor((width * 0.42) / 8));
      const titleLines = estimateWrappedLines(title, charsPerLine);
      const subtitleLines = estimateWrappedLines(subtitle, charsPerLine);
      const height = Math.max(node.height || 0, Math.min(220, Math.max(120, 120 + Math.max(0, titleLines - 1) * 22 + subtitleLines * 20)));
      return { width, height };
    }
    case 'note': {
      const baseWidth = Math.min(360, Math.max(196, 196 + Math.max(0, longestText - 14) * 7));
      const width = Math.min(MAX_NODE_WIDTH, Math.max(node.width || 0, baseWidth));
      const charsPerLine = Math.max(13, Math.floor((width - 52) / 8));
      const titleLines = estimateWrappedLines(title, charsPerLine);
      const subtitleLines = estimateWrappedLines(subtitle, charsPerLine);
      const height = Math.max(node.height || 0, MIN_NODE_HEIGHT, 56 + titleLines * 18 + subtitleLines * 16 + 24);
      return { width, height };
    }
    case 'box':
    default: {
      const baseWidth = Math.min(320, Math.max(180, 180 + Math.max(0, longestText - 14) * 6));
      const width = Math.min(MAX_NODE_WIDTH, Math.max(node.width || 0, baseWidth));
      const charsPerLine = Math.max(14, Math.floor((width - 36) / 8));
      const titleLines = estimateWrappedLines(title, charsPerLine);
      const subtitleLines = estimateWrappedLines(subtitle, charsPerLine);
      const height = Math.max(node.height || 0, MIN_NODE_HEIGHT, 48 + titleLines * 18 + subtitleLines * 16 + 18);
      return { width, height };
    }
  }
}

function renderMockNodeShell(shape: FlowMockShape, borderColor: string, color: string, width: number, height: number) {
  const fill = 'var(--gantry-bg-primary)';

  switch (shape) {
    case 'pill':
      return (
        <div
          className="absolute inset-x-0 inset-y-1 rounded-full border"
          style={{ borderColor, background: fill }}
        />
      );
    case 'diamond':
      return (
        <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          <polygon
            points={`${width / 2},6 ${width - 14},${height / 2} ${width / 2},${height - 6} 14,${height / 2}`}
            fill={fill}
            stroke={borderColor}
            strokeWidth="1.5"
          />
        </svg>
      );
    case 'note':
      return (
        <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          <path
            d={`M 14 8 H ${width - 34} L ${width - 14} 28 V ${height - 14} Q ${width - 14} ${height - 8} ${width - 22} ${height - 8} H 22 Q 14 ${height - 8} 14 ${height - 16} Z`}
            fill={fill}
            stroke={borderColor}
            strokeWidth="1.5"
          />
          <path
            d={`M ${width - 34} 8 V 22 Q ${width - 34} 28 ${width - 28} 28 H ${width - 14} L ${width - 34} 8 Z`}
            fill={mockFoldFill(color)}
            stroke={borderColor}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'box':
    default:
      return (
        <div
          className="absolute inset-0 rounded-2xl border"
          style={{ borderColor, background: fill }}
        />
      );
  }
}

function mockContentClasses(shape: FlowMockShape): string {
  switch (shape) {
    case 'diamond':
      return 'items-center justify-center text-center px-10 py-6';
    case 'pill':
      return 'justify-center px-7 py-4';
    case 'note':
      return 'justify-between px-5 py-4 pr-12';
    case 'box':
    default:
      return 'justify-between px-4 py-3';
  }
}

function mockContentStyle(shape: FlowMockShape, width: number): CSSProperties {
  switch (shape) {
    case 'diamond':
      return { maxWidth: Math.max(120, width * 0.44) };
    case 'pill':
      return { maxWidth: Math.max(140, width - 32) };
    case 'note':
      return { maxWidth: Math.max(140, width - 44) };
    case 'box':
    default:
      return { maxWidth: Math.max(140, width - 28) };
  }
}

function flowHref(entity: Entity, mode: 'view' | 'edit') {
  const params = new URLSearchParams({
    flow: entity.metadata.name,
    namespace: entity.metadata.namespace || 'default',
    mode,
  });
  return `/flow?${params.toString()}`;
}

function edgePath(source: FlowNode, target: FlowNode): string {
  const sourceSize = getNodeDimensions(source);
  const targetSize = getNodeDimensions(target);
  const x1 = source.position.x + sourceSize.width;
  const y1 = source.position.y + sourceSize.height / 2;
  const x2 = target.position.x;
  const y2 = target.position.y + targetSize.height / 2;
  const dx = Math.max(80, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
}

function edgeLabelPosition(source: FlowNode, target: FlowNode) {
  const sourceSize = getNodeDimensions(source);
  const targetSize = getNodeDimensions(target);
  return {
    x: (source.position.x + sourceSize.width + target.position.x) / 2,
    y: (source.position.y + target.position.y) / 2 + (sourceSize.height + targetSize.height) / 4 - 10,
  };
}

function edgeOffsetTransform(source: FlowNode, target: FlowNode, offset: number): string {
  const sourceSize = getNodeDimensions(source);
  const targetSize = getNodeDimensions(target);
  const x1 = source.position.x + sourceSize.width;
  const y1 = source.position.y + sourceSize.height / 2;
  const x2 = target.position.x;
  const y2 = target.position.y + targetSize.height / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  return `translate(${nx * offset}, ${ny * offset})`;
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
