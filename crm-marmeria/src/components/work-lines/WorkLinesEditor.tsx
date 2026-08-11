import React, { useMemo } from 'react';
import { ChevronDown, ChevronUp, Copy, GripVertical, Info, Plus, Settings, Trash2 } from 'lucide-react';
import { formatEuro, parseLocaleNumber } from '../../utils/numbers';
import { createId } from '../../utils/ids';
import {
  calculateEdge,
  calculateWorkLine,
  summarizeWorkLines,
} from '../../domain/work-lines/calculations';
import {
  createWorkLine,
  edgeDefaults,
  normalizeWorkLine,
  workLinesToDocumentItems,
} from '../../domain/work-lines/normalize';
import { edgeSelectionFromCatalog, uniqueEdgeCatalogItems } from '../../domain/work-lines/edgeSelector';
import { customerMaterialUnitPrice } from '../../domain/work-lines/pricing';
import { EDGE_KEYS, EDGE_LABELS } from '../../domain/work-lines/types';
import type {
  EdgeCatalogItem,
  EdgeKey,
  LinearCatalogItem,
  MaterialPriceLike,
  WorkLine,
  WorkLineType,
} from '../../domain/work-lines/types';

export interface WorkLinesEditorProps {
  value: WorkLine[];
  onChange: (lines: WorkLine[]) => void;
  materials?: MaterialPriceLike[];
  edgeCatalog?: EdgeCatalogItem[];
  linearCatalog?: LinearCatalogItem[];
  invoiceMode?: boolean;
  showPrices?: boolean;
  readOnly?: boolean;
  className?: string;
  onOpenEdgeCatalog?: () => void;
}

const inputClass = 'w-full rounded border p-2 bg-light-bg dark:bg-dark-input';

const numberText = (value: unknown): string => value == null ? '' : String(value);

const NumericInput = ({
  label,
  value,
  onChange,
  min = 0,
  step = '0.01',
  disabled = false,
}: {
  label: string;
  value: unknown;
  onChange: (value: number) => void;
  min?: number;
  step?: string;
  disabled?: boolean;
}) => (
  <label className="block text-sm">
    <span className="mb-1 block font-medium">{label}</span>
    <input
      type="text"
      inputMode="decimal"
      min={min}
      step={step}
      value={numberText(value)}
      onChange={(event) => onChange(parseLocaleNumber(event.target.value))}
      disabled={disabled}
      className={`${inputClass} disabled:opacity-60`}
    />
  </label>
);

const Field = ({
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  label: string;
  value: unknown;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) => (
  <label className="block text-sm">
    <span className="mb-1 block font-medium">{label}</span>
    <input
      value={String(value ?? '')}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`${inputClass} disabled:opacity-60`}
    />
  </label>
);

const EdgeConfigurator = ({
  line,
  edgeCatalog,
  onEdgeChange,
  disabled,
  showPrices,
}: {
  line: WorkLine;
  edgeCatalog: EdgeCatalogItem[];
  onEdgeChange: (key: EdgeKey, patch: Record<string, unknown>) => void;
  disabled: boolean;
  showPrices: boolean;
}) => (
  <details className="mt-4 rounded border bg-gray-50 p-3 dark:bg-gray-900/30" open>
    <summary className="cursor-pointer font-semibold">Bordi e angoli</summary>
    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
      {EDGE_KEYS.map((key) => {
        const edge = line.edges?.[key] || edgeDefaults(line.lengthCm, line.widthCm)[key];
        const catalogById = edge?.catalogId
          ? edgeCatalog.find((item) => String(item.id) === String(edge.catalogId))
          : undefined;
        const selectedCatalog = catalogById;
        const availableEdgeTypes = uniqueEdgeCatalogItems(edgeCatalog);
        const edgeTypes = selectedCatalog && !availableEdgeTypes.some((item) => String(item.name) === String(selectedCatalog.name))
          ? [selectedCatalog, ...availableEdgeTypes]
          : edge?.type && !availableEdgeTypes.some((item) => String(item.name) === String(edge.type))
            ? [{ id: `legacy-${key}`, name: edge.type }, ...availableEdgeTypes]
            : availableEdgeTypes;
        const displayPrice = selectedCatalog?.unitPrice ?? selectedCatalog?.price ?? edge?.unitPrice ?? edge?.priceSnapshot ?? 0;
        const selectedType = selectedCatalog?.name || edge?.type || '';
        const catalogSelected = Boolean(edge?.catalogId && selectedCatalog);
        return (
          <div key={key} className="rounded border bg-white p-3 dark:bg-dark-card">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={Boolean(edge?.active)}
                onChange={(event) => onEdgeChange(key, { active: event.target.checked })}
                disabled={disabled}
              />
              {EDGE_LABELS[key]}
            </label>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="text-xs sm:col-span-3">
                <span className="mb-1 block">Tipo bordo</span>
                <select
                  value={selectedType}
                  onChange={(event) => {
                    const selectedType = event.target.value;
                    if (!selectedType) {
                      onEdgeChange(key, {
                        catalogId: undefined,
                        type: '',
                        nameSnapshot: '',
                        unitPrice: undefined,
                        priceSnapshot: undefined,
                        materialId: undefined,
                      });
                      return;
                    }
                    const selection = edgeSelectionFromCatalog(edgeCatalog, {
                      type: selectedType,
                      materialId: line.materialId,
                      thickness: line.thickness,
                    }, edge);
                    onEdgeChange(key, selection);
                  }}
                  disabled={disabled}
                  className={`${inputClass} text-xs`}
                >
                  <option value="">Tipo generico</option>
                  {edgeTypes.map((item) => <option key={item.id} value={item.name || String(item.id)}>{item.name || String(item.id)}</option>)}
                </select>
              </label>
              <NumericInput label="Lunghezza cm" value={edge?.lengthCm || ''} onChange={(value) => onEdgeChange(key, { lengthCm: value, lengthMeters: undefined })} disabled={disabled} />
              <div className="text-sm sm:pt-0">
                <span className="mb-1 block font-medium">{showPrices ? 'Prezzo bordo da catalogo' : 'Prezzo bordo'}</span>
                {catalogSelected ? <>
                  {showPrices && <output className="block rounded border bg-gray-100 p-2 dark:bg-gray-800" aria-label="Prezzo bordo dal catalogo">{formatEuro(displayPrice)} / ml</output>}
                  <span className="mt-1 block text-xs text-gray-500">Fonte: catalogo bordi. Valore non modificabile.</span>
                </> : edge?.active && (edge?.unitPrice != null || edge?.priceSnapshot != null) ? <>
                  {showPrices && <output className="block rounded border bg-gray-100 p-2 dark:bg-gray-800" aria-label="Prezzo storico del bordo">{formatEuro(displayPrice)} / ml</output>}
                  <span className="mt-1 block text-xs text-gray-500">Snapshot storico senza collegamento catalogo. Valore non modificabile.</span>
                </> : <span className="block rounded border bg-gray-100 p-2 text-gray-500 dark:bg-gray-800">Seleziona un bordo dal catalogo</span>}
              </div>
              {showPrices && <div className="text-xs text-gray-500 sm:pt-6">Costo: <strong>{formatEuro(calculateEdge(edge, line.quantity))}</strong></div>}
            </div>
          </div>
        );
      })}
    </div>
  </details>
);

const updateSurfaceEdges = (
  line: WorkLine,
  patch: { lengthCm?: number; widthCm?: number },
): WorkLine['edges'] => {
  const lengthCm = patch.lengthCm ?? line.lengthCm ?? 0;
  const widthCm = patch.widthCm ?? line.widthCm ?? 0;
  const defaults = edgeDefaults(lengthCm, widthCm);
  return Object.fromEntries(EDGE_KEYS.map((key) => [
    key,
    {
      ...(defaults[key] || {}),
      ...(line.edges?.[key] || {}),
      lengthCm: ['front', 'back'].includes(key) ? lengthCm : ['left', 'right'].includes(key) ? widthCm : (line.edges?.[key]?.lengthCm ?? defaults[key]?.lengthCm),
    },
  ])) as WorkLine['edges'];
};

const LineCard = ({
  line,
  index,
  materials,
  edgeCatalog,
  linearCatalog,
  invoiceMode,
  showPrices,
  readOnly,
  onChange,
  onDelete,
  onDuplicate,
  onMove,
  onOpenEdgeCatalog,
}: {
  line: WorkLine;
  index: number;
  materials: MaterialPriceLike[];
  edgeCatalog: EdgeCatalogItem[];
  linearCatalog: LinearCatalogItem[];
  invoiceMode: boolean;
  showPrices: boolean;
  readOnly: boolean;
  onChange: (patch: Partial<WorkLine>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
  onOpenEdgeCatalog?: () => void;
}) => {
  const calculated = calculateWorkLine(line);
  const material = materials.find((item) => String(item.id) === String(line.materialId || ''));
  const updateMaterial = (rawId: string) => {
    const selected = materials.find((item) => String(item.id) === rawId);
    onChange({
      materialId: selected?.id == null ? undefined : String(selected.id),
      materialNameSnapshot: selected?.name || '',
      unitPrice: line.type === 'linear' ? line.unitPrice : customerMaterialUnitPrice(selected),
      unit: line.type === 'linear' ? line.unit : selected?.unit || line.unit,
      thickness: selected?.thickness,
      variant: selected?.variant || line.variant,
      description: line.description || selected?.name || '',
    });
  };

  return (
    <article className="rounded-lg border p-4 shadow-sm dark:border-dark-border">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GripVertical size={17} className="text-gray-400" />
          <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-900/30 dark:text-blue-200">
            {line.type === 'surface' ? 'm²' : line.type === 'linear' ? 'ml' : 'Manuale'}
          </span>
          <span className="text-sm font-semibold">Riga {index + 1}</span>
        </div>
        {!readOnly && <div className="flex items-center gap-1">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} className="rounded p-1 text-gray-600 disabled:opacity-30" title="Sposta su"><ChevronUp size={17} /></button>
          <button type="button" onClick={() => onMove(1)} className="rounded p-1 text-gray-600" title="Sposta giù"><ChevronDown size={17} /></button>
          {line.type === 'surface' && onOpenEdgeCatalog && <button type="button" onClick={onOpenEdgeCatalog} className="rounded p-1 text-indigo-600" title="Impostazioni catalogo bordi" aria-label="Apri impostazioni catalogo bordi"><Settings size={17} /></button>}
          <button type="button" onClick={onDuplicate} className="rounded p-1 text-blue-600" title="Duplica"><Copy size={17} /></button>
          <button type="button" onClick={onDelete} className="rounded p-1 text-red-600" title="Elimina"><Trash2 size={17} /></button>
        </div>}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Field label="Descrizione" value={line.description} onChange={(value) => onChange({ description: value })} disabled={readOnly} />
        <NumericInput label="Quantità" value={line.quantity} onChange={(value) => onChange({ quantity: value })} min={0} disabled={readOnly} />
        {line.type === 'surface' && <>
          <NumericInput label="Lunghezza cm" value={line.lengthCm} onChange={(value) => onChange({ lengthCm: value, edges: updateSurfaceEdges(line, { lengthCm: value }) })} disabled={readOnly} />
          <NumericInput label="Larghezza cm" value={line.widthCm} onChange={(value) => onChange({ widthCm: value, edges: updateSurfaceEdges(line, { widthCm: value }) })} disabled={readOnly} />
        </>}
        {line.type === 'linear' && <>
          <label className="block text-sm lg:col-span-2"><span className="mb-1 block font-medium">Elemento lineare</span><select value={line.linearItemId || ''} onChange={(event) => {
            const selected = linearCatalog.find((item) => String(item.id) === event.target.value);
            onChange({ linearItemId: selected?.id == null ? undefined : String(selected.id), linearItemNameSnapshot: selected?.name || line.linearItemNameSnapshot, description: selected?.name || line.description, unitPrice: parseLocaleNumber(selected?.unitPrice ?? selected?.price), unit: selected?.unit || 'ml' });
          }} disabled={readOnly} className={`${inputClass} disabled:opacity-60`}><option value="">Voce lineare manuale</option>{linearCatalog.filter((item) => item.active !== false).map((item) => <option key={item.id} value={String(item.id)}>{item.name}</option>)}</select></label>
          <NumericInput label="Metri lineari" value={line.linearMeters} onChange={(value) => onChange({ linearMeters: value })} disabled={readOnly} />
        </>}
        {line.type !== 'manual' && <label className="block text-sm"><span className="mb-1 block font-medium">Materiale</span><select value={line.materialId || ''} onChange={(event) => updateMaterial(event.target.value)} disabled={readOnly} className={`${inputClass} disabled:opacity-60`}><option value="">Materiale manuale</option>{materials.map((item) => <option key={String(item.id)} value={String(item.id)}>{item.name}{item.thickness ? ` · ${item.thickness} mm` : ''}{item.variant ? ` · ${item.variant}` : ''}</option>)}</select></label>}
        {line.type !== 'manual' && <>
          <Field label="Spessore" value={line.thickness} onChange={(value) => onChange({ thickness: value })} disabled={readOnly} placeholder="es. 3 mm" />
          <Field label="Variante / finitura" value={line.variant} onChange={(value) => onChange({ variant: value })} disabled={readOnly} placeholder="es. lucido" />
        </>}
        <NumericInput label={showPrices ? 'Prezzo unitario' : 'Prezzo (protetto)'} value={line.unitPrice} onChange={(value) => onChange({ unitPrice: value })} disabled={readOnly || !showPrices} />
        {showPrices && <label className="block text-sm"><span className="mb-1 flex items-center gap-1 font-medium">Extra prodotti esterni / posa / manodopera <span className="group relative inline-flex cursor-help" tabIndex={0} aria-describedby={'extra-help-' + line.id}><Info size={15} className="text-blue-600" /><span id={'extra-help-' + line.id} role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-10 mb-2 hidden w-64 rounded bg-gray-900 p-2 text-xs font-normal text-white shadow-lg group-hover:block group-focus:block">Campo compatibile con lo storico: extra aggiuntivo per prodotti esterni, posa o manodopera. Viene aggiunto una sola volta al totale della riga.</span></span></span><input type="text" inputMode="decimal" value={numberText(line.extraCost || 0)} onChange={(event) => onChange({ extraCost: parseLocaleNumber(event.target.value) })} disabled={readOnly} className={inputClass + ' disabled:opacity-60'} /></label>}
        {invoiceMode && <NumericInput label="IVA %" value={line.taxRate ?? 22} onChange={(value) => onChange({ taxRate: value })} disabled={readOnly} />}
        {invoiceMode && <Field label="Natura IVA" value={line.taxNature} onChange={(value) => onChange({ taxNature: value.toUpperCase() })} disabled={readOnly} placeholder="Solo se IVA 0%" />}
      </div>

      {line.type === 'surface' && <EdgeConfigurator line={line} edgeCatalog={edgeCatalog} disabled={readOnly} showPrices={showPrices} onEdgeChange={(key, patch) => onChange({ edges: { ...line.edges, [key]: { ...(line.edges?.[key] || {}), ...patch } } })} />}
      <label className="mt-3 block text-sm"><span className="mb-1 block font-medium">Note lavorazione</span><textarea rows={2} value={line.notes || ''} onChange={(event) => onChange({ notes: event.target.value })} disabled={readOnly} className={`${inputClass} disabled:opacity-60`} /></label>
      {showPrices && <div className="mt-3 grid grid-cols-2 gap-2 rounded bg-gray-50 p-3 text-sm dark:bg-gray-900/40 md:grid-cols-4">
        {line.type === 'surface' && <p>Superficie: <strong>{calculated.squareMeters.toFixed(2)} m²</strong></p>}
        {line.type === 'linear' && <p>Metri: <strong>{calculated.linearMeters.toFixed(2)} ml</strong></p>}
        {line.type !== 'manual' && <p>Materiale: <strong>{formatEuro(calculated.materialCost)}</strong></p>}
        {line.type === 'surface' && <p>Bordi: <strong>{formatEuro(calculated.edgeCost)}</strong></p>}
        <p className="font-semibold">Totale riga: {formatEuro(calculated.total)}</p>
        {material?.name && <p className="text-gray-500">Snapshot: {material.name}</p>}
      </div>}
    </article>
  );
};

export const WorkLinesEditor: React.FC<WorkLinesEditorProps> = ({
  value,
  onChange,
  materials = [],
  edgeCatalog = [],
  linearCatalog = [],
  invoiceMode = false,
  showPrices = true,
  readOnly = false,
  className = '',
  onOpenEdgeCatalog,
}) => {
  const lines = useMemo(() => value.map((line, index) => normalizeWorkLine(line, index)), [value]);
  const summary = useMemo(() => summarizeWorkLines(lines), [lines]);
  const replaceLines = (next: WorkLine[]) => onChange(next.map((line, index) => normalizeWorkLine({ ...line, sortOrder: index }, index)));
  const add = (type: WorkLineType) => replaceLines([...lines, createWorkLine(type, type === 'surface' ? materials[0] : undefined, type === 'linear' ? linearCatalog[0] : undefined)]);
  const update = (index: number, patch: Partial<WorkLine>) => replaceLines(lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= lines.length) return;
    const next = [...lines];
    [next[index], next[target]] = [next[target], next[index]];
    replaceLines(next);
  };
  const duplicate = (index: number) => replaceLines([...lines, { ...lines[index], id: createId(), importSource: undefined }]);

  return <section className={`space-y-4 ${className}`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-semibold">Lavorazioni strutturate</h3><p className="text-xs text-gray-500">Misure, materiali, bordi e prezzi restano riapribili come dati.</p></div>
      {!readOnly && <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => add('surface')} className="flex items-center gap-1 rounded border px-3 py-1.5 text-sm"><Plus size={15} /> Riga m²</button>
        <button type="button" onClick={() => add('linear')} className="flex items-center gap-1 rounded border px-3 py-1.5 text-sm"><Plus size={15} /> Riga ml</button>
        <button type="button" onClick={() => add('manual')} className="flex items-center gap-1 rounded border px-3 py-1.5 text-sm"><Plus size={15} /> Voce manuale</button>
      </div>}
    </div>
    {!lines.length && <p className="rounded border border-dashed p-4 text-sm text-gray-500">Nessuna lavorazione. Aggiungi una riga m², ml o manuale.</p>}
    <div className="space-y-3">
      {lines.map((line, index) => <LineCard key={line.id} line={line} index={index} materials={materials} edgeCatalog={edgeCatalog} linearCatalog={linearCatalog} invoiceMode={invoiceMode} showPrices={showPrices} readOnly={readOnly} onChange={(patch) => update(index, patch)} onDelete={() => replaceLines(lines.filter((_, lineIndex) => lineIndex !== index))} onDuplicate={() => duplicate(index)} onMove={(direction) => move(index, direction)} onOpenEdgeCatalog={onOpenEdgeCatalog} />)}
    </div>
    {showPrices && <div className="grid grid-cols-2 gap-3 rounded-lg border bg-white p-4 text-sm dark:bg-dark-card md:grid-cols-3 lg:grid-cols-6">
      <p>Totale m²<br /><strong>{summary.surfaceSquareMeters.toFixed(2)}</strong></p>
      <p>Totale ml<br /><strong>{summary.linearMeters.toFixed(2)}</strong></p>
      <p>Costo materiale<br /><strong>{formatEuro(summary.materialCost)}</strong></p>
      <p>Costo bordi<br /><strong>{formatEuro(summary.edgeCost)}</strong></p>
      <p>Prodotti esterni/posa/manodopera<br /><strong>{formatEuro(summary.manualOther)}</strong></p>
      <p className="font-semibold">Subtotale<br /><strong>{formatEuro(summary.total)}</strong></p>
    </div>}
  </section>;
};

export const workLinesToItems = (lines: WorkLine[], invoice = false) => workLinesToDocumentItems(lines, invoice);

export default WorkLinesEditor;
