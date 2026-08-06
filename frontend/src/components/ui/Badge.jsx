export default function Badge({ tone = 'neutral', children, className = '' }) {
  return (
    <span className={`oms-badge oms-badge--${tone} ${className}`}>
      {children}
    </span>
  );
}
