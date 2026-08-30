const PAYMENT_STATUSES = new Set(['Non Pagata', 'Pagata Parzialmente', 'Pagata']);

export const documentStatusIsEditable = (kind: string): boolean => kind !== 'invoice';

export const paymentStatusLabel = (status: unknown): string => {
  const value = String(status || '').trim();
  return PAYMENT_STATUSES.has(value) ? value : 'Non Pagata';
};
