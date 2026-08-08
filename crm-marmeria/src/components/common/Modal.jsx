import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
};
let openModalCount = 0;
let previousBodyOverflow = '';
const openModalStack = [];

const Modal = ({
  isOpen = true,
  onClose,
  title,
  children,
  size = 'md',
  wide = false,
  closeLabel = 'Chiudi',
  overlayClassName = '',
  panelClassName = '',
  showHeader = true,
  variant = 'default',
}) => {
  const titleId = useId();
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      if (openModalStack[openModalStack.length - 1] !== dialogRef) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    openModalStack.push(dialogRef);
    return () => {
      const index = openModalStack.lastIndexOf(dialogRef);
      if (index >= 0) openModalStack.splice(index, 1);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    if (openModalCount === 0) previousBodyOverflow = document.body.style.overflow;
    openModalCount += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) document.body.style.overflow = previousBodyOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const panelAppearance = variant === 'unstyled'
    ? 'bg-transparent shadow-none'
    : 'rounded-lg bg-white p-6 shadow-xl dark:bg-dark-card';
  const bodyClassName = 'min-h-0 flex-1 overflow-y-auto';
  const maxWidth = wide ? 'max-w-6xl' : (sizeClasses[size] || sizeClasses.md);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-2 backdrop-blur-sm sm:p-4 ${overlayClassName}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        data-crm-modal="true"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`my-auto flex w-full min-h-0 max-h-[calc(100vh-2rem)] flex-col ${maxWidth} ${panelAppearance} ${panelClassName}`}
        style={{ maxHeight: 'calc(100dvh - 2rem)' }}
      >
        {showHeader ? (
          <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
            <h2 id={titleId} className="text-xl font-semibold text-gray-800 dark:text-white">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="shrink-0 rounded p-1 text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-light-primary dark:text-gray-400 dark:hover:text-gray-200"
            >
              <X size={24} />
            </button>
          </div>
        ) : (
          <h2 id={titleId} className="sr-only">{title}</h2>
        )}
        <div className={bodyClassName}>{children}</div>
      </div>
    </div>
  );
};

export default Modal;
