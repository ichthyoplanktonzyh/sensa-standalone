import { uiClass } from '../ui/classes';
import { useMemo, useState, type CSSProperties } from 'react';
import {
  semanticStatusLabel,
  type PersonalMeaningItem,
  type PersonalSemanticRegionItem,
  type SemanticSenseItem,
} from '../contentProjection';
import { PHASE_LABELS } from '../personalMeaningJourney';

interface SemanticMapViewProps {
  senses: SemanticSenseItem[];
  meanings: PersonalMeaningItem[];
  regions: PersonalSemanticRegionItem[];
  onOpenSense: (senseId: string) => void;
  onOpenPersonalMeaning?: (personalMeaningId: string) => void;
}

type SelectedMapNode =
  | { kind: 'sense'; entry: SemanticSenseItem }
  | { kind: 'personal_meaning'; entry: PersonalMeaningItem };

interface PersonalZoneLayout {
  id: string;
  name: string;
  meanings: PersonalMeaningItem[];
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAP_WIDTH = 620;
const ZOOM_LEVELS = [0.82, 1, 1.18] as const;

const buildPersonalZones = (
  regions: PersonalSemanticRegionItem[],
  meanings: PersonalMeaningItem[],
  startY: number,
): { zones: PersonalZoneLayout[]; mapHeight: number } => {
  const zoneInputs = regions.map((region) => ({
    id: region.regionId,
    name: region.name,
    meanings: meanings.filter((meaning) => meaning.regionId === region.regionId),
  }));
  const ungrouped = meanings.filter((meaning) => meaning.regionId === null);
  if (ungrouped.length > 0) {
    zoneInputs.push({ id: 'ungrouped', name: '我的个人意义', meanings: ungrouped });
  }

  const zones: PersonalZoneLayout[] = [];
  let currentY = startY;
  for (let index = 0; index < zoneInputs.length; index += 2) {
    const pair = zoneInputs.slice(index, index + 2);
    const pairHeights = pair.map((zone) => {
      const rows = Math.ceil(zone.meanings.length / 2);
      return Math.max(124, 112 + Math.max(0, rows - 1) * 70);
    });
    const rowHeight = Math.max(...pairHeights);
    pair.forEach((zone, pairIndex) => {
      zones.push({
        ...zone,
        x: 22 + pairIndex * 296,
        y: currentY,
        width: 280,
        height: rowHeight,
      });
    });
    currentY += rowHeight + 16;
  }
  return { zones, mapHeight: Math.max(startY, currentY) + 20 };
};

const ReviewedNode = ({
  entry,
  index,
  selected,
  onSelect,
}: {
  entry: SemanticSenseItem;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) => {
  const style = {
    '--map-node-x': `${68 + (index % 4) * 142}px`,
    '--map-node-y': `${82 + Math.floor(index / 4) * 94}px`,
  } as CSSProperties;
  return (
    <button
      type="button"
      className={uiClass(`semantic-map-node reviewed status-${entry.status}${selected ? ' selected' : ''}`)}
      style={style}
      onClick={onSelect}
      aria-label={`${entry.expression.formL2}，${entry.ground.labelL1}，${semanticStatusLabel[entry.status]}`}
      aria-pressed={selected}
    >
      <i aria-hidden="true" />
      <b>{entry.expression.formL2}</b>
      <small>{entry.ground.labelL1}</small>
    </button>
  );
};

const PersonalMeaningNode = ({
  meaning,
  index,
  selected,
  onSelect,
}: {
  meaning: PersonalMeaningItem;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) => {
  const experience = meaning.semanticAnchors[0] ?? null;
  const familiarExpression = meaning.familiarExpressions[0] ?? null;
  const style = {
    '--map-node-x': `${68 + (index % 2) * 136}px`,
    '--map-node-y': `${72 + Math.floor(index / 2) * 70}px`,
  } as CSSProperties;
  return (
    <button
      type="button"
      className={uiClass(`semantic-map-node personal${selected ? ' selected' : ''}`)}
      style={style}
      onClick={onSelect}
      aria-label={`个人意义，${experience?.bodyText || familiarExpression?.surfaceForm}`}
      aria-pressed={selected}
    >
      <i aria-hidden="true" />
      <b>{familiarExpression?.surfaceForm || '我的经验'}</b>
      <small>{PHASE_LABELS[meaning.phase]}</small>
    </button>
  );
};

export const SemanticMapView = ({
  senses,
  meanings,
  regions,
  onOpenSense,
  onOpenPersonalMeaning,
}: SemanticMapViewProps) => {
  const [zoomIndex, setZoomIndex] = useState(0);
  const [selected, setSelected] = useState<SelectedMapNode | null>(null);
  const zoom = ZOOM_LEVELS[zoomIndex];

  const reviewedRows = Math.max(1, Math.ceil(senses.length / 4));
  const reviewedHeight = Math.max(148, 126 + Math.max(0, reviewedRows - 1) * 94);
  const personalLayout = useMemo(
    () => buildPersonalZones(regions, meanings, 38 + reviewedHeight),
    [meanings, regions, reviewedHeight],
  );
  const mapHeight = Math.max(personalLayout.mapHeight, reviewedHeight + 80);

  return (
    <section className={uiClass("semantic-map-view")} aria-label="个人意义地图">
      <header className={uiClass("semantic-map-toolbar")}>
        <span>
          <small>PERSONAL MEANING MAP</small>
          <b>个人意义地图</b>
        </span>
        <div role="group" aria-label="地图缩放">
          <button
            type="button"
            aria-label="缩小地图"
            disabled={zoomIndex === 0}
            onClick={() => setZoomIndex((value) => Math.max(0, value - 1))}
          >−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            aria-label="放大地图"
            disabled={zoomIndex === ZOOM_LEVELS.length - 1}
            onClick={() => setZoomIndex((value) => Math.min(ZOOM_LEVELS.length - 1, value + 1))}
          >+</button>
        </div>
      </header>

      <div className={uiClass("semantic-map-legend")} aria-label="地图图例">
        <span className={uiClass("reviewed")}><i />已审核 Sense</span>
        <span className={uiClass("personal")}><i />个人意义</span>
        <span className={uiClass("relation")}><i />暂无已发布关系线</span>
      </div>

      <div className={uiClass("semantic-map-stage")}>
        <div className={uiClass("semantic-map-viewport")} tabIndex={0} aria-label="可滚动的意义地图画布">
          <div
            className={uiClass("semantic-map-scale-shell")}
            style={{ width: MAP_WIDTH * zoom, height: mapHeight * zoom }}
          >
            <div
              className={uiClass("semantic-map-canvas")}
              style={{
                width: MAP_WIDTH,
                height: mapHeight,
                transform: `scale(${zoom})`,
              }}
            >
              <span className={uiClass("semantic-map-contour contour-a")} aria-hidden="true" />
              <span className={uiClass("semantic-map-contour contour-b")} aria-hidden="true" />

              <section
                className={uiClass("semantic-map-zone reviewed-zone")}
                style={{ left: 22, top: 18, width: 576, height: reviewedHeight }}
                aria-label="学习中建立的意义区域"
              >
                <header><span>学习中建立的意义</span><small>{senses.length} 个 Sense</small></header>
                {senses.map((entry, index) => (
                  <ReviewedNode
                    key={entry.senseId}
                    entry={entry}
                    index={index}
                    selected={selected?.kind === 'sense' && selected.entry.senseId === entry.senseId}
                    onSelect={() => setSelected({ kind: 'sense', entry })}
                  />
                ))}
              </section>

              {personalLayout.zones.map((zone) => (
                <section
                  className={uiClass("semantic-map-zone personal-zone")}
                  style={{ left: zone.x, top: zone.y, width: zone.width, height: zone.height }}
                  key={zone.id}
                  aria-label={`个人区域：${zone.name}`}
                >
                  <header><span>{zone.name}</span><small>{zone.meanings.length} 个意义</small></header>
                  {zone.meanings.length === 0 && <p>等待第一个个人意义</p>}
                  {zone.meanings.map((meaning, index) => (
                    <PersonalMeaningNode
                      key={meaning.personalMeaningId}
                      meaning={meaning}
                      index={index}
                      selected={
                        selected?.kind === 'personal_meaning'
                        && selected.entry.personalMeaningId === meaning.personalMeaningId
                      }
                      onSelect={() => setSelected({ kind: 'personal_meaning', entry: meaning })}
                    />
                  ))}
                </section>
              ))}
            </div>
          </div>
        </div>

        {selected && (
          <aside className={uiClass(`semantic-map-inspector ${selected.kind}`)} aria-live="polite">
            <button type="button" onClick={() => setSelected(null)} aria-label="关闭节点预览">×</button>
            {selected.kind === 'sense' ? (
              <>
                <span><i className={uiClass(`status-${selected.entry.status}`)} />{semanticStatusLabel[selected.entry.status]}</span>
                <h3>{selected.entry.expression.formL2}</h3>
                <p>{selected.entry.ground.labelL1}</p>
                <button type="button" onClick={() => onOpenSense(selected.entry.senseId)}>查看具体意思 →</button>
              </>
            ) : (
              <>
                <span><i />我的个人意义 · {PHASE_LABELS[selected.entry.phase]}</span>
                <h3>
                  {selected.entry.familiarExpressions.map((item) => item.surfaceForm).join(' · ') || '我的经验'}
                </h3>
                <p>
                  {selected.entry.semanticAnchors[0]?.bodyText
                    || selected.entry.familiarExpressions[0]?.surfaceForm}
                </p>
                <button
                  type="button"
                  onClick={() => onOpenPersonalMeaning?.(selected.entry.personalMeaningId)}
                >
                  {selected.entry.phase === 'unclarified' ? '开始澄清 →' : '查看 / 继续澄清 →'}
                </button>
              </>
            )}
          </aside>
        )}
      </div>

      <p className={uiClass("semantic-map-boundary-note")}>
        区域来自真实来源；当前没有已发布的 Sense Relation，因此不画连线。节点位置只用于稳定排布，不表示语义距离。
      </p>
    </section>
  );
};
