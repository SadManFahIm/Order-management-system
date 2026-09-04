export default function Logo({ compact = false, mark = 'O' }) {
  return (
    <span className="oms-logo">
      <span className="oms-logo__mark">{mark.slice(0, 3)}</span>
      {!compact && <span>Orderly</span>}
    </span>
  );
}
