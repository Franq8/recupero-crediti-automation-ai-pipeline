# 17 — ExecPlan dettagliato (build reale, no mock)

## Stato iniziale
- Documentazione funzionale/UX consolidata
- Nessun codice applicativo ancora presente

## Obiettivo esecuzione
Costruire un sistema production-grade per:
1. workspace unico dati,
2. ingestion file + import strutturato + editing manuale,
3. estrazione informazioni con evidenze,
4. generazione DOCX da template (upload o libreria persistente),
5. operatività parallela via Discord.

---

## Principi di implementazione
- No mock UI/backend: solo componenti reali e integrabili.
- Incrementi verticali: ogni fase produce funzionalità usabile.
- Persistenza DB-first (file inclusi, no dipendenza path locali host).
- Audit-by-design su ogni modifica campo.

---

## Fase 1 — Fondazione tecnica (MVP backbone)
### Deliverable
- Monorepo con:
  - `apps/api` (backend)
  - `apps/web` (frontend)
  - `packages/shared` (tipi/schema condivisi)
- DB schema iniziale (pratiche, file, template, campi, audit)
- Storage file su DB/object-ready abstraction
- API base pratiche/template/file

### Acceptance
- Creazione pratica funzionante
- Upload DOCX template funzionante e persistente
- Upload PDF/DOCX documenti pratica funzionante e persistente
- Lettura stato pratica via API

---

## Fase 2 — Workspace dati unico
### Deliverable
- UI workspace unico campi
- Stati campo: AUTO_OK / NEEDS_REVIEW / MANUAL / MISSING
- Autosave e audit timeline
- Import CSV/XLSX/JSON su schema PracticeData

### Acceptance
- Pratica editabile integralmente in UI
- Import template dati compilabile e ingestibile
- Modifiche manuali tracciate con utente/timestamp

---

## Fase 3 — Estrazione reale + conflitti
### Deliverable
- Parser documentale PDF/DOCX
- Estrazione campi prioritaria per casistica precetto DI
- Evidenze fonte (file/pagina/snippet)
- Regola conflitto esecutorietà (manuale vs auto)

### Acceptance
- Pulsante `Estrai informazioni` popola campi reali
- Conflitti evidenziati e confermabili

---

## Fase 4 — Motore interessi + output DOCX
### Deliverable
- Interessi mode none/simple/complex_placeholder
- Selettore tasso `legale|mora`, default `legale`
- Calcolo simple deterministico
- Generazione DOCX da template selezionato
- Due percorsi: standard / genera-subito

### Acceptance
- DOCX generato con campi valorizzati
- Campi mancanti => segnaposto residui nel DOCX
- Warning dataset parziale presente

---

## Fase 5 — Libreria template persistente
### Deliverable
- CRUD template Word
- Versioning template
- Associazione template predefinito per casistica

### Acceptance
- Selezione template da libreria senza re-upload
- Storico versioni disponibile

---

## Fase 6 — Canale Discord operativo
### Deliverable
- Comandi `/precetto ...` v1
- Attach allegati a pratica
- extract/status/set/generate/generate-fast/export
- Restituzione DOCX nel canale operativo

### Acceptance
- E2E completo in Discord su pratica reale

---

## Fase 7 — Hardening + deploy
### Deliverable
- AuthZ, rate limiting, logging strutturato
- Backup DB/storage
- Config deploy VPS (docker compose + migration)

### Acceptance
- Deploy ripetibile su VPS
- Recovery test base OK

---

## Sequenza operativa immediata (adesso)
1. Bootstrap monorepo + DB schema
2. Implementare API pratiche/file/template (fase 1)
3. Implementare UI minima workspace (fase 2 start)
4. Commit incrementale per feature-set

---

## Rischi e mitigazioni
- Parsing PDF eterogenei → pipeline con confidence + fallback manuale.
- Mappatura template complessa → estrazione MERGEFIELD automatica + validatore mapping.
- Drift requisiti → decision log obbligatorio a ogni cambiamento.
