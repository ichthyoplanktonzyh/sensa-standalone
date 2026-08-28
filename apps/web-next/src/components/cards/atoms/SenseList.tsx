import type { SenseGroup } from '../../../types';

interface SenseListProps {
  senses: SenseGroup[];
  onOpenExample: (idx: number) => void;
}

export const SenseList = ({ senses, onOpenExample }: SenseListProps) => {
  return (
    <div className="senses" id="wSenses">
      {senses.map((s, sIdx) => (
        <div key={sIdx} className="sense">
          <span className="pos">{s.pos}</span>
          {s.items.map((m, mIdx) => (
            <span
              key={mIdx}
              className="m"
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
