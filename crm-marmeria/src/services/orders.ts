import api from './api';
import { cacheService } from './cache';
import toast from 'react-hot-toast';

export interface Order {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  description?: string;
  type?: 'order' | 'quote' | 'invoice';
  status: 'Preventivo' | 'In Attesa' | 'In Lavorazione' | 'Completato' | 'Annullato';
  priority: 'Bassa' | 'Media' | 'Alta' | 'Urgente';
  startDate: string;
  endDate: string;
  deliveryDate?: string;
  estimatedDelivery?: string;
  actualDelivery?: string;
  amount: number;
  materials: OrderMaterial[];
  notes?: string;
  version?: number;
  _queued?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrderMaterial {
  id: string;
  materialId: string;
  materialName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
}

export interface CreateOrderRequest {
  clientId: string;
  title: string;
  description?: string;
  type?: Order['type'];
  status: Order['status'];
  priority: Order['priority'];
  startDate: string;
  endDate: string;
  estimatedDelivery?: string;
  amount: number;
  materials: Omit<OrderMaterial, 'id'>[];
  notes?: string;
  version?: number;
}

export interface UpdateOrderRequest extends Partial<CreateOrderRequest> {
  id: string;
}

export interface OrderStatus {
  id: string;
  status: Order['status'];
  eta: string | null;
  clientName: string;
  title: string;
  priority: Order['priority'];
  completionPercentage: number;
  delaysCount: number;
  lastUpdate: string;
}

const isNetworkFailure = (error: any) => (
  error?.code === 'ERR_NETWORK'
  || error?.code === 'ECONNABORTED'
  || !error?.response
);

const safeText = (value: unknown) => String(value ?? '').toLowerCase();

class OrdersService {
  private readonly CACHE_TTL = 3 * 60 * 1000;

  private notifyOfflineReadOnly() {
    const previous = Number(localStorage.getItem('lastOfflineToast') || 0);
    if (Date.now() - previous <= 30000) return;
    toast.error('Sei offline – dati in sola lettura', {
      duration: 5000,
      id: 'offline-mode',
    });
    localStorage.setItem('lastOfflineToast', String(Date.now()));
  }

  private async cachedOrder(id: string): Promise<Order | null> {
    const direct = await cacheService.get<Order>('orders', String(id));
    if (direct) return direct;
    const all = await cacheService.get<Order[]>('orders', 'all');
    return all?.find((order) => String(order.id) === String(id)) || null;
  }

  private async requiredVersion(id: string, supplied?: number): Promise<number> {
    if (Number.isFinite(supplied)) return Number(supplied);
    const cached = await this.cachedOrder(id);
    if (Number.isFinite(cached?.version)) return Number(cached?.version);

    try {
      const current = await this.getOrder(id);
      if (Number.isFinite(current.version)) return Number(current.version);
    } catch {
      // Il messaggio seguente spiega l'azione necessaria anche in modalità offline.
    }
    throw new Error('Versione ordine non disponibile. Ricarica l’ordine prima di modificarlo.');
  }

  async getOrders(): Promise<Order[]> {
    try {
      const response = await api.get<Order[]>('/orders');
      const orders = response.data || [];
      await cacheService.set('orders', 'all', orders, this.CACHE_TTL);
      await Promise.all(orders.map((order) => (
        cacheService.set('orders', String(order.id), order, this.CACHE_TTL)
      )));
      return orders;
    } catch (error: any) {
      const cached = await cacheService.get<Order[]>('orders', 'all');
      if (isNetworkFailure(error) && cached) {
        this.notifyOfflineReadOnly();
        return cached;
      }
      throw error;
    }
  }

  async getOrder(id: string): Promise<Order> {
    const encodedId = encodeURIComponent(String(id));
    try {
      const response = await api.get<Order>(`/orders/${encodedId}`);
      await cacheService.set('orders', String(id), response.data, this.CACHE_TTL);
      return response.data;
    } catch (error: any) {
      const cached = await this.cachedOrder(id);
      if (isNetworkFailure(error) && cached) {
        this.notifyOfflineReadOnly();
        return cached;
      }
      throw error;
    }
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    const encodedId = encodeURIComponent(String(orderId));
    try {
      const response = await api.get<OrderStatus>(`/orders/${encodedId}/status`);
      await cacheService.set('orders', `status_${orderId}`, response.data, 60000);
      return response.data;
    } catch (error: any) {
      if (isNetworkFailure(error)) {
        const cachedStatus = await cacheService.get<OrderStatus>('orders', `status_${orderId}`);
        if (cachedStatus) return cachedStatus;
        const cachedOrder = await this.cachedOrder(orderId);
        if (cachedOrder) return this.calculateOrderStatusFromOrder(cachedOrder);
      }
      throw error;
    }
  }

  async createOrder(orderData: CreateOrderRequest): Promise<Order> {
    const response = await api.post<Order>('/orders', orderData);
    const order = response.data;
    await this.invalidateCache();
    await cacheService.set('orders', String(order.id), order, this.CACHE_TTL);
    if (response.status !== 202) toast.success('Ordine creato con successo');
    return order;
  }

  async updateOrder(id: string, orderData: Partial<CreateOrderRequest>): Promise<Order> {
    const version = await this.requiredVersion(id, orderData.version);
    const response = await api.patch<Order>(`/orders/${encodeURIComponent(String(id))}`, {
      ...orderData,
      version,
      expectedVersion: version,
    });
    const order = response.data;
    await cacheService.set('orders', String(id), order, this.CACHE_TTL);
    await this.invalidateCache();
    if (response.status !== 202) toast.success('Ordine aggiornato con successo');
    return order;
  }

  async updateOrderStatus(
    id: string,
    status: Order['status'],
    suppliedVersion?: number,
  ): Promise<Order> {
    const version = await this.requiredVersion(id, suppliedVersion);
    const response = await api.patch<Order>(
      `/orders/${encodeURIComponent(String(id))}/status`,
      { status, version, expectedVersion: version },
    );
    const order = response.data;
    await cacheService.set('orders', String(id), order, this.CACHE_TTL);
    await this.invalidateCache();
    if (response.status !== 202) toast.success(`Stato ordine aggiornato a: ${status}`);
    return order;
  }

  async deleteOrder(id: string, suppliedVersion?: number): Promise<void> {
    const version = await this.requiredVersion(id, suppliedVersion);
    const response = await api.delete(`/orders/${encodeURIComponent(String(id))}`, {
      headers: { 'If-Match': String(version) },
    });
    await cacheService.delete('orders', String(id));
    await cacheService.delete('orders', `status_${id}`);
    await this.invalidateCache();
    if (response.status !== 202) toast.success('Ordine eliminato con successo');
  }

  async searchOrders(query: string): Promise<Order[]> {
    try {
      const response = await api.get<Order[]>('/orders/search', { params: { q: query } });
      return response.data;
    } catch (error: any) {
      const cached = await cacheService.get<Order[]>('orders', 'all');
      if (isNetworkFailure(error) && cached) {
        this.notifyOfflineReadOnly();
        const normalized = safeText(query);
        return cached.filter((order) => [
          order.title,
          order.clientName,
          order.status,
        ].some((value) => safeText(value).includes(normalized)));
      }
      throw error;
    }
  }

  async getOrdersByStatus(status: Order['status']): Promise<Order[]> {
    try {
      const response = await api.get<Order[]>(
        `/orders/by-status/${encodeURIComponent(status)}`,
      );
      return response.data;
    } catch (error: any) {
      const cached = await cacheService.get<Order[]>('orders', 'all');
      if (isNetworkFailure(error) && cached) {
        this.notifyOfflineReadOnly();
        return cached.filter((order) => order.status === status);
      }
      throw error;
    }
  }

  private calculateOrderStatusFromOrder(order: Order): OrderStatus {
    const now = new Date();
    const endDate = new Date(order.endDate);
    const startDate = new Date(order.startDate);
    let completionPercentage = 0;

    if (order.status === 'In Attesa') completionPercentage = 10;
    if (order.status === 'In Lavorazione') {
      const duration = endDate.getTime() - startDate.getTime();
      const elapsed = now.getTime() - startDate.getTime();
      completionPercentage = duration > 0 && Number.isFinite(duration)
        ? Math.min(90, Math.max(10, (elapsed / duration) * 80 + 10))
        : 50;
    }
    if (order.status === 'Completato') completionPercentage = 100;

    let eta: string | null = null;
    if (order.status === 'In Lavorazione' && order.estimatedDelivery) {
      eta = order.estimatedDelivery;
    } else if (order.status === 'Completato' && order.actualDelivery) {
      eta = order.actualDelivery;
    }

    return {
      id: order.id,
      status: order.status,
      eta,
      clientName: order.clientName,
      title: order.title,
      priority: order.priority,
      completionPercentage: Math.round(completionPercentage),
      delaysCount: Number.isFinite(endDate.getTime())
        && endDate < now
        && order.status !== 'Completato'
        ? 1
        : 0,
      lastUpdate: order.updatedAt,
    };
  }

  private async invalidateCache(): Promise<void> {
    await cacheService.delete('orders', 'all');
    await cacheService.delete('orders', 'stats');
  }

  async getOrdersStats(): Promise<{
    total: number;
    byStatus: Record<Order['status'], number>;
    totalValue: number;
    pendingDeliveries: number;
  }> {
    const orders = await this.getOrders();
    const stats = this.calculateStatsFromOrders(orders);
    await cacheService.set('orders', 'stats', stats, this.CACHE_TTL);
    return stats;
  }

  private calculateStatsFromOrders(orders: Order[]) {
    const byStatus: Record<Order['status'], number> = {
      Preventivo: 0,
      'In Attesa': 0,
      'In Lavorazione': 0,
      Completato: 0,
      Annullato: 0,
    };
    let totalValue = 0;
    let pendingDeliveries = 0;

    for (const order of orders) {
      if (order.status in byStatus) byStatus[order.status] += 1;
      totalValue += Number(order.amount) || 0;
      if (['In Lavorazione', 'In Attesa'].includes(order.status)) pendingDeliveries += 1;
    }
    return { total: orders.length, byStatus, totalValue, pendingDeliveries };
  }

  async clearCache(): Promise<void> {
    await cacheService.clear('orders');
  }
}

export const ordersService = new OrdersService();
export default ordersService;
