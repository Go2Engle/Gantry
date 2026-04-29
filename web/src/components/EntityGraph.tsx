import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GraphData, GraphNode, GraphEdge } from '../lib/types';
import { catalogEntityPath } from '../lib/utils';

const NODE_W = 156;
const NODE_H = 54;
const ROW_GAP = 170;
const COL_GAP = 190;

const KIND_COLORS: Record<string, string> = {
  Service: '#3B82F6',
  API: '#10B981',
  Infrastructure: '#F59E0B',
  Team: '#8B5CF6',
  Environment: '#06B6D4',
  Documentation: '#6B7280',
  Action: '#EF4444',
};

const RELATION_COLORS: Record<string, string> = {
  dependsOn: '#94A3B8',
  providesApi: '#10B981',
  consumesApi: '#3B82F6',
  ownedBy: '#8B5CF6',
  documents: '#6B7280',
};

const RELATION_LABELS: Record<string, string> = {
  dependsOn: 'depends on',
  providesApi: 'provides API',
  consumesApi: 'consumes API',
  ownedBy: 'owned by',
  documents: 'documents',
};

function kindColor(kind: string): string {
  return KIND_COLORS[kind] ?? '#64748B';
}

function relationColor(relation: string): string {
  return RELATION_COLORS[relation] ?? '#94A3B8';
}

interface Position {
  x: number;
  y: number;
}

function computeLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string
): Record<string, Position> {
  const outgoing = new Set<string>();
  const incoming = new Set<string>();

  for (const edge of edges) {
    if (edge.from === rootId) outgoing.add(edge.to);
    if (edge.to === rootId) incoming.add(edge.from);
  }

  const positions: Record<string, Position> = {};

  // Root at origin — we'll translate the whole group to canvas center.
  positions[rootId] = { x: -(NODE_W / 2), y: -(NODE_H / 2) };

  // Outgoing (root depends on): row below root.
  const outList = Array.from(outgoing);
  const outWidth = (outList.length - 1) * COL_GAP;
  outList.forEach((id, i) => {
    positions[id] = {
      x: -(outWidth / 2) + i * COL_GAP - NODE_W / 2,
      y: ROW_GAP - NODE_H / 2,
    };
  });

  // Incoming (depend on root): row above root.
  const inList = Array.from(incoming);
  const inWidth = (inList.length - 1) * COL_GAP;
  inList.forEach((id, i) => {
    positions[id] = {
      x: -(inWidth / 2) + i * COL_GAP - NODE_W / 2,
      y: -ROW_GAP - NODE_H / 2,
    };
  });

  // Fallback: place any uncategorized nodes to the right.
  let extraX = COL_GAP * 2;
  for (const n of nodes) {
    if (!positions[n.id]) {
      positions[n.id] = { x: extraX - NODE_W / 2, y: -(NODE_H / 2) };
      extraX += COL_GAP;
    }
  }

  return positions;
}

function EdgePath({
  from,
  to,
  relation,
  positions,
  highlighted,
}: {
  from: string;
  to: string;
  relation: string;
  positions: Record<string, Position>;
  highlighted: boolean;
}) {
  const fp = positions[from];
  const tp = positions[to];
  if (!fp || !tp) return null;

  const color = relationColor(relation);

  // Centers of each node.
  const fcx = fp.x + NODE_W / 2;
  const fcy = fp.y + NODE_H / 2;
  const tcx = tp.x + NODE_W / 2;
  const tcy = tp.y + NODE_H / 2;

  // Connect bottom-of-source → top-of-target when source is above target, else vice versa.
  let x1: number, y1: number, x2: number, y2: number;
  if (fcy <= tcy) {
    x1 = fcx; y1 = fp.y + NODE_H;
    x2 = tcx; y2 = tp.y;
  } else {
    x1 = fcx; y1 = fp.y;
    x2 = tcx; y2 = tp.y + NODE_H;
  }

  const midY = (y1 + y2) / 2;
  const pathD = `M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`;

  return (
    <path
      d={pathD}
      fill="none"
      stroke={color}
      strokeWidth={highlighted ? 2.5 : 1.5}
      strokeOpacity={highlighted ? 1 : 0.55}
      markerEnd={`url(#arrow-${relation})`}
    />
  );
}

function NodeBox({
  node,
  pos,
  isHovered,
  onMouseDown,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  node: GraphNode;
  pos: Position;
  isHovered: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const color = kindColor(node.kind);
  const label = node.title && node.title !== node.name ? node.title : node.name;
  const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      style={{ cursor: 'pointer' }}
      onMouseDown={onMouseDown}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Shadow */}
      {isHovered && (
        <rect
          x={2} y={2}
          width={NODE_W} height={NODE_H}
          rx={8}
          fill={color}
          opacity={0.15}
        />
      )}
      {/* Background */}
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={8}
        fill={node.isRoot ? color : 'var(--gantry-bg-primary)'}
        stroke={color}
        strokeWidth={node.isRoot ? 0 : isHovered ? 2 : 1.5}
      />
      {/* Kind badge */}
      <rect x={8} y={8} width={52} height={16} rx={4} fill={color} opacity={node.isRoot ? 0.25 : 0.12} />
      <text x={34} y={19.5} textAnchor="middle" fontSize={9} fontWeight="600" fill={node.isRoot ? 'white' : color}>
        {truncate(node.kind, 8)}
      </text>
      {/* Name */}
      <text
        x={NODE_W / 2}
        y={40}
        textAnchor="middle"
        fontSize={12}
        fontWeight="500"
        fill={node.isRoot ? 'white' : 'var(--gantry-text-primary)'}
      >
        {truncate(label, 17)}
      </text>
    </g>
  );
}

function ListView({
  nodes,
  edges,
  rootId,
  filteredKinds,
  navigate,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  rootId: string;
  filteredKinds: Set<string>;
  navigate: (path: string) => void;
}) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Group edges by direction relative to root
  const outgoing: { node: GraphNode; relation: string }[] = [];
  const incoming: { node: GraphNode; relation: string }[] = [];

  for (const edge of edges) {
    if (edge.from === rootId) {
      const target = nodeMap.get(edge.to);
      if (target && !filteredKinds.has(target.kind)) {
        outgoing.push({ node: target, relation: edge.relation });
      }
    }
    if (edge.to === rootId) {
      const source = nodeMap.get(edge.from);
      if (source && !filteredKinds.has(source.kind)) {
        incoming.push({ node: source, relation: edge.relation });
      }
    }
  }

  const noRelationships = outgoing.length === 0 && incoming.length === 0;

  const renderRow = (node: GraphNode, relation: string) => {
    const color = kindColor(node.kind);
    const label = node.title && node.title !== node.name ? node.title : node.name;
    const url = catalogEntityPath(node.kind, node.name, node.namespace);

    return (
      <button
        key={`${node.id}-${relation}`}
        onClick={() => navigate(url)}
        className="flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[var(--gantry-bg-tertiary)] group"
      >
        <span
          className="inline-flex items-center shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ background: color + '18', color }}
        >
          {node.kind}
        </span>
        <span className="text-sm font-medium text-[var(--gantry-text-primary)] truncate group-hover:underline">
          {label}
        </span>
        <span
          className="ml-auto shrink-0 text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded"
          style={{ background: relationColor(relation) + '18', color: relationColor(relation) }}
        >
          {RELATION_LABELS[relation] ?? relation}
        </span>
      </button>
    );
  };

  return (
    <div className="px-4 py-3 space-y-4">
      {outgoing.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--gantry-text-secondary)] mb-1.5 px-1">
            Depends on
          </h4>
          <div className="space-y-0.5">
            {outgoing.map(({ node, relation }) => renderRow(node, relation))}
          </div>
        </div>
      )}
      {incoming.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--gantry-text-secondary)] mb-1.5 px-1">
            Depended on by
          </h4>
          <div className="space-y-0.5">
            {incoming.map(({ node, relation }) => renderRow(node, relation))}
          </div>
        </div>
      )}
      {noRelationships && (
        <p className="py-6 text-center text-xs text-[var(--gantry-text-secondary)]">
          No relationships defined for this entity yet.
        </p>
      )}
    </div>
  );
}

export default function EntityGraph({
  data,
  rootKind,
  rootName,
}: {
  data: GraphData;
  rootKind: string;
  rootName: string;
}) {
  const navigate = useNavigate();
  const rootId = `${rootKind}/${rootName}`;
  const svgRef = useRef<SVGSVGElement>(null);

  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [scale, setScale] = useState(1);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [filteredKinds, setFilteredKinds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph');

  // Ref-based drag tracking to avoid stale closures.
  const dragRef = useRef<{ sx: number; sy: number; stx: number; sty: number } | null>(null);
  const transformRef = useRef({ tx, ty, scale });
  transformRef.current = { tx, ty, scale };

  // Center graph on mount.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const { width, height } = svg.getBoundingClientRect();
    setTx(width / 2);
    setTy(height / 2);
  }, []);

  const allKinds = Array.from(new Set(data.nodes.map((n) => n.kind))).sort();

  const visibleNodes = data.nodes.filter((n) => n.isRoot || !filteredKinds.has(n.kind));
  const visibleIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = data.edges.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to));

  const positions = computeLayout(data.nodes, data.edges, rootId);

  const usedRelations = Array.from(new Set(visibleEdges.map((e) => e.relation)));

  // Hover: highlight connected edges.
  const highlightedEdges = hoveredNode
    ? new Set(visibleEdges.filter((e) => e.from === hoveredNode || e.to === hoveredNode).map((e) => `${e.from}→${e.to}`))
    : null;

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    setScale((s) => Math.min(3, Math.max(0.25, s * factor)));
  }, []);

  const handleSvgMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = {
      sx: e.clientX, sy: e.clientY,
      stx: transformRef.current.tx, sty: transformRef.current.ty,
    };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.sx;
    const dy = e.clientY - dragRef.current.sy;
    setTx(dragRef.current.stx + dx);
    setTy(dragRef.current.sty + dy);
  }, []);

  const stopDrag = useCallback(() => { dragRef.current = null; }, []);

  const resetView = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const { width, height } = svg.getBoundingClientRect();
    setTx(width / 2);
    setTy(height / 2);
    setScale(1);
  };

  const toggleKind = (kind: string) => {
    setFilteredKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind); else next.add(kind);
      return next;
    });
  };

  // Stop node clicks from triggering SVG drag.
  const nodeMouseDown = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--gantry-border)] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[var(--gantry-text-secondary)]">Show:</span>
          {allKinds.map((kind) => (
            <button
              key={kind}
              onClick={() => toggleKind(kind)}
              disabled={kind === rootKind}
              title={kind === rootKind ? 'Root entity kind cannot be hidden' : undefined}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-opacity disabled:cursor-default"
              style={{
                background: kindColor(kind) + '18',
                color: filteredKinds.has(kind) ? '#94A3B8' : kindColor(kind),
                border: `1px solid ${filteredKinds.has(kind) ? '#CBD5E1' : kindColor(kind) + '60'}`,
                opacity: filteredKinds.has(kind) ? 0.5 : 1,
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: kindColor(kind) }} />
              {kind}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[var(--gantry-border)] overflow-hidden">
            <button
              onClick={() => setViewMode('graph')}
              className={`px-2.5 py-1 text-xs transition-colors ${viewMode === 'graph' ? 'bg-[var(--gantry-accent)] text-[var(--gantry-bg-primary)] font-medium' : 'text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)]'}`}
            >
              Graph
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-2.5 py-1 text-xs transition-colors ${viewMode === 'list' ? 'bg-[var(--gantry-accent)] text-[var(--gantry-bg-primary)] font-medium' : 'text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)]'}`}
            >
              List
            </button>
          </div>
          {viewMode === 'graph' && (
            <button
              onClick={resetView}
              className="shrink-0 rounded-lg border border-[var(--gantry-border)] px-2.5 py-1 text-xs text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)]"
            >
              Reset View
            </button>
          )}
        </div>
      </div>

      {viewMode === 'graph' ? (
        <>
          {/* SVG Canvas */}
          <svg
            ref={svgRef}
            className="w-full select-none"
            style={{ height: 420, cursor: dragRef.current ? 'grabbing' : 'grab' }}
            onWheel={handleWheel}
            onMouseDown={handleSvgMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={stopDrag}
            onMouseLeave={stopDrag}
          >
            <defs>
              {Object.entries(RELATION_COLORS).map(([relation, color]) => (
                <marker
                  key={relation}
                  id={`arrow-${relation}`}
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="3"
                  orient="auto"
                >
                  <path d="M 0 0 L 7 3 L 0 6 z" fill={color} opacity={0.65} />
                </marker>
              ))}
            </defs>
            <g transform={`translate(${tx}, ${ty}) scale(${scale})`}>
              {/* Edges (drawn first so nodes appear on top) */}
              {visibleEdges.map((edge, i) => (
                <EdgePath
                  key={i}
                  from={edge.from}
                  to={edge.to}
                  relation={edge.relation}
                  positions={positions}
                  highlighted={highlightedEdges?.has(`${edge.from}→${edge.to}`) ?? false}
                />
              ))}
              {/* Nodes */}
              {visibleNodes.map((node) => {
                const pos = positions[node.id];
                if (!pos) return null;
                return (
                  <NodeBox
                    key={node.id}
                    node={node}
                    pos={pos}
                    isHovered={hoveredNode === node.id}
                    onMouseDown={nodeMouseDown}
                    onClick={() => navigate(catalogEntityPath(node.kind, node.name, node.namespace))}
                    onMouseEnter={() => setHoveredNode(node.id)}
                    onMouseLeave={() => setHoveredNode(null)}
                  />
                );
              })}
            </g>
          </svg>

          {/* Legend */}
          {usedRelations.length > 0 && (
            <div className="flex flex-wrap items-center gap-5 border-t border-[var(--gantry-border)] px-4 py-2">
              {usedRelations.map((relation) => (
                <div key={relation} className="flex items-center gap-1.5">
                  <svg width="22" height="9" style={{ overflow: 'visible' }}>
                    <line x1="0" y1="4.5" x2="15" y2="4.5" stroke={relationColor(relation)} strokeWidth="1.5" strokeOpacity="0.65" />
                    <polygon points="15,1.5 22,4.5 15,7.5" fill={relationColor(relation)} opacity="0.65" />
                  </svg>
                  <span className="text-xs text-[var(--gantry-text-secondary)]">
                    {RELATION_LABELS[relation] ?? relation}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {visibleNodes.length === 1 && visibleEdges.length === 0 && (
            <p className="pb-4 text-center text-xs text-[var(--gantry-text-secondary)]">
              No relationships defined for this entity yet.
            </p>
          )}
        </>
      ) : (
        /* List View */
        <ListView
          nodes={visibleNodes}
          edges={visibleEdges}
          rootId={rootId}
          filteredKinds={filteredKinds}
          navigate={navigate}
        />
      )}
    </div>
  );
}
