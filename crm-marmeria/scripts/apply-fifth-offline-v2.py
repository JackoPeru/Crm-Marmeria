from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def ensure_replace(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if new in text:
        return
    if old not in text:
        raise RuntimeError(f'Pattern not found in {path}: {old[:180]!r}')
    path.write_text(text.replace(old, new, 1))


def replace_return_after(path: Path, marker: str, replacement: str) -> None:
    text = path.read_text()
    if replacement.strip() in text:
        return
    marker_index = text.index(marker)
    target = 'return response.data;'
    target_index = text.index(target, marker_index)
    line_start = text.rfind('\n', 0, target_index) + 1
    indent = text[line_start:target_index]
    rendered = '\n'.join(indent + line if line else '' for line in replacement.splitlines())
    path.write_text(text[:line_start] + rendered + text[target_index + len(target):])


optimistic = ROOT / 'src/services/optimisticMutation.ts'
optimistic.write_text(r'''const cleanMutationUrl = (value: string) => String(value || '').split(/[?#]/, 1)[0].replace(/\/$/, '');

export const mutationResourceId = (url: string, data?: unknown): string => {
  if (data && typeof data === 'object' && !Array.isArray(data) && (data as any).id != null) {
    return String((data as any).id);
  }
  const segments = cleanMutationUrl(url).split('/').filter(Boolean);
  if (segments.at(-1) === 'status' && segments.length >= 2) return String(segments.at(-2));
  return String(segments.at(-1) || '');
};

export const buildOptimisticMutation = (url: string, data?: unknown) => ({
  ...(data && typeof data === 'object' && !Array.isArray(data) ? data : {}),
  id: mutationResourceId(url, data),
  _queued: true,
});

export const mergeOptimisticEntity = <T extends Record<string, any>>(
  current: Partial<T> | null | undefined,
  requested: Partial<T> | null | undefined,
  response: Partial<T> | null | undefined,
  id: string,
): T => ({
  ...(current || {}),
  ...(requested || {}),
  ...(response || {}),
  id: String(id),
} as T);
''')

(ROOT / 'src/services/optimisticMutation.test.ts').write_text(r'''import { describe, expect, it } from 'vitest';
import {
  buildOptimisticMutation,
  mergeOptimisticEntity,
  mutationResourceId,
} from './optimisticMutation';

describe('optimistic offline mutations', () => {
  it('uses the order id instead of the status suffix', () => {
    expect(mutationResourceId('/orders/ordine-123/status', { status: 'Completato' }))
      .toBe('ordine-123');
    expect(buildOptimisticMutation('/orders/ordine-123/status', { status: 'Completato' }))
      .toMatchObject({ id: 'ordine-123', status: 'Completato', _queued: true });
  });

  it('keeps a client-generated id for offline creates', () => {
    expect(mutationResourceId('/orders', { id: 'ordine-locale', title: 'Scala' }))
      .toBe('ordine-locale');
  });

  it('merges a queued patch without deleting existing fields', () => {
    const merged = mergeOptimisticEntity(
      { id: '1', title: 'Piano cucina', clientName: 'Rossi', version: 3 },
      { status: 'Completato' },
      { status: 'Completato', _queued: true },
      '1',
    );
    expect(merged).toEqual({
      id: '1',
      title: 'Piano cucina',
      clientName: 'Rossi',
      version: 3,
      status: 'Completato',
      _queued: true,
    });
  });
});
''')

api = ROOT / 'src/services/api.ts'
ensure_replace(api, "import { bindRequestToScope, queueScopesEqual } from './requestScope';\n", "import { bindRequestToScope, queueScopesEqual } from './requestScope';\nimport { buildOptimisticMutation } from './optimisticMutation';\n")
ensure_replace(
    api,
    """            const optimistic = {
              ...(typeof data === 'object' && data ? data : {}),
              id: (data as any)?.id || url.split('/').filter(Boolean).pop(),
              _queued: true,
            };
""",
    """            const optimistic = buildOptimisticMutation(url, data);
""",
)

clients = ROOT / 'src/services/clients.ts'
ensure_replace(
    clients,
    """  async updateClient(id: string, data: Partial<CreateClientRequest>): Promise<Client> {
    const response = await api.put<Client>(`/clients/${String(id)}`, {
      ...payloadWithClientType(data),
      expectedVersion: data.version,
    });
    const client = normalizeClient(response.data);
""",
    """  async updateClient(id: string, data: Partial<CreateClientRequest>): Promise<Client> {
    const direct = await cacheService.get<Client>('customers', String(id));
    const cachedList = direct ? null : await cacheService.get<Client[]>('customers', 'all');
    const current = direct || cachedList?.find((item) => String(item.id) === String(id));
    const requested = payloadWithClientType(data);
    const response = await api.put<Client>(`/clients/${String(id)}`, {
      ...requested,
      expectedVersion: data.version,
    });
    const client = normalizeClient({
      ...(current || {}),
      ...requested,
      ...response.data,
      id: String(id),
    });
""",
)

orders = ROOT / 'src/services/orders.ts'
ensure_replace(orders, "import toast from 'react-hot-toast';\n", "import toast from 'react-hot-toast';\nimport { mergeOptimisticEntity } from './optimisticMutation';\n")
ensure_replace(
    orders,
    """  async updateOrder(id: string, orderData: Partial<CreateOrderRequest>): Promise<Order> {
    const version = await this.requiredVersion(id, orderData.version);
    const response = await api.patch<Order>(`/orders/${encodeURIComponent(String(id))}`, {
      ...orderData,
      version,
      expectedVersion: version,
    });
    const order = response.data;
""",
    """  async updateOrder(id: string, orderData: Partial<CreateOrderRequest>): Promise<Order> {
    const version = await this.requiredVersion(id, orderData.version);
    const current = await this.cachedOrder(id);
    const requested = { ...orderData, version, expectedVersion: version };
    const response = await api.patch<Order>(`/orders/${encodeURIComponent(String(id))}`, requested);
    const order = mergeOptimisticEntity<Order>(current, orderData, response.data, String(id));
""",
)
ensure_replace(
    orders,
    """    const version = await this.requiredVersion(id, suppliedVersion);
    const response = await api.patch<Order>(
      `/orders/${encodeURIComponent(String(id))}/status`,
      { status, version, expectedVersion: version },
    );
    const order = response.data;
""",
    """    const version = await this.requiredVersion(id, suppliedVersion);
    const current = await this.cachedOrder(id);
    const requested = { status, version, expectedVersion: version };
    const response = await api.patch<Order>(
      `/orders/${encodeURIComponent(String(id))}/status`,
      requested,
    );
    const order = mergeOptimisticEntity<Order>(current, { status }, response.data, String(id));
""",
)

materials = ROOT / 'src/store/slices/materialsSlice.ts'
ensure_replace(
    materials,
    """    try {
      const version = Number(data.version);
""",
    """    try {
      const direct = await cacheService.get<Material>('materials', id);
      const cachedList = direct ? null : await cacheService.get<Material[]>('materials', 'all');
      const current = direct || cachedList?.find((item) => String(item.id) === String(id));
      const version = Number(data.version);
""",
)
replace_return_after(
    materials,
    "if (response.status !== 202) toast.success('Materiale aggiornato con successo');",
    """return {
  ...(current || {}),
  ...data,
  ...response.data,
  id: String(id),
} as Material;""",
)
ensure_replace(
    materials,
    """      if (index !== -1) {
        state.items[index] = action.payload;
      }
      
      // Aggiorna anche il materiale selezionato se corrisponde
      if (state.selectedMaterial?.id === action.payload.id) {
        state.selectedMaterial = action.payload;
      }
""",
    """      if (index !== -1) {
        state.items[index] = { ...state.items[index], ...action.payload };
      }
      
      // Aggiorna anche il materiale selezionato se corrisponde
      if (state.selectedMaterial?.id === action.payload.id) {
        state.selectedMaterial = { ...state.selectedMaterial, ...action.payload };
      }
""",
)
ensure_replace(
    materials,
    """        if (index !== -1) {
          state.items[index] = action.payload;
        }
        
        if (state.selectedMaterial?.id === action.payload.id) {
          state.selectedMaterial = action.payload;
        }
""",
    """        if (index !== -1) {
          state.items[index] = { ...state.items[index], ...action.payload };
        }
        
        if (state.selectedMaterial?.id === action.payload.id) {
          state.selectedMaterial = { ...state.selectedMaterial, ...action.payload };
        }
""",
)
