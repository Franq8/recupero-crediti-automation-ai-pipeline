import { ChangeEvent, useEffect, useMemo, useState } from 'react';

const API = 'http://localhost:8787';

type Practice = { id: string; caseType: string; selectedTemplateId?: string | null; createdAt: string };
type Template = { id: string; name: string; version: number; filename: string };
type FieldRow = { id: string; fieldKey: string; valueJson: string; status: string; sourceType: string; confidence?: number|null; sourceRef?: string|null };

const PRESET_FIELDS = [
  'creditore_denominazione',
  'debitore_denominazione_nome',
  'tribunale',
  'di_numero',
  'rg_numero',
  'capitale_ingiunto',
  'di_data_notifica',
  'flag_esecutorieta_nel_titolo'
];

export function App() {
  const [practices, setPractices] = useState<Practice[]>([]);
  const [currentPracticeId, setCurrentPracticeId] = useState<string>('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [rawRows, setRawRows] = useState<FieldRow[]>([]);
  const [templateName, setTemplateName] = useState('precetto_base');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateFields, setTemplateFields] = useState<string[]>([]);
  const [mappingPreview, setMappingPreview] = useState<{mappingCoverage:number;unknown:string[];mapped:string[]}|null>(null);
  const [consistency, setConsistency] = useState<{manualFlag:string;autoDetection:string;conflict:boolean}|null>(null);
  const [templateReport, setTemplateReport] = useState<{coverage:number;missing:string[];filled:string[];templateFields:string[]}|null>(null);
  const [qualityGate, setQualityGate] = useState<{score:number;level:string;missingStrong:string[];conflictExec:boolean}|null>(null);
  const [audit, setAudit] = useState<Array<{id:string;action:string;actor:string;createdAt:string}>>([]);
  const [fieldFilter, setFieldFilter] = useState<'all'|'missing'|'manual'|'conflict'>('all');
  const [finalReport, setFinalReport] = useState<{qualityScore:number;missingFields:string[];totals:{files:number;fields:number;missing:number}}|null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const orderedKeys = useMemo(() => {
    const dynamic = Object.keys(fields).filter((k) => !PRESET_FIELDS.includes(k)).sort();
    return [...PRESET_FIELDS, ...dynamic];
  }, [fields]);

  const filteredKeys = useMemo(() => {
    if (fieldFilter === 'all') return orderedKeys;
    if (fieldFilter === 'conflict') return orderedKeys.filter((k) => k === 'conflitto_esecutorieta');
    return orderedKeys.filter((k) => {
      const row = rawRows.find((r) => r.fieldKey === k);
      if (fieldFilter === 'missing') return !row || row.status === 'MISSING';
      if (fieldFilter === 'manual') return row?.sourceType === 'manual' || row?.status === 'MANUAL';
      return true;
    });
  }, [orderedKeys, fieldFilter, rawRows]);


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

  async function loadPractice(id: string) {
    const res = await fetch(`${API}/practices/${id}`);
    const json = await res.json();
    const fv = (json.data?.fieldValues ?? []) as FieldRow[];
    setSelectedTemplateId(json.data?.selectedTemplateId ?? '');
    const map: Record<string, string> = {};
    for (const r of fv) {
      try {
        const parsed = JSON.parse(r.valueJson);
        map[r.fieldKey] = String(parsed ?? '');
      } catch {
        map[r.fieldKey] = r.valueJson;
      }
    }
    if (!('interessi_modalita' in map)) map.interessi_modalita = 'none';
    if (!('interessi_tipo_tasso' in map)) map.interessi_tipo_tasso = 'legale';
    setFields(map);
    setRawRows(fv);
    setCurrentPracticeId(id);
    setConsistency(null);
    setQualityGate(null);
  }

  useEffect(() => {
    (async () => {
      await fetchPractices();
      await fetchTemplates();
    })();
  }, []);

  async function createPractice() {
    setLoading(true); setError(''); setMsg('');
    try {
      const res = await fetch(`${API}/practices`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: 'web-user' }) });
      const json = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(json));
      setMsg(`Pratica creata: ${json.data.id}`);
      await fetchPractices();
      await loadPractice(json.data.id);
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  }

  async function uploadTo(url: string, file: File, extras: Record<string, string>) {
    const fd = new FormData();
    fd.append('file', file);
    Object.entries(extras).forEach(([k, v]) => fd.append(k, v));
    const res = await fetch(url, { method: 'POST', body: fd });
    const json = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json));
    return json;
  }

  async function onUploadPracticeFiles(e: ChangeEvent<HTMLInputElement>) {
    if (!currentPracticeId || !e.target.files?.length) return;
    setLoading(true); setError(''); setMsg('');
    try {
      for (const f of Array.from(e.target.files)) {
        await uploadTo(`${API}/practices/${currentPracticeId}/files`, f, { kind: 'PRACTICE_DOCUMENT', actor: 'web-user' });
      }
      setMsg('Documenti caricati');
      await loadPractice(currentPracticeId);
      await checkConsistency();
      await refreshTemplateReport();
      await refreshQualityGate();
      await refreshAudit();
      await checkConsistency();
      await refreshTemplateReport();
      await refreshQualityGate();
      await refreshAudit();
    } catch (err) {
      setError((err as Error).message);
    } finally { setLoading(false); }
  }

  async function onImportFile(e: ChangeEvent<HTMLInputElement>) {
    if (!currentPracticeId) return;
    const f = e.target.files?.[0];
    if (!f) return;
    setLoading(true); setError(''); setMsg('');
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('actor', 'web-user');
      const res = await fetch(`${API}/practices/${currentPracticeId}/import`, { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(json));
      setMsg(`Import applicato: ${json.data.importedFields} campi`);
      await loadPractice(currentPracticeId);
      await checkConsistency();
      await refreshTemplateReport();
      await refreshQualityGate();
      await refreshAudit();
    } catch (err) {
      setError((err as Error).message);
    } finally { setLoading(false); }
  }

  async function onUploadTemplate(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setLoading(true); setError(''); setMsg('');
    try {
      await uploadTo(`${API}/templates`, f, { name: templateName, actor: 'web-user' });
      setMsg('Template caricato in libreria');
      await fetchTemplates();
    } catch (err) {
      setError((err as Error).message);
    } finally { setLoading(false); }
  }

  async function selectTemplate(templateId: string) {
    if (!currentPracticeId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API}/practices/${currentPracticeId}/select-template`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ templateId, actor: 'web-user' })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(json));
      setSelectedTemplateId(templateId);
      setMsg('Template selezionato');
      await fetchPractices();
      const rf = await fetch(`${API}/templates/${templateId}/fields`);
      const jf = await rf.json();
      setTemplateFields(jf.data?.fields ?? []);
      await refreshMappingPreview(templateId);
      await syncTemplateFields();
      await refreshTemplateReport();
      await refreshQualityGate();
      await refreshAudit();
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  }

  async function refreshMappingPreview(templateId?: string) {
    const tid = templateId || selectedTemplateId;
    if (!tid) return;
    try {
      const res = await fetch(`${API}/templates/${tid}/mapping-preview`);
      const json = await res.json();
      if (res.ok) setMappingPreview(json.data);
    } catch {
      // noop
    }
  }

  async function runExtraction() {
    if (!currentPracticeId) return;
    setLoading(true); setError(''); setMsg('');
    try {
      const res = await fetch(`${API}/practices/${currentPracticeId}/extract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: 'web-user' }) });
      const json = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(json));
      setMsg(`Estrazione completata: ${Object.keys(json.data.extracted ?? {}).length} campi`);
      await loadPractice(currentPracticeId);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }

  async function refreshFinalReport() {
    if (!currentPracticeId) return;
    try {
      const res = await fetch(`${API}/practices/${currentPracticeId}/final-report`);
      const json = await res.json();
      if (res.ok) setFinalReport(json.data);
    } catch {
      // noop
    }
  }

  async function refreshQualityGate() {
    if (!currentPracticeId) return;
    try {
      const res = await fetch(`${API}/practices/${currentPracticeId}/quality-gate`);
      const json = await res.json();
      if (res.ok) setQualityGate(json.data);
    } catch {
      // noop
    }
  }

  async function refreshAudit() {
    if (!currentPracticeId) return;
    try {
      const res = await fetch(`${API}/practices/${currentPracticeId}/audit?limit=50`);
      const json = await res.json();
      if (res.ok) setAudit((json.data ?? []).map((x:any)=>({ id:x.id, action:x.action, actor:x.actor, createdAt:x.createdAt })));
    } catch {
      // noop
    }
  }

  async function refreshTemplateReport() {
    if (!currentPracticeId) return;
    try {
      const q = selectedTemplateId ? `?templateId=${encodeURIComponent(selectedTemplateId)}` : '';
      const res = await fetch(`${API}/practices/${currentPracticeId}/template-report${q}`);
      const json = await res.json();
      if (res.ok) setTemplateReport(json.data);
    } catch {
      // noop
    }
  }

  async function syncTemplateFields() {
    if (!currentPracticeId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API}/practices/${currentPracticeId}/sync-template-fields`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ templateId: selectedTemplateId || undefined, actor: 'web-user' })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(json));
      setMsg(`Template sync: creati ${json.data.createdMissingFields} campi mancanti`);
      await loadPractice(currentPracticeId);
      await refreshTemplateReport();
      await refreshQualityGate();
      await refreshAudit();
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  }

  async function checkConsistency() {
    if (!currentPracticeId) return;
    try {
      const res = await fetch(`${API}/practices/${currentPracticeId}/consistency`);
      const json = await res.json();
      if (res.ok) setConsistency(json.data);
    } catch {
      // noop
    }
  }

  async function saveField(key: string, value: string) {
    if (!currentPracticeId) return;
    const res = await fetch(`${API}/practices/${currentPracticeId}/fields`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fieldKey: key,
        value,
        sourceType: 'manual',
        status: value ? 'MANUAL' : 'MISSING',
        actor: 'web-user'
      })
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async function saveAllFields() {
    setLoading(true); setError(''); setMsg('');
    try {
      for (const key of Object.keys(fields)) {
        await saveField(key, fields[key]);
      }
      setMsg('Campi salvati');
      await loadPractice(currentPracticeId);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }

  async function recomputeInterest() {
    if (!currentPracticeId) return;
    setLoading(true); setError('');
    try {
      await saveField('interessi_modalita', fields.interessi_modalita ?? 'none');
      await saveField('interessi_tipo_tasso', fields.interessi_tipo_tasso ?? 'legale');
      if (fields.interessi_tasso_percent) await saveField('interessi_tasso_percent', fields.interessi_tasso_percent);
      if (fields.interessi_base_calcolo) await saveField('interessi_base_calcolo', fields.interessi_base_calcolo);
      if (fields.interessi_dies_a_quo) await saveField('interessi_dies_a_quo', fields.interessi_dies_a_quo);
      if (fields.interessi_data_finale) await saveField('interessi_data_finale', fields.interessi_data_finale);

      const res = await fetch(`${API}/practices/${currentPracticeId}/recompute-interest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: 'web-user' })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(json));
      setMsg(json.data.warning ?? `Interessi ricalcolati: ${json.data.interessiImporto}`);
      await loadPractice(currentPracticeId);
      await refreshTemplateReport();
      await refreshQualityGate();
      await refreshAudit();
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  }

  async function generate(fast: boolean) {
    if (!currentPracticeId) return;
    setLoading(true); setError(''); setMsg('');
    try {
      await refreshTemplateReport();
      await refreshQualityGate();
      await refreshAudit();
      const pre = await fetch(`${API}/practices/${currentPracticeId}/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fast, actor: 'web-user' })
      });
      const preJson = await pre.json();
      if (!pre.ok) throw new Error(JSON.stringify(preJson));

      const res = await fetch(`${API}/practices/${currentPracticeId}/generate-docx`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fast, actor: 'web-user', templateId: selectedTemplateId || undefined })
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `precetto_${currentPracticeId}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(preJson.data.warning ?? `DOCX generato (${fast ? 'fast' : 'standard'})`);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }

  return (
    <div className="page">
      <h1>Recupero Crediti Automation</h1>
      <p className="sub">Workspace unico: upload, estrazione, modifica campi, generazione.</p>

      <div className="grid2">
        <section className="card">
          <h2>Pratiche</h2>
          <button disabled={loading} onClick={createPractice}>Nuova pratica</button>
          <ul>
            {practices.map((p) => (
              <li key={p.id}>
                <button className={`link ${p.id === currentPracticeId ? 'active' : ''}`} onClick={() => loadPractice(p.id)}>{p.id}</button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>Template library</h2>
          <label>Nome template</label>
          <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
          <input type="file" accept=".docx" onChange={onUploadTemplate} />
          <ul>
            {templates.map((t) => (
              <li key={t.id}>{t.name} v{t.version} <button onClick={() => selectTemplate(t.id)}>Usa</button></li>
            ))}
          </ul>
          <div className="row">
            <button onClick={syncTemplateFields} disabled={!currentPracticeId || !selectedTemplateId || loading}>Allinea campi da template</button>
          </div>
          {!!templateFields.length && (
            <div><small>Campi template: {templateFields.join(', ')}</small></div>
          )}
          {mappingPreview && (
            <div className={mappingPreview.unknown.length ? 'warn' : 'ok'}>
              Mapping coverage: {mappingPreview.mappingCoverage}% · unknown fields: {mappingPreview.unknown.length}
              {mappingPreview.unknown.length > 0 && <div>Unknown: {mappingPreview.unknown.join(', ')}</div>}
            </div>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Documenti pratica</h2>
        <input type="file" multiple accept=".pdf,.docx" onChange={onUploadPracticeFiles} disabled={!currentPracticeId} />
        <label>Import dati (xlsx/csv/json)</label>
        <input type="file" accept=".xlsx,.csv,.json" onChange={onImportFile} disabled={!currentPracticeId} />
        <div className="row">
          <a className="btnlink" href={`${API}/import-template/xlsx`} target="_blank" rel="noreferrer">Scarica template XLSX</a>
          <a className="btnlink" href={`${API}/import-template/csv`} target="_blank" rel="noreferrer">Scarica template CSV</a>
          <a className="btnlink" href={`${API}/import-template/json`} target="_blank" rel="noreferrer">Scarica template JSON</a>
        </div>
        <div className="row">
          <button onClick={runExtraction} disabled={!currentPracticeId || loading}>Estrai informazioni</button>
          <button onClick={() => generate(false)} disabled={!currentPracticeId || loading}>Genera documento</button>
          <button onClick={checkConsistency} disabled={!currentPracticeId || loading}>Controlla coerenza</button>
          <button onClick={refreshQualityGate} disabled={!currentPracticeId || loading}>Quality gate</button>
          <button onClick={refreshFinalReport} disabled={!currentPracticeId || loading}>Final report</button>
          <button onClick={() => generate(true)} disabled={!currentPracticeId || loading}>Genera subito (fast)</button>
        </div>
      </section>

      <section className="card">
        <h2>Interessi</h2>
        <div className="row">
          <label>Modalità</label>
          <select value={fields.interessi_modalita ?? 'none'} onChange={(e)=>setFields((s)=>({...s, interessi_modalita:e.target.value}))}>
            <option value="none">none</option>
            <option value="simple">simple</option>
            <option value="complex_placeholder">complex (placeholder)</option>
          </select>
          <label>Tipo tasso</label>
          <select value={fields.interessi_tipo_tasso ?? 'legale'} onChange={(e)=>setFields((s)=>({...s, interessi_tipo_tasso:e.target.value}))}>
            <option value="legale">legale</option>
            <option value="mora">mora</option>
          </select>
        </div>
        <div className="grid2">
          <input placeholder="tasso %" value={fields.interessi_tasso_percent ?? ''} onChange={(e)=>setFields((s)=>({...s, interessi_tasso_percent:e.target.value}))} />
          <input placeholder="base calcolo" value={fields.interessi_base_calcolo ?? ''} onChange={(e)=>setFields((s)=>({...s, interessi_base_calcolo:e.target.value}))} />
          <input placeholder="dies a quo (YYYY-MM-DD)" value={fields.interessi_dies_a_quo ?? ''} onChange={(e)=>setFields((s)=>({...s, interessi_dies_a_quo:e.target.value}))} />
          <input placeholder="data finale (YYYY-MM-DD)" value={fields.interessi_data_finale ?? ''} onChange={(e)=>setFields((s)=>({...s, interessi_data_finale:e.target.value}))} />
        </div>
        <button onClick={recomputeInterest} disabled={!currentPracticeId || loading}>Ricalcola interessi</button>
      </section>

      <section className="card">
        <h2>Workspace campi</h2>
        <div className="row">
          <label>Filtro campi</label>
          <select value={fieldFilter} onChange={(e)=>setFieldFilter(e.target.value as any)}>
            <option value="all">all</option>
            <option value="missing">missing</option>
            <option value="manual">manual</option>
            <option value="conflict">conflict</option>
          </select>
        </div>
        {filteredKeys.map((k) => {
          const row = rawRows.find((r) => r.fieldKey === k);
          return (
          <div className="field-wrap" key={k}>
            <div className="field">
              <label>{k}</label>
              <input value={fields[k] ?? ''} onChange={(e) => setFields((s) => ({ ...s, [k]: e.target.value }))} />
              <small>{row?.status ?? 'MISSING'} {row?.confidence != null ? `· conf ${(row.confidence * 100).toFixed(0)}%` : ''}</small>
            </div>
            {row?.sourceRef && <div className="source">Fonte: {row.sourceRef}</div>}
          </div>
          );
        })}
        <button onClick={saveAllFields} disabled={!currentPracticeId || loading}>Salva campi</button>
      </section>


      <section className="card">
        <h2>Audit timeline</h2>
        <button onClick={refreshAudit} disabled={!currentPracticeId || loading}>Aggiorna audit</button>
        <ul>
          {audit.map((a) => (
            <li key={a.id}><strong>{a.action}</strong> · {a.actor} · {new Date(a.createdAt).toLocaleString()}</li>
          ))}
        </ul>
      </section>

      {finalReport && (
        <section className="card">
          <h2>Final report pratica</h2>
          <p>Quality score: <strong>{finalReport.qualityScore}</strong></p>
          <p>Files: {finalReport.totals.files} · Fields: {finalReport.totals.fields} · Missing: {finalReport.totals.missing}</p>
          {finalReport.missingFields.length > 0 && <div className="warn">Missing fields: {finalReport.missingFields.join(', ')}</div>}
        </section>
      )}

      {qualityGate && (
        <section className="card">
          <h2>Quality gate bozza</h2>
          <p>Punteggio: <strong>{qualityGate.score}</strong> · livello: <strong>{qualityGate.level}</strong></p>
          {qualityGate.conflictExec && <div className="warn">Conflitto esecutorietà presente</div>}
          {qualityGate.missingStrong.length > 0 && <div className="warn">Campi forti mancanti: {qualityGate.missingStrong.join(', ')}</div>}
        </section>
      )}

      {templateReport && (
        <section className="card">
          <h2>Report template</h2>
          <p>Copertura: <strong>{templateReport.coverage}%</strong> · compilati: {templateReport.filled.length} · mancanti: {templateReport.missing.length}</p>
          {templateReport.missing.length > 0 && <div className="warn">Campi template mancanti: {templateReport.missing.join(', ')}</div>}
        </section>
      )}

      {consistency && (
        <div className={consistency.conflict ? 'warn' : 'ok'}>
          Esecutorietà — manuale: {consistency.manualFlag} · auto: {consistency.autoDetection} {consistency.conflict ? '· CONFLITTO' : '· coerente'}
        </div>
      )}
      {msg && <div className="ok">{msg}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
