import { uiClass } from '../../../ui/classes';
interface PhoneticBarProps {
  phon: string;
  onPlay: () => void;
}

export const PhoneticBar = ({ phon, onPlay }: PhoneticBarProps) => {
  return (
    <div className={uiClass("phon")}>
      <button className={uiClass("ph-b")} onClick={onPlay}>
        美 <svg className={uiClass("icon")}><use href="#i-vol" /></svg>
      </button>
      <span className={uiClass("p", "#wPhon")} id="wPhon">{phon}</span>
    </div>
  );
};
