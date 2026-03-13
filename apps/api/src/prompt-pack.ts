import type { PlaceholderKind, TemplateInstruction } from './template-instructions.js';

type FlowPromptItem = {
  key: string;
  prompt: string;
};

type FlowPromptPack = {
  kind: PlaceholderKind;
  instructions: string[];
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, { value: 'string|number|null'; confidence: '0..1'; sourceRef: 'string' }>;
};

function buildSingle(kind: PlaceholderKind, items: FlowPromptItem[]): FlowPromptPack {
  const schema = Object.fromEntries(
    items.map((item) => [item.key, { value: 'string|number|null', confidence: '0..1', sourceRef: 'string' }])
  ) as FlowPromptPack['schema'];

  const common = [
    'Rispondi SOLO JSON valido.',
    'Non aggiungere testo fuori JSON.',
    'Se un valore non è determinabile, usa value=null con confidence bassa.'
  ].join('\n');

  const systemByKind: Record<PlaceholderKind, string> = {
    extract: [
      'Sei un estrattore legale rigoroso.',
      'Lavora SOLO sui placeholder di tipo EXTRACT.',
      'Obiettivo: reperire valori semplici dai documenti input, senza riformulazioni creative.',
      'Non inventare.'
    ].join('\n'),
    derive: [
      'Sei un motore di derivazione legale.',
      'Lavora SOLO sui placeholder di tipo DERIVE.',
      'Obiettivo: derivare valori compositi a partire dai documenti input.',
      'Mantieni tracciabilità con sourceRef sintetico.',
      'Se sono necessari calcoli matematici/formali, NON calcolare a mano: produci richiesta tool nel formato { "toolRequests": [{"tool":"interest.compute","input":{...}}] }.'
    ].join('\n'),
    generate: [
      'Sei un motore generativo documentale.',
      'Lavora SOLO sui placeholder di tipo GENERATE.',
      'Obiettivo: eseguire istruzioni creative/avanzate espresse nel placeholder.',
      'Rispetta stile legale chiaro e contenuto richiesto.',
      'Se compaiono numeri/calcoli, delega ai tool disponibili invece di calcolare in autonomia.'
    ].join('\n')
  };

  const instructionLines = items.map((item, i) => `${i + 1}. ${item.prompt}`).join('\n') || '(none)';
  const userPrompt = [
    `TIPO FLUSSO: ${kind.toUpperCase()}`,
    `ISTRUZIONI DA RISOLVERE (${items.length}):`,
    instructionLines,
    'TOOLS DISPONIBILI: interest.compute(base,tassoPercent,dal,al)',
    'Per calcoli matematici usa i tool.',
    'OUTPUT JSON shape:',
    JSON.stringify({ values: schema }, null, 2)
  ].join('\n\n');

  return {
    kind,
    instructions: items.map((item) => item.prompt),
    systemPrompt: `${systemByKind[kind]}\n\n${common}`,
    userPrompt,
    schema
  };
}

export function buildPromptFlows(instructions: TemplateInstruction[]) {
  const extract = instructions
    .filter((i) => i.kind === 'extract')
    .map((i) => ({ key: i.key, prompt: i.key }));
  const derive = instructions
    .filter((i) => i.kind === 'derive')
    .map((i) => ({ key: i.key, prompt: `${i.key}: ${i.instruction ?? ''}`.trim() }));
  const generate = instructions
    .filter((i) => i.kind === 'generate')
    .map((i) => ({ key: i.key, prompt: `${i.key}: ${i.instruction ?? ''}`.trim() }));

  const flows: FlowPromptPack[] = [];
  if (extract.length) flows.push(buildSingle('extract', extract));
  if (derive.length) flows.push(buildSingle('derive', derive));
  if (generate.length) flows.push(buildSingle('generate', generate));

  return {
    flows,
    counts: { extract: extract.length, derive: derive.length, generate: generate.length }
  };
}
