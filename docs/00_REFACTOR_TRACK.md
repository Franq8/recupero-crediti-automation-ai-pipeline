# 00 — Refactor Track (single AI dataset pipeline)

## Obiettivo
Refactor del flusso verso pipeline unica:
1. template + documenti in input,
2. estrazione/creazione valori (base+complessi) delegata a OpenClaw default model,
3. dataset strutturato unico,
4. merge template con unico motore, senza fallback compositivi hardcoded.

## Policy
- Qualunque LLM usage passa da OpenClaw client/default model.
- Nessuna API key/provider diretta nel codice applicativo.

## Separation
Questo filone è separato dalla baseline legacy:
- Legacy: `/Users/lawlabs/clawd/recupero-crediti-automation`
- Refactor: `/Users/lawlabs/clawd/recupero-crediti-automation-ai-pipeline`

## Step plan
- Step 1: Congelare baseline e mappare delta architetturale.
- Step 2: Definire contratto JSON unico (`ai_dataset_v1`).
- Step 3: Rimuovere default builder composti hardcoded come primaria.
- Step 4: Implementare orchestrazione OpenClaw payload->apply.
- Step 5: Validare su template reali e casi reali anonimizzati.

## Log
Ogni step completato va registrato qui con data e file toccati.
