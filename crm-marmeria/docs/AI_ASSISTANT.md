# Assistente AI locale CRM

L’assistente è una superficie locale del server CRM. Il database SQLite resta unica fonte dati; il modello non riceve il database intero e non può eseguire SQL, shell o HTTP arbitrario.

## Avvio sicuro

Senza configurazione l’assistente usa `MockLlmProvider`: è deterministico, non usa rete e permette sviluppo/test del flusso completo.

Per usare un server Qwen locale OpenAI-compatible:

```powershell
$env:CRM_AI_PROVIDER = 'qwen'
$env:CRM_AI_QWEN_URL = 'http://127.0.0.1:8000/v1'
$env:CRM_AI_QWEN_MODEL = 'Qwen3.8-27B'
$env:CRM_AI_QWEN_CHAT_TEMPLATE_KWARGS = '{"add_generation_prompt":true}'
npm.cmd run server
```

`Qwen3.8-27B` è il target configurabile del progetto, non un ID universale del runtime. Imposta `CRM_AI_QWEN_MODEL` con l’identificativo esatto esposto dal tuo server locale; se omesso, il valore predefinito resta `Qwen3.8-27B` come riferimento target.

Il budget contesto è limitato a 60.000 caratteri; per test locali può essere ridotto con `CRM_AI_CONTEXT_MAX_CHARS` (mai oltre 64.000).

Il server invia a Qwen `chat_template_kwargs.enable_thinking=false` per le richieste ordinarie e `true` per richieste deterministiche di analisi, confronto, pianificazione, trend o root-cause. `CRM_AI_QWEN_CHAT_TEMPLATE_KWARGS` è un oggetto JSON opzionale per gli altri parametri compatibili con il runtime locale; il flag `enable_thinking` viene sempre scelto dal server in base alla modalità e non è sovrascrivibile dalla configurazione. Il supporto dipende dal template chat del runtime Qwen in uso: se il server non riconosce questo campo, va configurato un adapter compatibile prima dell’uso live.

Il server locale deve esporre `POST /chat/completions` compatibile con tool calling e streaming SSE OpenAI-compatible. Per una lettura il CRM esegue il primo pass non-streaming per la selezione del tool, esegue il tool autorizzato, poi invia al secondo pass solo i risultati strutturati bounded; la risposta finale arriva con `stream:true` e viene inoltrata a chunk SSE. Se la sintesi fallisce, l’API restituisce un errore stabile in italiano senza inventare una risposta sostitutiva.

SGLang e vLLM sono percorsi compatibili possibili, ma non sono stati installati né validati live in questo worktree. Restano da verificare sul runtime reale: ID modello esposto, formato tool calling, supporto `tool_choice: none`, `stream_options` e frammentazione SSE.

Verifica preliminare, fuori dal CRM:

```powershell
Invoke-RestMethod "$env:CRM_AI_QWEN_URL/models" -Method Get
```

Il nome modello configurato deve corrispondere a quello restituito dal runtime locale. L’assistente non scarica modelli, non gestisce GPU e non considera `GET /models` prova di tool calling o streaming: va verificata una richiesta reale al tuo runtime Qwen.

## Flusso utente

1. Apri **Assistente** nell’intestazione.
2. Crea una sessione autenticata e scrivi una richiesta naturale in italiano.
3. Le letture partono subito; il server emette eventi SSE di stato, strumento, testo e conclusione.
4. Ogni scrittura crea uno stato di conferma strutturato con `actionId` e `operationId`. Solo `POST /api/ai/confirm` con l’azione corretta esegue la modifica; `POST /api/ai/cancel` la annulla.

La conferma non dipende dalla memoria del modello o da una frase precedente. Retry e doppio invio usano l’idempotenza del database CRM.

## API essenziale

- `POST /api/ai/sessions` — crea sessione autenticata.
- `GET /api/ai/sessions/:id` — legge stato bounded della sessione.
- `POST /api/ai/chat` — body `{ sessionId, message, operationId }`, risposta `text/event-stream`.
- `POST /api/ai/confirm` — body `{ sessionId, actionId, operationId }`.
- `POST /api/ai/cancel` — body `{ sessionId, actionId }`.
- `GET /api/ai/tools/metadata` — catalogo filtrato dai permessi dell’utente.
- `GET /api/ai/benchmark/session?sessionId=...` — metriche dell’ultima risposta.

Le metriche espongono `reasoningMode` (`fast` o `reasoning`), tempi routing/TTFT/tool/total, prefill nuovo e cached, rate di prefill/decode, `sttLatencyMs:null` e `ttsFirstAudioMs:null` finché STT/TTS non sono collegati.

Eventi SSE stabili:

```text
status → tool(start/done/pending) → confirmation? → text(delta/final) → done
```

Gli errori hanno `{ ok:false, error, message }` in italiano semplice. Stack trace, prompt completi e segreti non vengono inviati al client.

## Sicurezza e dati

Il controllo permessi usa `req.user` autenticato prima dell’esecuzione del tool. Il catalogo è typed e ristretto ai domini clienti, progetti, preventivi, fatture, incassi, calendario e statistiche. Ambiguità cliente/fattura produce candidati, mai una scelta arbitraria.

Le sessioni e le conferme sono in memoria e scadono; un riavvio chiude quindi ogni conferma pendente. Gli audit delle mutazioni AI finiscono nella tabella SQLite `ai_audit_log` sotto la `dataDir` configurata. Nessun file viene scritto in `server/data` durante test o build. Gli audit includono utente, sessione, input originale limitato, tool, argomenti validati, risultato, conferma, mutazione ed esito.

STT e TTS non sono attivati in questa V1. Restano integrazioni successive sostituibili: il contratto TTS dovrà poter emettere audio per frase/chunk senza cambiare sessione, permessi, conferma o audit.

## Test locali

```powershell
cd crm-marmeria
npm.cmd run server:test
node server/ai.check.js
```

`ai.check.js` usa solo directory temporanee, fixture isolate e provider mock. Prova routing bounded, schema/unknown tool, ambiguità con selezione al turno successivo, round-trip tool/provider, stream SSE a delta separati, permessi parziali e redazione finanziaria, fattura assente, conferma/annulla, idempotenza isolata per utente/sessione, audit atomico e sanificato, modalità fast/reasoning, catalogo completo e limite contesto.
