import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY,
  type SimulationNodeDatum, type SimulationLinkDatum, type Simulation,
} from 'd3-force'
import type { Page } from '../../shared/types'
import { buildLinkIndex } from '../utils/linkGraph'
import './GraphView.css'

interface Props {
  allPages: Map<string, Page>
  pagesVersion: number
  onNavigate: (id: string, title?: string) => void
  onOpenSidebar: (id: string) => void
}

interface GNode extends SimulationNodeDatum {
  id: string
  title: string
  degree: number
  r: number
}
type GLink = SimulationLinkDatum<GNode>

interface Colors { node: string; nodeHi: string; link: string; linkHi: string; label: string; bg: string }

function readColors(): Colors {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string) => cs.getPropertyValue(name).trim()
  return {
    node: v('--text-muted'),
    nodeHi: v('--accent'),
    link: v('--border-normal'),
    linkHi: v('--accent'),
    label: v('--text-secondary'),
    bg: v('--bg-primary'),
  }
}

export function GraphView({ allPages, pagesVersion, onNavigate, onOpenSidebar }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [showDaily, setShowDaily] = useState(false)
  const [showOrphans, setShowOrphans] = useState(false)
  const [stats, setStats] = useState({ nodes: 0, links: 0 })

  // Viewport transform + interaction state live in refs: they change every
  // frame and must not re-render React.
  const view = useRef({ x: 0, y: 0, k: 1 })
  const hoverRef = useRef<GNode | null>(null)
  const simRef = useRef<Simulation<GNode, GLink> | null>(null)
  const nodesRef = useRef<GNode[]>([])
  const linksRef = useRef<GLink[]>([])
  const neighborsRef = useRef<Map<string, Set<string>>>(new Map())
  const colorsRef = useRef<Colors | null>(null)
  const drawQueued = useRef(false)
  const sizeRef = useRef({ w: 0, h: 0 })
  // Until the user pans/zooms, the view auto-fits the graph once it settles
  const userMovedRef = useRef(false)
  // Ticks the current layout has run — a rebuild only counts as an "update"
  // (keep positions, gentle settle) once there's a real layout to keep.
  const ticksRef = useRef(0)

  // allPages.size: empty daily placeholders are added without a pagesVersion bump
  const pages = useMemo(() => Array.from(allPages.values()), [allPages, pagesVersion, allPages.size])

  const graph = useMemo(() => {
    const visible = pages.filter(p => showDaily || !p.isDaily)
    const visibleIds = new Set(visible.map(p => p.id))
    const { outgoing } = buildLinkIndex(pages)

    const seen = new Set<string>()
    const links: { source: string; target: string }[] = []
    const degree = new Map<string, number>()
    for (const p of visible) {
      for (const t of outgoing.get(p.id) ?? []) {
        if (!visibleIds.has(t)) continue
        const key = p.id < t ? `${p.id}\u0000${t}` : `${t}\u0000${p.id}`
        if (seen.has(key)) continue
        seen.add(key)
        links.push({ source: p.id, target: t })
        degree.set(p.id, (degree.get(p.id) ?? 0) + 1)
        degree.set(t, (degree.get(t) ?? 0) + 1)
      }
    }

    const nodes = visible
      .filter(p => showOrphans || (degree.get(p.id) ?? 0) > 0)
      .map(p => {
        const d = degree.get(p.id) ?? 0
        return { id: p.id, title: p.title, degree: d, r: 3 + Math.sqrt(d) * 1.6 }
      })
    // Structural fingerprint: block edits, sync pulls and timestamp changes that
    // don't add/remove pages, links or titles leave the layout untouched.
    const signature = nodes.map(n => `${n.id}\u0001${n.title}`).sort().join('\u0002')
      + '\u0003' + links.map(l => `${l.source}\u0001${l.target}`).sort().join('\u0002')
    return { nodes, links, signature }
  }, [pages, showDaily, showOrphans])
  const graphRef = useRef(graph)
  graphRef.current = graph

  function requestDraw() {
    if (drawQueued.current) return
    drawQueued.current = true
    requestAnimationFrame(() => { drawQueued.current = false; draw() })
  }

  function draw() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const colors = colorsRef.current ?? (colorsRef.current = readColors())
    const dpr = window.devicePixelRatio || 1
    const { w, h } = sizeRef.current
    const { x, y, k } = view.current
    const hover = hoverRef.current
    const hoverNeighbors = hover ? neighborsRef.current.get(hover.id) : null

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.translate(w / 2 + x, h / 2 + y)
    ctx.scale(k, k)

    // Links
    ctx.lineWidth = 1 / k
    for (const l of linksRef.current) {
      const s = l.source as GNode, t = l.target as GNode
      const hi = hover && (s === hover || t === hover)
      ctx.strokeStyle = hi ? colors.linkHi : colors.link
      ctx.globalAlpha = hover && !hi ? 0.35 : 1
      ctx.beginPath()
      ctx.moveTo(s.x!, s.y!)
      ctx.lineTo(t.x!, t.y!)
      ctx.stroke()
    }

    // Nodes
    for (const n of nodesRef.current) {
      const hi = hover && (n === hover || hoverNeighbors?.has(n.id))
      ctx.globalAlpha = hover && !hi ? 0.3 : 1
      ctx.fillStyle = n === hover ? colors.nodeHi : hi ? colors.nodeHi : colors.node
      ctx.beginPath()
      ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2)
      ctx.fill()
    }

    // Labels: hubs always, everything once zoomed in, hovered + neighbours on hover
    ctx.font = `${12 / k}px -apple-system, BlinkMacSystemFont, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (const n of nodesRef.current) {
      const hi = hover && (n === hover || hoverNeighbors?.has(n.id))
      const small = nodesRef.current.length <= 80
      const show = hi || k > 1.6 || (!hover && (small || n.degree >= 8) && k > 0.6)
      if (!show) continue
      ctx.globalAlpha = hover && !hi ? 0.3 : 1
      ctx.fillStyle = n === hover ? colors.nodeHi : colors.label
      ctx.fillText(n.title.length > 40 ? n.title.slice(0, 39) + '…' : n.title, n.x!, n.y! + n.r + 2 / k)
    }
    ctx.globalAlpha = 1
  }

  // Build / rebuild the simulation when the graph's structure changes.
  // Existing nodes keep their positions; new ones start next to a neighbour.
  useEffect(() => {
    const graph = graphRef.current
    const prev = new Map(nodesRef.current.map(n => [n.id, n]))
    const links: GLink[] = graph.links.map(l => ({ ...l }))
    const neighbors = new Map<string, Set<string>>()
    for (const l of graph.links) {
      if (!neighbors.has(l.source)) neighbors.set(l.source, new Set())
      if (!neighbors.has(l.target)) neighbors.set(l.target, new Set())
      neighbors.get(l.source)!.add(l.target)
      neighbors.get(l.target)!.add(l.source)
    }
    const nodes: GNode[] = graph.nodes.map(n => {
      const old = prev.get(n.id)
      if (old) return { ...n, x: old.x, y: old.y, vx: old.vx, vy: old.vy }
      const anchor = Array.from(neighbors.get(n.id) ?? []).map(id => prev.get(id)).find(Boolean)
      return anchor
        ? { ...n, x: anchor.x! + (Math.random() - 0.5) * 30, y: anchor.y! + (Math.random() - 0.5) * 30 }
        : { ...n }
    })
    const isUpdate = prev.size > 0 && ticksRef.current > 30
    if (!isUpdate) ticksRef.current = 0
    nodesRef.current = nodes
    linksRef.current = links
    neighborsRef.current = neighbors
    hoverRef.current = null
    setStats({ nodes: nodes.length, links: links.length })

    const sim = forceSimulation<GNode>(nodes)
      .force('link', forceLink<GNode, GLink>(links).id(d => d.id).distance(36).strength(0.4))
      .force('charge', forceManyBody<GNode>().strength(-60).distanceMax(500))
      .force('center', forceCenter(0, 0))
      // Gentle pull keeps disconnected clusters/orphans on screen
      .force('x', forceX<GNode>(0).strength(0.04))
      .force('y', forceY<GNode>(0).strength(0.04))
      .force('collide', forceCollide<GNode>(d => d.r + 2))
      .on('tick', () => { ticksRef.current++; requestDraw() })
      .on('end', () => { if (!userMovedRef.current) fitView() })
    simRef.current = sim
    if (isUpdate) {
      // An update only needs a gentle, animated settle
      sim.alpha(0.3)
    } else {
      // First layout: settle it before the first paint so the graph opens
      // already placed and framed (no shrunken blob that jumps later)
      sim.stop()
      sim.tick(nodes.length > 2000 ? 120 : 300)
      ticksRef.current = 300
      if (!userMovedRef.current) fitView()
      else requestDraw()
    }
    return () => { sim.stop() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.signature])

  // Canvas sizing
  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1
      const { width, height } = wrap.getBoundingClientRect()
      sizeRef.current = { w: width, h: height }
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      if (!userMovedRef.current) fitView()
      else requestDraw()
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-read theme colours when theme/style changes
  useEffect(() => {
    const mo = new MutationObserver(() => { colorsRef.current = null; requestDraw() })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-style'] })
    return () => mo.disconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Interaction: pan, zoom (wheel + pinch), drag nodes, hover, click ───
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const toWorld = (cx: number, cy: number) => {
      const rect = canvas.getBoundingClientRect()
      const { w, h } = sizeRef.current
      const { x, y, k } = view.current
      return { wx: (cx - rect.left - w / 2 - x) / k, wy: (cy - rect.top - h / 2 - y) / k }
    }
    const nodeAt = (cx: number, cy: number): GNode | null => {
      const { wx, wy } = toWorld(cx, cy)
      let best: GNode | null = null
      let bestD = Infinity
      for (const n of nodesRef.current) {
        const dx = n.x! - wx, dy = n.y! - wy
        const d = dx * dx + dy * dy
        const hit = Math.max(n.r + 3, 8 / view.current.k)
        if (d < hit * hit && d < bestD) { best = n; bestD = d }
      }
      return best
    }
    const pointers = new Map<number, { x: number; y: number }>()
    let dragNode: GNode | null = null
    let panning = false
    let moved = false
    let last = { x: 0, y: 0 }
    let pinchDist = 0

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // Like Roam: scrolling zooms around the cursor (mouse wheel, trackpad
      // two-finger scroll and pinch), dragging the background pans.
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
      const speed = e.ctrlKey ? 0.01 : 0.002   // pinch deltas are small
      const factor = Math.exp(-Math.max(-150, Math.min(150, dy)) * speed)
      zoomAt(e.clientX, e.clientY, factor)
    }

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      moved = false
      last = { x: e.clientX, y: e.clientY }
      if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values())
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
        dragNode = null
        panning = false
        return
      }
      const n = nodeAt(e.clientX, e.clientY)
      if (n) {
        dragNode = n
        n.fx = n.x; n.fy = n.y
        simRef.current?.alphaTarget(0.25).restart()
      } else {
        panning = true
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values())
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinchDist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist)
        pinchDist = d
        moved = true
        return
      }

      if (Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y) > 3) moved = true

      if (dragNode) {
        if (moved) userMovedRef.current = true  // don't re-fit after a node drag
        const { wx, wy } = toWorld(e.clientX, e.clientY)
        dragNode.fx = wx; dragNode.fy = wy
        requestDraw()
      } else if (panning) {
        userMovedRef.current = true
        view.current.x += e.clientX - last.x
        view.current.y += e.clientY - last.y
        requestDraw()
      } else if (e.pointerType === 'mouse') {
        const n = nodeAt(e.clientX, e.clientY)
        if (n !== hoverRef.current) {
          hoverRef.current = n
          canvas.style.cursor = n ? 'pointer' : 'grab'
          requestDraw()
        }
      }
      last = { x: e.clientX, y: e.clientY }
    }

    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (pointers.size > 0) return
      if (dragNode) {
        const n = dragNode
        n.fx = null; n.fy = null
        simRef.current?.alphaTarget(0)
        if (!moved) {
          if (e.shiftKey) onOpenSidebar(n.id)
          else onNavigate(n.id, n.title)
        }
      }
      dragNode = null
      panning = false
      pinchDist = 0
    }

    const onLeave = () => {
      if (hoverRef.current) { hoverRef.current = null; requestDraw() }
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('pointerleave', onLeave)
    return () => {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('pointerleave', onLeave)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onNavigate, onOpenSidebar])

  /** Zoom by `factor`, keeping the point under (cx, cy) — or the centre — fixed */
  function zoomAt(cx: number | null, cy: number | null, factor: number) {
    const canvas = canvasRef.current
    if (!canvas) return
    userMovedRef.current = true
    const rect = canvas.getBoundingClientRect()
    const { w, h } = sizeRef.current
    const v = view.current
    const k = Math.min(8, Math.max(0.05, v.k * factor))
    const px = cx === null ? 0 : cx - rect.left - w / 2
    const py = cy === null ? 0 : cy - rect.top - h / 2
    v.x = px - (px - v.x) * (k / v.k)
    v.y = py - (py - v.y) * (k / v.k)
    v.k = k
    requestDraw()
  }

  /** Zoom/centre so every node is on screen */
  function fitView() {
    const nodes = nodesRef.current
    const { w, h } = sizeRef.current
    if (nodes.length === 0 || w === 0) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of nodes) {
      minX = Math.min(minX, n.x! - n.r); maxX = Math.max(maxX, n.x! + n.r)
      minY = Math.min(minY, n.y! - n.r); maxY = Math.max(maxY, n.y! + n.r)
    }
    const pad = 60
    const k = Math.min(2, Math.max(0.1, Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxY - minY || 1))))
    view.current = { k, x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k }
    requestDraw()
  }

  function resetView() {
    userMovedRef.current = false
    fitView()
  }

  return (
    <div className="graph-view">
      <div className="graph-toolbar">
        <span className="graph-title">Graph</span>
        <span className="graph-stats">{stats.nodes} pages · {stats.links} links</span>
        <div className="graph-toolbar-spacer" />
        <label className="graph-toggle">
          <input type="checkbox" checked={showDaily} onChange={e => setShowDaily(e.target.checked)} />
          Daily notes
        </label>
        <label className="graph-toggle">
          <input type="checkbox" checked={showOrphans} onChange={e => setShowOrphans(e.target.checked)} />
          Orphans
        </label>
      </div>
      <div className="graph-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} className="graph-canvas" />
        <div className="graph-zoom-controls">
          <button onClick={() => zoomAt(null, null, 1.3)} title="Zoom in">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
          <button onClick={() => zoomAt(null, null, 1 / 1.3)} title="Zoom out">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 6h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
          <button onClick={resetView} title="Fit the whole graph">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 4.5v-3h3M7.5 1.5h3v3M10.5 7.5v3h-3M4.5 10.5h-3v-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
        {stats.nodes === 0 && (
          <div className="graph-empty">No linked pages yet — link pages with [[…]] or #tags.</div>
        )}
      </div>
    </div>
  )
}
