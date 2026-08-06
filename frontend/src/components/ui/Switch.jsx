export default function Switch({ label, id, className = '', ...rest }) {
  return (
    <label className={`oms-switch ${className}`} htmlFor={id}>
      <input type="checkbox" id={id} {...rest} />
      <span className="oms-switch__track" aria-hidden="true" />
      {label}
    </label>
  );
}
