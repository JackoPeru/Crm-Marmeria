import type { FC, ReactNode } from 'react';

export interface ModalProps {
  isOpen?: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl';
  wide?: boolean;
  closeLabel?: string;
  overlayClassName?: string;
  panelClassName?: string;
  showHeader?: boolean;
  variant?: 'default' | 'unstyled';
}

declare const Modal: FC<ModalProps>;

export default Modal;
