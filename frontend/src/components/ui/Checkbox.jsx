export default function Checkbox({ label, id, className = '', ...rest }) {
  return (
    <label className={`oms-check ${className}`} htmlFor={id}>
      <input type="checkbox" id={id} {...rest} />
      {label}
    </label>
  );
}
