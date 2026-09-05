import { uiClass } from '../../../ui/classes';
export const MaskedSenses = () => {
  return (
    <div className={uiClass("masked-senses", "#wMaskedSenses")} id="wMaskedSenses">
      <div className={uiClass("mask-bar bar1")} />
      <div className={uiClass("mask-bar bar2")} />
    </div>
  );
};
