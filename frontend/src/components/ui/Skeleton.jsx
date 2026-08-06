/**
 * Skeleton loading placeholders.
 * <Skeleton />             — 12px text line
 * <Skeleton variant="circle" width={40} height={40} />
 * <SkeletonList rows={5} /> — stacked text lines
 */
export default function Skeleton({
  variant = 'text',
  width,
  height,
  className = '',
  style,
}) {
  return (
    <span
      className={`oms-skeleton oms-skeleton--${variant} ${className}`}
      style={{ width, height, ...style }}
      aria-hidden="true"
    />
  );
}

export function SkeletonText({ lines = 3, gap = 10 }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap, width: '100%' }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '55%' : '100%'} />
      ))}
    </span>
  );
}
