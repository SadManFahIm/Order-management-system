export default function PageHeader({ title, desc, actions, children }) {
  return (
    <div className="oms-page__header">
      <div>
        <h1 className="oms-page__title">{title}</h1>
        {desc && <p className="oms-page__desc">{desc}</p>}
        {children}
      </div>
      {actions && <div className="oms-page__actions">{actions}</div>}
    </div>
  );
}
