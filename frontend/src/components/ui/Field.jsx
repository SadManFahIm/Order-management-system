import { cloneElement, forwardRef, isValidElement } from 'react';

/**
 * Field wraps any control with a label, hint, and error message.
 * Usage: <Field label="Email" error="…"> <Input … /> </Field>
 *
 * When the child has no `id`, one is derived from the label so the label
 * stays correctly associated with the control.
 */
const Field = forwardRef(function Field(
  { label, hint, error, children, className = '' },
  ref
) {
  // Respect an explicit id on the control itself; only derive one when the
  // child has none (deriving unconditionally would clobber ids like
  // `login-email` with `fld-email` and break form selectors).
  const childId = isValidElement(children) ? children.props.id : undefined;
  const derivedId =
    childId ||
    (label ? `fld-${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : undefined);

  let control = children;
  if (derivedId && !childId && isValidElement(children)) {
    control = cloneElement(children, { id: derivedId });
  }

  return (
    <div className={`oms-field ${className}`} ref={ref}>
      {label && (
        <label className="oms-field__label" htmlFor={derivedId}>
          {label}
        </label>
      )}
      {control}
      {hint && !error && <div className="oms-field__hint">{hint}</div>}
      {error && <div className="oms-field__error" role="alert">{error}</div>}
    </div>
  );
});

export default Field;
