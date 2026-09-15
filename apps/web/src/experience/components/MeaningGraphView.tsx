import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minus, Plus, ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { JourneyWorldItemView } from "../personalMeaningJourney";
import { buildMeaningGraph, type MeaningGraphNode } from "../ui/meaningGraph";

export function MeaningGraphView({
  items,
  selectedMeaningId,
  onSelectMeaning,
  onOpenMeaning,
  onOpenConfirmedSense,
}: {
  items: readonly JourneyWorldItemView[];
  selectedMeaningId: string | null;
  onSelectMeaning: (id: string) => void;
  onOpenMeaning: (id: string, focusId?: string) => void;
  onOpenConfirmedSense: (id: string, focusId: string) => void;
}) {
  const { t } = useTranslation();
  const graph = useMemo(() => buildMeaningGraph(items), [items]);
  const [camera, setCamera] = useState(() => {
    const zoom = Math.min(0.85, 960 / graph.width, 530 / graph.height);
    return { x: (1000 - graph.width * zoom) / 2, y: 25, zoom };
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    originX: number;
    originY: number;
  } | null>(null);
  const byId = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph],
  );
  const selected =
    byId.get(selectedNodeId ?? "") ??
    graph.nodes.find(
      (n) => n.meaningId === selectedMeaningId && n.kind === "context",
    );
  const fit = () => {
    const zoom = Math.min(0.85, 960 / graph.width, 530 / graph.height);
    setCamera({ x: (1000 - graph.width * zoom) / 2, y: 25, zoom });
  };
  const zoomBy = (factor: number) =>
    setCamera((c) => {
      const zoom = Math.max(0.08, Math.min(2, c.zoom * factor));
      return {
        x: 500 - ((500 - c.x) * zoom) / c.zoom,
        y: 280 - ((280 - c.y) * zoom) / c.zoom,
        zoom,
      };
    });
  // Non-passive wheel handling keeps graph zoom from scrolling the page.
  useEffect(() => {
    const node = svg.current;
    if (!node) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(e.deltaY > 0 ? 0.9 : 1.1);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);
  const select = (node: MeaningGraphNode) => {
    setSelectedNodeId(node.id);
    onSelectMeaning(node.meaningId);
  };
  const open = (node: MeaningGraphNode) =>
    node.confirmed && node.focusId && node.kind !== "focus"
      ? onOpenConfirmedSense(node.meaningId, node.focusId)
      : onOpenMeaning(node.meaningId, node.focusId);
  const toolbarButton =
    "grid size-11 place-items-center rounded-control text-fg-secondary hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-focus";
  return (
    <section
      className="sensa-meaning-graph overflow-hidden rounded-card border border-border-subtle bg-surface-panel"
      aria-label={t("content.graph.title")}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex flex-wrap gap-3 text-xs text-fg-tertiary">
          {(["context", "focus", "sense", "expression"] as const).map(
            (kind) => (
              <span key={kind} className="flex items-center gap-1.5">
                <i
                  className={`size-2 rounded-pill ${kind === "context" ? "bg-fg-tertiary" : kind === "focus" ? "bg-decorative" : kind === "sense" ? "bg-progress" : "bg-action-primary"}`}
                />
                {t(`content.graph.${kind}`)}
              </span>
            ),
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            className={toolbarButton}
            onClick={() => zoomBy(0.8)}
            aria-label={t("content.graph.zoomOut")}
          >
            <Minus size={16} />
          </button>
          <span className="w-12 text-center text-xs tabular-nums text-fg-tertiary">
            {Math.round(camera.zoom * 100)}%
          </span>
          <button
            className={toolbarButton}
            onClick={() => zoomBy(1.25)}
            aria-label={t("content.graph.zoomIn")}
          >
            <Plus size={16} />
          </button>
          <button
            className={toolbarButton}
            onClick={fit}
            aria-label={t("content.graph.fit")}
          >
            <Maximize size={16} />
          </button>
        </div>
      </header>
      <svg
        ref={svg}
        viewBox="0 0 1000 580"
        className="h-[440px] w-full touch-none bg-surface-subtle select-none sm:h-[540px]"
        aria-label={t("content.graph.canvas")}
        onPointerDown={(e) => {
          if ((e.target as Element).closest("[data-node]")) return;
          svg.current?.setPointerCapture(e.pointerId);
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            originX: camera.x,
            originY: camera.y,
          };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          const rect = svg.current?.getBoundingClientRect();
          if (!d || !rect) return;
          const scale = Math.min(rect.width / 1000, rect.height / 580);
          setCamera((c) => ({
            ...c,
            x: d.originX + (e.clientX - d.x) / scale,
            y: d.originY + (e.clientY - d.y) / scale,
          }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <g
          transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}
        >
          {graph.edges.map((edge) => {
            const a = byId.get(edge.from)!,
              b = byId.get(edge.to)!;
            return (
              <path
                key={`${edge.from}:${edge.to}`}
                d={`M ${a.x + 230} ${a.y} C ${a.x + 265} ${a.y}, ${b.x - 35} ${b.y}, ${b.x} ${b.y}`}
                fill="none"
                stroke="var(--sensa-border-strong)"
                strokeWidth="1.5"
              />
            );
          })}
          {graph.nodes.map((node) => (
            <g
              key={node.id}
              data-node={node.id}
              transform={`translate(${node.x} ${node.y - 30})`}
              role="button"
              tabIndex={0}
              aria-label={`${t(`content.graph.${node.kind}`)}: ${node.label}`}
              aria-pressed={selected?.id === node.id}
              className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-focus [&:focus-visible>rect]:stroke-[3]"
              onClick={() => select(node)}
              onDoubleClick={() => open(node)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  select(node);
                }
              }}
            >
              <rect
                width="230"
                height="64"
                rx="10"
                fill={
                  selected?.id === node.id
                    ? "var(--sensa-surface-selected)"
                    : node.kind === "expression"
                      ? "var(--sensa-accent-soft)"
                      : "var(--sensa-surface-panel)"
                }
                stroke={selected?.id === node.id ? "var(--sensa-focus)" : "var(--sensa-border-strong)"}
                strokeWidth={selected?.id === node.id ? 2 : 1}
              />
              <text x="14" y="20" fill="var(--sensa-fg-tertiary)" fontSize="10">
                {t(`content.graph.${node.kind}`)}
              </text>
              <text x="14" y="44" fill="var(--sensa-fg-primary)" fontSize="13">
                {node.label.length > 25
                  ? `${node.label.slice(0, 24)}…`
                  : node.label}
              </text>
              <title>{node.label}</title>
            </g>
          ))}
        </g>
      </svg>
      <footer className="flex min-h-20 items-center justify-between gap-4 border-t border-border-subtle px-5 py-4">
        <p className="min-w-0 text-sm leading-6 text-fg-secondary">
          {selected?.label ?? t("content.graph.hint")}
        </p>
        {selected && (
          <button
            onClick={() => open(selected)}
            className="flex min-h-11 shrink-0 items-center gap-2 rounded-control px-3 text-sm text-action-primary focus-visible:outline-2 focus-visible:outline-focus"
          >
            {t("content.graph.open")}
            <ArrowUpRight size={16} />
          </button>
        )}
      </footer>
    </section>
  );
}
