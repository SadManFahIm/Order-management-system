import { Link } from 'react-router-dom';
import Spinner from './Spinner';

/**
 * Button with design-system variants.
 * - variant: primary | secondary | outline | ghost | danger | dangerGhost
 * - size: sm | md | lg
 * - loading: shows a spinner and disables
 * - to: renders as a react-router Link instead of a button
 */
export default function Button({
  children,
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled = false,
  to,
  type = 'button',
  className = '',
  icon,
  ...rest
}) {
  const classes = [
    'oms-btn',
    variant !== 'secondary' ? `oms-btn--${variant}` : '',
    size !== 'md' ? `oms-btn--${size}` : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const inner = (
    <>
      {loading ? <Spinner /> : icon}
      {children}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={classes} {...rest}>
        {inner}
      </Link>
    );
  }

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {inner}
    </button>
  );
}
