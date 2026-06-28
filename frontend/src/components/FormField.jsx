import { forwardRef, useId } from 'react';

/**
 * FormField — label + input/select/textarea with consistent spacing.
 *
 * @param {string}  label         — displayed label text
 * @param {string}  htmlFor       — explicit id (auto-generated if omitted)
 * @param {string}  type          — input type (default 'text')
 * @param {string}  as            — override element: 'input' | 'select' | 'textarea'
 * @param {object}  fieldProps    — spread onto the input/select/textarea
 * @param {string}  className     — extra classes on the wrapper
 */
const FormField = forwardRef(function FormField(
  { label, htmlFor, type = 'text', as = 'input', fieldProps = {}, className = '', children },
  ref,
) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  const Component = as;
  const { className: extraClass = '', ...restProps } = fieldProps;
  const baseInputClass =
    'w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-base outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20';

  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <Component
        ref={ref}
        id={id}
        type={Component === 'input' ? type : undefined}
        className={`${baseInputClass}${extraClass ? ` ${extraClass}` : ''}`}
        {...restProps}
      >
        {children}
      </Component>
    </div>
  );
});

export default FormField;
