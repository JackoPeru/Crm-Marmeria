import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  Maximize2,
  Paperclip,
  Printer,
  Share2,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { attachmentsService } from '../services/attachments';
import type { AttachmentRecord } from '../services/attachments';
import { apiClient } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import AuditHistory from './AuditHistory';
import Modal from './common/Modal';

const permissionPrefixes: Record<string, string> = {
  client: 'clients',
  order: 'orders',
  project: 'projects',
  material: 'materials',
  quote: 'quotes',
  invoice: 'invoices',
};

type AttachmentView = AttachmentRecord & {
  caption?: string;
  includeInExport?: boolean;
  sortOrder?: number;
};

type ViewerState = { attachment: AttachmentView; url: string };

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
};

const mimeType = (attachment: AttachmentRecord) => String(attachment.mimeType || '').toLowerCase();
const isImage = (attachment: AttachmentRecord) => mimeType(attachment).startsWith('image/');
const isVideo = (attachment: AttachmentRecord) => mimeType(attachment).startsWith('video/');
const isPdf = (attachment: AttachmentRecord) => mimeType(attachment) === 'application/pdf' || /\.pdf$/i.test(attachment.originalName);
const canPreview = (attachment: AttachmentRecord) => isImage(attachment) || isVideo(attachment) || isPdf(attachment);
const canPrint = (attachment: AttachmentRecord) => isImage(attachment) || isPdf(attachment);

const attachmentKind = (attachment: AttachmentRecord) => {
  if (isImage(attachment)) return 'Immagine';
  if (isVideo(attachment)) return 'Video';
  if (isPdf(attachment)) return 'PDF';
  return 'File';
};

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const openExternal = (url: string) => {
  const popup = window.open(url, '_blank', 'noopener,noreferrer');
  if (!popup) window.location.assign(url);
};

const AttachmentsPanel: React.FC<{
  entityType: string;
  entityId: string;
}> = ({ entityType, entityId }) => {
  const { hasPermission } = useAuth();
  const [attachments, setAttachments] = useState<AttachmentView[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [fallbackShare, setFallbackShare] = useState<AttachmentView | null>(null);
  const [busy, setBusy] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const mountedRef = useRef(true);
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

  // Thumbnails are intentionally limited to images. Video/PDF blobs load only on explicit view/print/share.
  useEffect(() => {
    let active = true;
    const created: string[] = [];
    setPreviewUrls({});
    const loadPreviews = async () => {
      const entries = await Promise.all(attachments.filter(isImage).map(async (attachment) => {
        try {
          const response = await apiClient.get(`/attachments/file/${encodeURIComponent(attachment.id)}`, { responseType: 'blob' });
          const url = URL.createObjectURL(response.data);
          if (!active) {
            URL.revokeObjectURL(url);
            return null;
          }
          created.push(url);
          return [String(attachment.id), url] as const;
        } catch {
          return null;
        }
      }));
      if (active) setPreviewUrls(Object.fromEntries(entries.filter(Boolean) as Array<readonly [string, string]>));
    };
    void loadPreviews();
    return () => {
      active = false;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [attachments]);

  useEffect(() => () => {
    if (viewer?.url) URL.revokeObjectURL(viewer.url);
  }, [viewer]);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

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

  const orderedAttachments = useMemo(() => [...attachments].sort((left, right) => (
    Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
      || new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  )), [attachments]);

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
      toast.error(error.response?.data?.error || 'Caricamento allegati non riuscito. È richiesta la connessione al server.');
    } finally {
      setBusy(false);
    }
  };

  const openViewer = async (attachment: AttachmentView) => {
    if (!canPreview(attachment)) {
      toast('Anteprima non disponibile per questo tipo di file');
      return;
    }
    try {
      const blob = await attachmentsService.fetchBlob(attachment);
      const url = URL.createObjectURL(blob);
      if (!mountedRef.current) {
        URL.revokeObjectURL(url);
        return;
      }
      setViewer({ attachment, url });
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Apertura allegato non riuscita');
    }
  };

  const download = async (attachment: AttachmentView) => {
    try {
      await attachmentsService.download(attachment);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Download allegato non riuscito');
    }
  };

  const print = async (attachment: AttachmentView) => {
    if (!canPrint(attachment)) return;
    const printWindow = window.open('', 'crm-allegato-stampa');
    if (!printWindow) {
      toast.error('Popup stampa bloccato dal browser');
      return;
    }
    printWindow.document.write('<!doctype html><title>Preparazione stampa</title><p>Preparazione allegato...</p>');
    try {
      const blob = await attachmentsService.fetchBlob(attachment);
      const url = URL.createObjectURL(blob);
      const title = escapeHtml(attachment.caption || attachment.originalName);
      printWindow.document.open();
      printWindow.document.write(isImage(attachment)
        ? `<!doctype html><title>${title}</title><style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh}img{max-width:100%;max-height:100vh;object-fit:contain}</style><img src="${url}" alt="${title}">`
        : `<!doctype html><title>${title}</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}</style><iframe src="${url}" title="${title}"></iframe>`);
      printWindow.document.close();
      printWindow.addEventListener('beforeunload', () => URL.revokeObjectURL(url), { once: true });
      window.setTimeout(() => {
        try {
          printWindow.focus();
          printWindow.print();
        } finally {
          window.setTimeout(() => URL.revokeObjectURL(url), 120000);
        }
      }, 500);
    } catch (error: any) {
      printWindow.close();
      toast.error(error.response?.data?.error || 'Stampa allegato non riuscita');
    }
  };

  const share = async (attachment: AttachmentView) => {
    setSharingId(String(attachment.id));
    try {
      const blob = await attachmentsService.fetchBlob(attachment);
      const file = typeof globalThis.File === 'function'
        ? new globalThis.File([blob], attachment.originalName, { type: mimeType(attachment) || blob.type || 'application/octet-stream' })
        : null;
      const shareNavigator = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
        share?: (data?: ShareData) => Promise<void>;
      };
      let canUseFileShare = Boolean(file && typeof shareNavigator.share === 'function');
      if (canUseFileShare && shareNavigator.canShare && file) {
        try {
          canUseFileShare = shareNavigator.canShare({ files: [file] });
        } catch {
          canUseFileShare = false;
        }
      }
      if (canUseFileShare && file) {
        try {
          await shareNavigator.share({ files: [file], title: attachment.originalName, text: attachment.caption || 'Allegato CRM Marmeria' });
          return;
        } catch (error: any) {
          if (error?.name === 'AbortError') return;
        }
      }

      attachmentsService.downloadBlob(blob, attachment.originalName);
      setFallbackShare(attachment);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Condivisione allegato non riuscita');
    } finally {
      setSharingId(null);
    }
  };

  const remove = async (attachment: AttachmentView) => {
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

  const updateMetadata = async (attachment: AttachmentView, patch: Record<string, unknown>) => {
    if (!canEdit) return;
    try {
      await apiClient.patch(`/attachments/file/${encodeURIComponent(attachment.id)}`, patch);
      await load();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Metadati allegato non aggiornati');
    }
  };

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
    <div className="mt-6 border-t border-light-border pt-5 dark:border-dark-border">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-semibold">
          <Paperclip size={18} /> {entityType === 'project' ? 'Media e allegati progetto' : 'Foto e allegati'}
        </h3>
        {canEdit && (
          <label className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm text-white ${busy ? 'bg-gray-400' : 'cursor-pointer bg-blue-600 hover:bg-blue-700'}`}>
            <Upload size={16} /> {entityType === 'project' ? 'Aggiungi immagini/video/PDF' : 'Aggiungi file'}
            <input
              type="file"
              multiple
              accept={['project', 'quote'].includes(entityType) ? 'image/*,video/*,.pdf' : undefined}
              onChange={upload}
              disabled={busy}
              className="hidden"
            />
          </label>
        )}
      </div>

      {!attachments.length ? (
        <p className="text-sm text-gray-500">{entityType === 'project' ? 'Nessun media o allegato. Quantità illimitata.' : 'Nessun allegato.'}</p>
      ) : (
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {orderedAttachments.map((attachment, index) => (
            <div key={attachment.id} className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 w-full items-center gap-2 sm:w-auto">
                {previewUrls[String(attachment.id)] ? (
                  <button type="button" onClick={() => void openViewer(attachment)} className="relative shrink-0 overflow-hidden rounded border" title="Apri anteprima">
                    <img src={previewUrls[String(attachment.id)]} alt={attachment.caption || attachment.originalName} className="h-14 w-14 object-cover" />
                    <Maximize2 size={13} className="absolute bottom-0 right-0 bg-black/60 p-0.5 text-white" />
                  </button>
                ) : (
                  <button type="button" onClick={() => void openViewer(attachment)} disabled={!canPreview(attachment)} className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded border text-gray-500 disabled:cursor-default disabled:opacity-60" title={canPreview(attachment) ? 'Apri anteprima' : 'Anteprima non disponibile'}>
                    {isVideo(attachment) ? <Video size={22} /> : isPdf(attachment) ? <FileText size={22} /> : isImage(attachment) ? <ImageIcon size={22} /> : <FileIcon size={22} />}
                    <span className="text-[10px]">{attachmentKind(attachment)}</span>
                  </button>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{attachment.originalName}</p>
                  <p className="text-xs text-gray-500">{attachmentKind(attachment)} · {formatBytes(attachment.sizeBytes)} · {new Date(attachment.createdAt).toLocaleString('it-IT')}</p>
                  {canEdit && <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input aria-label={`Didascalia ${attachment.originalName}`} value={attachment.caption || ''} onChange={(event) => setAttachments((current) => current.map((item) => item.id === attachment.id ? { ...item, caption: event.target.value } : item))} onBlur={(event) => void updateMetadata(attachment, { caption: event.target.value })} placeholder="Didascalia" className="rounded border px-2 py-1 text-xs dark:bg-dark-input" />
                    {entityType === 'quote' && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={Boolean(attachment.includeInExport)} onChange={(event) => void updateMetadata(attachment, { includeInExport: event.target.checked })} /> In Word</label>}
                  </div>}
                </div>
              </div>
              <div className="flex w-full flex-wrap justify-end gap-1 sm:w-auto sm:shrink-0">
                {canEdit && <>
                  <button type="button" disabled={busy || index === 0} onClick={() => void move(index, -1)} className="p-2 text-gray-600 disabled:opacity-30" title="Sposta su" aria-label="Sposta su"><ChevronUp size={17} /></button>
                  <button type="button" disabled={busy || index === orderedAttachments.length - 1} onClick={() => void move(index, 1)} className="p-2 text-gray-600 disabled:opacity-30" title="Sposta giù" aria-label="Sposta giù"><ChevronDown size={17} /></button>
                </>}
                {canPreview(attachment) && <button type="button" onClick={() => void openViewer(attachment)} className="p-2 text-blue-600" title="Visualizza" aria-label={`Visualizza ${attachment.originalName}`}><Eye size={17} /></button>}
                <button type="button" onClick={() => void download(attachment)} className="p-2 text-blue-600" title="Scarica" aria-label={`Scarica ${attachment.originalName}`}><Download size={17} /></button>
                {canPrint(attachment) && <button type="button" onClick={() => void print(attachment)} className="p-2 text-gray-700" title="Stampa" aria-label={`Stampa ${attachment.originalName}`}><Printer size={17} /></button>}
                <button type="button" onClick={() => void share(attachment)} disabled={sharingId === String(attachment.id)} className="p-2 text-indigo-600 disabled:opacity-50" title="Condividi file" aria-label={`Condividi ${attachment.originalName}`}><Share2 size={17} /></button>
                {canEdit && <button type="button" onClick={() => void remove(attachment)} disabled={busy} className="p-2 text-red-600 disabled:opacity-50" title="Elimina" aria-label={`Elimina ${attachment.originalName}`}><Trash2 size={17} /></button>}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={Boolean(viewer)}
        onClose={() => setViewer(null)}
        title={viewer?.attachment.caption || viewer?.attachment.originalName || 'Anteprima allegato'}
        size="6xl"
      >
        {viewer && <div className="space-y-3">
          {isImage(viewer.attachment) && <img src={viewer.url} alt={viewer.attachment.caption || viewer.attachment.originalName} className="mx-auto max-h-[70vh] max-w-full object-contain" />}
          {isVideo(viewer.attachment) && <video src={viewer.url} controls preload="metadata" className="mx-auto max-h-[70vh] max-w-full" />}
          {isPdf(viewer.attachment) && <iframe src={viewer.url} title={viewer.attachment.originalName} className="h-[70vh] w-full rounded border" />}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => void download(viewer.attachment)} className="flex items-center gap-2 rounded border px-3 py-2 text-sm"><Download size={16} /> Scarica</button>
            {canPrint(viewer.attachment) && <button type="button" onClick={() => void print(viewer.attachment)} className="flex items-center gap-2 rounded border px-3 py-2 text-sm"><Printer size={16} /> Stampa</button>}
            <button type="button" onClick={() => setViewer(null)} className="flex items-center gap-2 rounded border px-3 py-2 text-sm"><X size={16} /> Chiudi</button>
          </div>
        </div>}
      </Modal>

      <Modal
        isOpen={Boolean(fallbackShare)}
        onClose={() => setFallbackShare(null)}
        title="Condividi allegato"
        size="sm"
      >
        {fallbackShare && <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Il browser non può allegare direttamente questo file. <strong>{fallbackShare.originalName}</strong> è stato scaricato: scegli dove preparare il messaggio e allegalo dalla cartella Download.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => {
              const message = `Allegato CRM Marmeria: ${fallbackShare.originalName}. Allego il file al messaggio.`;
              openExternal(`https://wa.me/?text=${encodeURIComponent(message)}`);
              setFallbackShare(null);
            }} className="rounded bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700">Apri WhatsApp</button>
            <button type="button" onClick={() => {
              const message = `Allegato CRM Marmeria: ${fallbackShare.originalName}. Allego il file al messaggio.`;
              openExternal(`mailto:?subject=${encodeURIComponent(`Allegato CRM: ${fallbackShare.originalName}`)}&body=${encodeURIComponent(message)}`);
              setFallbackShare(null);
            }} className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">Apri Email</button>
            <button type="button" onClick={() => setFallbackShare(null)} className="rounded border px-4 py-2 text-sm">Chiudi</button>
          </div>
        </div>}
      </Modal>

      <AuditHistory entityType={entityType} entityId={entityId} />
    </div>
  );
};

export default AttachmentsPanel;
