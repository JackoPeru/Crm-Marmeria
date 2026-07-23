export const createId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const values = new Uint32Array(2);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(values);
  } else {
    values[0] = Math.floor(Math.random() * 0xFFFFFFFF);
    values[1] = Math.floor(Math.random() * 0xFFFFFFFF);
  }
  return `crm-${Date.now().toString(36)}-${values[0].toString(36)}${values[1].toString(36)}`;
};
