# 08 — Architettura proposta (v1)

## Modalità esecuzione
- Priorità: localhost su Mac mini
- Opzione futura: deploy VPS

## Componenti logici
1. **Ingestion**: upload file + metadata pratica
2. **Extractor**: parsing documenti e popolamento schema
3. **Validator**: controlli formali/campi critici
4. **Calculator**: regole deterministiche (interessi simple + totali)
5. **Template Manager**: upload/template library persistente, versioning e richiamo template DOCX
6. **Exporter**: CSV/XLSX per merge + report JSON/TXT + DOCX compilato
7. **UI Web**: revisione e conferma

## Requisiti di audit
- Persistenza valori originali estratti
- Traccia modifiche manuali
- Log versione regole/calcoli

## Persistenza file (orientata a VPS)
- Evitare dipendenze da path locali host
- Salvare template/doc allegati in storage applicativo (DB con blob o object storage)
- Metadati file in DB (owner, versione, hash, mime, timestamp)

## Policy LLM applicativa
- Tutte le chiamate LLM devono transitare dal client/runtime OpenClaw.
- Vietato integrare API key/provider LLM direttamente nel backend/frontend dell’app.
- Modello effettivo: default OpenClaw (salvo override gestiti da OpenClaw stesso).

## Sicurezza dati
- backup periodico storage + DB
- nessuna condivisione esterna automatica
