import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRightLeft,
  ExternalLink,
  GitBranch,
  Loader2,
  Minus,
  Network,
  Plus,
  Save,
  Search,
  Trash2,
  Unplug,
  Workflow,
} from 'lucide-react';
import { api } from '../lib/api';
import type { Entity, FlowEdge, FlowMockNode, FlowMockShape, FlowNode, FlowPluginSettings, FlowSpec } from '../lib/types';
import {
  edgeLabelPosition,
  edgeOffsetTransform,
  edgePath,
  ensureFlowSpec,
  getNodeDimensions,
  isEntityNode,
  isMockNode,
  MAX_NODE_WIDTH,
  mockContentClasses,
  mockContentStyle,
  mockShapeLabel,
  MOCK_SHAPE_OPTIONS,
  nodeColor,
  nodeSubtitle,
  renderMockNodeShell,
} from '../lib/flow';

const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 900;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.8;
const ZOOM_STEP = 0.15;
const FIT_PADDING = 48;
const CONTENT_PADDING = 64;
const RELATION_OPTIONS = ['calls', 'dependsOn', 'readsFrom', 'writesTo', 'publishesTo', 'subscribesTo', 'consumes', 'provides'];
const MOCK_NODE_LIBRARY: Array<{ label: string; subtitle: string; shape: FlowMockShape; color: string }> = [
  { label: 'Box', subtitle: 'Generic process step', shape: 'box', color: '#64748B' },
  { label: 'Diamond', subtitle: 'Decision or branch point', shape: 'diamond', color: '#F59E0B' },
  { label: 'Pill', subtitle: 'External actor or entry point', shape: 'pill', color: '#8B5CF6' },
  { label: 'Note', subtitle: 'Idea, future state, or comment', shape: 'note', color: '#0EA5E9' },
];

function defaultFlowSpec(): FlowSpec {
  return {
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
  };
}


function flowTitle(flow: Entity): string {
  return flow.metadata.title || flow.metadata.name;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function entityKey(entity: Pick<Entity, 'kind' | 'metadata'>): string {
  return `${entity.kind}:${entity.metadata.namespace || 'default'}:${entity.metadata.name}`;
}

function nodeEntityKey(node: FlowNode): string {
  if (!isEntityNode(node)) return '';
  return `${node.entityRef.kind}:${node.entityRef.namespace || 'default'}:${node.entityRef.name}`;
}

function nodeTitle(node: FlowNode, entityMap: Map<string, Entity>): string {
  if (isMockNode(node)) return node.label;
  return entityMap.get(nodeEntityKey(node))?.metadata.title || node.entityRef.name;
}

function nodeMeta(node: FlowNode): string {
  if (isMockNode(node)) return `Mock · ${node.shape}`;
  return `${node.entityRef.kind} · ${node.entityRef.name}`;
}


function entityPath(kind: string, name: string, namespace?: string): string {
  return `/catalog/${kind}/${name}${namespace && namespace !== 'default' ? `?namespace=${encodeURIComponent(namespace)}` : ''}`;
}


function getFlowBounds(spec: FlowSpec) {
  if (spec.nodes.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: CANVAS_WIDTH,
      maxY: CANVAS_HEIGHT,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of spec.nodes) {
    const size = getNodeDimensions(node);
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + size.width);
    maxY = Math.max(maxY, node.position.y + size.height);
  }

  minX -= CONTENT_PADDING;
  minY -= CONTENT_PADDING;
  maxX += CONTENT_PADDING;
  maxY += CONTENT_PADDING;

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function getFitViewState(width: number, height: number, spec: FlowSpec) {
  if (width <= 0 || height <= 0) {
    return { zoom: 1, offset: { x: 24, y: 24 } };
  }

  const bounds = getFlowBounds(spec);
  const stageMinX = Math.min(0, bounds.minX);
  const stageMinY = Math.min(0, bounds.minY);
  const renderMinX = bounds.minX - stageMinX;
  const renderMinY = bounds.minY - stageMinY;
  const zoom = clamp(
    Math.min(
      (width - FIT_PADDING * 2) / bounds.width,
      (height - FIT_PADDING * 2) / bounds.height,
      1
    ),
    MIN_ZOOM,
    1
  );

  return {
    zoom,
    offset: {
      x: (width - bounds.width * zoom) / 2 - renderMinX * zoom,
      y: (height - bounds.height * zoom) / 2 - renderMinY * zoom,
    },
  };
}

export default function Flow() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const suppressNodeClickRef = useRef(false);
  const suppressCanvasClickRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [pluginEnabled, setPluginEnabled] = useState(false);
  const [flowSettings, setFlowSettings] = useState<FlowPluginSettings>({
    showInSidebar: true,
    editorRole: 'developer',
    canEdit: true,
  });
  const [availableEntities, setAvailableEntities] = useState<Entity[]>([]);
  const [flows, setFlows] = useState<Entity[]>([]);
  const [currentFlowName, setCurrentFlowName] = useState<string | null>(null);
  const [currentNamespace, setCurrentNamespace] = useState('default');
  const [flowName, setFlowName] = useState('');
  const [flowTitleValue, setFlowTitleValue] = useState('');
  const [flowDescription, setFlowDescription] = useState('');
  const [flowOwner, setFlowOwner] = useState('');
  const [flowSpec, setFlowSpec] = useState<FlowSpec>(defaultFlowSpec());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const [entityQuery, setEntityQuery] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const [dragging, setDragging] = useState<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const [resizing, setResizing] = useState<{ nodeId: string; startClientX: number; startClientY: number; startWidth: number; startHeight: number } | null>(null);
  const [panning, setPanning] = useState<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [zoomMode, setZoomMode] = useState<'fit' | 'manual'>('fit');
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const requestedFlow = searchParams.get('flow') || '';
  const requestedNamespace = searchParams.get('namespace') || 'default';
  const requestedMode = searchParams.get('mode') === 'edit' ? 'edit' : 'view';
  const flowBounds = useMemo(() => getFlowBounds(flowSpec), [flowSpec]);
  const [renderBounds, setRenderBounds] = useState(flowBounds);
  const activeBounds = dragging || resizing ? renderBounds : flowBounds;
  const stageMinX = Math.min(0, activeBounds.minX);
  const stageMinY = Math.min(0, activeBounds.minY);
  const stageMaxX = Math.max(CANVAS_WIDTH, activeBounds.maxX);
  const stageMaxY = Math.max(CANVAS_HEIGHT, activeBounds.maxY);
  const contentOffsetX = -stageMinX;
  const contentOffsetY = -stageMinY;
  const stageWidth = stageMaxX - stageMinX;
  const stageHeight = stageMaxY - stageMinY;
  const scaledCanvasWidth = stageWidth * canvasZoom;
  const scaledCanvasHeight = stageHeight * canvasZoom;
  const canvasOffset = {
    x: panOffset.x,
    y: panOffset.y,
  };

  function getViewportDimensions() {
    if (viewportRef.current) {
      return {
        width: viewportRef.current.clientWidth,
        height: viewportRef.current.clientHeight,
      };
    }
    return viewportSize;
  }

  const applyZoomAtClientPoint = useCallback((nextZoom: number, clientX: number, clientY: number) => {
    const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    const viewport = viewportRef.current;
    if (!viewport) {
      setZoomMode('manual');
      setCanvasZoom(zoom);
      return;
    }
    const rect = viewport.getBoundingClientRect();
    const stageX = (clientX - rect.left - panOffset.x) / canvasZoom;
    const stageY = (clientY - rect.top - panOffset.y) / canvasZoom;
    setZoomMode('manual');
    setCanvasZoom(zoom);
    setPanOffset({
      x: clientX - rect.left - stageX * zoom,
      y: clientY - rect.top - stageY * zoom,
    });
  }, [canvasZoom, panOffset.x, panOffset.y]);

  function applyManualZoom(nextZoom: number) {
    const { width, height } = getViewportDimensions();
    applyZoomAtClientPoint(nextZoom, (viewportRef.current?.getBoundingClientRect().left || 0) + width / 2, (viewportRef.current?.getBoundingClientRect().top || 0) + height / 2);
  }

  function fitCanvas() {
    setZoomMode('fit');
    const { width, height } = getViewportDimensions();
    const nextView = getFitViewState(width, height, flowSpec);
    setPanOffset(nextView.offset);
    setCanvasZoom(nextView.zoom);
  }

  function clientPointToCanvas(clientX: number, clientY: number) {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / canvasZoom - contentOffsetX,
      y: (clientY - rect.top) / canvasZoom - contentOffsetY,
    };
  }

  useEffect(() => {
    if (dragging || resizing) return;
    setRenderBounds(flowBounds);
  }, [dragging, resizing, flowBounds]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const [plugins, entities, flowEntities, nextFlowSettings] = await Promise.all([
          api.listPlugins(),
          api.listEntities(),
          api.listFlows().catch(() => []),
          api.getFlowSettings().catch(() => ({ showInSidebar: true, editorRole: 'developer', canEdit: true })),
        ]);
        if (!active) return;

        const flowPlugin = plugins.find((plugin) => plugin.name === 'flow');
        setPluginEnabled(Boolean(flowPlugin?.enabled));
        setFlowSettings(nextFlowSettings);
        setAvailableEntities((entities || []).filter((entity) => entity.kind !== 'Flow'));

        const sortedFlows = [...(flowEntities || [])].sort((a, b) => flowTitle(a).localeCompare(flowTitle(b)));
        setFlows(sortedFlows);
        if (sortedFlows.length > 0) {
          const requested = sortedFlows.find(
            (flow) => flow.metadata.name === requestedFlow && (flow.metadata.namespace || 'default') === requestedNamespace
          );
          loadFlow(requested || sortedFlows[0]);
          setMode(nextFlowSettings.canEdit ? requestedMode : 'view');
        } else {
          resetDraft();
          setMode(nextFlowSettings.canEdit ? requestedMode : 'view');
        }
      } catch (err: any) {
        if (!active) return;
        setError(err.message || 'Failed to load Flow data');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [requestedFlow, requestedNamespace, requestedMode]);

  useEffect(() => {
    if (!dragging) return;
    const currentDrag = dragging;

    function handleMove(event: MouseEvent) {
      if (!viewportRef.current) return;
      suppressNodeClickRef.current = true;
      const nextPoint = clientPointToCanvas(event.clientX, event.clientY);
      const nextX = nextPoint.x - currentDrag.offsetX;
      const nextY = nextPoint.y - currentDrag.offsetY;

      setFlowSpec((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) =>
          node.id === currentDrag.nodeId
            ? {
                ...node,
                position: {
                  x: nextX,
                  y: nextY,
                },
              }
            : node
        ),
      }));
      setDirty(true);
    }

    function handleUp() {
      setDragging(null);
    }

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging, canvasZoom]);

  useEffect(() => {
    if (!resizing) return;
    const currentResize = resizing;

    function handleMove(event: MouseEvent) {
      const nextWidth = currentResize.startWidth + (event.clientX - currentResize.startClientX) / canvasZoom;
      const nextHeight = currentResize.startHeight + (event.clientY - currentResize.startClientY) / canvasZoom;

      setFlowSpec((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => (
          node.id === currentResize.nodeId && isMockNode(node)
            ? {
                ...node,
                width: clamp(nextWidth, 160, MAX_NODE_WIDTH),
                height: Math.max(72, nextHeight),
              }
            : node
        )),
      }));
      setDirty(true);
    }

    function handleUp() {
      setResizing(null);
    }

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [resizing, canvasZoom]);

  useEffect(() => {
    if (!panning) return;
    const currentPan = panning;

    function handleMove(event: MouseEvent) {
      suppressCanvasClickRef.current = true;
      setZoomMode('manual');
      setPanOffset({
        x: currentPan.originX + (event.clientX - currentPan.startX),
        y: currentPan.originY + (event.clientY - currentPan.startY),
      });
    }

    function handleUp() {
      setPanning(null);
    }

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [panning]);

  useEffect(() => {
    if (!viewportRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setViewportSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      event.stopPropagation();
      applyZoomAtClientPoint(canvasZoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP), event.clientX, event.clientY);
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [canvasZoom, applyZoomAtClientPoint]);

  useEffect(() => {
    if (zoomMode !== 'fit' || dragging || resizing) return;
    const frame = requestAnimationFrame(() => {
      const { width, height } = getViewportDimensions();
      const nextView = getFitViewState(width, height, flowSpec);
      setPanOffset(nextView.offset);
      setCanvasZoom(nextView.zoom);
    });
    return () => cancelAnimationFrame(frame);
  }, [zoomMode, dragging, resizing, viewportSize.width, viewportSize.height, currentFlowName, currentNamespace, flowSpec]);

  useEffect(() => {
    if (!flowSettings.canEdit && mode === 'edit') {
      setMode('view');
      setConnectFromId(null);
    }
  }, [flowSettings.canEdit, mode]);

  function resetDraft() {
    setCurrentFlowName(null);
    setCurrentNamespace('default');
    setFlowName('');
    setFlowTitleValue('');
    setFlowDescription('');
    setFlowOwner('');
    setFlowSpec(defaultFlowSpec());
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setConnectFromId(null);
    setDirty(false);
    setNotice('');
    setError('');
    setZoomMode('fit');
    setPanOffset({ x: 0, y: 0 });
  }

  function loadFlow(flow: Entity) {
    setCurrentFlowName(flow.metadata.name);
    setCurrentNamespace(flow.metadata.namespace || 'default');
    setFlowName(flow.metadata.name);
    setFlowTitleValue(flow.metadata.title || '');
    setFlowDescription(flow.metadata.description || '');
    setFlowOwner(flow.metadata.owner || '');
    setFlowSpec(ensureFlowSpec(flow.spec));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setConnectFromId(null);
    setDirty(false);
    setNotice('');
    setError('');
    setZoomMode('fit');
    setPanOffset({ x: 0, y: 0 });
  }

  function confirmDiscard(): boolean {
    if (!dirty) return true;
    return window.confirm('You have unsaved Flow changes. Discard them?');
  }

  function startNewFlow() {
    if (!flowSettings.canEdit) {
      setError(`Editing flows requires the ${flowSettings.editorRole} role or higher.`);
      return;
    }
    if (!confirmDiscard()) return;
    resetDraft();
    setMode('edit');
  }

  function selectFlow(flow: Entity) {
    if (!confirmDiscard()) return;
    loadFlow(flow);
    setMode('view');
  }

  function openEditor() {
    if (!flowSettings.canEdit) {
      setError(`Editing flows requires the ${flowSettings.editorRole} role or higher.`);
      return;
    }
    setMode('edit');
  }

  function openOverview() {
    setMode('view');
    setConnectFromId(null);
  }

  function setMeta(updater: () => void) {
    updater();
    setDirty(true);
    setNotice('');
  }

  function addEntityNode(entity: Entity) {
    if (!flowSettings.canEdit) return;
    const existingNode = flowSpec.nodes.find((node) => nodeEntityKey(node) === entityKey(entity));
    if (existingNode) {
      setSelectedNodeId(existingNode.id);
      setSelectedEdgeId(null);
      return;
    }

    const count = flowSpec.nodes.length;
    const nextNode: FlowNode = {
      id: crypto.randomUUID(),
      entityRef: {
        kind: entity.kind,
        name: entity.metadata.name,
        namespace: entity.metadata.namespace || 'default',
      },
      position: {
        x: 48 + (count % 4) * 250,
        y: 48 + Math.floor(count / 4) * 150,
      },
    };

    setFlowSpec((prev) => ({ ...prev, nodes: [...prev.nodes, nextNode] }));
    setSelectedNodeId(nextNode.id);
    setSelectedEdgeId(null);
    setConnectFromId(null);
    setDirty(true);
    setNotice('');
  }

  function addMockNode(template: { label: string; subtitle: string; shape: FlowMockShape; color: string }) {
    if (!flowSettings.canEdit) return;
    const count = flowSpec.nodes.length;
    const nextNode: FlowMockNode = {
      id: crypto.randomUUID(),
      nodeType: 'mock',
      label: template.label,
      subtitle: template.subtitle,
      shape: template.shape,
      color: template.color,
      position: {
        x: 48 + (count % 4) * 250,
        y: 48 + Math.floor(count / 4) * 150,
      },
    };

    setFlowSpec((prev) => ({ ...prev, nodes: [...prev.nodes, nextNode] }));
    setSelectedNodeId(nextNode.id);
    setSelectedEdgeId(null);
    setConnectFromId(null);
    setDirty(true);
    setNotice('');
  }

  function updateNode(nodeId: string, patch: Partial<FlowNode>) {
    if (!flowSettings.canEdit) return;
    setFlowSpec((prev) => ({
      ...prev,
      nodes: prev.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } as FlowNode : node)),
    }));
    setDirty(true);
    setNotice('');
  }

  function removeNode(nodeId: string) {
    if (!flowSettings.canEdit) return;
    setFlowSpec((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((node) => node.id !== nodeId),
      edges: prev.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
    }));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    if (connectFromId === nodeId) setConnectFromId(null);
    setDirty(true);
    setNotice('');
  }

  function createEdge(sourceId: string, targetId: string) {
    if (!flowSettings.canEdit) return;
    if (sourceId === targetId) return;
    const duplicate = flowSpec.edges.find((edge) => edge.source === sourceId && edge.target === targetId);
    if (duplicate) {
      setSelectedEdgeId(duplicate.id);
      setSelectedNodeId(null);
      setConnectFromId(null);
      return;
    }

    const edge: FlowEdge = {
      id: crypto.randomUUID(),
      source: sourceId,
      target: targetId,
      relation: 'calls',
      direction: 'one-way',
      label: '',
      animated: true,
    };

    setFlowSpec((prev) => ({ ...prev, edges: [...prev.edges, edge] }));
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
    setConnectFromId(null);
    setDirty(true);
    setNotice('');
  }

  function removeEdge(edgeId: string) {
    if (!flowSettings.canEdit) return;
    setFlowSpec((prev) => ({ ...prev, edges: prev.edges.filter((edge) => edge.id !== edgeId) }));
    setSelectedEdgeId(null);
    setDirty(true);
    setNotice('');
  }

  function updateEdge(edgeId: string, patch: Partial<FlowEdge>) {
    if (!flowSettings.canEdit) return;
    setFlowSpec((prev) => ({
      ...prev,
      edges: prev.edges.map((edge) => (edge.id === edgeId ? { ...edge, ...patch } : edge)),
    }));
    setDirty(true);
    setNotice('');
  }

  function seedEdgesFromRelationships() {
    if (!flowSettings.canEdit) return;
    const entityMap = new Map(availableEntities.map((entity) => [entityKey(entity), entity]));
    const nodeByEntity = new Map(flowSpec.nodes.filter(isEntityNode).map((node) => [nodeEntityKey(node), node]));
    const nextEdges = [...flowSpec.edges];
    let added = 0;

    const maybeAdd = (sourceId: string, targetId: string, relation: string) => {
      if (sourceId === targetId) return;
      const exists = nextEdges.some((edge) => edge.source === sourceId && edge.target === targetId && edge.relation === relation);
      if (exists) return;
      nextEdges.push({
        id: crypto.randomUUID(),
        source: sourceId,
        target: targetId,
        relation,
        direction: 'one-way',
        label: '',
        animated: true,
      });
      added++;
    };

    for (const node of flowSpec.nodes) {
      if (!isEntityNode(node)) continue;
      const entity = entityMap.get(nodeEntityKey(node));
      if (!entity?.spec) continue;

      const dependsOn = Array.isArray(entity.spec.dependsOn) ? entity.spec.dependsOn : [];
      for (const dependency of dependsOn) {
        if (!dependency || typeof dependency !== 'object') continue;
        const depKind = String((dependency as any).kind || '');
        const depName = String((dependency as any).name || '');
        const target = nodeByEntity.get(`${depKind}:${entity.metadata.namespace || 'default'}:${depName}`)
          || nodeByEntity.get(`${depKind}:default:${depName}`);
        if (depKind && depName && target) maybeAdd(node.id, target.id, 'dependsOn');
      }

      const consumesApis = Array.isArray(entity.spec.consumesApis) ? entity.spec.consumesApis : [];
      for (const apiName of consumesApis) {
        const target = nodeByEntity.get(`API:default:${String(apiName)}`);
        if (target) maybeAdd(node.id, target.id, 'consumes');
      }

      const providesApis = Array.isArray(entity.spec.providesApis) ? entity.spec.providesApis : [];
      for (const apiName of providesApis) {
        const target = nodeByEntity.get(`API:default:${String(apiName)}`);
        if (target) maybeAdd(node.id, target.id, 'provides');
      }
    }

    setFlowSpec((prev) => ({ ...prev, edges: nextEdges }));
    setDirty((previous) => added > 0 || previous);
    setNotice(added > 0 ? `Added ${added} relationship edge${added === 1 ? '' : 's'} from entity metadata.` : 'No new relationship edges were found to add.');
  }

  async function saveFlow() {
    if (!flowSettings.canEdit) {
      setError(`Editing flows requires the ${flowSettings.editorRole} role or higher.`);
      return;
    }
    const name = flowName.trim();
    if (!name) {
      setError('Flow name is required');
      return;
    }

    setSaving(true);
    setError('');
    setNotice('');

    const metadata = {
      name,
      namespace: currentNamespace,
      title: flowTitleValue.trim() || undefined,
      description: flowDescription.trim() || undefined,
      owner: flowOwner.trim() || undefined,
    };

    try {
      const saved = currentFlowName
        ? await api.updateFlow(currentFlowName, metadata, flowSpec, currentNamespace)
        : await api.createFlow(metadata, flowSpec);

      setFlows((prev) => {
        const remaining = prev.filter((flow) => !(flow.metadata.name === currentFlowName && (flow.metadata.namespace || 'default') === currentNamespace));
        return [...remaining, saved].sort((a, b) => flowTitle(a).localeCompare(flowTitle(b)));
      });
      loadFlow(saved);
      setNotice(currentFlowName ? 'Flow saved.' : 'Flow created.');
    } catch (err: any) {
      setError(err.message || 'Failed to save Flow');
    } finally {
      setSaving(false);
    }
  }

  async function deleteFlow() {
    if (!flowSettings.canEdit) {
      setError(`Editing flows requires the ${flowSettings.editorRole} role or higher.`);
      return;
    }
    if (!currentFlowName) {
      resetDraft();
      return;
    }
    if (!window.confirm(`Delete flow "${currentFlowName}"?`)) return;

    try {
      await api.deleteFlow(currentFlowName, currentNamespace);
      const remaining = flows.filter((flow) => !(flow.metadata.name === currentFlowName && (flow.metadata.namespace || 'default') === currentNamespace));
      setFlows(remaining);
      if (remaining.length > 0) {
        loadFlow(remaining[0]);
      } else {
        resetDraft();
      }
      setNotice('Flow deleted.');
    } catch (err: any) {
      setError(err.message || 'Failed to delete Flow');
    }
  }

  const selectedNode = flowSpec.nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedEdge = flowSpec.edges.find((edge) => edge.id === selectedEdgeId) || null;
  const entityMap = new Map(availableEntities.map((entity) => [entityKey(entity), entity]));

  const filteredEntities = availableEntities
    .filter((entity) => {
      if (!entityQuery.trim()) return true;
      const q = entityQuery.toLowerCase();
      return (
        entity.metadata.name.toLowerCase().includes(q)
        || (entity.metadata.title || '').toLowerCase().includes(q)
        || entity.kind.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => `${a.kind} ${a.metadata.name}`.localeCompare(`${b.kind} ${b.metadata.name}`))
    .slice(0, 32);

  function renderSavedFlowsCard() {
    return (
      <div className="rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4">
        <h2 className="text-sm font-semibold text-[var(--gantry-text-primary)]">Saved Flows</h2>
        <p className="mt-1 text-xs text-[var(--gantry-text-secondary)]">
          Diagrams persist as `Flow` entities and can be exported by GitOps like the rest of your catalog.
        </p>
        <div className="mt-4 space-y-2">
          {flows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--gantry-border)] px-3 py-6 text-center text-sm text-[var(--gantry-text-secondary)]">
              No flows yet.
            </div>
          ) : (
            flows.map((flow) => {
              const active = flow.metadata.name === currentFlowName && (flow.metadata.namespace || 'default') === currentNamespace;
              return (
                <button
                  key={`${flow.metadata.namespace || 'default'}:${flow.metadata.name}`}
                  onClick={() => selectFlow(flow)}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                    active
                      ? 'border-[var(--gantry-accent)] bg-[var(--gantry-accent)]/10'
                      : 'border-[var(--gantry-border)] hover:bg-[var(--gantry-bg-tertiary)]'
                  }`}
                >
                  <div className="text-sm font-medium text-[var(--gantry-text-primary)]">{flowTitle(flow)}</div>
                  <div className="mt-1 text-xs text-[var(--gantry-text-secondary)]">
                    {flow.metadata.name}
                    {(flow.metadata.namespace || 'default') !== 'default' ? ` · ${(flow.metadata.namespace || 'default')}` : ''}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  }

  function renderCanvas(readOnly: boolean) {
    return (
      <div className="overflow-hidden rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]">
        <div className="flex items-center justify-between border-b border-[var(--gantry-border)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--gantry-text-primary)]">{readOnly ? 'Preview' : 'Canvas'}</h2>
            <p className="mt-1 text-xs text-[var(--gantry-text-secondary)]">
              {readOnly
                ? 'Browse the flow diagram, scroll to zoom, and select nodes or edges for details.'
                : 'Drag nodes to arrange the diagram. Scroll to zoom, then click one node and another while connecting to create an edge.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-[var(--gantry-text-secondary)]">
              {flowSpec.nodes.length} node{flowSpec.nodes.length === 1 ? '' : 's'} · {flowSpec.edges.length} edge{flowSpec.edges.length === 1 ? '' : 's'}
            </div>
            <div className="inline-flex items-center gap-1 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] p-1">
              <button
                onClick={() => applyManualZoom(canvasZoom - ZOOM_STEP)}
                disabled={canvasZoom <= MIN_ZOOM}
                className="rounded-md p-1 text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                title="Zoom out"
              >
                <Minus className="h-4 w-4" />
              </button>
              <button
                onClick={fitCanvas}
                className="rounded-md px-2 py-1 text-xs font-medium text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)]"
                title="Fit to view"
              >
                Fit
              </button>
              <button
                onClick={() => applyManualZoom(canvasZoom + ZOOM_STEP)}
                disabled={canvasZoom >= MAX_ZOOM}
                className="rounded-md p-1 text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                title="Zoom in"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="min-w-[3.5rem] text-right text-xs tabular-nums text-[var(--gantry-text-secondary)]">
              {Math.round(canvasZoom * 100)}%
            </div>
          </div>
        </div>
        <div className="bg-[var(--gantry-bg-secondary)] p-4">
          <div
            ref={viewportRef}
            className={`relative h-[min(70vh,44rem)] min-h-[22rem] overflow-hidden rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] ${
              panning ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            style={{
              overscrollBehavior: 'contain',
              backgroundImage: 'linear-gradient(rgba(148, 163, 184, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.08) 1px, transparent 1px)',
              backgroundSize: `${32 * canvasZoom}px ${32 * canvasZoom}px`,
              backgroundPosition: `${canvasOffset.x + contentOffsetX * canvasZoom}px ${canvasOffset.y + contentOffsetY * canvasZoom}px`,
            }}
            onMouseDown={(event) => {
              const target = event.target as HTMLElement;
              if (
                target.closest('[data-flow-node="true"]')
                || target.closest('[data-flow-edge-hit="true"]')
                || target.closest('button, input, textarea, select, a')
              ) {
                return;
              }
              suppressCanvasClickRef.current = false;
              setPanning({
                startX: event.clientX,
                startY: event.clientY,
                originX: panOffset.x,
                originY: panOffset.y,
              });
            }}
          >
            <div
              ref={canvasRef}
              className="absolute left-0 top-0"
              style={{
                width: scaledCanvasWidth,
                height: scaledCanvasHeight,
                transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px)`,
              }}
            >
              <div
                className="absolute left-0 top-0 rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)]"
                style={{
                  width: stageWidth,
                  height: stageHeight,
                  transform: `scale(${canvasZoom})`,
                  transformOrigin: 'top left',
                  background: 'transparent',
                  borderColor: 'transparent',
                }}
                onClick={() => {
                  if (suppressCanvasClickRef.current) {
                    suppressCanvasClickRef.current = false;
                    return;
                  }
                  setSelectedNodeId(null);
                  setSelectedEdgeId(null);
                }}
              >
                <div
                  className="absolute left-0 top-0"
                  style={{
                    width: stageWidth,
                    height: stageHeight,
                    transform: `translate(${contentOffsetX}px, ${contentOffsetY}px)`,
                  }}
                >
                  <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
                    <defs>
                      <marker id="flow-arrow-end" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748B" />
                      </marker>
                      <marker id="flow-arrow-start" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748B" />
                      </marker>
                    </defs>
                    {flowSpec.edges.map((edge) => {
                      const source = flowSpec.nodes.find((node) => node.id === edge.source);
                      const target = flowSpec.nodes.find((node) => node.id === edge.target);
                      if (!source || !target) return null;
                      const path = edgePath(source, target);
                      const labelPos = edgeLabelPosition(source, target);
                      const active = edge.id === selectedEdgeId;
                      const twoWay = edge.direction === 'two-way';
                      const forwardTransform = twoWay ? edgeOffsetTransform(source, target, 3) : undefined;
                      const reverseTransform = twoWay ? edgeOffsetTransform(source, target, -3) : undefined;

                      return (
                        <g key={edge.id}>
                          {!twoWay && (
                            <path
                              d={path}
                              fill="none"
                              stroke={active ? 'var(--gantry-text-primary)' : 'var(--gantry-text-secondary)'}
                              strokeWidth={active ? 3 : 2}
                              strokeDasharray={edge.animated ? '8 8' : undefined}
                              markerEnd="url(#flow-arrow-end)"
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
                                stroke={active ? 'var(--gantry-text-primary)' : 'var(--gantry-text-secondary)'}
                                strokeWidth={active ? 2.8 : 2.1}
                                strokeDasharray={edge.animated ? '8 8' : undefined}
                                markerEnd="url(#flow-arrow-end)"
                              >
                                {edge.animated && <animate attributeName="stroke-dashoffset" from="16" to="0" dur="1s" repeatCount="indefinite" />}
                              </path>
                              <path
                                d={path}
                                fill="none"
                                transform={reverseTransform}
                                stroke={active ? 'var(--gantry-text-primary)' : 'var(--gantry-text-secondary)'}
                                strokeWidth={active ? 2.6 : 1.9}
                                strokeDasharray={edge.animated ? '8 8' : undefined}
                                markerStart="url(#flow-arrow-start)"
                              >
                                {edge.animated && <animate attributeName="stroke-dashoffset" from="0" to="16" dur="1s" repeatCount="indefinite" />}
                              </path>
                            </>
                          )}
                          <path
                            d={path}
                            fill="none"
                            stroke="transparent"
                            strokeWidth="16"
                            data-flow-edge-hit="true"
                            className="pointer-events-auto cursor-pointer"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedEdgeId(edge.id);
                              setSelectedNodeId(null);
                            }}
                          />
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
                    const active = node.id === selectedNodeId;
                    const connectSource = node.id === connectFromId;
                    const color = nodeColor(node);
                    const title = nodeTitle(node, entityMap);
                    const subtitle = nodeSubtitle(node);
                    const badge = isMockNode(node) ? `Mock ${mockShapeLabel(node.shape)}` : node.entityRef.kind;
                    const nodeSize = getNodeDimensions(node);
                    const nodeOuterStyle: CSSProperties = {
                      left: node.position.x,
                      top: node.position.y,
                      width: nodeSize.width,
                      height: nodeSize.height,
                    };
                    const baseBorderColor = active || connectSource ? color : 'var(--gantry-border)';
                    const cardStyle: CSSProperties = {
                      borderColor: baseBorderColor,
                      background: 'var(--gantry-bg-primary)',
                    };

                    return (
                      <div
                        key={node.id}
                        data-flow-node="true"
                        className={`group absolute rounded-2xl shadow-sm transition-shadow ${
                          active || connectSource ? 'shadow-lg' : 'hover:shadow-md'
                        }`}
                        style={nodeOuterStyle}
                        onMouseDown={(event) => {
                          if (readOnly || !flowSettings.canEdit) return;
                          event.stopPropagation();
                          suppressNodeClickRef.current = false;
                          setRenderBounds(flowBounds);
                          const point = clientPointToCanvas(event.clientX, event.clientY);
                          setDragging({
                            nodeId: node.id,
                            offsetX: point.x - node.position.x,
                            offsetY: point.y - node.position.y,
                          });
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (suppressNodeClickRef.current) {
                            suppressNodeClickRef.current = false;
                            return;
                          }
                          if (!readOnly && flowSettings.canEdit && connectFromId && connectFromId !== node.id) {
                            createEdge(connectFromId, node.id);
                            return;
                          }
                          setSelectedNodeId(node.id);
                          setSelectedEdgeId(null);
                        }}
                      >
                        <div className="relative h-full w-full">
                          {isMockNode(node) ? (
                            renderMockNodeShell(node.shape, baseBorderColor, color, nodeSize.width, nodeSize.height)
                          ) : (
                            <div className="absolute inset-0 rounded-2xl border" style={cardStyle} />
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
                                  {title}
                                </div>
                              </div>
                              <div
                                className={`min-w-0 break-words whitespace-pre-wrap text-xs leading-4 text-[var(--gantry-text-secondary)] ${node.shape === 'diamond' ? 'text-center' : ''}`}
                                style={mockContentStyle(node.shape, nodeSize.width)}
                              >
                                {subtitle}
                              </div>
                            </div>
                          ) : (
                            <div className="relative flex h-full flex-col justify-between p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `${color}1A`, color }}>
                                    {badge}
                                  </div>
                                  <div className="mt-2 break-words text-sm font-semibold leading-5 text-[var(--gantry-text-primary)]">
                                    {title}
                                  </div>
                                </div>
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    navigate(entityPath(node.entityRef.kind, node.entityRef.name, node.entityRef.namespace));
                                  }}
                                  className="rounded-lg border border-[var(--gantry-border)] p-1.5 text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)] hover:text-[var(--gantry-text-primary)]"
                                  title="Open entity"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <div className="break-words text-xs leading-4 text-[var(--gantry-text-secondary)]">
                                {subtitle}
                              </div>
                            </div>
                          )}
                          {!readOnly && flowSettings.canEdit && isMockNode(node) && (
                            <button
                              type="button"
                              data-flow-resize="true"
                              onMouseDown={(event) => {
                                event.stopPropagation();
                                event.preventDefault();
                                setRenderBounds(flowBounds);
                                setResizing({
                                  nodeId: node.id,
                                  startClientX: event.clientX,
                                  startClientY: event.clientY,
                                  startWidth: nodeSize.width,
                                  startHeight: nodeSize.height,
                                });
                              }}
                              className={`absolute -bottom-2.5 -right-2.5 flex h-6 w-6 cursor-se-resize items-center justify-center rounded-full border shadow-lg transition-all ${
                                active
                                  ? 'border-[var(--gantry-accent)] bg-[var(--gantry-accent)] text-[var(--gantry-bg-primary)] opacity-100'
                                  : 'border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] text-[var(--gantry-text-secondary)] opacity-0 group-hover:opacity-100'
                              }`}
                              title="Resize shape"
                            >
                              <span className="pointer-events-none relative block h-2.5 w-2.5">
                                <span className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b-2 border-r-2 border-current" />
                                <span className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 border-b-2 border-r-2 border-current opacity-80" />
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {flowSpec.nodes.length === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                      <div className="rounded-2xl bg-[var(--gantry-accent)]/10 p-4 text-[var(--gantry-accent)]">
                        <Workflow className="h-8 w-8" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-[var(--gantry-text-primary)]">
                          {readOnly ? 'No flow selected' : 'Start your first flow'}
                        </h3>
                        <p className="mt-1 max-w-md text-sm text-[var(--gantry-text-secondary)]">
                          {readOnly
                            ? 'Choose a saved flow from the left to preview it, or create a new one when you are ready to edit.'
                            : 'Add entities or mockup shapes from the left rail, drag them into place, then connect them to show request paths, data movement, and ownership boundaries.'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="flex items-center gap-3 text-[var(--gantry-text-secondary)]">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading Flow editor...
        </div>
      </div>
    );
  }

  if (!pluginEnabled) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-[var(--gantry-accent)]/10 p-3 text-[var(--gantry-accent)]">
            <Workflow className="h-7 w-7" />
          </div>
          <div className="space-y-3">
            <h1 className="text-2xl font-bold text-[var(--gantry-text-primary)]">Flow is not enabled</h1>
            <p className="text-sm leading-6 text-[var(--gantry-text-secondary)]">
              Enable the Flow plugin to start building GitOps-backed architecture and data flow diagrams from your existing Gantry entities.
            </p>
            <Link
              to="/plugins"
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)]"
            >
              Open Plugins
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-[var(--gantry-accent)]/10 p-2 text-[var(--gantry-accent)]">
              <Workflow className="h-6 w-6" />
            </span>
            <div>
              <h1 className="text-2xl font-bold text-[var(--gantry-text-primary)]">Flow</h1>
              <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
                Build shared system diagrams from existing catalog entities and keep them GitOps-friendly as `Flow` YAML.
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {mode === 'edit' && connectFromId && (
            <span className="rounded-full border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-1 text-xs font-medium text-[var(--gantry-text-secondary)]">
              Connecting from {(() => {
                const connectNode = flowSpec.nodes.find((node) => node.id === connectFromId);
                return connectNode ? nodeTitle(connectNode, entityMap) : 'selected node';
              })()}
            </span>
          )}
          {dirty && mode === 'edit' && (
            <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
              Unsaved changes
            </span>
          )}
          {!flowSettings.canEdit && (
            <span className="rounded-full border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-3 py-1 text-xs font-medium text-[var(--gantry-text-secondary)]">
              View only
            </span>
          )}
          {mode === 'view' ? (
            <>
              {flowSettings.canEdit && (
                <>
                  <button
                    onClick={startNewFlow}
                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-2 text-sm font-medium text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)]"
                  >
                    <Plus className="h-4 w-4" />
                    New Flow
                  </button>
                  <button
                    onClick={openEditor}
                    className="inline-flex items-center gap-2 rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)]"
                  >
                    <Workflow className="h-4 w-4" />
                    {currentFlowName ? 'Open Editor' : 'Create in Editor'}
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <button
                onClick={openOverview}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-2 text-sm font-medium text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)]"
              >
                <Network className="h-4 w-4" />
                Back to Overview
              </button>
              <button
                onClick={startNewFlow}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-2 text-sm font-medium text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)]"
              >
                <Plus className="h-4 w-4" />
                New Flow
              </button>
              <button
                onClick={deleteFlow}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-2 text-sm font-medium text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)]"
              >
                <Trash2 className="h-4 w-4" />
                {currentFlowName ? 'Delete Flow' : 'Clear Draft'}
              </button>
              <button
                onClick={saveFlow}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)] disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Flow
              </button>
            </>
          )}
        </div>
      </div>

      {!flowSettings.canEdit && (
        <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] px-4 py-3 text-sm text-[var(--gantry-text-secondary)]">
          <div className="flex items-start gap-2">
            <Network className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Editing is limited to the <strong className="text-[var(--gantry-text-primary)]">{flowSettings.editorRole}</strong> role and higher. Your current Flow access is read-only.</span>
          </div>
        </div>
      )}

      {(error || notice) && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          error
            ? 'border-[var(--gantry-danger)]/30 bg-[var(--gantry-danger)]/10 text-[var(--gantry-danger)]'
            : 'border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] text-[var(--gantry-text-secondary)]'
        }`}>
          <div className="flex items-start gap-2">
            {error ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <GitBranch className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{error || notice}</span>
          </div>
        </div>
      )}

      {mode === 'edit' ? (
        <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
          <section className="space-y-4">
            {renderSavedFlowsCard()}

            <div className="rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4">
              <div>
                <h2 className="text-sm font-semibold text-[var(--gantry-text-primary)]">Add Mockups</h2>
                <p className="mt-1 text-xs text-[var(--gantry-text-secondary)]">Use simple shapes for future systems, external actors, or rough architecture sketches.</p>
              </div>
              <div className="mt-4 space-y-2">
                {MOCK_NODE_LIBRARY.map((template) => (
                  <button
                    key={`${template.shape}:${template.label}`}
                    onClick={() => addMockNode(template)}
                    className="flex w-full items-start justify-between rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-3 text-left transition-colors hover:bg-[var(--gantry-bg-tertiary)]"
                  >
                    <div>
                      <div className="text-sm font-medium text-[var(--gantry-text-primary)]">{template.label}</div>
                      <div className="mt-1 text-xs text-[var(--gantry-text-secondary)]">
                        {mockShapeLabel(template.shape)} · {template.subtitle}
                      </div>
                    </div>
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{ backgroundColor: `${template.color}1A`, color: template.color }}
                    >
                      Add
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--gantry-text-primary)]">Add Entities</h2>
                <p className="mt-1 text-xs text-[var(--gantry-text-secondary)]">Drop real catalog items onto the canvas.</p>
              </div>
              <button
                onClick={seedEdgesFromRelationships}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--gantry-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--gantry-text-secondary)] hover:bg-[var(--gantry-bg-tertiary)]"
              >
                <Network className="h-3.5 w-3.5" />
                Seed Edges
              </button>
            </div>
            <div className="relative mt-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--gantry-text-secondary)]" />
              <input
                value={entityQuery}
                onChange={(event) => setEntityQuery(event.target.value)}
                placeholder="Search entities..."
                className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] py-2 pl-10 pr-3 text-sm text-[var(--gantry-text-primary)] placeholder:text-[var(--gantry-text-secondary)] focus:border-[var(--gantry-accent)] focus:outline-none"
              />
            </div>
            <div className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto pr-1">
              {filteredEntities.map((entity) => {
                const onCanvas = flowSpec.nodes.some((node) => isEntityNode(node) && nodeEntityKey(node) === entityKey(entity));
                return (
                  <button
                    key={entityKey(entity)}
                    onClick={() => addEntityNode(entity)}
                    className="flex w-full items-start justify-between rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-3 text-left transition-colors hover:bg-[var(--gantry-bg-tertiary)]"
                  >
                    <div>
                      <div className="text-sm font-medium text-[var(--gantry-text-primary)]">
                        {entity.metadata.title || entity.metadata.name}
                      </div>
                      <div className="mt-1 text-xs text-[var(--gantry-text-secondary)]">
                        {entity.kind} · {entity.metadata.name}
                      </div>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      onCanvas
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'bg-[var(--gantry-accent)]/10 text-[var(--gantry-accent)]'
                    }`}>
                      {onCanvas ? 'Added' : 'Add'}
                    </span>
                  </button>
                );
              })}
            </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Name</span>
                <input
                  value={flowName}
                  onChange={(event) => setMeta(() => setFlowName(event.target.value))}
                  disabled={currentFlowName !== null}
                  placeholder="checkout-system"
                  className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Owner</span>
                <input
                  value={flowOwner}
                  onChange={(event) => setMeta(() => setFlowOwner(event.target.value))}
                  placeholder="platform"
                  className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                />
              </label>
              <label className="space-y-1.5 md:col-span-2">
                <span className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Title</span>
                <input
                  value={flowTitleValue}
                  onChange={(event) => setMeta(() => setFlowTitleValue(event.target.value))}
                  placeholder="Checkout System Flow"
                  className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                />
              </label>
              <label className="space-y-1.5 md:col-span-2">
                <span className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Description</span>
                <textarea
                  value={flowDescription}
                  onChange={(event) => setMeta(() => setFlowDescription(event.target.value))}
                  rows={2}
                  placeholder="Show how requests and data move through the checkout experience."
                  className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                />
              </label>
            </div>
            </div>

            {renderCanvas(false)}
          </section>

          <section className="space-y-4">
            <div className="rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4">
            <h2 className="text-sm font-semibold text-[var(--gantry-text-primary)]">Inspector</h2>
            <p className="mt-1 text-xs text-[var(--gantry-text-secondary)]">
              Select a node or edge to edit it. Flow files remain normal entities, so they work naturally with GitOps export and apply.
            </p>
            </div>

            {selectedNode && (
              <div className="space-y-4 rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Selected Node</div>
                <h3 className="mt-2 text-lg font-semibold text-[var(--gantry-text-primary)]">
                  {nodeTitle(selectedNode, entityMap)}
                </h3>
                <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
                  {nodeMeta(selectedNode)}
                </p>
              </div>
              {isMockNode(selectedNode) && (
                <>
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Label</span>
                    <input
                      value={selectedNode.label}
                      onChange={(event) => updateNode(selectedNode.id, { label: event.target.value } as Partial<FlowMockNode>)}
                      className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Subtitle</span>
                    <input
                      value={selectedNode.subtitle || ''}
                      onChange={(event) => updateNode(selectedNode.id, { subtitle: event.target.value } as Partial<FlowMockNode>)}
                      className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                    />
                  </label>
                  <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Shape</span>
                      <select
                        value={selectedNode.shape}
                        onChange={(event) => updateNode(selectedNode.id, { shape: event.target.value as FlowMockShape } as Partial<FlowMockNode>)}
                        className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                      >
                        {MOCK_SHAPE_OPTIONS.map((shape) => (
                          <option key={shape} value={shape}>{mockShapeLabel(shape)}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Color</span>
                      <input
                        type="color"
                        value={selectedNode.color || '#64748B'}
                        onChange={(event) => updateNode(selectedNode.id, { color: event.target.value } as Partial<FlowMockNode>)}
                        className="h-10 w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-1 py-1"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Width</span>
                      <input
                        type="number"
                        value={Math.round(getNodeDimensions(selectedNode).width)}
                        onChange={(event) => updateNode(selectedNode.id, { width: Number(event.target.value) } as Partial<FlowMockNode>)}
                        className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Height</span>
                      <input
                        type="number"
                        value={Math.round(getNodeDimensions(selectedNode).height)}
                        onChange={(event) => updateNode(selectedNode.id, { height: Number(event.target.value) } as Partial<FlowMockNode>)}
                        className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                      />
                    </label>
                  </div>
                </>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">X</span>
                  <input
                    type="number"
                    value={Math.round(selectedNode.position.x)}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      updateNode(selectedNode.id, { position: { ...selectedNode.position, x: next } });
                    }}
                    className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Y</span>
                  <input
                    type="number"
                    value={Math.round(selectedNode.position.y)}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      updateNode(selectedNode.id, { position: { ...selectedNode.position, y: next } });
                    }}
                    className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setConnectFromId(connectFromId === selectedNode.id ? null : selectedNode.id)}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
                    connectFromId === selectedNode.id
                      ? 'bg-[var(--gantry-accent)] text-[var(--gantry-bg-primary)]'
                      : 'border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)]'
                  }`}
                >
                  <ArrowRightLeft className="h-4 w-4" />
                  {connectFromId === selectedNode.id ? 'Cancel Connection' : 'Connect From Here'}
                </button>
                {isEntityNode(selectedNode) && (
                  <button
                    onClick={() => navigate(entityPath(selectedNode.entityRef.kind, selectedNode.entityRef.name, selectedNode.entityRef.namespace))}
                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm font-medium text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)]"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open Entity
                  </button>
                )}
                <button
                  onClick={() => removeNode(selectedNode.id)}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--gantry-danger)] px-3 py-2 text-sm font-medium text-[var(--gantry-bg-primary)]"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </button>
              </div>
              </div>
            )}

            {selectedEdge && (
              <div className="space-y-4 rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Selected Edge</div>
                <h3 className="mt-2 text-lg font-semibold text-[var(--gantry-text-primary)]">{selectedEdge.label || selectedEdge.relation}</h3>
                <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
                  {selectedEdge.direction === 'two-way' ? 'Bi-directional' : 'One-way'} flow
                </p>
              </div>
              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Relation</span>
                <select
                  value={selectedEdge.relation}
                  onChange={(event) => updateEdge(selectedEdge.id, { relation: event.target.value })}
                  className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                >
                  {RELATION_OPTIONS.map((relation) => (
                    <option key={relation} value={relation}>{relation}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Label</span>
                <input
                  value={selectedEdge.label || ''}
                  onChange={(event) => updateEdge(selectedEdge.id, { label: event.target.value })}
                  placeholder="charge card"
                  className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Direction</span>
                <select
                  value={selectedEdge.direction}
                  onChange={(event) => updateEdge(selectedEdge.id, { direction: event.target.value === 'two-way' ? 'two-way' : 'one-way' })}
                  className="w-full rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm text-[var(--gantry-text-primary)] focus:border-[var(--gantry-accent)] focus:outline-none"
                >
                  <option value="one-way">One-way</option>
                  <option value="two-way">Two-way</option>
                </select>
              </label>
              <label className="flex items-center justify-between rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-3">
                <div>
                  <div className="text-sm font-medium text-[var(--gantry-text-primary)]">Animated edge</div>
                  <div className="mt-1 text-xs text-[var(--gantry-text-secondary)]">Show moving dash animation to indicate traffic direction.</div>
                </div>
                <input
                  type="checkbox"
                  checked={selectedEdge.animated}
                  onChange={(event) => updateEdge(selectedEdge.id, { animated: event.target.checked })}
                  className="h-4 w-4 rounded border-[var(--gantry-border)] text-[var(--gantry-accent)] focus:ring-[var(--gantry-accent)]"
                />
              </label>
              <button
                onClick={() => removeEdge(selectedEdge.id)}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--gantry-danger)] px-3 py-2 text-sm font-medium text-[var(--gantry-bg-primary)]"
              >
                <Trash2 className="h-4 w-4" />
                Remove Edge
              </button>
              </div>
            )}

            {!selectedNode && !selectedEdge && (
              <div className="rounded-2xl border border-dashed border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-6 text-center">
              <Unplug className="mx-auto h-8 w-8 text-[var(--gantry-text-secondary)]" />
              <h3 className="mt-3 text-sm font-semibold text-[var(--gantry-text-primary)]">Nothing selected</h3>
              <p className="mt-2 text-sm text-[var(--gantry-text-secondary)]">
                Click a node or edge on the canvas to edit it.
              </p>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
          <section className="space-y-4">
            {renderSavedFlowsCard()}
          </section>

          <section className="space-y-4">
            <div className="rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--gantry-text-primary)]">
                    {flowTitleValue || flowName || 'Flow Overview'}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
                    {flowDescription || 'Select a flow to preview it, then open the editor when you want to make changes.'}
                  </p>
                </div>
                {flowSettings.canEdit ? (
                  <button
                    onClick={openEditor}
                    className="inline-flex items-center gap-2 rounded-lg bg-[var(--gantry-accent)] px-4 py-2 text-sm font-medium text-[var(--gantry-bg-primary)] hover:bg-[var(--gantry-accent-hover)]"
                  >
                    <Workflow className="h-4 w-4" />
                    {currentFlowName ? 'Edit This Flow' : 'Create Flow'}
                  </button>
                ) : (
                  <div className="rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-xs font-medium text-[var(--gantry-text-secondary)]">
                    Read-only for your role
                  </div>
                )}
              </div>
            </div>

            {renderCanvas(true)}
          </section>

          <section className="space-y-4">
            <div className="rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4">
              <h2 className="text-sm font-semibold text-[var(--gantry-text-primary)]">Overview</h2>
              <div className="mt-4 space-y-3 text-sm text-[var(--gantry-text-secondary)]">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Name</div>
                  <div className="mt-1 text-[var(--gantry-text-primary)]">{flowName || 'Not created yet'}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Owner</div>
                  <div className="mt-1 text-[var(--gantry-text-primary)]">{flowOwner || 'Unassigned'}</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] p-3">
                    <div className="text-xs uppercase tracking-wide text-[var(--gantry-text-secondary)]">Nodes</div>
                    <div className="mt-1 text-lg font-semibold text-[var(--gantry-text-primary)]">{flowSpec.nodes.length}</div>
                  </div>
                  <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] p-3">
                    <div className="text-xs uppercase tracking-wide text-[var(--gantry-text-secondary)]">Edges</div>
                    <div className="mt-1 text-lg font-semibold text-[var(--gantry-text-primary)]">{flowSpec.edges.length}</div>
                  </div>
                </div>
              </div>
            </div>

            {selectedNode && (
              <div className="space-y-4 rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Selected Node</div>
                  <h3 className="mt-2 text-lg font-semibold text-[var(--gantry-text-primary)]">
                    {nodeTitle(selectedNode, entityMap)}
                  </h3>
                  <p className="mt-1 text-sm text-[var(--gantry-text-secondary)]">
                    {nodeMeta(selectedNode)}
                  </p>
                </div>
                {isMockNode(selectedNode) ? (
                  <div className="rounded-xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-3 text-sm text-[var(--gantry-text-secondary)]">
                    {selectedNode.subtitle || 'Mockup shape for planning and generalized flows.'}
                  </div>
                ) : (
                  <button
                    onClick={() => navigate(entityPath(selectedNode.entityRef.kind, selectedNode.entityRef.name, selectedNode.entityRef.namespace))}
                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--gantry-border)] bg-[var(--gantry-bg-secondary)] px-3 py-2 text-sm font-medium text-[var(--gantry-text-primary)] hover:bg-[var(--gantry-bg-tertiary)]"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open Entity
                  </button>
                )}
              </div>
            )}

            {selectedEdge && (
              <div className="space-y-2 rounded-2xl border border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-[var(--gantry-text-secondary)]">Selected Edge</div>
                <h3 className="text-lg font-semibold text-[var(--gantry-text-primary)]">{selectedEdge.label || selectedEdge.relation}</h3>
                <p className="text-sm text-[var(--gantry-text-secondary)]">
                  {selectedEdge.direction === 'two-way' ? 'Bi-directional' : 'One-way'} flow
                </p>
              </div>
            )}

            {!selectedNode && !selectedEdge && (
              <div className="rounded-2xl border border-dashed border-[var(--gantry-border)] bg-[var(--gantry-bg-primary)] p-6 text-center">
                <Unplug className="mx-auto h-8 w-8 text-[var(--gantry-text-secondary)]" />
                <h3 className="mt-3 text-sm font-semibold text-[var(--gantry-text-primary)]">Read-only view</h3>
                <p className="mt-2 text-sm text-[var(--gantry-text-secondary)]">
                  Browse the diagram here first, then jump into the editor when you want to make changes.
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
