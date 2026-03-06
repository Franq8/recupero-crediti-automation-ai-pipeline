# 04 — Workflow operativo (v1)

1. **Nuova pratica**
   - Creazione pratica
   - Upload documenti (box unico) e/o import template (Excel/CSV/JSON)

2. **Classificazione**
   - Selezione “Precetto su DI”

3. **Precompilazione campi**
   - Parsing documentale / import strutturato
   - Popolamento campi nello schema unico

4. **Schermata dati unica (sempre editabile)**
   - Campi sempre presenti
   - Evidenza stato campo: `estratto`, `manuale`, `mancante`
   - L’utente integra/corregge nello stesso punto

5. **Scelta azione**
   - Pulsante A: `Estrai informazioni` (refresh estrazione)
   - Pulsante B: `Genera subito documento` (bypass controllo completo)

6. **Percorso standard (con controllo)**
   - Conferma correttezza e completezza dati
   - Scelta modalità interessi (None / Simple / Complex placeholder)
   - Calcolo e riepilogo
   - Export

7. **Percorso rapido (bypass)**
   - Prosecuzione immediata fino a documento finale
   - Ammessi dati parziali
   - Segnaposto non valorizzati restano nel documento

8. **Compilazione Word**
   - Uso template studio via stampa unione

## Gate di qualità
- Nessun blocco su campi mancanti: l’utente può sempre proseguire
- Warning esplicito pre-output quando il dataset è parziale
- I segnaposto senza valore restano nel DOCX generato
- Tracciatura completa modifiche manuali e fonti estrazione
