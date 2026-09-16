# Guida all'installazione

Versione italiana di [SETUP.md](SETUP.md). La guida inglese resta allineata
all'upstream ed è il riferimento in caso di dubbio.

## 1. Prerequisiti

| Cosa | Perché | Verifica |
|---|---|---|
| [Claude Code](https://claude.com/claude-code) | il motore di tutto il flusso | `claude --version` |
| Piano a pagamento o crediti API | Claude Code non funziona sul piano gratuito | — |
| [Bun](https://bun.sh) | esegue i client dei portali | `bun --version` |
| Python 3.10+ | strumenti di verifica PDF e manutenzione | `python3 --version` |
| LaTeX (`lualatex` + `xelatex`) | compila CV e lettere | `lualatex --version` |
| [GitHub CLI](https://cli.github.com) | opzionale, per fork e issue | `gh --version` |

Su macOS: `brew install bun python@3.12 gh` e MacTeX per LaTeX.
Su Debian/Ubuntu: `apt install python3 texlive-full` e Bun dallo script ufficiale.

## 2. Ottenere una copia

> **Attenzione: i fork su GitHub sono pubblici.** GitHub non permette di rendere
> privato il fork di un repository pubblico, e `/setup` scrive i tuoi **dati
> personali** dentro file tracciati da git. Se fai push su un fork, quei dati
> sono visibili a chiunque.

**Se vuoi usarlo per la tua ricerca di lavoro** (il caso normale), usa un
repository **privato** invece del pulsante Fork:

```bash
git clone https://github.com/andreadorizza/ai-job-search-italy.git
cd ai-job-search-italy
git remote rename origin upstream-it
gh repo create mia-ricerca-lavoro --private --source=. --remote=origin
git push -u origin master
```

Così i tuoi dati restano privati e continui a ricevere gli aggiornamenti con
`git pull upstream-it master`.

**Se vuoi contribuire al fork italiano**, allora sì, fai il fork:

```bash
gh repo fork andreadorizza/ai-job-search-italy --clone
cd ai-job-search-italy
gh repo set-default <tuo-username>/ai-job-search-italy
```

> La riga `set-default` non è facoltativa. `gh repo fork --clone` imposta il
> repository **originale** come predefinito, e `gh` usa il predefinito per
> creare issue e pull request. Senza quella riga, un `gh issue create` lanciato
> da questa copia — da te o da un agente a cui hai chiesto di seguire le tue
> candidature — finisce sul tracker **pubblico** dell'originale, pubblicando il
> contenuto sotto la tua identità GitHub, su un repository dove non puoi
> cancellarlo.

## 3. Installare le dipendenze dei portali

```bash
for d in .agents/skills/*/cli; do (cd "$d" && bun install); done
```

## 4. Compilare il profilo

```
/setup
```

L'intervista raccoglie esperienza, competenze, formazione, **lingue con il
relativo livello** (serve al controllo lingua che scarta gli annunci che
richiedono una lingua che non parli), vincoli di spostamento e criteri
irrinunciabili. Puoi anche partire dai tuoi documenti: metti CV, export
LinkedIn, diplomi e referenze in `documents/` e `/setup` li legge.

Alla domanda sulla lingua del CV, rispondi **Italiano** per avere i CV in
italiano di default.

## 5. Opzionale: benchmark retributivo

Il file `salary_data.json` (escluso da git) alimenta il confronto sulle
retribuzioni. Formato e conversione da Excel sono in
[tools/README_SALARY_TOOL.md](tools/README_SALARY_TOOL.md). Senza quel file, il
passaggio viene semplicemente saltato.

## 6. Provare il flusso

```
/scrape
/apply <url di un annuncio>
```

## 7. Compilare i documenti

```bash
lualatex cv/main_example.tex
xelatex  cover_letters/cover_example.tex
python3 tools/verify_pdf.py cv/main_example.pdf --dump-text /tmp/cv.txt
```

Il CV deve risultare di **esattamente 2 pagine**, la lettera di **1**. Controlla
anche che nel testo estratto le lettere accentate (`è à ù ò`) siano intatte:
se vedi `(cid:*)` o `�`, i sistemi ATS non leggeranno correttamente il tuo CV.

## 8. Aggiornamenti dall'upstream

Questo fork segue a sua volta
[MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search).
Il funzionamento, i livelli di proprietà dei file e la procedura di merge sono
descritti in [`FORK.md`](FORK.md).

Per la tua copia personale:

```bash
git fetch upstream-it master
python3 tools/check_upstream_updates.py --remote upstream-it
git merge upstream-it/master
```

Un conflitto in un file che hai personalizzato è un **segnale utile**, non un
errore: vuol dire che l'upstream ha cambiato qualcosa proprio nella sezione che
avevi adattato. Risolvi tenendo i tuoi dati e adottando la modifica intorno.

## Risoluzione dei problemi

**I test falliscono con errori sui `[PLACEHOLDER]`.** Esporta la variabile:

```bash
GITHUB_REPOSITORY=andreadorizza/ai-job-search-italy python3 -m unittest discover -s tests -t .
```

Alcuni controlli dell'upstream verificano che il modello sia ancora vergine e
partono dal presupposto di girare sul repository originale. Vedi
[`FORK.md`](FORK.md).

**`lualatex` non trova `fontawesome5`.** Installa la distribuzione LaTeX
completa (`texlive-full`), non quella minima.

**Un portale non restituisce risultati.** Potrebbe essere ad accesso limitato e
quindi disattivato: vedi la sezione sui portali nel
[README italiano](README.it.md).
