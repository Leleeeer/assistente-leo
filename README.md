# J.A.R.V.I.S. per iPad

L'assistente personale di Leo: si apre da un'icona sulla schermata Home dell'iPad, si sveglia con la voce («Jarvis») o con il pulsante del microfono e risponde parlando.

- **Cervello a cascata**: prima Claude (Opus 5.5 → Sonnet 5.5 → Haiku 5.5). Quando il credito finisce o un modello è occupato, passa da solo a Google Gemini gratis, dal modello più potente al più leggero. In alto si vede sempre quale cervello sta rispondendo.
- **Plancia**: sfera al centro, intorno agenda di oggi, email non lette, cose da fare e promemoria. Si toccano: spunti le cose fatte, apri un'email e premi *Riassumi*, *Rispondi* o *Leggimela*.
- **Google**: Gmail (legge, riassume e risponde, ma spedisce solo dopo il tuo sì), Google Calendar (agenda e promemoria, che arrivano come notifica anche sul telefono), Google Tasks (cose da fare).
- **Voce** ElevenLabs (o quella dell'iPad), **memoria** di quello che gli racconti, **calcoli** istantanei e **ricerca su internet** (con Claude).
- **Musica di sottofondo** come nel Jarvis originale: parte al risveglio, si abbassa quando parla. Il brano si sceglie dall'iPad (Impostazioni → Musica) e resta solo lì, quindi non viene pubblicato su GitHub.

## Privacy

Questa pagina contiene **solo il codice**. Chiavi, memoria e impostazioni restano nella memoria di Safari sull'iPad e non vengono mai caricate su GitHub. Chi aprisse l'indirizzo vedrebbe un Jarvis vuoto, senza accesso alle tue chiavi o ai tuoi dati.

## Installazione sull'iPad

1. Apri l'indirizzo della pagina con **Safari**.
2. Tocca **Condividi** (il quadrato con la freccia) → **Aggiungi alla schermata Home**.
3. Apri Jarvis dall'icona, tocca lo schermo e poi l'**ingranaggio** in alto a destra:
   - **Cervello**: chiave di Claude ([console.anthropic.com](https://console.anthropic.com/settings/keys)) e chiave gratuita di Gemini ([aistudio.google.com](https://aistudio.google.com/apikey)).
   - **Voce**: chiave ElevenLabs ([elevenlabs.io](https://elevenlabs.io/app/settings/api-keys)).
   - **Google**: segui la guida dentro le impostazioni (una volta sola, circa 10 minuti).
4. Consenti il microfono quando l'iPad lo chiede.

## Come si usa

- Tocca il **microfono** e parla, oppure di' **«Jarvis»** quando è in attesa (con la pagina aperta e lo schermo acceso).
- Puoi sempre **scrivere** nella barra in basso.
- Esempi: «cosa ho domani?», «aggiungi dentista giovedì alle 10», «ricordami di chiamare Marco alle 17», «aggiungi latte alla lista», «ho email nuove?», «rispondi a Giulia che va bene», «che tempo fa?».
- «Grazie Jarvis» o «a dopo» lo rimettono in attesa. Toccare il microfono mentre parla lo interrompe.

## File

| File | Cosa fa |
|---|---|
| `index.html`, `styles.css` | La pagina e il suo aspetto |
| `js/app.js` | Collega tutto: sfera, voce, pannelli, promemoria, impostazioni |
| `js/brain.js` | Personalità di Jarvis, strumenti e cascata dei cervelli |
| `js/claude.js`, `js/gemini.js` | I due cervelli |
| `js/google.js`, `js/data.js` | Gmail, Calendar, Tasks (o dati salvati sull'iPad se Google non è collegato) |
| `js/voice.js` | Voce (ElevenLabs / iPad) e ascolto |
| `js/scene.js` | La scena 3D originale (sfera di particelle e rete neurale) |
| `js/music.js` | Musica di sottofondo (il brano resta salvato sull'iPad) |
| `js/store.js` | Cosa resta salvato sull'iPad |
| `js/calc.js` | Calcolatrice istantanea |

Derivato dal progetto Jarvis di Thomas Colombo (licenza MIT, vedi `LICENSE`).
