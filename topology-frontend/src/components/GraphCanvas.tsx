import { useEffect, useRef, useState, useCallback } from 'react';
import { NetworkNode, NetworkEdge } from '../types';

interface SimNode extends NetworkNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphCanvasProps {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
}

function nodeColor(type: NetworkNode['type'], selected: boolean) {
  if (selected) return '#f0fffe';
  switch (type) {
    case 'router': return '#38bdf8';
    case 'switch': return '#34d399';
    case 'host': return '#94a3b8';
    default: return '#64748b';
  }
}

function nodeGlow(type: NetworkNode['type'], selected: boolean) {
  if (selected) return 'drop-shadow(0 0 8px #ffffff88)';
  switch (type) {
    case 'router': return 'drop-shadow(0 0 6px #38bdf880)';
    case 'switch': return 'drop-shadow(0 0 6px #34d39980)';
    default: return 'drop-shadow(0 0 4px #94a3b840)';
  }
}

function nodeRadius(type: NetworkNode['type']) {
  if (type === 'router') return 18;
  if (type === 'switch') return 15;
  return 12;
}

const REPULSION = 4500;
const SPRING_LENGTH = 120;
const SPRING_K = 0.04;
const DAMPING = 0.82;
const CENTER_PULL = 0.03;

export function GraphCanvas({ nodes, edges, selectedNode, onSelectNode }: GraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);
  const animFrameRef = useRef<number>(0);
  const simNodesRef = useRef<SimNode[]>([]);
  const [dims, setDims] = useState({ w: 800, h: 500 });
  const dimsRef = useRef(dims);

  const dragRef = useRef<{ id: string; ox: number; oy: number; mx: number; my: number } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, px: 0, py: 0 });

  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: width, h: height });
      dimsRef.current = { w: width, h: height };
    });
    if (svgRef.current?.parentElement) obs.observe(svgRef.current.parentElement);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const existing = new Map(simNodesRef.current.map((n) => [n.id, n]));
    const cx = dimsRef.current.w / 2;
    const cy = dimsRef.current.h / 2;
    const newSim: SimNode[] = nodes.map((n) => {
      if (existing.has(n.id)) {
        const e = existing.get(n.id)!;
        return { ...e, ...n };
      }
      const angle = Math.random() * Math.PI * 2;
      const r = 60 + Math.random() * 100;
      return { ...n, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, vx: 0, vy: 0 };
    });
    simNodesRef.current = newSim;
    setSimNodes([...newSim]);
  }, [nodes]);

  const tick = useCallback(() => {
    const sn = simNodesRef.current;
    if (sn.length === 0) {
      animFrameRef.current = requestAnimationFrame(tick);
      return;
    }
    const { w, h } = dimsRef.current;
    const cx = w / 2;
    const cy = h / 2;

    for (let i = 0; i < sn.length; i++) {
      if (dragRef.current?.id === sn[i].id) continue;
      let fx = 0, fy = 0;

      for (let j = 0; j < sn.length; j++) {
        if (i === j) continue;
        const dx = sn[i].x - sn[j].x;
        const dy = sn[i].y - sn[j].y;
        const dist2 = dx * dx + dy * dy + 1;
        const dist = Math.sqrt(dist2);
        fx += (dx / dist) * (REPULSION / dist2);
        fy += (dy / dist) * (REPULSION / dist2);
      }

      for (const e of edges) {
        const isSource = e.source === sn[i].id;
        const isTarget = e.target === sn[i].id;
        if (!isSource && !isTarget) continue;
        const otherId = isSource ? e.target : e.source;
        const other = sn.find((n) => n.id === otherId);
        if (!other) continue;
        const dx = other.x - sn[i].x;
        const dy = other.y - sn[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const force = SPRING_K * (dist - SPRING_LENGTH);
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      }

      fx += (cx - sn[i].x) * CENTER_PULL;
      fy += (cy - sn[i].y) * CENTER_PULL;

      sn[i].vx = (sn[i].vx + fx) * DAMPING;
      sn[i].vy = (sn[i].vy + fy) * DAMPING;
      sn[i].x += sn[i].vx;
      sn[i].y += sn[i].vy;
    }

    setSimNodes([...sn]);
    animFrameRef.current = requestAnimationFrame(tick);
  }, [edges]);

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [tick]);

  const svgToWorld = useCallback((sx: number, sy: number) => {
    return {
      wx: (sx - panRef.current.x) / zoomRef.current,
      wy: (sy - panRef.current.y) / zoomRef.current,
    };
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { wx, wy } = svgToWorld(sx, sy);
    const node = simNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    dragRef.current = { id: nodeId, ox: wx - node.x, oy: wy - node.y, mx: wx, my: wy };
    onSelectNode(nodeId);
  }, [svgToWorld, onSelectNode]);

  const onSvgMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === svgRef.current || (e.target as SVGElement).tagName === 'rect') {
      const rect = svgRef.current!.getBoundingClientRect();
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, px: panRef.current.x, py: panRef.current.y };
      onSelectNode(null);
    }
  }, [onSelectNode]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (dragRef.current) {
      const { wx, wy } = svgToWorld(sx, sy);
      const node = simNodesRef.current.find((n) => n.id === dragRef.current!.id);
      if (node) {
        node.x = wx - dragRef.current.ox;
        node.y = wy - dragRef.current.oy;
        node.vx = 0;
        node.vy = 0;
      }
    } else if (isPanningRef.current) {
      const dx = sx - panStartRef.current.x;
      const dy = sy - panStartRef.current.y;
      setPan({ x: panStartRef.current.px + dx, y: panStartRef.current.py + dy });
    }
  }, [svgToWorld]);

  const onMouseUp = useCallback(() => {
    dragRef.current = null;
    isPanningRef.current = false;
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setZoom((z) => {
      const newZ = Math.min(Math.max(z * factor, 0.2), 4);
      setPan((p) => ({
        x: mx - (mx - p.x) * (newZ / z),
        y: my - (my - p.y) * (newZ / z),
      }));
      return newZ;
    });
  }, []);

  const nodeMap = new Map(simNodes.map((n) => [n.id, n]));

  return (
    <div className="relative w-full h-full bg-gray-950 rounded-lg overflow-hidden border border-gray-800">
      <svg
        ref={svgRef}
        width={dims.w}
        height={dims.h}
        className="w-full h-full cursor-grab active:cursor-grabbing select-none"
        onMouseDown={onSvgMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
      >
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" strokeWidth="0.5" />
          </pattern>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="#334155" />
          </marker>
        </defs>

        <rect width={dims.w} height={dims.h} fill="url(#grid)" />

        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {edges.map((e, i) => {
            const src = nodeMap.get(e.source);
            const tgt = nodeMap.get(e.target);
            if (!src || !tgt) return null;
            const isSrcSelected = selectedNode === e.source;
            const isTgtSelected = selectedNode === e.target;
            const isHighlighted = isSrcSelected || isTgtSelected;
            return (
              <line
                key={i}
                x1={src.x}
                y1={src.y}
                x2={tgt.x}
                y2={tgt.y}
                stroke={isHighlighted ? '#38bdf8' : '#1e3a5f'}
                strokeWidth={isHighlighted ? 1.5 : 1}
                strokeOpacity={isHighlighted ? 0.8 : 0.5}
                strokeDasharray={isHighlighted ? '' : '4 3'}
              />
            );
          })}

          {simNodes.map((node) => {
            const isSelected = selectedNode === node.id;
            const r = nodeRadius(node.type);
            const color = nodeColor(node.type, isSelected);
            const glow = nodeGlow(node.type, isSelected);
            return (
              <g
                key={node.id}
                transform={`translate(${node.x},${node.y})`}
                style={{ cursor: 'pointer', filter: glow }}
                onMouseDown={(e) => onMouseDown(e, node.id)}
              >
                {isSelected && (
                  <circle r={r + 6} fill="none" stroke={color} strokeWidth={1} strokeOpacity={0.3} />
                )}
                <circle
                  r={r}
                  fill={isSelected ? color : 'transparent'}
                  stroke={color}
                  strokeWidth={isSelected ? 0 : 1.5}
                  fillOpacity={isSelected ? 1 : 0}
                />
                <circle
                  r={r - 2}
                  fill={isSelected ? '#0f172a' : '#0f172a'}
                  stroke={color}
                  strokeWidth={1.5}
                />
                <text
                  y={r + 14}
                  textAnchor="middle"
                  fill={color}
                  fontSize={9}
                  fontFamily="monospace"
                  opacity={0.9}
                >
                  {node.ip}
                </text>
                <text
                  textAnchor="middle"
                  fill={color}
                  fontSize={7}
                  fontFamily="monospace"
                  dy="0.35em"
                  opacity={0.6}
                >
                  {node.type.toUpperCase()}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute bottom-3 right-3 flex flex-col gap-1">
        <button
          onClick={() => setZoom((z) => Math.min(z * 1.2, 4))}
          className="w-7 h-7 bg-gray-900 border border-gray-700 text-gray-400 hover:text-white rounded flex items-center justify-center text-sm font-mono"
        >+</button>
        <button
          onClick={() => setZoom((z) => Math.max(z * 0.8, 0.2))}
          className="w-7 h-7 bg-gray-900 border border-gray-700 text-gray-400 hover:text-white rounded flex items-center justify-center text-sm font-mono"
        >-</button>
        <button
          onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
          className="w-7 h-7 bg-gray-900 border border-gray-700 text-gray-400 hover:text-white rounded flex items-center justify-center"
          title="Reset view"
        >
          <span className="text-xs font-mono">R</span>
        </button>
      </div>

      <div className="absolute bottom-3 left-3 flex gap-3 text-xs font-mono">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-sky-400 inline-block" style={{ boxShadow: '0 0 4px #38bdf8' }} />
          <span className="text-gray-500">Router</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" style={{ boxShadow: '0 0 4px #34d399' }} />
          <span className="text-gray-500">Switch</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />
          <span className="text-gray-500">Host</span>
        </span>
      </div>
    </div>
  );
}
