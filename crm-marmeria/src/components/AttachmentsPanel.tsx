import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Download, File, Maximize2, Paperclip, Trash2, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { attachmentsService } from '../services/attachments';
import type { AttachmentRecord } from '../services/attachments';
import { apiClient } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import AuditHistory from './AuditHistory';

const permissionPrefixes: Record<string, string> = {
  client: 'clients',
  order: 'orders',
  project: 'projects',
  material: 'materials',
  quote: 'quotes',
  invoice: 'invoices',
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
};

const AttachmentsPanel: React.FC<{
  entityType: string;
  entityId: string;
}> = ({ entityType, entityId }) => {
  const { hasPermission } = useAuth();
  const [attachments, setAttachments] = useState<Array<AttachmentRecord & { caption?: string; includeInExport?: boolean; sortOrder?: number }>>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<(AttachmentRecord & { caption?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const prefix = permissionPrefixes[entityType];
  const canEdit = Boolean(prefix && hasPermission(`${prefix}.edit`));

  const load = async () => {
    try {
      setAttachments(await attachmentsService.list(entityType, entityId));
    } catch (error) {
      console.error('Caricamento allegati fallito:', error);
    }
  };

  useEffect(() => {
    let active = true;
    attachmentsService.list(entityType, entityId)
      .then((items) => {
        if (active) setAttachments(items);
      })
      .catch((error) => console.error('Caricamento allegati fallito:', error));
    return () => {
      active = false;
    };
  }, [entityType, entityId]);

  useEffect(() => {
    let active = true;
    const created: string[] = [];
    setPreviewUrls({});
    const loadPreviews = async () => {
      const entries = await Promise.all(attachments.map(async (attachment) => {
        if (!String(attachment.mimeType || '').toLowerCase().startsWith('image/')) return null;
        try {
          const response = await apiClient.get(`/attachments/file/${encodeURIComponent(attachment.id)}`, { responseType: 'blob' });
          const url = URL.createObjectURL(response.data);
          created.push(url);
          return [String(attachment.id), url] as const;
        } catch {
          return null;
        }
      }));
      if (!active) return;
      setPreviewUrls(Object.fromEntries(entries.filter(Boolean) as Array<readonly [string, string]>));
    };
    void loadPreviews();
    return () => {
      active = false;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [attachments]);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail;
      if (
        detail?.event === 'attachments.changed'
        && detail.entityType === entityType
        && String(detail.id) === String(entityId)
      ) {
        void load();
      }
    };
    window.addEventListener('crm-realtime', listener);
    return () => window.removeEventListener('crm-realtime', listener);
  }, [entityType, entityId]);

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    event.target.value = '';
    if (!canEdit || !files?.length) return;
    setBusy(true);
    try {
      await attachmentsService.upload(entityType, entityId, files);
      await load();
      toast.success('Allegati caricati');
    } catch (error: any) {
      toast.error(
        error.response?.data?.error
        || 'Caricamento allegati non riuscito. È richiesta la connessione al server.',
      );
    } finally {
      setBusy(false);
    }
  };

  const download = async (attachment: AttachmentRecord) => {
    try {
      await attachmentsService.download(attachment);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Download allegato non riuscito');
    }
  };

  const remove = async (attachment: AttachmentRecord) => {
    if (!canEdit) return;
    if (!window.confirm(`Eliminare ${attachment.originalName}?`)) return;
    setBusy(true);
    try {
      await attachmentsService.remove(attachment.id);
      await load();
      toast.success('Allegato eliminato');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Eliminazione non riuscita');
    } finally {
      setBusy(false);
    }
  };

  const updateMetadata = async (attachment: AttachmentRecord & { caption?: string; includeInExport?: boolean; sortOrder?: number }, patch: Record<string, unknown>) => {
    if (!canEdit) return;
    try {
      await apiClient.patch(`/attachments/file/${encodeURIComponent(attachment.id)}`, patch);
      await load();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Metadati allegato non aggiornati');
    }
  };

  const orderedAttachments = useMemo(() => [...attachments].sort((left, right) => (
    Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
      || new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  )), [attachments]);

  const move = async (index: number, direction: -1 | 1) => {
    if (!canEdit) return;
    const target = index + direction;
    if (target < 0 || target >= orderedAttachments.length) return;
    const current = orderedAttachments[index];
    const swapped = orderedAttachments[target];
    setBusy(true);
    try {
      await Promise.all([
        apiClient.patch(`/attachments/file/${encodeURIComponent(current.id)}`, { sortOrder: target }),
        apiClient.patch(`/attachments/file/${encodeURIComponent(swapped.id)}`, { sortOrder: index }),
      ]);
      await load();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Riordinamento non riuscito');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 border-t pt-5 border-light-border dark:border-dark-border">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <Paperclip size={18} /> {entityType === 'project' ? 'Immagini e allegati progetto' : 'Foto e allegati'}
        </h3>
        {canEdit && (
          <label className={`px-3 py-2 text-sm rounded-md text-white flex items-center gap-2 ${busy ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700 cursor-pointer'}`}>
            <Upload size={16} /> {entityType === 'project' ? 'Aggiungi immagini/file' : 'Aggiungi file'}
            <input
              type="file"
              multiple
              accept={['project', 'quote'].includes(entityType) ? 'image/*,.pdf' : undefined}
              onChange={upload}
              disabled={busy}
              className="hidden"
            />
          </label>
        )}
      </div>

      {!attachments.length ? (
        <p className="text-sm text-gray-500">{entityType === 'project' ? 'Nessuna immagine o allegato. Quantità illimitata.' : 'Nessun allegato.'}</p>
      ) : (
        <div className="space-y-2 max-h-52 overflow-y-auto">
          {orderedAttachments.map((attachment, index) => (
            <div
              key={attachment.id}
              className="p-3 border rounded-md flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex items-center gap-2">
                {previewUrls[String(attachment.id)] ? (
                  <button type="button" onClick={() => setLightbox(attachment)} className="relative shrink-0 overflow-hidden rounded border" title="Apri anteprima ingrandita">
                    <img src={previewUrls[String(attachment.id)]} alt={attachment.caption || attachment.originalName} className="h-14 w-14 object-cover" />
                    <Maximize2 size={13} className="absolute bottom-0 right-0 bg-black/60 p-0.5 text-white" />
                  </button>
                ) : <File size={18} className="shrink-0" />}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{attachment.originalName}</p>
                  <p className="text-xs text-gray-500">
                    {formatBytes(attachment.sizeBytes)} · {new Date(attachment.createdAt).toLocaleString('it-IT')}
                  </p>
                  {canEdit && <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input aria-label={`Didascalia ${attachment.originalName}`} value={attachment.caption || ''} onChange={(event) => setAttachments((current) => current.map((item) => item.id === attachment.id ? { ...item, caption: event.target.value } : item))} onBlur={(event) => void updateMetadata(attachment, { caption: event.target.value })} placeholder="Didascalia" className="rounded border px-2 py-1 text-xs dark:bg-dark-input" />
                    {entityType === 'quote' && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={Boolean(attachment.includeInExport)} onChange={(event) => void updateMetadata(attachment, { includeInExport: event.target.checked })} /> In Word</label>}
                  </div>}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                {canEdit && <>
                  <button type="button" disabled={busy || index === 0} onClick={() => void move(index, -1)} className="p-2 text-gray-600 disabled:opacity-30" title="Sposta su"><ChevronUp size={17} /></button>
                  <button type="button" disabled={busy || index === orderedAttachments.length - 1} onClick={() => void move(index, 1)} className="p-2 text-gray-600 disabled:opacity-30" title="Sposta giù"><ChevronDown size={17} /></button>
                </>}
                <button
                  type="button"
                  onClick={() => void download(attachment)}
                  className="p-2 text-blue-600"
                  title="Scarica"
                >
                  <Download size={17} />
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => void remove(attachment)}
                    disabled={busy}
                    className="p-2 text-red-600 disabled:opacity-50"
                    title="Elimina"
                  >
                    <Trash2 size={17} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {lightbox && previewUrls[String(lightbox.id)] && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}>
          <button type="button" className="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white" onClick={() => setLightbox(null)} title="Chiudi anteprima"><X size={24} /></button>
          <figure className="max-h-full max-w-full" onClick={(event) => event.stopPropagation()}>
            <img src={previewUrls[String(lightbox.id)]} alt={lightbox.caption || lightbox.originalName} className="max-h-[78vh] max-w-[90vw] object-contain" />
            <figcaption className="mt-3 text-center text-sm text-white">{lightbox.caption || lightbox.originalName}</figcaption>
          </figure>
        </div>
      )}

      <AuditHistory entityType={entityType} entityId={entityId} />
    </div>
  );
};

export default AttachmentsPanel;
