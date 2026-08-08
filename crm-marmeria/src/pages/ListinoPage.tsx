import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownAZ, ArrowUpAZ, Filter, FileSpreadsheet, RotateCcw, Search } from 'lucide-react';
import useUI from '../hooks/useUI';
import { useData } from '../hooks/useData';
import { useAuth } from '../contexts/AuthContext';
import { formatEuro } from '../utils/numbers';
import MaterialImportModal from '../components/catalog/MaterialImportModal';
import type { Material } from '../store/slices/materialsSlice';

type MaterialRow = Material & { price?: number; stock?: number };
type ActiveFilter = '' | 'active' | 'inactive';

const ListinoPage: React.FC = () => {
  const { setBreadcrumbs } = useUI();
  const { materials = [] } = useData();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [supplier, setSupplier] = useState('');
  const [thickness, setThickness] = useState('');
  const [variant, setVariant] = useState('');
  const [active, setActive] = useState<ActiveFilter>('');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [importOpen, setImportOpen] = useState(false);

  const canImport = user?.role === 'admin';
  const canViewFinancials = ['admin', 'manager'].includes(user?.role || '');

  useEffect(() => { setBreadcrumbs([{ label: 'Listino' }]); }, [setBreadcrumbs]);

  const options = useMemo(() => {
    const rows = materials as MaterialRow[];
    const values = (key: keyof MaterialRow) => [...new Set(rows.map((item) => String(item[key] ?? '').trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, 'it', { sensitivity: 'base', numeric: true }));
    return { categories: values('category'), suppliers: values('supplier'), thicknesses: values('thickness'), variants: values('variant') };
  }, [materials]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('it-IT');
    return (materials as MaterialRow[]).filter((item) => {
      const haystack = [item.name, item.category, item.supplier, item.thickness, item.variant, item.unit].map((value) => String(value ?? '').toLocaleLowerCase('it-IT'));
      const matchesSearch = !query || haystack.some((value) => value.includes(query));
      const matchesActive = !active || (active === 'active' ? item.active !== false : item.active === false);
      return matchesSearch
        && (!category || String(item.category || '') === category)
        && (!supplier || String(item.supplier || '') === supplier)
        && (!thickness || String(item.thickness || '') === thickness)
        && (!variant || String(item.variant || '') === variant)
        && matchesActive;
    }).sort((left, right) => {
      const result = String(left.name || '').localeCompare(String(right.name || ''), 'it', { sensitivity: 'base', numeric: true });
      return order === 'asc' ? result : -result;
    });
  }, [active, category, materials, order, search, supplier, thickness, variant]);

  const reset = () => { setSearch(''); setCategory(''); setSupplier(''); setThickness(''); setVariant(''); setActive(''); setOrder('asc'); };

  return <div className="min-h-screen bg-light-bg p-6 text-light-text dark:bg-dark-bg dark:text-dark-text">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Listino</h1><p className="mt-1 text-sm text-gray-500">Consultazione rapida dei prezzi materiali. Modifica materiali da Materiali.</p></div>{canImport && <button type="button" onClick={() => setImportOpen(true)} className="flex items-center gap-2 rounded-md border px-4 py-2"><FileSpreadsheet size={18} /> Importa listino .xlsx</button>}</div>
    <section className="rounded-lg bg-white shadow-sm dark:bg-dark-card" aria-label="Filtri listino">
      <div className="border-b p-4 dark:border-dark-border"><div className="flex flex-wrap items-center gap-3"><div className="relative min-w-[16rem] flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca materiale, categoria, fornitore..." className="w-full rounded-md border bg-light-bg py-2 pl-10 pr-3 dark:bg-dark-input" /></div><button type="button" onClick={() => setOrder((value) => value === 'asc' ? 'desc' : 'asc')} className="flex items-center gap-2 rounded-md border px-3 py-2" aria-label={`Ordine ${order === 'asc' ? 'A-Z' : 'Z-A'}, cambia ordine`}>{order === 'asc' ? <ArrowDownAZ size={18} /> : <ArrowUpAZ size={18} />}{order === 'asc' ? 'A-Z' : 'Z-A'}</button><button type="button" onClick={reset} className="flex items-center gap-2 rounded-md border px-3 py-2"><RotateCcw size={17} /> Azzera filtri</button></div><div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6"><label><span className="mb-1 block text-xs font-medium">Categoria</span><select value={category} onChange={(event) => setCategory(event.target.value)} className="w-full rounded border p-2 dark:bg-dark-input"><option value="">Tutte</option>{options.categories.map((value) => <option key={value}>{value}</option>)}</select></label><label><span className="mb-1 block text-xs font-medium">Fornitore</span><select value={supplier} onChange={(event) => setSupplier(event.target.value)} className="w-full rounded border p-2 dark:bg-dark-input"><option value="">Tutti</option>{options.suppliers.map((value) => <option key={value}>{value}</option>)}</select></label><label><span className="mb-1 block text-xs font-medium">Spessore</span><select value={thickness} onChange={(event) => setThickness(event.target.value)} className="w-full rounded border p-2 dark:bg-dark-input"><option value="">Tutti</option>{options.thicknesses.map((value) => <option key={value}>{value}</option>)}</select></label><label><span className="mb-1 block text-xs font-medium">Variante / finitura</span><select value={variant} onChange={(event) => setVariant(event.target.value)} className="w-full rounded border p-2 dark:bg-dark-input"><option value="">Tutte</option>{options.variants.map((value) => <option key={value}>{value}</option>)}</select></label><label><span className="mb-1 block text-xs font-medium">Stato</span><select value={active} onChange={(event) => setActive(event.target.value as ActiveFilter)} className="w-full rounded border p-2 dark:bg-dark-input"><option value="">Attivi e disattivi</option><option value="active">Solo attivi</option><option value="inactive">Solo disattivi</option></select></label><div className="flex items-end text-sm text-gray-500"><Filter size={16} className="mr-1" /> {filtered.length} risultati</div></div></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-light-bg dark:bg-dark-bg"><tr><th className="px-4 py-3 text-left">Materiale</th><th className="px-4 py-3 text-left">Categoria</th><th className="px-4 py-3 text-left">Spessore</th><th className="px-4 py-3 text-left">Finitura / variante</th><th className="px-4 py-3 text-left">Unità</th><th className="px-4 py-3 text-left">Prezzo</th><th className="px-4 py-3 text-left">Fornitore</th><th className="px-4 py-3 text-left">Stato</th></tr></thead><tbody className="divide-y dark:divide-dark-border">{filtered.map((item) => <tr key={String(item.id)}><td className="px-4 py-3 font-medium">{item.name}</td><td className="px-4 py-3">{item.category || '—'}</td><td className="px-4 py-3">{item.thickness || '—'}</td><td className="px-4 py-3">{item.variant || '—'}</td><td className="px-4 py-3">{item.unit || '—'}</td><td className="px-4 py-3">{canViewFinancials ? formatEuro(item.unitPrice ?? item.price) : 'Prezzo riservato'}</td><td className="px-4 py-3">{item.supplier || '—'}</td><td className="px-4 py-3">{item.active === false ? 'Disattivo' : 'Attivo'}</td></tr>)}{!filtered.length && <tr><td colSpan={8} className="px-6 py-12 text-center text-gray-500">Nessun materiale nel listino.</td></tr>}</tbody></table></div>
    </section>
    {canImport && <MaterialImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={() => window.dispatchEvent(new CustomEvent('crm-data-refresh-requested'))} />}
  </div>;
};

export default ListinoPage;
