import { forwardRef } from 'react';

const Textarea = forwardRef(function Textarea({ invalid = false, className = '', ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={`oms-textarea ${className}`}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

export default Textarea;
