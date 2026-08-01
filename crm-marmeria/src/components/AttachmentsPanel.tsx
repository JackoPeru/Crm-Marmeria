import React, { useEffect, useState } from 'react';
import { Download, File, Paperclip, Trash2, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { attachmentsService } from '../services/attachments';
import type { AttachmentRecord } from '../services/attachments';
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
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
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
              accept={entityType === 'project' ? 'image/*,.pdf' : undefined}
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
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="p-3 border rounded-md flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex items-center gap-2">
                <File size={18} className="shrink-0" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{attachment.originalName}</p>
                  <p className="text-xs text-gray-500">
                    {formatBytes(attachment.sizeBytes)} · {new Date(attachment.createdAt).toLocaleString('it-IT')}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
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

      <AuditHistory entityType={entityType} entityId={entityId} />
    </div>
  );
};

export default AttachmentsPanel;
