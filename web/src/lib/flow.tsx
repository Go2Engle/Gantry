import type { CSSProperties } from 'react';
import type { FlowEdge, FlowEntityNode, FlowMockNode, FlowMockShape, FlowNode, FlowSpec } from './types';

export const ENTITY_NODE_WIDTH = 208;
export const ENTITY_NODE_HEIGHT = 92;
export const MAX_NODE_WIDTH = 440;
export const MIN_NODE_HEIGHT = 92;
export const MOCK_SHAPE_OPTIONS: FlowMockShape[] = ['box', 'pill', 'diamond', 'note'];

export const FLOW_KIND_COLORS: Record<string, string> = {
  Service: '#3B82F6',
  API: '#10B981',
  Infrastructure: '#F59E0B',
  Team: '#8B5CF6',
  Environment: '#06B6D4',
  Documentation: '#EC4899',
  Action: '#EF4444',
  Flow: '#0EA5E9',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ensureFlowSpec(spec: Record<string, any> | undefined): FlowSpec {
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

export function isMockNode(node: FlowNode): node is FlowMockNode {
  return node.nodeType === 'mock';
}

export function isEntityNode(node: FlowNode): node is FlowEntityNode {
  return !isMockNode(node);
}

export function nodeColor(node: FlowNode): string {
  if (isMockNode(node)) return node.color || '#64748B';
  return FLOW_KIND_COLORS[node.entityRef.kind] || '#64748B';
}

export function nodeSubtitle(node: FlowNode): string {
  if (isMockNode(node)) return node.subtitle || 'Mockup';
  return node.entityRef.name;
}

export function mockShapeLabel(shape: FlowMockShape): string {
  switch (shape) {
    case 'pill':
      return 'Pill';
    case 'diamond':
      return 'Diamond';
    case 'note':
      return 'Note';
    default:
      return 'Box';
  }
}

export function withAlpha(color: string, alpha: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return `${color}${alpha}`;
  }
  return color;
}

export function mockFoldFill(color: string): string {
  return withAlpha(color, '22');
}

export function estimateWrappedLines(text: string, charsPerLine: number): number {
  if (!text.trim()) return 0;
  return text
    .split(/\r?\n/)
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.trim().length / Math.max(1, charsPerLine))), 0);
}

export function getNodeDimensions(node: FlowNode): { width: number; height: number } {
  if (isEntityNode(node)) {
    return { width: ENTITY_NODE_WIDTH, height: ENTITY_NODE_HEIGHT };
  }

  const title = node.label.trim();
  const subtitle = (node.subtitle || '').trim();
  const longestText = Math.max(title.length, subtitle.length, 12);

  switch (node.shape) {
    case 'pill': {
      const baseWidth = clamp(188 + Math.max(0, longestText - 12) * 7, 188, 340);
      const width = clamp(Math.max(node.width || 0, baseWidth), 188, MAX_NODE_WIDTH);
      const charsPerLine = Math.max(12, Math.floor((width - 44) / 8));
      const titleLines = estimateWrappedLines(title, charsPerLine);
      const subtitleLines = estimateWrappedLines(subtitle, charsPerLine);
      const baseHeight = Math.max(84, 48 + titleLines * 18 + subtitleLines * 16 + 18);
      const height = Math.max(node.height || 0, baseHeight);
      return { width, height };
    }
    case 'diamond': {
      const baseWidth = clamp(272 + Math.max(0, longestText - 10) * 10, 272, MAX_NODE_WIDTH);
      const width = clamp(Math.max(node.width || 0, baseWidth), 272, MAX_NODE_WIDTH);
      const charsPerLine = Math.max(9, Math.floor((width * 0.42) / 8));
      const titleLines = estimateWrappedLines(title, charsPerLine);
      const subtitleLines = estimateWrappedLines(subtitle, charsPerLine);
      const baseHeight = clamp(120 + Math.max(0, titleLines - 1) * 22 + subtitleLines * 20, 120, 220);
      const height = Math.max(node.height || 0, baseHeight);
      return { width, height };
    }
    case 'note': {
      const baseWidth = clamp(196 + Math.max(0, longestText - 14) * 7, 196, 360);
      const width = clamp(Math.max(node.width || 0, baseWidth), 196, MAX_NODE_WIDTH);
      const charsPerLine = Math.max(13, Math.floor((width - 52) / 8));
      const titleLines = estimateWrappedLines(title, charsPerLine);
      const subtitleLines = estimateWrappedLines(subtitle, charsPerLine);
      const baseHeight = Math.max(MIN_NODE_HEIGHT, 56 + titleLines * 18 + subtitleLines * 16 + 24);
      const height = Math.max(node.height || 0, baseHeight);
      return { width, height };
    }
    case 'box':
    default: {
      const baseWidth = clamp(180 + Math.max(0, longestText - 14) * 6, 180, 320);
      const width = clamp(Math.max(node.width || 0, baseWidth), 180, MAX_NODE_WIDTH);
      const charsPerLine = Math.max(14, Math.floor((width - 36) / 8));
      const titleLines = estimateWrappedLines(title, charsPerLine);
      const subtitleLines = estimateWrappedLines(subtitle, charsPerLine);
      const baseHeight = Math.max(MIN_NODE_HEIGHT, 48 + titleLines * 18 + subtitleLines * 16 + 18);
      const height = Math.max(node.height || 0, baseHeight);
      return { width, height };
    }
  }
}

export function renderMockNodeShell(shape: FlowMockShape, borderColor: string, color: string, width: number, height: number) {
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

export function mockContentClasses(shape: FlowMockShape): string {
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

export function mockContentStyle(shape: FlowMockShape, width: number): CSSProperties {
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

export function edgePath(source: FlowNode, target: FlowNode): string {
  const sourceSize = getNodeDimensions(source);
  const targetSize = getNodeDimensions(target);
  const x1 = source.position.x + sourceSize.width;
  const y1 = source.position.y + sourceSize.height / 2;
  const x2 = target.position.x;
  const y2 = target.position.y + targetSize.height / 2;
  const dx = Math.max(80, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
}

export function edgeLabelPosition(source: FlowNode, target: FlowNode) {
  const sourceSize = getNodeDimensions(source);
  const targetSize = getNodeDimensions(target);
  return {
    x: (source.position.x + sourceSize.width + target.position.x) / 2,
    y: (source.position.y + target.position.y) / 2 + (sourceSize.height + targetSize.height) / 4 - 10,
  };
}

export function edgeOffsetTransform(source: FlowNode, target: FlowNode, offset: number): string {
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
