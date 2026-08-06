export default function Card({ title, subtitle, actions, footer, children, hover = false, bodyPadding = true, className = '' }) {
  return (
    <div className={`oms-card ${hover ? 'oms-card--hover' : ''} ${className}`}>
      {(title || actions) && (
        <div className="oms-card__header">
          <div>
            {title && <div className="oms-card__title">{title}</div>}
            {subtitle && <div className="oms-card__subtitle">{subtitle}</div>}
          </div>
          {actions}
        </div>
      )}
      <div className={bodyPadding ? 'oms-card__body' : 'oms-card__body oms-card__body--flush'}>
        {children}
      </div>
      {footer && <div className="oms-card__footer">{footer}</div>}
    </div>
  );
}
