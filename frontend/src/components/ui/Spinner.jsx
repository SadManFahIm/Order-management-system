export default function Spinner({ size = 18, className = '', style }) {
  return (
    <span
      className={`oms-btn__spinner ${className}`}
      style={{ width: size, height: size, ...style }}
      aria-hidden="true"
    />
  );
}
