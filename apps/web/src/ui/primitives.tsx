import type { ReactElement, ReactNode } from "react";
import { Icon, IconButton } from "./icons";
import type { SensaExampleAsset } from "./assets";

/**
 * The target form is highlighted from the asset's own offsets, which
 * `resolveActionView` has already checked against `targetForm`. Slicing the
 * immutable text is what keeps the highlight honest for an inflected form.
 */
export function Sentence({ example }: Readonly<{ example: SensaExampleAsset }>): ReactElement {
  const text = example.textL2;
  return (
    <>
      {text.slice(0, example.targetStart)}
      <mark>{text.slice(example.targetStart, example.targetEnd)}</mark>
      {text.slice(example.targetEnd)}
    </>
  );
}

export function maskedSentence(masked: string): ReactElement {
  const at = masked.indexOf("____");
  if (at < 0) return <>{masked}</>;
  return (
    <>
      {masked.slice(0, at)}
      <span className="cloze-blank" aria-label="需要填入的词" />
      {masked.slice(at + 4)}
    </>
  );
}

export function UtilityHead(props: Readonly<{
  title: string;
  onBack: () => void;
  action?: ReactNode;
}>): ReactElement {
  return (
    <header className="utility-head">
      <IconButton name="chevron" label="返回" onClick={props.onBack} />
      <h1>{props.title}</h1>
      {props.action ?? <span />}
    </header>
  );
}

export function SettingRow(props: Readonly<{
  label: string;
  value?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}>): ReactElement {
  return (
    <button
      type="button"
      className="setting-row"
      onClick={props.onClick}
      disabled={props.disabled === true || props.onClick === undefined}
    >
      <b>{props.label}</b>
      <span className="row-value">{props.value}</span>
    </button>
  );
}

export function Switch({ on }: Readonly<{ on: boolean }>): ReactElement {
  return <span className={`switch${on ? " on" : ""}`} aria-hidden="true"><i /></span>;
}

export function Toast({ text }: Readonly<{ text: string }>): ReactElement {
  return <div className="toast" role="status">{text}</div>;
}

export function BusyVeil(): ReactElement {
  return <div className="busy-veil" aria-hidden="true"><i /></div>;
}

export function Diagnostic(props: Readonly<{
  title: string;
  children: ReactNode;
}>): ReactElement {
  return (
    <div className="diagnostic">
      <strong>{props.title}</strong>
      {props.children}
    </div>
  );
}

export function AudioPill(props: Readonly<{
  label: string;
  playing: boolean;
  loading: boolean;
  onClick: () => void;
}>): ReactElement {
  return (
    <button
      type="button"
      className={`audio-pill${props.playing ? " playing" : ""}${props.loading ? " loading" : ""}`}
      onClick={props.onClick}
      aria-label={`${props.playing ? "暂停" : "播放"}${props.label}`}
    >
      <Icon name={props.playing ? "pause" : "volume"} />
      <span>{props.label}</span>
    </button>
  );
}
