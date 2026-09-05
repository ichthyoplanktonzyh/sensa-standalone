import { uiClass } from '../../../ui/classes';
import type { SenseGroup } from '../../../types';

interface SenseListProps {
  senses: SenseGroup[];
  onOpenExample: (idx: number) => void;
}

export const SenseList = ({ senses, onOpenExample }: SenseListProps) => {
  return (
    <div className={uiClass("senses", "#wSenses")} id="wSenses">
      {senses.map((s, sIdx) => (
        <div key={sIdx} className={uiClass("sense")}>
          <span className={uiClass("pos")}>{s.pos}</span>
          {s.items.map((m, mIdx) => (
            <span
              key={mIdx}
              className={uiClass("m")}
              onClick={() => onOpenExample(mIdx)}
              title="点击查看该释义例句卡片"
            >
              {m}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
};
