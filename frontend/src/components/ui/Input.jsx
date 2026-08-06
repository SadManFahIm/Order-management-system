import { forwardRef } from 'react';

const Input = forwardRef(function Input({ invalid = false, className = '', ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={`oms-input ${className}`}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

export default Input;
