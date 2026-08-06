import { forwardRef } from 'react';

const Select = forwardRef(function Select({ className = '', children, ...rest }, ref) {
  return (
    <select ref={ref} className={`oms-select ${className}`} {...rest}>
      {children}
    </select>
  );
});

export default Select;
