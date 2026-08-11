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
  caption?: string;
  includeInExport?: boolean;
  sortOrder?: number;
}

export const attachmentsService = {
  async list(entityType: string, entityId: string): Promise<AttachmentRecord[]> {
    const response = await apiClient.get(
      `/entity-attachments/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
    );
    return response.data || [];
  },

  async upload(
    entityType: string,
    entityId: string,
    files: FileList | File[],
  ): Promise<AttachmentRecord[]> {
    const form = new FormData();
    Array.from(files).forEach((file) => form.append('files', file));
    const response = await apiClient.post(
      `/entity-attachments/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
      form,
      { timeout: 60000 },
    );
    return response.data || [];
  },

  async fetchBlob(attachment: AttachmentRecord): Promise<Blob> {
    const response = await apiClient.get(
      `/attachments/file/${encodeURIComponent(attachment.id)}`,
      { responseType: 'blob' },
    );
    return response.data;
  },

  downloadBlob(blob: Blob, originalName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = originalName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  },

  async download(attachment: AttachmentRecord): Promise<void> {
    const blob = await this.fetchBlob(attachment);
    this.downloadBlob(blob, attachment.originalName);
  },

  async remove(id: string): Promise<void> {
    await apiClient.delete(`/attachments/file/${encodeURIComponent(id)}`);
  },
};
