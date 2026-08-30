# CRM integrity fixes

Obiettivo: correggere i problemi emersi dalla revisione senza cambiare il modello operativo LAN/browser e senza toccare `server/data`.

## Piano

1. Aggiungere test di regressione per IVA delle fatture importate, bordi ridimensionati, relazioni tra entità, incassi e mutazioni offline.
2. Preservare l'assenza dell'aliquota IVA nelle work line e applicare 22% solo quando una riga non-fattura viene trasformata in fattura; mantenere esplicite le aliquote 0% con Natura IVA.
3. Centralizzare le regole applicative di integrità: cliente/progetto/preventivo/fattura devono esistere ed essere coerenti; bloccare cancellazioni che lascerebbero riferimenti orfani.
4. Rendere gli incassi la fonte di verità dello stato pagamento: impedire sovrapagamenti, sincronizzare lo stato fattura dopo create/update/delete degli incassi e non fidarsi dello stato manuale nello scadenziario.
5. Consentire update/delete di entità create offline e ancora in coda, lasciando che `offlineQueue` fonda o annulli le operazioni.
6. Eliminare `lengthMeters` obsoleto quando le dimensioni di un bordo vengono aggiornate in centimetri.
7. Applicare lazy loading alle pagine principali e all'assistente AI per ridurre il chunk iniziale.
8. Eseguire suite server, typecheck, Vitest, build e controlli CI; riesaminare il diff prima del merge.
