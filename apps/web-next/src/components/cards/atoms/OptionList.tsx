import type { Option } from '../../../types';

interface OptionListProps {
  options: Option[];
  answering: boolean;
  selectedIdx: number | null;
  onPick: (index: number) => void;
}

export const OptionList = ({
  options,
  answering,
  selectedIdx,
  onPick,
}: OptionListProps) => {
  return (
    <div className="opts" id="wOpts">
      {options.map((o, idx) => {
        let optClass = 'opt';
        if (answering) {
          if (selectedIdx === idx) {
            optClass += o.ok ? ' right' : ' wrong';
          } else if (!o.ok) {
            optClass += ' mute';
          } else if (selectedIdx !== null && selectedIdx >= 0 && !options[selectedIdx]?.ok && o.ok) {
            optClass += ' right';
          } else if (selectedIdx === -1 && o.ok) {
            optClass += ' right';
          }
        }

        return (
          <button
            key={idx}
            className={optClass}
            onClick={() => onPick(idx)}
          >
            <div className="p">{o.pos}</div>
            <div className="m">{o.text}</div>
          </button>
        );
      })}
    </div>
  );
};
