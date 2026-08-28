interface FooterButton {
  label: string;
  color: 'red' | 'green' | 'orange' | 'amber' | 'yellow';
  onClick: () => void;
}

interface FooterBarProps {
  buttons: FooterButton[];
}

export const FooterBar = ({ buttons }: FooterBarProps) => {
  const layoutClass = buttons.length === 3 ? ' three-up' : buttons.length === 2 ? ' two-up' : '';

  return (
    <div className={`lfoot${layoutClass}`} id="lFoot">
      {buttons.map((btn, idx) => (
        <button
          key={idx}
          className={`fbtn ${btn.color}`}
          onClick={btn.onClick}
        >
          {btn.label}
          <i />
        </button>
      ))}
    </div>
  );
};
