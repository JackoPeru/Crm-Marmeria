import api from './api';
import { cacheService } from './cache';
import toast from 'react-hot-toast';

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  type: 'Azienda' | 'Privato';
  clientType?: 'Azienda' | 'Privato';
  vatNumber?: string;
  fiscalCode?: string;
  notes?: string;
  version?: number;
  _queued?: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface CreateClientRequest {
  name: string;
  email: string;
  phone: string;
  address: string;
  type: 'Azienda' | 'Privato';
  clientType?: 'Azienda' | 'Privato';
  vatNumber?: string;
  fiscalCode?: string;
  notes?: string;
  version?: number;
}

const normalizeClient = (client: any): Client => ({
  ...client,
  id: String(client.id),
  type: client.clientType || (client.type === 'Azienda' || client.type === 'Privato' ? client.type : 'Privato'),
  clientType: client.clientType || (client.type === 'Azienda' || client.type === 'Privato' ? client.type : undefined),
});
const payloadWithClientType = <T extends Partial<CreateClientRequest>>(data: T): T & { clientType?: string } => ({
  ...data,
  clientType: data.type || data.clientType,
});

class ClientsService {
  private readonly CACHE_TTL = 30 * 60 * 1000;

  async getClients(): Promise<Client[]> {
    try {
      const response = await api.get<Client[]>('/clients');
      const clients = response.data.map(normalizeClient);
      await cacheService.set('customers', 'all', clients, this.CACHE_TTL);
      return clients;
    } catch (error: any) {
      const cached = await cacheService.get<Client[]>('customers', 'all');
      if ((error.code === 'ERR_NETWORK' || !error.response) && cached) return cached.map(normalizeClient);
      throw error;
    }
  }

  async getClient(id: string): Promise<Client> {
    try {
      const response = await api.get<Client>(`/clients/${String(id)}`);
      const client = normalizeClient(response.data);
      await cacheService.set('customers', String(id), client, this.CACHE_TTL);
      return client;
    } catch (error: any) {
      const cached = await cacheService.get<Client>('customers', String(id));
      if ((error.code === 'ERR_NETWORK' || !error.response) && cached) return normalizeClient(cached);
      throw error;
    }
  }

  async createClient(data: CreateClientRequest): Promise<Client> {
    const response = await api.post<Client>('/clients', payloadWithClientType(data));
    const client = normalizeClient(response.data);
    await cacheService.delete('customers', 'all');
    if (response.status !== 202) toast.success('Cliente creato con successo');
    return client;
  }

  async updateClient(id: string, data: Partial<CreateClientRequest>): Promise<Client> {
    const response = await api.put<Client>(`/clients/${String(id)}`, {
      ...payloadWithClientType(data),
      expectedVersion: data.version,
    });
    const client = normalizeClient(response.data);
    await cacheService.set('customers', String(id), client, this.CACHE_TTL);
    await cacheService.delete('customers', 'all');
    if (response.status !== 202) toast.success('Cliente aggiornato con successo');
    return client;
  }

  async deleteClient(id: string): Promise<void> {
    await api.delete(`/clients/${String(id)}`);
    await cacheService.delete('customers', String(id));
    await cacheService.delete('customers', 'all');
    toast.success('Cliente eliminato con successo');
  }

  async searchClients(query: string): Promise<Client[]> {
    try {
      const response = await api.get<Client[]>('/clients/search', { params: { q: query } });
      return response.data.map(normalizeClient);
    } catch (error: any) {
      const cached = await cacheService.get<Client[]>('customers', 'all');
      if ((error.code === 'ERR_NETWORK' || !error.response) && cached) {
        const normalized = cached.map(normalizeClient);
        const q = query.toLowerCase();
        return normalized.filter((client) => client.name.toLowerCase().includes(q) || client.email.toLowerCase().includes(q));
      }
      throw error;
    }
  }

  async getClientsStats(): Promise<{ total: number; byType: Record<string, number>; recentlyAdded: number }> {
    const clients = await this.getClients();
    const byType = clients.reduce<Record<string, number>>((result, client) => {
      result[client.type] = (result[client.type] || 0) + 1;
      return result;
    }, {});
    return {
      total: clients.length,
      byType,
      recentlyAdded: clients.filter((client) => new Date(client.createdAt).getTime() > Date.now() - 604800000).length,
    };
  }

  async clearCache(): Promise<void> {
    await cacheService.clear('customers');
  }
}

export const clientsService = new ClientsService();
export default clientsService;
