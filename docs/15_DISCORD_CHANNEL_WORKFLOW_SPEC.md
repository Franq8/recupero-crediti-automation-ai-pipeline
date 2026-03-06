# 15 — Workflow Discord parallelo (canale operativo)

## Obiettivo
Permettere in Discord le operazioni core della UI:
- upload allegati,
- estrazione/precompilazione,
- patch dati,
- generazione DOCX (standard o rapida).

## Modello operativo
- Ogni pratica ha `practice_id`.
- Messaggi con allegati possono creare/aggiornare pratica.
- Stato pratica sempre richiamabile con comando status.

## Comandi finali v1
- `/precetto new`
- `/precetto attach <practice_id>` (con allegati)
- `/precetto extract <practice_id>`
- `/precetto status <practice_id>`
- `/precetto set <practice_id> <campo>=<valore>`
- `/precetto set-bulk <practice_id>` (con CSV/JSON/XLSX)
- `/precetto interessi <practice_id> mode=none|simple|complex`
- `/precetto generate <practice_id>`
- `/precetto generate-fast <practice_id>`
- `/precetto export <practice_id> format=docx|csv|xlsx`

## Stato implementazione attuale (backend)
È stato implementato un adapter API `/discord/command` con comandi:
- `new`
- `attach` (base64 payload)
- `status`
- `extract`
- `set`
- `interessi`
- `generate`
- `generate-fast`
- `export` (csv)

È stato inoltre implementato un router testuale `/discord/router` che riceve testo comando in stile `/precetto ...`, effettua parse e dispatch interno su `/discord/command`.

È stato aggiunto endpoint `/discord/hook` per integrazione diretta con event handling messaging:
- supporta testo + allegati (base64)
- può auto-creare pratica se arrivano allegati senza `practiceId`
- allega file alla pratica e opzionalmente esegue comando testuale nella stessa chiamata.

Il comando `generate/generate-fast` produce DOCX, persiste il file in pratica e restituisce `downloadPath` per il file generato.
## Semantica comandi chiave

### `generate`
- Percorso standard con validazione campi critici.
- Blocca su errori bloccanti.

### `generate-fast`
- Bypass validazione completa.
- Genera output anche con campi mancanti.
- Segnaposto non valorizzati restano nel DOCX.
- Warning obbligatorio nel messaggio di conferma.

## Stato pratica (output sintetico)
- documenti ricevuti
- copertura campi (% + count)
- conflitti aperti (incluso `CONFLICT_EXECUTORIETA`)
- warning/errori
- ultimo export disponibile

## Sicurezza e controllo
- Solo utenti autorizzati nel canale possono usare i comandi.
- Audit log: utente, comando, payload sintetico, timestamp.
- Nessun invio esterno automatico.

## UX Discord
- messaggi brevi, azionabili, non verbosi
- no spam: notifiche solo su eventi rilevanti
- naming output: `precetto_<practice_id>_<timestamp>.docx`

## Limiti rispetto UI web
- Revisione massiva meno comoda
- Evidenze documentali meno ricche visivamente
- Migliore per “fast lane” e operatività rapida
