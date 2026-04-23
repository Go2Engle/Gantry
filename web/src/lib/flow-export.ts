import type { Entity, FlowEntityNode, FlowMockNode, FlowSpec } from './types';
import {
  connectedEdgeHealth,
  edgeLabelPosition,
  edgeOffsetTransform,
  edgePath,
  edgeStrokeForHealth,
  FLOW_EDGE_HEALTHY_STROKE,
  FLOW_EDGE_STROKE,
  FLOW_EDGE_UNHEALTHY_STROKE,
  getAbsolutePosition,
  getNodeDimensions,
  isMockNode,
  mockFoldFill,
  nodeBadge,
  nodeColor,
  nodeEntityKey,
  nodeSubtitle,
  withAlpha,
} from './flow';

export type FlowExportFormat = 'svg' | 'png' | 'pdf';
export type FlowExportStyle = 'presentation' | 'clean';
export type FlowExportBackground = 'theme' | 'light' | 'transparent';
export type FlowExportTheme = 'app' | 'light' | 'dark';

interface FlowExportOptions {
  name?: string;
  title?: string;
  description?: string;
  owner?: string;
  namespace?: string;
  spec: FlowSpec;
  entitiesByKey: Map<string, Entity>;
  healthStatuses: Map<string, boolean | null>;
  style?: FlowExportStyle;
  background?: FlowExportBackground;
  theme?: FlowExportTheme;
}

interface FlowExportPalette {
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  accent: string;
  accentHover: string;
  danger: string;
  grid: string;
}

interface NormalizedFlowExportOptions extends FlowExportOptions {
  style: FlowExportStyle;
  background: FlowExportBackground;
  theme: FlowExportTheme;
  showHeader: boolean;
  showFrame: boolean;
  showGrid: boolean;
  showEdgeLabels: boolean;
  palette: FlowExportPalette;
}

interface FlowSvgDocument {
  baseName: string;
  svg: string;
  width: number;
  height: number;
}

export interface FlowExportPreview {
  svg: string;
  width: number;
  height: number;
}

const PAGE_PADDING = 28;
const CARD_PADDING = 48;
const HEADER_HEIGHT = 120;
const MIN_CONTENT_WIDTH = 760;
const MIN_CONTENT_HEIGHT = 420;
const EMPTY_CONTENT_WIDTH = 960;
const EMPTY_CONTENT_HEIGHT = 560;
const GRID_SIZE = 32;
const CLEAN_PADDING = 28;
const PDF_PORTRAIT = { width: 612, height: 792 };
const PDF_LANDSCAPE = { width: 792, height: 612 };

const LIGHT_EXPORT_PALETTE: FlowExportPalette = {
  bgPrimary: '#FFFFFF',
  bgSecondary: '#F8FAFC',
  bgTertiary: '#EEF2F7',
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  border: '#D1D5DB',
  accent: '#111827',
  accentHover: '#374151',
  danger: '#DC2626',
  grid: 'rgba(107, 114, 128, 0.10)',
};

const DARK_EXPORT_PALETTE: FlowExportPalette = {
  bgPrimary: '#1C1C1E',
  bgSecondary: '#111113',
  bgTertiary: '#2C2C2E',
  textPrimary: '#F5F5F7',
  textSecondary: '#8E8E93',
  border: '#38383A',
  accent: '#F5F5F7',
  accentHover: '#D1D1D6',
  danger: '#FF453A',
  grid: 'rgba(142, 142, 147, 0.18)',
};

export async function exportFlowDiagram(options: FlowExportOptions, format: FlowExportFormat): Promise<void> {
  const doc = buildFlowSvgDocument(normalizeExportOptions(options, format));

  if (format === 'svg') {
    downloadBlob(`${doc.baseName}.svg`, new Blob([doc.svg], { type: 'image/svg+xml;charset=utf-8' }));
    return;
  }

  const canvas = await renderSvgToCanvas(doc.svg, doc.width, doc.height, 2);
  if (format === 'png') {
    const blob = await canvasToBlob(canvas, 'image/png');
    downloadBlob(`${doc.baseName}.png`, blob);
    return;
  }

  const jpegDataURL = canvas.toDataURL('image/jpeg', 0.94);
  const jpegBytes = decodeBase64DataUrl(jpegDataURL);
  const pdfBytes = buildPdfFromJpeg(jpegBytes, canvas.width, canvas.height);
  downloadBlob(`${doc.baseName}.pdf`, new Blob([toArrayBuffer(pdfBytes)], { type: 'application/pdf' }));
}

export function getFlowExportPreview(options: FlowExportOptions, format: FlowExportFormat): FlowExportPreview {
  const doc = buildFlowSvgDocument(normalizeExportOptions(options, format));
  return {
    svg: doc.svg,
    width: doc.width,
    height: doc.height,
  };
}

function normalizeExportOptions(options: FlowExportOptions, format: FlowExportFormat): NormalizedFlowExportOptions {
  const theme = options.theme || 'app';
  const style = options.style || 'presentation';
  const palette = resolveThemePalette(theme);
  let background = options.background;
  if (!background) {
    background = style === 'clean'
      ? (format === 'pdf' ? 'light' : 'transparent')
      : 'theme';
  }
  if (format === 'pdf' && background === 'transparent') {
    background = 'light';
  }

  return {
    ...options,
    style,
    background,
    theme,
    showHeader: style === 'presentation',
    showFrame: style === 'presentation',
    showGrid: style === 'presentation',
    showEdgeLabels: style === 'presentation',
    palette,
  };
}

function buildFlowSvgDocument(options: NormalizedFlowExportOptions): FlowSvgDocument {
  const baseName = sanitizeFileName(options.title || options.name || 'flow');
  const displayTitle = (options.title || options.name || 'Untitled Flow').trim() || 'Untitled Flow';
  const description = (options.description || '').trim();
  const owner = (options.owner || '').trim();
  const namespace = (options.namespace || 'default').trim() || 'default';
  const nodeMap = new Map(options.spec.nodes.map((node) => [node.id, node]));
  const childIds = new Set(options.spec.nodes.filter((node) => node.parentId).map((node) => node.parentId!));
  const bounds = getDiagramBounds(options.spec, nodeMap, options.showFrame ? CARD_PADDING : 0);
  const backgroundFill = getDocumentBackground(options);
  const nodeCount = options.spec.nodes.length;
  const edgeCount = options.spec.edges.length;
  const metaParts = [
    namespace !== 'default' ? `Namespace: ${namespace}` : '',
    owner ? `Owner: ${owner}` : '',
    `${nodeCount} node${nodeCount === 1 ? '' : 's'}`,
    `${edgeCount} edge${edgeCount === 1 ? '' : 's'}`,
  ].filter(Boolean);

  const sortedNodes = [...options.spec.nodes].sort((a, b) => {
    const aIsContainer = childIds.has(a.id);
    const bIsContainer = childIds.has(b.id);
    if (aIsContainer && !bIsContainer) return -1;
    if (!aIsContainer && bIsContainer) return 1;
    return (a.zIndex ?? 0) - (b.zIndex ?? 0);
  });

  const contentWidth = options.spec.nodes.length > 0
    ? Math.max(bounds.width, options.style === 'presentation' ? MIN_CONTENT_WIDTH : 0)
    : EMPTY_CONTENT_WIDTH;
  const contentHeight = options.spec.nodes.length > 0
    ? Math.max(bounds.height, options.style === 'presentation' ? MIN_CONTENT_HEIGHT : 0)
    : EMPTY_CONTENT_HEIGHT;

  let width: number;
  let height: number;
  let offsetX: number;
  let offsetY: number;
  let headerSvg = '';
  let frameSvg = '';
  let gridSvg = '';

  if (options.showFrame) {
    const cardX = PAGE_PADDING;
    const cardY = HEADER_HEIGHT;
    const cardWidth = contentWidth + CARD_PADDING * 2;
    const cardHeight = contentHeight + CARD_PADDING * 2;
    width = cardX * 2 + cardWidth;
    height = cardY + cardHeight + PAGE_PADDING;
    offsetX = cardX + CARD_PADDING + (contentWidth - bounds.width) / 2 - bounds.minX;
    offsetY = cardY + CARD_PADDING + (contentHeight - bounds.height) / 2 - bounds.minY;

    headerSvg = options.showHeader ? `
  <text class="flow-title" x="${PAGE_PADDING}" y="48">${escapeXml(displayTitle)}</text>
  <text class="flow-meta" x="${PAGE_PADDING}" y="72">${escapeXml(metaParts.join(' · '))}</text>
  ${description ? `<text class="flow-description" x="${PAGE_PADDING}" y="98">${escapeXml(description)}</text>` : ''}
` : '';
    frameSvg = `
  <rect x="${cardX}" y="${cardY}" width="${cardWidth}" height="${cardHeight}" rx="28" fill="${options.palette.bgPrimary}" stroke="${options.palette.border}" />
`;
    gridSvg = options.showGrid ? `
  <rect x="${cardX + 1}" y="${cardY + 1}" width="${cardWidth - 2}" height="${cardHeight - 2}" rx="27" fill="url(#flow-grid)" />
` : '';
  } else {
    width = contentWidth + CLEAN_PADDING * 2;
    height = contentHeight + CLEAN_PADDING * 2;
    offsetX = CLEAN_PADDING - bounds.minX + (contentWidth - bounds.width) / 2;
    offsetY = CLEAN_PADDING - bounds.minY + (contentHeight - bounds.height) / 2;
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="flow-export-title flow-export-meta">
  <title id="flow-export-title">${escapeXml(displayTitle)}</title>
  <desc id="flow-export-meta">${escapeXml(metaParts.join(' · '))}</desc>
  <defs>
    <pattern id="flow-grid" width="${GRID_SIZE}" height="${GRID_SIZE}" patternUnits="userSpaceOnUse">
      <path d="M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}" fill="none" stroke="${options.palette.grid}" stroke-width="1" />
    </pattern>
    <marker id="flow-arrow-end-default" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${resolveEdgeColor(FLOW_EDGE_STROKE, options.palette)}" />
    </marker>
    <marker id="flow-arrow-end-healthy" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${resolveEdgeColor(FLOW_EDGE_HEALTHY_STROKE, options.palette)}" />
    </marker>
    <marker id="flow-arrow-end-unhealthy" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${resolveEdgeColor(FLOW_EDGE_UNHEALTHY_STROKE, options.palette)}" />
    </marker>
    <marker id="flow-arrow-start-default" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${resolveEdgeColor(FLOW_EDGE_STROKE, options.palette)}" />
    </marker>
    <marker id="flow-arrow-start-healthy" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${resolveEdgeColor(FLOW_EDGE_HEALTHY_STROKE, options.palette)}" />
    </marker>
    <marker id="flow-arrow-start-unhealthy" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${resolveEdgeColor(FLOW_EDGE_UNHEALTHY_STROKE, options.palette)}" />
    </marker>
    <style>
      text { font-family: Inter, "Segoe UI", Helvetica, Arial, sans-serif; }
      .flow-title { fill: ${options.palette.textPrimary}; font-size: 28px; font-weight: 700; }
      .flow-meta { fill: ${options.palette.textSecondary}; font-size: 13px; font-weight: 500; }
      .flow-description { fill: ${options.palette.textSecondary}; font-size: 14px; }
      .edge-label { fill: ${options.palette.textSecondary}; font-size: 11px; font-weight: 600; }
      .node-title { fill: ${options.palette.textPrimary}; font-size: 14px; font-weight: 700; }
      .node-subtitle { fill: ${options.palette.textSecondary}; font-size: 11px; font-weight: 500; }
      .node-badge { font-size: 10px; font-weight: 700; }
      .empty-title { fill: ${options.palette.textPrimary}; font-size: 22px; font-weight: 700; }
      .empty-body { fill: ${options.palette.textSecondary}; font-size: 14px; }
    </style>
  </defs>
  ${backgroundFill ? `<rect x="0" y="0" width="${width}" height="${height}" fill="${backgroundFill}" />` : ''}
  ${headerSvg}
  ${frameSvg}
  ${gridSvg}
  <g transform="translate(${offsetX}, ${offsetY})">
    ${options.spec.edges.map((edge) => renderEdge(edge, options, nodeMap)).join('\n')}
    ${sortedNodes.map((node) => renderNode(node, options, nodeMap, childIds)).join('\n')}
    ${options.spec.nodes.length === 0 ? renderEmptyState(contentWidth, contentHeight, options.palette) : ''}
  </g>
</svg>`;

  return { baseName, svg, width, height };
}

function renderEdge(
  edge: FlowSpec['edges'][number],
  options: NormalizedFlowExportOptions,
  nodeMap: Map<string, FlowSpec['nodes'][number]>
): string {
  const source = nodeMap.get(edge.source);
  const target = nodeMap.get(edge.target);
  if (!source || !target) return '';

  const sourceAbs = getAbsolutePosition(source, nodeMap);
  const targetAbs = getAbsolutePosition(target, nodeMap);
  const sourceSize = getNodeDimensions(source);
  const targetSize = getNodeDimensions(target);
  const path = edgePath(sourceAbs, sourceSize, targetAbs, targetSize, edge.sourceHandle, edge.targetHandle);
  const labelPos = edgeLabelPosition(sourceAbs, sourceSize, targetAbs, targetSize, edge.sourceHandle, edge.targetHandle);
  const health = connectedEdgeHealth(edge, nodeMap, options.healthStatuses);
  const edgeColor = resolveEdgeColor(edgeStrokeForHealth(health), options.palette);
  const markerVariant = health === true ? 'healthy' : health === false ? 'unhealthy' : 'default';
  const label = edge.label || edge.relation;
  const labelWidth = Math.max(60, Math.min(160, 22 + label.length * 6.5));
  const twoWay = edge.direction === 'two-way';
  const forwardTransform = twoWay ? edgeOffsetTransform(sourceAbs, sourceSize, targetAbs, targetSize, 3, edge.sourceHandle, edge.targetHandle) : '';
  const reverseTransform = twoWay ? edgeOffsetTransform(sourceAbs, sourceSize, targetAbs, targetSize, -3, edge.sourceHandle, edge.targetHandle) : '';

  return `<g>
    ${!twoWay ? `<path d="${path}" fill="none" stroke="${edgeColor}" stroke-width="${options.style === 'clean' ? 2.4 : 2}" marker-end="url(#flow-arrow-end-${markerVariant})" />` : ''}
    ${twoWay ? `<path d="${path}" fill="none" transform="${forwardTransform}" stroke="${edgeColor}" stroke-width="${options.style === 'clean' ? 2.5 : 2.1}" marker-end="url(#flow-arrow-end-${markerVariant})" />` : ''}
    ${twoWay ? `<path d="${path}" fill="none" transform="${reverseTransform}" stroke="${edgeColor}" stroke-width="${options.style === 'clean' ? 2.2 : 1.9}" marker-start="url(#flow-arrow-start-${markerVariant})" />` : ''}
    ${options.showEdgeLabels ? `<rect x="${labelPos.x - labelWidth / 2}" y="${labelPos.y - 17}" width="${labelWidth}" height="22" rx="11" fill="${options.palette.bgPrimary}" stroke="${health === undefined ? options.palette.border : edgeColor}" />
    <text class="edge-label" x="${labelPos.x}" y="${labelPos.y - 2}" text-anchor="middle">${escapeXml(label)}</text>` : ''}
  </g>`;
}

function renderNode(
  node: FlowSpec['nodes'][number],
  options: NormalizedFlowExportOptions,
  nodeMap: Map<string, FlowSpec['nodes'][number]>,
  childIds: Set<string>
): string {
  const size = getNodeDimensions(node);
  const absPos = getAbsolutePosition(node, nodeMap);
  const color = nodeColor(node);
  const badge = nodeBadge(node);
  const subtitle = nodeSubtitle(node);
  const title = nodeTitle(node, options.entitiesByKey);
  const hasChildren = childIds.has(node.id);
  const baseBorderColor = options.style === 'clean' ? withAlpha(color, '66') : options.palette.border;

  if (isMockNode(node)) {
    return renderMockNode(node, title, subtitle, badge, absPos.x, absPos.y, size.width, size.height, hasChildren, baseBorderColor, color, options);
  }

  return renderEntityNode(node, title, subtitle, badge, absPos.x, absPos.y, size.width, size.height, hasChildren, color, options);
}

function renderMockNode(
  node: FlowMockNode,
  title: string,
  subtitle: string,
  badge: string,
  x: number,
  y: number,
  width: number,
  height: number,
  hasChildren: boolean,
  borderColor: string,
  color: string,
  options: NormalizedFlowExportOptions
): string {
  const titleLines = wrapText(title, mockTitleChars(node.shape, width), 4);
  const subtitleLines = wrapText(subtitle, mockSubtitleChars(node.shape, width), 4);
  const badgeColor = withAlpha(color, '1A');
  const shell = renderMockShell(node.shape, x, y, width, height, borderColor, color, options.palette.bgPrimary);
  const overlay = hasChildren
    ? `<rect x="${x + 6}" y="${y + 6}" width="${Math.max(1, width - 12)}" height="${Math.max(1, height - 12)}" rx="${node.shape === 'pill' ? (height - 12) / 2 : 18}" fill="none" stroke="${withAlpha(color, options.style === 'clean' ? '40' : '55')}" stroke-width="1.5" stroke-dasharray="6 5" />`
    : '';

  if (node.shape === 'diamond') {
    let currentY = y + (badge ? 28 : 22);
    const badgeSvg = badge
      ? `<rect x="${x + width / 2 - Math.min(72, badge.length * 4.3 + 16)}" y="${y + 18}" width="${Math.min(144, badge.length * 8.6 + 32)}" height="18" rx="9" fill="${badgeColor}" />
         <text class="node-badge" x="${x + width / 2}" y="${y + 31}" text-anchor="middle" fill="${color}">${escapeXml(badge)}</text>`
      : '';
    const titleSvg = titleLines.map((line) => {
      const next = `<text class="node-title" x="${x + width / 2}" y="${currentY + 16}" text-anchor="middle">${escapeXml(line)}</text>`;
      currentY += 18;
      return next;
    }).join('');
    currentY += subtitleLines.length > 0 ? 8 : 0;
    const subtitleSvg = subtitleLines.map((line) => {
      const next = `<text class="node-subtitle" x="${x + width / 2}" y="${currentY + 14}" text-anchor="middle">${escapeXml(line)}</text>`;
      currentY += 16;
      return next;
    }).join('');
    return `<g>${shell}${overlay}${badgeSvg}${titleSvg}${subtitleSvg}</g>`;
  }

  const horizontalInset = node.shape === 'pill' ? 28 : node.shape === 'note' ? 24 : 18;
  let currentY = y + 22;
  const badgeSvg = badge
    ? `<rect x="${x + horizontalInset}" y="${currentY - 2}" width="${Math.min(150, badge.length * 8.5 + 22)}" height="18" rx="9" fill="${badgeColor}" />
       <text class="node-badge" x="${x + horizontalInset + 11}" y="${currentY + 11}" fill="${color}">${escapeXml(badge)}</text>`
    : '';
  currentY += badge ? 24 : 4;
  const titleSvg = titleLines.map((line) => {
    const next = `<text class="node-title" x="${x + horizontalInset}" y="${currentY + 14}">${escapeXml(line)}</text>`;
    currentY += 18;
    return next;
  }).join('');
  currentY += subtitleLines.length > 0 ? 8 : 0;
  const subtitleSvg = subtitleLines.map((line) => {
    const next = `<text class="node-subtitle" x="${x + horizontalInset}" y="${currentY + 12}">${escapeXml(line)}</text>`;
    currentY += 16;
    return next;
  }).join('');

  return `<g>${shell}${overlay}${badgeSvg}${titleSvg}${subtitleSvg}</g>`;
}

function renderEntityNode(
  node: FlowEntityNode,
  title: string,
  subtitle: string,
  badge: string,
  x: number,
  y: number,
  width: number,
  height: number,
  hasChildren: boolean,
  color: string,
  options: NormalizedFlowExportOptions
): string {
  const badgeColor = withAlpha(color, '1A');
  const titleLines = wrapText(title, 22, 3);
  const subtitleLines = wrapText(subtitle, 24, 2);
  const health = options.healthStatuses.get(nodeEntityKey(node));
  const healthColor = health === true ? '#10B981' : health === false ? options.palette.danger : '';
  const borderColor = options.style === 'clean' ? withAlpha(color, '66') : options.palette.border;

  let currentY = y + 18;
  const badgeSvg = badge
    ? `<rect x="${x + 14}" y="${currentY}" width="${Math.min(150, badge.length * 8.5 + 22)}" height="18" rx="9" fill="${badgeColor}" />
       <text class="node-badge" x="${x + 25}" y="${currentY + 13}" fill="${color}">${escapeXml(badge)}</text>`
    : '';
  currentY += badge ? 26 : 8;
  const titleSvg = titleLines.map((line) => {
    const next = `<text class="node-title" x="${x + 14}" y="${currentY + 14}">${escapeXml(line)}</text>`;
    currentY += 18;
    return next;
  }).join('');
  const subtitleY = Math.min(y + height - 14, currentY + 18);
  const subtitleX = x + 14 + (healthColor ? 12 : 0);
  const subtitleSvg = subtitleLines.map((line, index) => `<text class="node-subtitle" x="${subtitleX}" y="${subtitleY + index * 14}">${escapeXml(line)}</text>`).join('');
  const healthSvg = healthColor
    ? `<circle cx="${x + 18}" cy="${subtitleY - 4}" r="4" fill="${healthColor}" />`
    : '';
  const containerSvg = hasChildren
    ? `<rect x="${x + 4}" y="${y + 4}" width="${width - 8}" height="${height - 8}" rx="20" fill="none" stroke="${options.style === 'clean' ? withAlpha(color, '35') : options.palette.border}" stroke-width="1.2" stroke-dasharray="6 5" />`
    : '';

  return `<g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="24" fill="${options.palette.bgPrimary}" stroke="${borderColor}" stroke-width="${options.style === 'clean' ? 1.8 : 1.2}" />
    ${containerSvg}
    ${badgeSvg}
    ${titleSvg}
    ${healthSvg}
    ${subtitleSvg}
  </g>`;
}

function renderMockShell(
  shape: 'box' | 'pill' | 'diamond' | 'note',
  x: number,
  y: number,
  width: number,
  height: number,
  borderColor: string,
  color: string,
  fill: string
): string {
  switch (shape) {
    case 'pill':
      return `<rect x="${x}" y="${y + 4}" width="${width}" height="${Math.max(1, height - 8)}" rx="${Math.max(18, (height - 8) / 2)}" fill="${fill}" stroke="${borderColor}" stroke-width="1.5" />`;
    case 'diamond':
      return `<polygon points="${x + width / 2},${y + 6} ${x + width - 14},${y + height / 2} ${x + width / 2},${y + height - 6} ${x + 14},${y + height / 2}" fill="${fill}" stroke="${borderColor}" stroke-width="1.5" />`;
    case 'note':
      return `<g>
        <path d="M ${x + 14} ${y + 8} H ${x + width - 34} L ${x + width - 14} ${y + 28} V ${y + height - 14} Q ${x + width - 14} ${y + height - 8} ${x + width - 22} ${y + height - 8} H ${x + 22} Q ${x + 14} ${y + height - 8} ${x + 14} ${y + height - 16} Z" fill="${fill}" stroke="${borderColor}" stroke-width="1.5" />
        <path d="M ${x + width - 34} ${y + 8} V ${y + 22} Q ${x + width - 34} ${y + 28} ${x + width - 28} ${y + 28} H ${x + width - 14} L ${x + width - 34} ${y + 8} Z" fill="${mockFoldFill(color)}" stroke="${borderColor}" stroke-width="1.5" stroke-linejoin="round" />
      </g>`;
    case 'box':
    default:
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="20" fill="${fill}" stroke="${borderColor}" stroke-width="1.5" />`;
  }
}

function renderEmptyState(contentWidth: number, contentHeight: number, palette: FlowExportPalette): string {
  const centerX = contentWidth / 2;
  const centerY = contentHeight / 2;
  return `<g>
    <circle cx="${centerX}" cy="${centerY - 36}" r="34" fill="${withAlpha(palette.accent, '12')}" />
    <path d="M ${centerX - 16} ${centerY - 36} h 32 M ${centerX} ${centerY - 52} v 32" stroke="${palette.accent}" stroke-width="2.5" stroke-linecap="round" />
    <text class="empty-title" x="${centerX}" y="${centerY + 26}" text-anchor="middle">Start building this flow</text>
    <text class="empty-body" x="${centerX}" y="${centerY + 52}" text-anchor="middle">Add entities or mock nodes in Gantry, then export the finished diagram to share it.</text>
  </g>`;
}

function getDiagramBounds(spec: FlowSpec, nodeMap: Map<string, FlowSpec['nodes'][number]>, padding: number) {
  if (spec.nodes.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: EMPTY_CONTENT_WIDTH,
      maxY: EMPTY_CONTENT_HEIGHT,
      width: EMPTY_CONTENT_WIDTH,
      height: EMPTY_CONTENT_HEIGHT,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of spec.nodes) {
    const absPos = getAbsolutePosition(node, nodeMap);
    const size = getNodeDimensions(node);
    minX = Math.min(minX, absPos.x);
    minY = Math.min(minY, absPos.y);
    maxX = Math.max(maxX, absPos.x + size.width);
    maxY = Math.max(maxY, absPos.y + size.height);
  }

  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function resolveThemePalette(theme: FlowExportTheme): FlowExportPalette {
  if (theme === 'light') return LIGHT_EXPORT_PALETTE;
  if (theme === 'dark') return DARK_EXPORT_PALETTE;

  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;

  return {
    bgPrimary: read('--gantry-bg-primary', LIGHT_EXPORT_PALETTE.bgPrimary),
    bgSecondary: read('--gantry-bg-secondary', LIGHT_EXPORT_PALETTE.bgSecondary),
    bgTertiary: read('--gantry-bg-tertiary', LIGHT_EXPORT_PALETTE.bgTertiary),
    textPrimary: read('--gantry-text-primary', LIGHT_EXPORT_PALETTE.textPrimary),
    textSecondary: read('--gantry-text-secondary', LIGHT_EXPORT_PALETTE.textSecondary),
    border: read('--gantry-border', LIGHT_EXPORT_PALETTE.border),
    accent: read('--gantry-accent', LIGHT_EXPORT_PALETTE.accent),
    accentHover: read('--gantry-accent-hover', LIGHT_EXPORT_PALETTE.accentHover),
    danger: read('--gantry-danger', LIGHT_EXPORT_PALETTE.danger),
    grid: withAlpha(read('--gantry-text-secondary', LIGHT_EXPORT_PALETTE.textSecondary), '16'),
  };
}

function getDocumentBackground(options: NormalizedFlowExportOptions): string {
  switch (options.background) {
    case 'light':
      return '#FFFFFF';
    case 'transparent':
      return '';
    case 'theme':
    default:
      return options.palette.bgSecondary;
  }
}

function resolveEdgeColor(color: string, palette: FlowExportPalette): string {
  if (color === FLOW_EDGE_UNHEALTHY_STROKE || color === 'var(--gantry-danger)') return palette.danger;
  return color;
}

function nodeTitle(node: FlowSpec['nodes'][number], entitiesByKey: Map<string, Entity>): string {
  if (isMockNode(node)) return node.label;
  return entitiesByKey.get(nodeEntityKey(node))?.metadata.title || node.entityRef.name;
}

function mockTitleChars(shape: 'box' | 'pill' | 'diamond' | 'note', width: number): number {
  switch (shape) {
    case 'diamond':
      return Math.max(8, Math.floor((width * 0.42) / 8));
    case 'pill':
      return Math.max(12, Math.floor((width - 44) / 8));
    case 'note':
      return Math.max(12, Math.floor((width - 52) / 8));
    case 'box':
    default:
      return Math.max(12, Math.floor((width - 36) / 8));
  }
}

function mockSubtitleChars(shape: 'box' | 'pill' | 'diamond' | 'note', width: number): number {
  switch (shape) {
    case 'diamond':
      return Math.max(8, Math.floor((width * 0.42) / 9));
    case 'pill':
      return Math.max(12, Math.floor((width - 44) / 9));
    case 'note':
      return Math.max(12, Math.floor((width - 52) / 9));
    case 'box':
    default:
      return Math.max(12, Math.floor((width - 36) / 9));
  }
}

function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const normalized = text.trim();
  if (!normalized) return [];

  const lines: string[] = [];
  for (const segment of normalized.split(/\r?\n/)) {
    const words = segment.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let current = '';
    for (const word of words) {
      if (word.length > maxChars) {
        if (current) {
          lines.push(current);
          current = '';
        }
        for (let index = 0; index < word.length; index += maxChars) {
          lines.push(word.slice(index, index + maxChars));
        }
        continue;
      }

      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxChars) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }

  if (lines.length <= maxLines) return lines;
  const clamped = lines.slice(0, maxLines);
  const last = clamped[maxLines - 1];
  clamped[maxLines - 1] = last.length >= maxChars ? `${last.slice(0, Math.max(1, maxChars - 1))}…` : `${last}…`;
  return clamped;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeFileName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'flow';
}

async function renderSvgToCanvas(svg: string, width: number, height: number, scale: number): Promise<HTMLCanvasElement> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas export is not supported in this browser');
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.drawImage(image, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to render exported flow'));
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to encode exported flow'));
        return;
      }
      resolve(blob);
    }, type);
  });
}

function decodeBase64DataUrl(dataUrl: string): Uint8Array {
  const [, payload = ''] = dataUrl.split(',', 2);
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function buildPdfFromJpeg(jpegBytes: Uint8Array, imageWidth: number, imageHeight: number): Uint8Array {
  const pageSize = imageWidth >= imageHeight ? PDF_LANDSCAPE : PDF_PORTRAIT;
  const margin = 24;
  const scale = Math.min(
    (pageSize.width - margin * 2) / imageWidth,
    (pageSize.height - margin * 2) / imageHeight
  );
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const x = (pageSize.width - drawWidth) / 2;
  const y = (pageSize.height - drawHeight) / 2;

  const contentStream = `q
${formatPdfNumber(drawWidth)} 0 0 ${formatPdfNumber(drawHeight)} ${formatPdfNumber(x)} ${formatPdfNumber(y)} cm
/Im0 Do
Q
`;

  const objects: Uint8Array[] = [
    encodeAscii('<< /Type /Catalog /Pages 2 0 R >>'),
    encodeAscii('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    encodeAscii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${formatPdfNumber(pageSize.width)} ${formatPdfNumber(pageSize.height)}] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>`),
    concatBytes([
      encodeAscii(`<< /Type /XObject /Subtype /Image /Width ${Math.max(1, imageWidth)} /Height ${Math.max(1, imageHeight)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`),
      jpegBytes,
      encodeAscii('\nendstream'),
    ]),
    concatBytes([
      encodeAscii(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream`),
    ]),
  ];

  const header = encodeAscii('%PDF-1.4\n');
  const bodyChunks: Uint8Array[] = [header];
  const offsets: number[] = [0];
  let offset = header.length;

  objects.forEach((objectBytes, index) => {
    offsets.push(offset);
    const prefix = encodeAscii(`${index + 1} 0 obj\n`);
    const suffix = encodeAscii('\nendobj\n');
    bodyChunks.push(prefix, objectBytes, suffix);
    offset += prefix.length + objectBytes.length + suffix.length;
  });

  const xrefOffset = offset;
  const xrefLines = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f '];
  for (let index = 1; index < offsets.length; index++) {
    xrefLines.push(`${String(offsets[index]).padStart(10, '0')} 00000 n `);
  }
  const trailer = `trailer
<< /Size ${objects.length + 1} /Root 1 0 R >>
startxref
${xrefOffset}
%%EOF`;
  bodyChunks.push(encodeAscii(`${xrefLines.join('\n')}\n${trailer}`));
  return concatBytes(bodyChunks);
}

function formatPdfNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function encodeAscii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
