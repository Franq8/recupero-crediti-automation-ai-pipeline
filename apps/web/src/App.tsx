import { ChangeEvent, useEffect, useMemo, useState } from 'react';

const API = 'http://localhost:8787';

type WorkingMode = 'STANDARD_DOCUMENT_SET' | 'DETERMINISTIC_TABLE_FIRST';
type Practice = { id: string; selectedTemplateId?: string | null; workingMode: WorkingMode };
type Template = { id: string; name: string; version: number };
type PracticeFile = { id: string; filename: string; kind: string; noteText?: string | null; documentSetId?: string | null };
type DocumentSet = { id: string; label: string; files: PracticeFile[] };
type TableRow = {
  id: string;
  rowIndex: number;
  source: string;
  originMode?: WorkingMode;
  sourceSetId?: string | null;
  status?: string;
  reviewState?: string;
  qualityScore?: number | null;
  values: Record<string, unknown>;
};
type WorkflowReport = {
  phase: 'first-table' | 'final-table';
  mode?: WorkingMode;
  row: TableRow;
  inputSummary?: Record<string, unknown>;
  comparison?: {
    outcome: 'match' | 'non-match';
    matched: string[];
    missing: string[];
    extra: string[];
  };
  warnings?: Array<{ code: string; level: string; message: string }>;
  missingKeys?: string[];
  hasSpecialPlaceholders?: boolean;
  nextAction?: string;
  derivedKeys?: string[];
  generatedKeys?: string[];
};

function modeLabel(mode: WorkingMode) {
  return mode === 'STANDARD_DOCUMENT_SET' ? 'Template + documentazione' : 'Template + tabella';
}

export function App() {
  const [practices, setPractices] = useState<Practice[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [currentPracticeId, setCurrentPracticeId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [workingMode, setWorkingMode] = useState<WorkingMode>('STANDARD_DOCUMENT_SET');
  const [files, setFiles] = useState<PracticeFile[]>([]);
  const [documentSets, setDocumentSets] = useState<DocumentSet[]>([]);
  const [selectedDocumentSetId, setSelectedDocumentSetId] = useState('');
  const [newDocumentSetLabel, setNewDocumentSetLabel] = useState('Set 1');
  const [tableRows, setTableRows] = useState<TableRow[]>([]);
  const [activeRowIndex, setActiveRowIndex] = useState<number | null>(null);
  const [templateName, setTemplateName] = useState('precetto_base');
  const [templateFields, setTemplateFields] = useState<string[]>([]);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [rowDraft, setRowDraft] = useState<Record<string, string>>({});
  const [report1, setReport1] = useState<WorkflowReport | null>(null);
  const [report2, setReport2] = useState<WorkflowReport | null>(null);
  const [deriveJson, setDeriveJson] = useState('{}');
  const [generateJson, setGenerateJson] = useState('{}');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const allColumns = useMemo(() => {
    const keys = new Set<string>();
    tableRows.forEach((row) => Object.keys(row.values ?? {}).forEach((key) => keys.add(key)));
    return Array.from(keys).sort();
  }, [tableRows]);

  const activeRow = useMemo(
    () => tableRows.find((row) => row.rowIndex === activeRowIndex) ?? null,
    [tableRows, activeRowIndex]
  );

  const workspaceSummary = useMemo(() => {
    const rows = tableRows.length;
    const ready = tableRows.filter((row) => row.status === 'READY').length;
    const review = tableRows.filter((row) => row.status === 'NEEDS_REVIEW' || row.reviewState === 'TODO' || row.reviewState === 'IN_REVIEW').length;
    const generated = tableRows.filter((row) => row.status === 'OUTPUT_GENERATED').length;
    return { rows, ready, review, generated };
  }, [tableRows]);

  useEffect(() => {
    if (activeRow) {
      setRowDraft(Object.fromEntries(Object.entries(activeRow.values ?? {}).map(([key, value]) => [key, value == null ? '' : String(value)])));
    } else {
      setRowDraft({});
    }
  }, [activeRow]);

  async function fetchPractices() {
    const res = await fetch(`${API}/practices`);
    const json = await res.json();
    setPractices(json.data ?? []);
  }

  async function fetchTemplates() {
    const res = await fetch(`${API}/templates`);
    const json = await res.json();
    setTemplates(json.data ?? []);
  }

  async function fetchTemplateFields(templateId: string) {
    if (!templateId) {
      setTemplateFields([]);
      return;
    }
    const res = await fetch(`${API}/templates/${templateId}/fields`);
    const json = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json));
    setTemplateFields(json.data?.fields ?? []);
  }

  async function refreshRows(practiceId = currentPracticeId) {
    if (!practiceId) return;
    const res = await fetch(`${API}/practices/${practiceId}/table-rows`);
    const json = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json));
    const rows = (json.data ?? []) as TableRow[];
    setTableRows(rows);
    if (rows.length) setActiveRowIndex((prev) => prev ?? rows[0].rowIndex);
    if (!rows.length) setActiveRowIndex(null);
  }

  async function loadPractice(practiceId: string) {
    const res = await fetch(`${API}/practices/${practiceId}`);
    const json = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json));
    setCurrentPracticeId(practiceId);
    setSelectedTemplateId(json.data?.selectedTemplateId ?? '');
    setWorkingMode(json.data?.workingMode ?? 'STANDARD_DOCUMENT_SET');
    setFiles(json.data?.files ?? []);
    setDocumentSets(json.data?.documentSets ?? []);
    setSelectedDocumentSetId(json.data?.documentSets?.[0]?.id ?? '');
    setNoteDrafts(Object.fromEntries((json.data?.files ?? []).map((f: PracticeFile) => [f.id, f.noteText ?? ''])));
    setReport1(null);
    setReport2(null);
    await fetchTemplateFields(json.data?.selectedTemplateId ?? '');
    await refreshRows(practiceId);
  }

  useEffect(() => {
    void (async () => {
      await fetchPractices();
      await fetchTemplates();
    })();
  }, []);

  async function createPractice() {
    setLoading(true); setError(''); setMsg('');
    try {
      const res = await fetch(`${API}/practices`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: 'web-user' })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(json));
      await fetchPractices();
      await loadPractice(json.data.id);
      setMsg(`Pratica creata: ${json.data.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function uploadTo(url: string, file: File, extras: Record<string, string>) {
    const fd = new FormData();
    fd.append('file', file);
    Object.entries(extras).forEach(([key, value]) => fd.append(key, value));
    const res = await fetch(url, { method: 'POST', body: fd });
    const json = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json));
    return json;
  }

  async function onUploadTemplate(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true); setError(''); setMsg('');
    try {
      await uploadTo(`${API}/templates`, file, { name: templateName, actor: 'web-user' });
      await fetchTemplates();
      setMsg('Template caricato');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  }

  async function onUploadPracticeFiles(e: ChangeEvent<HTMLInputElement>) {
    if (!currentPracticeId || !e.target.files?.length) return;
    setLoading(true); setError(''); setMsg('');
    try {
      for (const file of Array.from(e.target.files)) {
        await uploadTo(`${API}/practices/${currentPracticeId}/files`, file, {
          actor: 'web-user',
          kind: 'PRACTICE_DOCUMENT',
          documentSetId: workingMode === 'STANDARD_DOCUMENT_SET' ? selectedDocumentSetId : ''
        });
      }
      await loadPractice(currentPracticeId);
      setMsg('File caricati');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  }

  async function onImportFile(e: ChangeEvent<HTMLInputElement>) {
    if (!currentPracticeId) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true); setError(''); setMsg('');
    try {
      await uploadTo(`${API}/practices/${currentPracticeId}/import`, file, { actor: 'web-user' });
      await refreshRows();
      setWorkingMode('DETERMINISTIC_TABLE_FIRST');
      setReport1(null);
      setReport2(null);
      setMsg('Tabella importata');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  }

  async function selectTemplate(templateId: string) {
    if (!currentPracticeId) return;
    setLoading(true); setError(''); setMsg('');
    try {
      const res = await fetch(`${API}/practices/${currentPracticeId}/select-template`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ templateId, actor: 'web-user' })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(json));
      setSelectedTemplateId(templateId);
      await fetchTemplateFields(templateId);
      setReport1(null);
      setReport2(null);
      setMsg('Template selezionato');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function updateMode(nextMode: WorkingMode) {
    if (!currentPracticeId) return;
    setLoading(true); setError(''); setMsg('');
    try {
      const res = await fetch(`${API}/practices/${currentPracticeId}/mode`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: nextMode, actor: 'web-user' })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(json));
      setWorkingMode(nextMode);
      setReport1(null);
      setReport2(null);
      setMsg(`Iter attivo: ${modeLabel(nextMode)}`);
      await fetchPractices();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function createDocumentSet() {
    if (!currentPracticeId) return;
    setLoading(true); setError(''); setMsg('');
    try {
      const res = await fetch(`${API}/practices/${currentPracticeId}/document-sets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: newDocumentSetLabel, actor: 'web-user' })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(json));
      await loadPractice(currentPracticeId);
      setSelectedDocumentSetId(json.data.id);
      setMsg(`Creato document set: ${json.data.label}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function saveFileNote(fileId: string) {
    if (!currentPracticeId) return;
    setLoading(true); setError(''); setMsg('');
    try {
      const res = await fetch(`${API}/practices/${currentPracticeId}/files/${fileId}/note`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note: noteDrafts[fileId] ?? '', actor: 'web-user' })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(json));
      await loadPractice(currentPracticeId);
      setMsg(`Nota salvata per file ${json.data.fileId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function prepareFirstTable() {
    if (!currentPracticeId || !selectedTemplateId) return;
    setLoading(true); setError(''); setMsg('');
    try {
      const res = await fetch(`${API}/practices/${currentPracticeId}/workflow/prepare`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          actor: 'web-user',
          mode: workingMode,
          templateId: selectedTemplateId,
          documentSetId: workingMode === 'STANDARD_DOCUMENT_SET' ? selectedDocumentSetId || undefined : undefined,
          rowIndex: activeRowIndex || 1
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? JSON.stringify(json));
      setReport1(json.data);
      setReport2(null);
      await refreshRows();
      setActiveRowIndex(json.data.row.rowIndex);
      setMsg(json.data.hasSpecialPlaceholders ? 'Prima tabella pronta. Ora puoi rivederla e, se serve, arricchirla.' : 'Prima tabella pronta. Se vuoi, puoi generare subito dal workspace.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function enrichFinalTable() {
    if (!currentPracticeId || !selectedTemplateId || !activeRowIndex) return;
    setLoading(true); setError(''); setMsg('');
    try {
      const deriveValues = JSON.parse(deriveJson || '{}') as Record<string, unknown>;
      const generateValues = JSON.parse(generateJson || '{}') as Record<string, unknown>;
      const res = await fetch(`${API}/practices/${currentPracticeId}/workflow/enrich`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          actor: 'web-user',
          templateId: selectedTemplateId,
          rowIndex: activeRowIndex,
          deriveValues,
          generateValues
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? JSON.stringify(json));
      setReport2(json.data);
      await refreshRows();
      setMsg('Seconda tabella pronta. La generazione userà questa tabella finale.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function saveActiveRow() {
    if (!currentPracticeId || !activeRowIndex) return;
    setLoading(true); setError(''); setMsg('');
    try {
      const res = await fetch(`${API}/practices/${currentPracticeId}/table-rows`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          actor: 'web-user',
          rowIndex: activeRowIndex,
          values: rowDraft,
          originMode: workingMode,
          source: report2 ? 'workflow-final-table-manual' : report1 ? 'workflow-first-table-manual' : 'manual-table',
          status: 'NEEDS_REVIEW',
          reviewState: 'TODO'
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(json));
      await refreshRows();
      setMsg(`Riga ${json.data.rowIndex} aggiornata`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function generateDocxFromActiveRow() {
    if (!currentPracticeId || !activeRowIndex || !selectedTemplateId) return;
    setLoading(true); setError(''); setMsg('');
    try {
      const res = await fetch(`${API}/practices/${currentPracticeId}/generate-docx-from-row`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: 'web-user', rowIndex: activeRowIndex, templateId: selectedTemplateId })
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `precetto_${currentPracticeId}_row${activeRowIndex}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      await refreshRows();
      setMsg(`DOCX generato dalla riga ${activeRowIndex}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const visibleFiles = workingMode === 'STANDARD_DOCUMENT_SET' && selectedDocumentSetId
    ? files.filter((file) => file.documentSetId === selectedDocumentSetId)
    : files;

  return (
    <div className="page">
      <div className="hero">
        <div>
          <h1>Recupero Crediti Automation</h1>
          <p className="sub">Due iter principali, prima tabella sempre, eventuale seconda tabella solo per placeholder speciali, generazione finale sempre dal workspace.</p>
        </div>
        <div className="hero-actions">
          <button disabled={loading} onClick={createPractice}>Nuova pratica</button>
          <div className="badge strong">Iter attivo: {modeLabel(workingMode)}</div>
        </div>
      </div>

      <section className="card">
        <h2>1. Iter principali</h2>
        <div className="path-grid">
          <button className={`path-card ${workingMode === 'STANDARD_DOCUMENT_SET' ? 'selected' : ''}`} disabled={!currentPracticeId || loading} onClick={() => updateMode('STANDARD_DOCUMENT_SET')}>
            <span className="path-title">Template + documentazione</span>
            <span className="path-text">Carichi template e documenti, ottieni la prima tabella, la correggi, poi eventualmente arricchisci i placeholder speciali.</span>
          </button>
          <button className={`path-card ${workingMode === 'DETERMINISTIC_TABLE_FIRST' ? 'selected' : ''}`} disabled={!currentPracticeId || loading} onClick={() => updateMode('DETERMINISTIC_TABLE_FIRST')}>
            <span className="path-title">Template + tabella</span>
            <span className="path-text">Carichi template e una sola tabella, vedi match/non-match senza blocchi inutili, poi lavori sulla tabella fino alla generazione.</span>
          </button>
        </div>
        <div className="info-box compact" style={{ marginTop: 12 }}>
          <strong>Funzione separata:</strong> Solo template = utility laterale per scaricare la struttura tabellare corretta dal template, non un iter principale.
        </div>
      </section>

      <div className="grid2 top-grid">
        <section className="card">
          <h2>2. Pratica</h2>
          <ul className="practice-list">
            {practices.map((practice) => (
              <li key={practice.id}>
                <button className={`link ${practice.id === currentPracticeId ? 'active' : ''}`} onClick={() => loadPractice(practice.id)}>{practice.id}</button>
                <span className="badge">{modeLabel(practice.workingMode)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>3. Template</h2>
          <label>Nome template</label>
          <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
          <input type="file" accept=".docx" onChange={onUploadTemplate} />
          <ul className="template-list">
            {templates.map((template) => (
              <li key={template.id}>
                <div><strong>{template.name}</strong> <span className="sub small">v{template.version}</span></div>
                <button disabled={!currentPracticeId || loading} onClick={() => selectTemplate(template.id)}>{selectedTemplateId === template.id ? 'Selezionato' : 'Usa questo template'}</button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card">
        <h2>4. Utility solo-template</h2>
        <p className="sub small">Serve per costruire la tabella corretta fuori piattaforma. Non cambia il flusso principale.</p>
        {selectedTemplateId ? (
          <div className="row">
            <a className="btnlink" href={`${API}/templates/${selectedTemplateId}/table-structure/xlsx`} target="_blank" rel="noreferrer">Scarica XLSX struttura</a>
            <a className="btnlink" href={`${API}/templates/${selectedTemplateId}/table-structure/csv`} target="_blank" rel="noreferrer">Scarica CSV struttura</a>
            <a className="btnlink" href={`${API}/templates/${selectedTemplateId}/table-structure/json`} target="_blank" rel="noreferrer">Scarica JSON struttura</a>
          </div>
        ) : <div className="warn">Seleziona prima un template.</div>}
      </section>

      <section className="card">
        <h2>5. Upload separato</h2>
        {!currentPracticeId && <div className="warn">Prima crea o seleziona una pratica.</div>}
        {!selectedTemplateId && currentPracticeId && <div className="warn">Prima seleziona un template valido.</div>}
        <div className="grid2 compact-grid">
          <div className="stack">
            <label>Area documentazione</label>
            {workingMode === 'STANDARD_DOCUMENT_SET' && (
              <>
                <div className="row">
                  <input value={newDocumentSetLabel} onChange={(e) => setNewDocumentSetLabel(e.target.value)} placeholder="Nome set" />
                  <button disabled={!currentPracticeId || loading} onClick={createDocumentSet}>Crea set</button>
                </div>
                <div className="set-list">
                  {documentSets.map((set) => (
                    <button key={set.id} className={`set-pill ${selectedDocumentSetId === set.id ? 'selected' : ''}`} onClick={() => setSelectedDocumentSetId(set.id)}>
                      {set.label} <span className="badge">{set.files.length} file</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <input type="file" multiple accept=".pdf,.docx,.txt,.xlsx,.csv" disabled={!currentPracticeId || loading || (workingMode === 'STANDARD_DOCUMENT_SET' && !selectedDocumentSetId)} onChange={onUploadPracticeFiles} />
          </div>
          <div className="stack">
            <label>Area tabella</label>
            <input type="file" accept=".xlsx,.csv,.json" disabled={!currentPracticeId || loading} onChange={onImportFile} />
            <p className="sub small">Nel percorso documentale la tabella è il workspace intermedio/finale. Nel percorso tabellare la tabella è anche input iniziale.</p>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>6. Primo mini-report + prima tabella</h2>
        <div className="row">
          <button disabled={!currentPracticeId || !selectedTemplateId || loading || (workingMode === 'STANDARD_DOCUMENT_SET' && !selectedDocumentSetId)} onClick={prepareFirstTable}>Prepara prima tabella</button>
        </div>
        {report1 && (
          <div className="stack" style={{ marginTop: 12 }}>
            <div className="info-box">
              <strong>Fase:</strong> {report1.phase}
              <span><strong>Riga:</strong> {report1.row.rowIndex}</span>
              {report1.inputSummary && <span><strong>Input:</strong> {JSON.stringify(report1.inputSummary)}</span>}
            </div>
            {report1.comparison && (
              <div className={`match-summary severity-${report1.comparison.outcome === 'match' ? 'ok' : 'warning'}`}>
                <div><strong>Esito:</strong> {report1.comparison.outcome}</div>
                <div><strong>Riconosciute:</strong> {report1.comparison.matched.length}</div>
                <div><strong>Mancanti:</strong> {report1.comparison.missing.length}</div>
                <div><strong>Extra:</strong> {report1.comparison.extra.length}</div>
              </div>
            )}
            {!!report1.warnings?.length && report1.warnings.map((warning) => (
              <div className="warn" key={warning.code}>{warning.message}</div>
            ))}
            {!report1.warnings?.length && <div className="ok">Nessun warning rilevante nella prima tabella.</div>}
            <div className="info-box compact">
              <strong>Prossimo passo:</strong> {report1.hasSpecialPlaceholders ? 'Puoi rivedere la tabella e poi creare la seconda tabella arricchita.' : 'Puoi rivedere la tabella e generare direttamente dal workspace.'}
            </div>
          </div>
        )}
      </section>

      <section className="card workspace-card">
        <div className="workspace-header">
          <div>
            <h2>7. Workspace tabellare editabile</h2>
            <p className="sub small">La generazione usa sempre la riga corrente del workspace.</p>
          </div>
          <div className="workspace-actions row">
            <button disabled={!activeRowIndex || loading} onClick={saveActiveRow}>Salva riga attiva</button>
            <button disabled={!activeRowIndex || !selectedTemplateId || loading} onClick={generateDocxFromActiveRow}>Genera DOCX</button>
            {!!currentPracticeId && <a className="btnlink" href={`${API}/practices/${currentPracticeId}/table-rows/export.csv`} target="_blank" rel="noreferrer">Esporta CSV workspace</a>}
          </div>
        </div>
        <div className="metrics-grid">
          <div className="metric"><strong>{workspaceSummary.rows}</strong><span>righe</span></div>
          <div className="metric"><strong>{workspaceSummary.ready}</strong><span>pronte</span></div>
          <div className="metric"><strong>{workspaceSummary.review}</strong><span>da verificare</span></div>
          <div className="metric"><strong>{workspaceSummary.generated}</strong><span>generate</span></div>
          <div className="metric"><strong>{allColumns.length}</strong><span>colonne</span></div>
        </div>
        {!!tableRows.length && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Attiva</th>
                  <th>Riga</th>
                  <th>Origine</th>
                  <th>Iter</th>
                  <th>Stato</th>
                  {allColumns.map((column) => <th key={column}>{column}</th>)}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => (
                  <tr key={row.id} className={activeRowIndex === row.rowIndex ? 'active-row' : ''}>
                    <td><input type="radio" checked={activeRowIndex === row.rowIndex} onChange={() => setActiveRowIndex(row.rowIndex)} /></td>
                    <td>{row.rowIndex}</td>
                    <td>{row.source}</td>
                    <td>{row.originMode ? modeLabel(row.originMode) : '—'}</td>
                    <td>{row.status ?? '—'}</td>
                    {allColumns.map((column) => <td key={`${row.id}-${column}`}>{String(row.values?.[column] ?? '—')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!!activeRow && (
          <div className="grid2 compact-grid" style={{ marginTop: 16 }}>
            <div className="stack">
              <h3>Editor riga #{activeRow.rowIndex}</h3>
              {Object.keys(rowDraft).sort().map((key) => (
                <div key={key}>
                  <label>{key}</label>
                  <textarea value={rowDraft[key] ?? ''} onChange={(e) => setRowDraft((prev) => ({ ...prev, [key]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div className="stack">
              <h3>Note documento</h3>
              {!visibleFiles.length && <p>Nessun file nel contesto corrente.</p>}
              {visibleFiles.map((file) => (
                <div className="note-card" key={file.id}>
                  <div><strong>{file.filename}</strong> <span className="badge">{file.kind}</span></div>
                  <textarea value={noteDrafts[file.id] ?? ''} onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [file.id]: e.target.value }))} placeholder="Nota contestuale per questo documento" />
                  <button disabled={loading} onClick={() => saveFileNote(file.id)}>Salva nota</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {report1?.hasSpecialPlaceholders && (
        <section className="card">
          <h2>8. Secondo mini-report + tabella finale</h2>
          <p className="sub small">Usa questa fase solo se il template contiene placeholder speciali. Se non servono, non compare nessuna seconda tabella.</p>
          <div className="grid2 compact-grid">
            <div>
              <label>Valori DERIVE (JSON oggetto)</label>
              <textarea value={deriveJson} onChange={(e) => setDeriveJson(e.target.value)} />
            </div>
            <div>
              <label>Valori GENERATE (JSON oggetto)</label>
              <textarea value={generateJson} onChange={(e) => setGenerateJson(e.target.value)} />
            </div>
          </div>
          <div className="row">
            <button disabled={!activeRowIndex || loading} onClick={enrichFinalTable}>Crea seconda tabella</button>
          </div>
          {report2 && (
            <div className="stack" style={{ marginTop: 12 }}>
              <div className="info-box">
                <strong>Secondo mini-report</strong>
                <span><strong>Riga:</strong> {report2.row.rowIndex}</span>
                <span><strong>Derivati:</strong> {(report2.derivedKeys ?? []).join(', ') || 'nessuno'}</span>
                <span><strong>Generati:</strong> {(report2.generatedKeys ?? []).join(', ') || 'nessuno'}</span>
              </div>
              {!!report2.warnings?.length && report2.warnings.map((warning) => (
                <div className="warn" key={warning.code}>{warning.message}</div>
              ))}
              {!report2.warnings?.length && <div className="ok">Seconda tabella pronta senza warning ulteriori.</div>}
            </div>
          )}
        </section>
      )}

      {msg && <div className="ok sticky-msg">{msg}</div>}
      {error && <div className="error sticky-msg">{error}</div>}
    </div>
  );
}
