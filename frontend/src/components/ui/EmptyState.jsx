export default function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}) {
  return (
    <div className={`oms-empty ${className}`}>
      {icon && <span className="oms-empty__icon">{icon}</span>}
      {title && <div className="oms-empty__title">{title}</div>}
      {description && <div className="oms-empty__desc">{description}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}
