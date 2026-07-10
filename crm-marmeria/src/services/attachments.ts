import { apiClient } from './api';

export interface AttachmentRecord {
  id: string;
  entityType: string;
  entityId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdBy?: string;
  createdAt: string;
}

export const attachmentsService = {
  async list(entityType: string, entityId: string): Promise<AttachmentRecord[]> {
    const response = await apiClient.get(`/entity-attachments/${entityType}/${entityId}`);
    return response.data || [];
  },

  async upload(entityType: string, entityId: string, files: FileList | File[]): Promise<AttachmentRecord[]> {
    const form = new FormData();
    Array.from(files).forEach((file) => form.append('files', file));
    const response = await apiClient.post(`/entity-attachments/${entityType}/${entityId}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
    return response.data || [];
  },

  async download(attachment: AttachmentRecord): Promise<void> {
    const response = await apiClient.get(`/attachments/file/${attachment.id}`, { responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.originalName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  async remove(id: string): Promise<void> {
    await apiClient.delete(`/attachments/file/${id}`);
  },
};
