# 13 — Direzione UX/Product (SaaS-grade)

## Visione
Interfaccia **professionale, moderna, fluida**: esperienza da SaaS verticale legale, non tool interno grezzo.

## Principi UX
1. **Single workspace**: un’unica area dati, sempre.
2. **Clarity first**: una decisione per volta.
3. **Confidence UX**: ogni dato mostra provenienza e affidabilità.
4. **Fast correction**: edit inline, tastiera-first, zero attrito.
5. **No dead ends**: ogni warning include azione suggerita.

## Pattern definitivo (allineato)
- Upload documenti in **box unico**.
- Import strutturato disponibile nella stessa schermata.
- Campi sempre presenti (non “compaiono/scompaiono” per modalità).
- L’estrazione precompila i campi e evidenzia cosa manca.

## CTA principali affiancate
1. `Estrai informazioni`
2. `Genera subito documento`

### Comportamento CTA
- `Estrai informazioni`: precompila/aggiorna, poi revisione standard.
- `Genera subito documento`: bypass controllo completo; produce output anche parziale.

## Layout suggerito
- Sidebar: stato pratica, completezza, warning critici.
- Main: sezioni campo (Parti, Titolo, Importi, Interessi, Output).
- Drawer laterale: evidenza fonte (file/pagina/snippet).

## Qualità visuale
- Tipografia pulita, spacing ampio, colori sobri + accenti moderni.
- Microinterazioni discrete (skeleton loading, success states).
- Accessibilità: contrasto AA, focus states, scorciatoie tastiera.

## Funzionalità serie
- Autosave continuo
- Versionamento pratica
- Diff ultimo salvataggio
- Filtro “mostra solo mancanti/conflitti”
- Audit timeline per campo

## Definition of Done UX (v1)
- Completamento pratica senza guida esterna
- Tempo revisione inferiore al metodo attuale
- Fonti dati verificabili per i campi chiave
- Zero ambiguità sul significato dei due pulsanti principali
