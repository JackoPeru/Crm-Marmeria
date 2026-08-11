# CRM Marmeria — upgrade lavorazioni strutturate

## Modello

Le formule e la separazione degli elementi lineari seguono il comportamento osservato nel checkout read-only `JackoPeru/Misure-mq` (HEAD `e2d7ce26d7f4a22ac0d130903c32295fc739686`); il CRM non incorpora quel sorgente e tratta l'eventuale prefisso legacy `LINEAR_` solo come compatibilità.

`WorkLine` supporta `surface`, `linear` e `manual`. Le righe superficie conservano dimensioni, materiale, spessore/variante, sei bordi/angoli (`front`, `back`, `left`, `right`, `cornerRight`, `cornerLeft`) e snapshot di prezzo. Nuove righe cliente leggono il costo acquisto del materiale dal Listino e applicano una sola volta markup 2x; righe salvate, importate o duplicate conservano il proprio snapshot. Il prezzo dei bordi attivi arriva dal catalogo; uno snapshot storico senza `catalogId` resta leggibile ma non modificabile. Le righe lineari conservano metri, catalogo e snapshot; le righe legacy diventano manuali.

I calcoli sono centralizzati in `src/domain/work-lines/calculations.ts`: m² = quantità × lunghezza × larghezza, ml = quantità × metri lineari, bordi = quantità × lunghezza bordo × prezzo/ml, più extra per prodotti esterni, posa o manodopera. Il campo tecnico storico resta `extraCost`; il server ricomputa righe, voci fiscali, imponibile, IVA e totale.

## Architettura

Il flusso è server-first: `server/database.js` conserva e normalizza i dati, `server/app.js` valida e ricomputa ogni scrittura, mentre il dominio TypeScript sotto `src/domain/work-lines/` contiene calcoli, normalizzazione, validazione e import senza dipendenze dalla UI. `WorkLinesEditor` è condiviso da preventivi, fatture e progetti; gli eventi realtime aggiornano documenti, allegati e dashboard. I cataloghi bordi/lineari sono entità CRM separate e le righe salvano snapshot dei prezzi usati.

## Compatibilità e import

All'apertura del database la normalizzazione è idempotente. Record vecchi senza `workLines` sono leggibili tramite conversione `items -> manual`; `In Corso` è esposto come `In Lavorazione`; la scadenza progetto è opzionale. Le conversioni creano copie indipendenti, con nuovi id e `importSource` (`quote`, `project`, `invoice`). In UI l'importazione esplicita consente `sostituisci`, `aggiungi` o `annulla`.

## Migrazione

Non serve uno script distruttivo separato: all'avvio `CrmDatabase.open()` applica la compatibilità sulle entità esistenti e scrive solo JSON realmente cambiati. Aggiunge in modo idempotente i metadati degli allegati (`caption`, `include_in_export`, `sort_order`), i campi catalogo materiale e le collezioni bordi/lineari mancanti. Prima di un aggiornamento operativo va mantenuto il backup di `server/data`; la normalizzazione non elimina record, allegati o campi legacy. Nuove conversioni e import usano nuovi UUID e copiano profondamente righe, bordi, snapshot e allegati.

## API

- `GET/POST/PUT/DELETE /api/edge-types`
- `GET/POST/PUT/DELETE /api/linear-items`
- `POST /api/quotes/:id/project`
- `POST /api/projects/:id/quote`
- `POST /api/quotes/:id/invoice`
- `POST /api/projects/:id/invoice`
- `PATCH /api/attachments/file/:id` per didascalia, ordine e inclusione foto in export
- `POST /api/imports/materials/preview` e `POST /api/imports/materials/commit` per listini `.xlsx` multi-foglio

Le nuove rotte usano rispettivamente `materials.*`, `projects.*`, `quotes.*` e `invoices.*`; il server rifiuta righe invalide e mantiene le rotte CRUD/documenti esistenti. Le scritture dei documenti ricomputano sempre le righe e i totali lato server.

## Permessi

- Cataloghi `edge-types` e `linear-items`: `materials.view/create/edit/delete`.
- Lavorazioni di un preventivo: `quotes.view/create/edit/delete`; di un progetto: `projects.view/create/edit/delete`; di una fattura: `invoices.view/create/edit/delete`.
- Conversioni: creazione nel tipo destinazione (`projects.create`, `quotes.create` o `invoices.create`), con lettura del tipo sorgente richiesta dal flusso esistente.
- Allegati: lettura/modifica/eliminazione ereditano i permessi dell'entità proprietaria; nessun bypass tramite l'endpoint file.
- Storico cliente: `clients.view`; appuntamenti/dashboard: `calendar.view` e `dashboard.view`. Valori finanziari mostrati solo a ruoli autorizzati con `invoices.view`.

## Interfaccia

Preventivi e fatture usano l'editor strutturato riapribile. I progetti mostrano deadline opzionale, lavorazioni e import da preventivo; la UI non espone più Scheda tecnica/Costi reali. Clienti, fornitori e materiali hanno ricerca/ordinamento alfabetico; materiali includono spessore, variante e stato catalogo. Lo storico cliente mostra preventivi, fatture, incassi associati/acconti e residui. La dashboard mostra appuntamenti di oggi/domani con aggiornamento realtime.

## Verifica

Test focalizzati: calcoli WorkLine, parsing decimali italiani, bordi, normalizzazione legacy, copia indipendente/importSource, modalità import, selector catalogo, listini multi-foglio/idempotenti, conversioni protette, allegati e ZIP OOXML. Eseguire `npm run typecheck`, `npm test -- --run`, `npm run server:test` e `npm run build` nella cartella `crm-marmeria`.

La selezione foto è persistita. I progetti accettano immagini, video e PDF: immagini e PDF si possono visualizzare/stampare, i video vengono caricati solo su richiesta. Con Web Share API e supporto File il CRM condivide il file direttamente; altrimenti scarica il file e apre una bozza Mail/WhatsApp chiedendo di allegarlo manualmente. L'export Word aggiunge in coda al body le sole immagini PNG/JPEG selezionate, con didascalia, media OOXML, relationship e content type; allegati non immagine sono mantenuti come allegati ma ignorati nell'inserimento grafico.
