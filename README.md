<p align="center">
  <img src="assets/mascot/pip_flight_loop.gif" alt="Pip, l'uccello corriere" width="200">
</p>

# AI Job Search — edizione italiana

*La ricerca di lavoro che gira sul tuo computer.*

Un framework per candidarti al lavoro costruito su [Claude Code](https://claude.com/claude-code).
Fai il fork, compila il tuo profilo, e Claude valuta gli annunci, adatta il tuo
CV, scrive le lettere di presentazione e ti prepara ai colloqui.

Questo è il **fork italiano** di
[MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search):
stesso motore, ma portali italiani, CV e lettere secondo le convenzioni
italiane, e documentazione in italiano. Il
[README in inglese](README.en.md) resta allineato all'upstream.

> Progetto open source indipendente, **non** affiliato ad Anthropic. Claude Code
> è citato solo per descrivere gli strumenti usati. Nessuna criptovaluta, nessun
> token, nessuna sponsorizzazione a pagamento: chi sostiene il contrario sta
> tentando una truffa.

## Cosa serve

- **[Claude Code](https://claude.com/claude-code)** con un piano a pagamento o crediti API.
- **[Bun](https://bun.sh)** per i client dei portali di lavoro.
- **Python 3.10+** per gli strumenti di verifica.
- Una distribuzione **LaTeX** (`lualatex` e `xelatex`) per compilare CV e lettere.

## Come iniziare

### 1. Fork e clone

Se vuoi **contribuire** al fork italiano:

```bash
gh repo fork andreadorizza/ai-job-search-italy --clone
cd ai-job-search-italy
gh repo set-default <tuo-username>/ai-job-search-italy
```

> La riga `set-default` non è facoltativa: senza, un `gh issue create` lanciato
> da questa copia finisce sul tracker **pubblico** del repository originale.

> **Attenzione prima di andare avanti: i fork sono pubblici.** GitHub non
> permette di rendere privato il fork di un repository pubblico, e `/setup`
> scrive i tuoi **dati personali** dentro file tracciati da git: fare push di
> quei commit su un fork li pubblica. Se questa copia serve alla *tua* ricerca
> di lavoro e non a contribuire, usa un **repository privato** con questo come
> `upstream`: la ricetta completa è nella
> [sezione 8 di SETUP.md](SETUP.md#8-aggiornamenti-dallupstream). Tutto il resto
> di questa guida funziona identico nei due casi.

### 2. Installa le dipendenze dei portali

```bash
for d in .agents/skills/*/cli; do (cd "$d" && bun install); done
```

### 3. Compila il tuo profilo

```
/setup
```

Rispondi **Italiano** alla domanda sulla lingua del CV per avere i CV in
italiano di default. I passaggi completi sono in [SETUP.md](SETUP.md).

## Come si usa

```
/setup          /scrape              /apply <url>
  |                |                     |
  v                v                     v
Compili il      Cerca sui           Valuta il match
tuo profilo     portali             Punteggio e consiglio
  |                |                     |
  v                v                     v
Profilo         Ti mostra le        Scrive CV + lettera
pronto          offerte trovate     (LaTeX, su misura)
                   |                     |
                   v                     v
               Scegli un'offerta    Un agente revisore critica
               -> /apply            -> Revisione -> PDF finale
```

### I comandi principali

| Comando | Cosa fa |
|---|---|
| `/setup` | Raccoglie il tuo profilo — esperienza, competenze, lingue, vincoli |
| `/scrape` | Cerca nuove offerte su tutti i portali attivi, senza duplicati |
| `/rank` | Ordina le offerte trovate in una rosa ristretta |
| `/apply <url>` | Valuta il match e, se ha senso, scrive CV e lettera su misura |
| `/interview` | Prepara il colloquio su una candidatura che stai seguendo |
| `/outcome` | Registra com'è andata |
| `/upskill` | Confronta le offerte col tuo profilo e propone un piano di studio |
| `/add-portal` | Genera un nuovo client per un portale di lavoro |
| `/add-template` | Registra un tuo modello di CV o lettera |

## Privacy — leggi prima di iniziare

`/setup` scrive **dati personali reali** dentro file tracciati da git: nome,
contatti, esperienza lavorativa, a volte le retribuzioni. Se il tuo fork è
**pubblico**, quei dati diventano pubblici.

I fork di repository pubblici su GitHub **non possono essere resi privati**. Se
vuoi tenere il profilo riservato, crea un repository privato tuo e aggiungi
questo come `upstream`, invece di usare il pulsante Fork. La procedura completa
è nella [sezione 8 di SETUP.md](SETUP.md#8-aggiornamenti-dallupstream).

Il `.gitignore` esclude già CV generati, lettere, il tracker delle candidature,
i documenti personali e gli eventuali dati retributivi. Quello che `/setup`
scrive nel profilo, però, è tracciato apposta — serve a Claude per lavorare.

## I portali di lavoro

Un portale è una cartella autonoma sotto `.agents/skills/`. `/scrape` li trova
da solo: non c'è nessun registro da aggiornare.

### Attivi

- **LinkedIn** — endpoint pubblici `jobs-guest`, nessuna dipendenza, funziona
  con qualsiasi città (`-l "Milano, Italy"`). Solo uso personale.
- **freehire** — aggregatore tech con API REST pubblica, risultati strutturati.
- **EURES** — il portale ufficiale della Commissione Europea. API pubblica, senza
  credenziali, copre l'Italia e tutta l'UE. Filtra per regione italiana per nome
  (`-l "Lombardia,Veneto"`) o per codice NUTS.

  Due cose da sapere: i titoli sono etichette ESCO, non il titolo scelto
  dall'azienda, e a volte c'entrano poco con il ruolo reale — leggi sempre la
  descrizione. E molti annunci arrivano da agenzie per il lavoro, quindi il
  campo azienda spesso riporta l'agenzia. In compenso le descrizioni italiane
  indicano quasi sempre CCNL e RAL.

- **Randstad Italia** — una delle maggiori agenzie per il lavoro in Italia.
  Pubblica i dati strutturati `schema.org/JobPosting` su ogni annuncio, quindi
  arrivano titolo, sede, tipo di contratto, **scadenza della candidatura** e
  **RAL** senza doverli estrarre dall'HTML. Filtra per regione o città
  (`-l Lombardia`, `-l Milano`).

  Nota: il campo azienda riporta quasi sempre "Randstad" e non il cliente
  finale — è il funzionamento normale di un'agenzia. Il settore e il comune
  sono nella descrizione.

### In arrivo per l'Italia

**InfoJobs non c'è più**: ha chiuso il 31 dicembre 2025 e ha cancellato tutti i
dati degli utenti. Anche ClicLavoro non pubblica più annunci. Lo stato
aggiornato di ogni portale è in [`FORK.md`](FORK.md).

### Portali ad accesso limitato

Alcuni portali italiani vietano l'accesso automatico nel `robots.txt` o nei
termini di servizio. Quando esiste comunque un modo tecnico di interrogarli, il
client viene incluso ma **disattivato due volte**: `enabled: false` nel suo
`SKILL.md`, e un rifiuto a runtime se non imposti

```bash
export AI_JOB_SEARCH_ALLOW_RESTRICTED=1
```

Attivarli è una tua scelta consapevole, a tuo rischio, e ha senso solo per uso
personale e a basso volume. Il flag concede il permesso, non l'accesso: un
portale protetto da anti-bot può comunque rifiutarsi di rispondere.

## CV e lettere in italiano

Claude ti risponde **nella lingua in cui scrivi**: scrivi in italiano e la
conversazione — valutazioni, tabelle, domande, riepiloghi — è in italiano. La
lingua dei documenti è una scelta separata, descritta qui sotto. La regola
completa sta in `CLAUDE.md`, sezione `## Interaction Language`.

Il CV è in **italiano** per impostazione predefinita (`CV language` in
`CLAUDE.md`); passa all'inglese quando serve. La lettera di presentazione segue
sempre la lingua dell'annuncio, quindi un annuncio in inglese produce una
lettera in inglese anche con il CV in italiano.

Le convenzioni italiane — la frase di consenso al trattamento dei dati, foto e
data di nascita, RAL contro netto, livelli CCNL, preavviso, `Gentile` /
`Spettabile`, `Cordiali saluti` — stanno in
`.claude/skills/job-application-assistant/10-mercato-italiano.md`.

## Contribuire

Le pull request sono benvenute, soprattutto **nuovi portali italiani**. Prima di
proporre un client per un portale, `/add-portal` verifica `robots.txt` e i
termini di servizio: è un controllo che non si salta.

Le modifiche che riguardano il framework in generale, e non il mercato
italiano, è meglio proporle direttamente
[all'upstream](https://github.com/MadsLorentzen/ai-job-search) — così le
ricevono tutti i fork, non solo questo.

Per capire come è organizzato il fork e come si integrano gli aggiornamenti
dall'upstream, leggi [`FORK.md`](FORK.md).

## Licenza

MIT, come l'upstream. Vedi [LICENSE](LICENSE).
