from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if old not in text:
        raise RuntimeError(f'Pattern not found in {path}: {old[:140]!r}')
    path.write_text(text.replace(old, new, 1))


# Reject responses that belong to a previous account/server/generation.
api = ROOT / 'src/services/api.ts'
replace_once(
    api,
    """interface ReplayConfig extends AxiosRequestConfig {
  _replay?: boolean;
}
""",
    """interface ReplayConfig extends AxiosRequestConfig {
  _replay?: boolean;
  _crmContext?: string;
}
""",
)
replace_once(
    api,
    """const operationId = () => crypto.randomUUID();
const normalizeBaseUrl = (value: string) => value.trim().replace(/\/$/, '');
""",
    """const operationId = () => crypto.randomUUID();
const normalizeBaseUrl = (value: string) => value.trim().replace(/\/$/, '');
const currentUserId = () => {
  try {
    return String(JSON.parse(localStorage.getItem('crm_user_data') || 'null')?.id || '');
  } catch {
    return '';
  }
};
const clientContextFingerprint = () => [
  normalizeBaseUrl(localStorage.getItem('crm_api_base_url') || import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3001/api'),
  localStorage.getItem(SERVER_ID_KEY) || '',
  localStorage.getItem(DATA_EPOCH_KEY) || '',
  currentUserId(),
].join('|');
""",
)
replace_once(
    api,
    """      config.baseURL = this.getBaseURL();
      config.headers = config.headers || {};
""",
    """      config.baseURL = this.getBaseURL();
      config._crmContext = clientContextFingerprint();
      config.headers = config.headers || {};
""",
)
replace_once(
    api,
    """    this.axiosInstance.interceptors.response.use(
      (response) => response,
      async (error) => {
""",
    """    this.axiosInstance.interceptors.response.use(
      (response) => {
        const requestContext = (response.config as ReplayConfig)._crmContext;
        if (requestContext && requestContext !== clientContextFingerprint()) {
          const error = new Error('Risposta ignorata perché account o server sono cambiati');
          (error as any).code = 'STALE_CONTEXT_RESPONSE';
          return Promise.reject(error);
        }
        return response;
      },
      async (error) => {
""",
)

# Dashboard notes follow stable server identity, not DHCP address.
dashboard = ROOT / 'src/pages/DashboardPage.jsx'
replace_once(dashboard, "import { apiClient } from '../services/api';\n", '')
replace_once(
    dashboard,
    "import { formatEuro, parseLocaleNumber } from '../utils/numbers';\n",
    "import { formatEuro, parseLocaleNumber } from '../utils/numbers';\nimport { observeServerScope, stableServerKey } from '../utils/serverScope';\n",
)
start = dashboard.read_text().find('const hashScope = (value) => {')
if start < 0:
    raise RuntimeError('Dashboard hashScope start not found')
end = dashboard.read_text().find('\n\nconst parseDate', start)
text = dashboard.read_text()
dashboard.write_text(text[:start] + text[end + 2:])
replace_once(
    dashboard,
    """  const [completingId, setCompletingId] = useState(null);

  const canViewProjects""",
    """  const [completingId, setCompletingId] = useState(null);
  const [notesScopeRevision, setNotesScopeRevision] = useState(0);

  const canViewProjects""",
)
replace_once(
    dashboard,
    """  const notesKey = `dashboardNotes:${String(user?.id || 'anonymous')}:${hashScope(apiClient.getBaseURL())}`;

  useEffect(() => {
""",
    """  const notesKey = `dashboardNotes:${String(user?.id || 'anonymous')}:${stableServerKey(false)}`;

  useEffect(() => observeServerScope(() => setNotesScopeRevision((value) => value + 1)), []);

  useEffect(() => {
""",
)
# Ensure React recomputes the key when an identity event occurs.
replace_once(
    dashboard,
    """  const notesKey = `dashboardNotes:${String(user?.id || 'anonymous')}:${stableServerKey(false)}`;
""",
    """  const notesKey = useMemo(
    () => `dashboardNotes:${String(user?.id || 'anonymous')}:${stableServerKey(false)}`,
    [user?.id, notesScopeRevision],
  );
""",
)

# Align old Redux material paths with version preconditions and offline semantics.
materials = ROOT / 'src/store/slices/materialsSlice.ts'
replace_once(
    materials,
    """  description?: string;
  specifications?: Record<string, any>;
  createdAt: string;
""",
    """  description?: string;
  specifications?: Record<string, any>;
  version?: number;
  _queued?: boolean;
  createdAt: string;
""",
)
replace_once(
    materials,
    """       toast.success('Materiale creato con successo');
       return response.data;
""",
    """       if (response.status !== 202) toast.success('Materiale creato con successo');
       return response.data;
""",
)
replace_once(
    materials,
    """  { id: string; data: Partial<CreateMaterialRequest> },
""",
    """  { id: string; data: Partial<CreateMaterialRequest> & { version?: number } },
""",
)
replace_once(
    materials,
    """    try {
      const response = await apiClient.getInstance().put(`/materials/${id}`, data);
      
      // Invalida la cache
""",
    """    try {
      const version = Number(data.version);
      if (!Number.isInteger(version) || version < 1) {
        throw new Error('Versione materiale non disponibile. Ricarica i dati.');
      }
      const response = await apiClient.getInstance().put(`/materials/${id}`, {
        ...data,
        expectedVersion: version,
      });
      
      // Invalida la cache
""",
)
replace_once(
    materials,
    """       toast.success('Materiale aggiornato con successo');
       return response.data;
""",
    """       if (response.status !== 202) toast.success('Materiale aggiornato con successo');
       return response.data;
""",
)
replace_once(
    materials,
    """  string,
  string,
  { rejectValue: string }
>(
  'materials/deleteMaterial',
  async (materialId, { rejectWithValue }) => {
    try {
      await apiClient.getInstance().delete(`/materials/${materialId}`);
""",
    """  string,
  { id: string; version: number },
  { rejectValue: string }
>(
  'materials/deleteMaterial',
  async ({ id, version }, { rejectWithValue }) => {
    try {
      if (!Number.isInteger(Number(version)) || Number(version) < 1) {
        throw new Error('Versione materiale non disponibile. Ricarica i dati.');
      }
      const response = await apiClient.getInstance().delete(`/materials/${id}`, {
        headers: { 'If-Match': String(version) },
      });
""",
)
replace_once(materials, "await cacheService.delete('materials', materialId);", "await cacheService.delete('materials', id);")
replace_once(
    materials,
    """       toast.success('Materiale eliminato con successo');
       return materialId;
""",
    """       if (response.status !== 202) toast.success('Materiale eliminato con successo');
       return id;
""",
)
replace_once(
    materials,
    """              material.name.toLowerCase().includes(query.toLowerCase()) ||
              material.category.toLowerCase().includes(query.toLowerCase()) ||
              material.supplier.toLowerCase().includes(query.toLowerCase())
""",
    """              String(material.name || '').toLowerCase().includes(query.toLowerCase()) ||
              String(material.category || '').toLowerCase().includes(query.toLowerCase()) ||
              String(material.supplier || '').toLowerCase().includes(query.toLowerCase())
""",
)
