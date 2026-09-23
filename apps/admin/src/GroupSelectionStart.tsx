type Props = {
  label: string;
  pending: number;
  disconnected: number;
  disabled: boolean;
  onStart: (skipDisconnected: boolean) => void;
};

export function GroupSelectionStart({ label, pending, disconnected, disabled, onStart }: Props) {
  return <>
    <button className="sc-tool-button" type="button" disabled={disabled || pending > 0} onClick={() => onStart(false)}>{label}</button>
    <span>{pending > 0 ? `${pending} still need to choose (${disconnected} disconnected).` : "Everyone has chosen. Start the groups and their instructions."}</span>
    {disconnected > 0 && <>
      <button className="sc-tool-button" data-sc-tool-variant="primary" type="button" disabled={disabled || pending > disconnected} onClick={() => onStart(true)}>{label} — leave disconnected choices open</button>
      <span>Starts the chosen groups and their audio. Disconnected people without a choice can join a running group when they return.</span>
    </>}
  </>;
}
