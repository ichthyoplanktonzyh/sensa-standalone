interface PhoneticBarProps {
  phon: string;
  onPlay: () => void;
}

export const PhoneticBar = ({ phon, onPlay }: PhoneticBarProps) => {
  return (
    <div className="phon">
      <button className="ph-b" onClick={onPlay}>
        美 <svg className="icon"><use href="#i-vol" /></svg>
      </button>
      <span className="p" id="wPhon">{phon}</span>
    </div>
  );
};
