# ElevenLabs – arbetsflöde, röster och kostnad

Hur ljuden i `audio-production/catalog.json` produceras. **Inga API-anrop har gjorts.** Allt nedan förutsätter uttryckligt
godkännande av manus ([AUDIO-SCRIPTS.md](AUDIO-SCRIPTS.md)), röster och kostnad före varje körning med `--live`.

## 1. Verifierat i ElevenLabs dokumentation (2026-10-29)

| Område | Uppgift | Källa |
| --- | --- | --- |
| Tal | `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=…`, header `xi-api-key`, JSON `text`, `model_id`, `voice_settings` (`stability`, `similarity_boost`, `style`, `speed`, `use_speaker_boost`), `seed` (0–4294967295, *best effort*), `language_code` (inte för multilingual v2). Svar: ljudfil. | [API: Text to Speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) |
| Ljudeffekter | `POST https://api.elevenlabs.io/v1/sound-generation`, JSON `text`, `duration_seconds` (0,5–30), `prompt_influence` (0–1, standard 0,3), `loop`, `model_id` (`eleven_text_to_sound_v2` standard, `eleven_text_to_sound_v3`). | [API: Sound Effects](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert) |
| Format | Standard `mp3_44100_128` (alla nivåer). 192 kbit/s kräver Creator. PCM/WAV 44,1 kHz kräver Pro. | samma |
| Modeller | `eleven_v4` (flaggskepp) nås via *Text to Dialogue*, inte via Text to Speech-endpointen. `eleven_v3` ("previous generation") och `eleven_multilingual_v2` fungerar med Text to Speech. Flash v2/v2.5 kostar 50 % mindre per tecken. | [Models](https://elevenlabs.io/docs/overview/models) |
| Pris, API | Per 1 000 tecken: v3 och Multilingual v2 0,08 USD, Flash/Turbo 0,04 USD. Ljudeffekter 0,12 USD per minut. "API usage is billed in US dollars, not credits." | [API pricing](https://elevenlabs.io/pricing/api) |
| Pris, krediter | Ljudeffekter: "40 credits per second when duration is specified". | [Sound effects](https://elevenlabs.io/docs/overview/capabilities/sound-effects) |
| Standardröster | "All our Default voices will expire on December 31, 2026" och finns bara för konton skapade före mars 2026. | [Default voices](https://elevenlabs.io/docs/help-center/product/voices/my-voices/how-do-i-access-eleven-labs-default-voices) |

### Osäkert, och därför spärrat i skriptet

- **Krediter per tecken för tal** står inte i nuvarande dokumentation. Katalogen antar 1 kredit per tecken (0,5 för Flash). Det är den tidigare kända nivån, men den är inte verifierad.
- **Ljudeffekter i dollar:** prissidan anger både "per minute" och "billed per generation". Om en minimiavgift per generering finns blir korta effekter dyrare än beräknat.
- **Ljudeffekter utan angiven längd** har inget dokumenterat pris. Därför har varje effekt i katalogen en fast längd.
- Svarshuvuden med faktisk kostnad (t.ex. `character-cost`) är inte dokumenterade. Skriptet sparar dem om de finns.

Skriptet markerar därför alla uppskattningar som **UNCERTAIN** och kräver `--accept-uncertain-cost` vid `--live`. Det
uppfyller kravet på separat godkännande. Kontrollera förbrukningen i ElevenLabs-kontot efter provpaketet och justera `pricing` i katalogen.

## 2. Kostnadsuppskattning

Från `npx tsx audio-production/generate.ts … ` (torrkörning), med en tagning per fil och antagandena ovan:

| Urval | Filer | Tecken (tal) | Sekunder (effekter) | Krediter | USD (API) |
| --- | --- | --- | --- | --- | --- |
| **Provpaket** (`--pack sample`) | 12 | 268 | 6,4 | ≈ 524 | ≈ 0,03 |
| Outbreak, befintliga händelser (`--pack core --product adult`) | 63 | 1 492 | 27,1 | ≈ 2 576 | ≈ 0,17 |
| Mini, befintliga händelser (`--pack core --product mini`) | 37 | 1 168 | 9,7 | ≈ 1 556 | ≈ 0,11 |
| Outbreak, allt (`--pack all --product adult`) | 72 | 1 661 | 54,6 | ≈ 3 845 | ≈ 0,24 |
| Mini, allt (`--pack all --product mini`) | 55 | 1 370 | 21,7 | ≈ 2 238 | ≈ 0,15 |
| **Hela biblioteket** (`--pack all`) | 127 | 3 031 | 76,3 | ≈ 6 083 | ≈ 0,40 |

**Realistisk budget:** räkna med 2–3 tagningar per fil innan en godkänns, särskilt för fiendeläten och effekter, där resultatet
varierar mer än för tal. Det ger cirka **1 000–1 600 krediter för provpaketet** och **12 000–18 000 krediter (cirka 0,8–1,2 USD
via API) för hela biblioteket**. Kostnaden är liten jämfört med abonnemanget som krävs. Kommersiell användning och API-åtkomst
beror på kontots plan. Kontrollera det själv: jag har inte verifierat vilka nivåer som tillåter vad.

Notera: ljudeffekterna står för hälften av krediterna men bara en liten del av dollarkostnaden. Kreditmåttet är det som räknas på ett abonnemang.

## 3. Röster

Inga röst-id:n är valda (`voiceId: null` i `audio-production/voices.json`). Skriptet blockerar tal tills de är ifyllda eller
anges med `--voice`.

**Rekommendation: använd inte ElevenLabs standardröster.** De upphör 2026-12-31 och finns bara på äldre konton. Redan genererade
filer fungerar vidare, men nya repliker och omtagningar med samma röst blir omöjliga efter det datumet. Det bryter mot målet om
reproducerbar produktion.

Två hållbara alternativ:

1. **Voice Library**, delade röster. Sökkriterier finns i `voices.json` → `librarySearch`.
   - *Outbreak – operatör:* manlig, medelålders, amerikansk eller brittisk, raspig eller grusig, lugn och auktoritär, "military/radio/narration".
   - *Mini – berättare:* varm, glad, tydlig, "children's storyteller/animation". Kön valfritt; lyssna efter tydlighet i hög hastighet.
   - Kontrollera rösternas villkor (vissa har uppsägningstid eller begränsningar) och spara namn + id i `voices.json`.
2. **Voice Design** (egen röst från en beskrivning). Prompter finns i `voices.json` → `voiceDesignPrompt`. Rösten ägs av kontot och försvinner inte. Kostnaden för Voice Design är inte uppskattad här.

**Modell:** `eleven_multilingual_v2` är förvald. Den är stabil för korta, separata repliker och stöder `seed`. `eleven_v3` ger mer
dramatik (bra för operatören) men är mindre förutsägbar för enstaka korta repliker. Pröva båda på provpaketets tre vuxenrepliker
med `--model eleven_v3 --regenerate`. Det kostar 141 tecken extra.

**Radiokaraktär:** generera ett rent original. Radiofilter (bandpass ca 300–3 400 Hz och lätt distorsion) läggs antingen på
lokalt efter godkännande, eller i appen med en `BiquadFilterNode`. Det senare gör att samma fil kan användas utan filter, och filtret kan justeras utan nya krediter.

## 4. Arbetsflöde

1. **Granska manus.** Ändra text i `audio-production/catalog.json` och spegla ändringen i `docs/AUDIO-SCRIPTS.md` (testet `audio-production.test.ts` fångar skillnader).
2. **Välj röster** i ElevenLabs webbgränssnitt (provlyssning). Fyll i `voiceId` och `voiceName` i `voices.json`.
3. **Torrkörning** av provpaketet:
   ```bash
   npx tsx audio-production/generate.ts --pack sample
   ```
4. **Godkännande** av ägaren: röster, modell, kostnad.
5. **Generera provpaketet**. Nyckeln anges bara i det egna skalet:
   ```bash
   export ELEVENLABS_API_KEY=...        # aldrig i en fil i repot, aldrig NEXT_PUBLIC_
   npx tsx audio-production/generate.ts --pack sample --live --accept-uncertain-cost
   ```
   Skriptet visar plan och kostnad, frågar `yes`, genererar en fil i taget och stoppar vid första fel utan att försöka igen.
6. **Lyssna** i `audio-production/output/<produkt>/<variant>/take-N.mp3`, helst utomhus i telefonens högtalare och med hörlurar.
7. **Godkänn eller underkänn:**
   ```bash
   npx tsx audio-production/generate.ts --approve adult.vo.game_start.1:1
   npx tsx audio-production/generate.ts --reject adult.enemy.growl.2:1
   npx tsx audio-production/generate.ts --id adult.enemy.growl.2 --regenerate --live --accept-uncertain-cost
   ```
   `--approve` kopierar filen till appens `public/audio/el/…` och markerar tagningen i `manifest.json`. Checka in båda.
8. **Fullständig produktion** i omgångar per produkt och paket (`--pack core --product mini` osv.), med samma granskning.
9. **Integration** i en separat PR enligt [AUDIO-DESIGN.md](AUDIO-DESIGN.md) §5.

### Skriptets regler

| Krav | Hur |
| --- | --- |
| Torrkörning som standard | Utan `--live` görs inga anrop. Utan `--pack`/`--id` väljs ingenting. |
| En fil / ett paket / en produkt | `--id <ljud eller variant>` (upprepas), `--pack sample\|core\|all`, `--product adult\|mini`. |
| Röst och modell | `--voice`, `--model`, `--sfx-model`, `--format`. `--voice` kräver en produkt om urvalet har tal för båda. |
| Återanvändning | Finns en godkänd eller väntande tagning med samma parametrar (hash) hoppas den över. En godkänd fil med ändrade parametrar markeras `skip-stale` och byts aldrig automatiskt. |
| Regenerering | Bara med `--regenerate`, och då som ny tagning. Gamla tagningar sparas. |
| Kostnad före generering | Plan och summa visas alltid. Tak `--max-credits` (standard 1 500). Osäker kostnad kräver `--accept-uncertain-cost`. Interaktivt `yes` om inte `--yes`. |
| Felhantering | 401/402/403/404/422/429 och nätverksfel förklaras. Första fel stoppar körningen. Inga omförsök. Nyckeln filtreras bort ur felmeddelanden. |
| Spårbarhet | Per tagning i `manifest.json` och `take-N.json`: exakta parametrar (utan nyckel), parameterhash, sha256, storlek, tid, status och `request-id` om det finns. |
| Aldrig i CI/bygge/test | Vägrar när `CI`, `GITHUB_ACTIONS`, `VERCEL`, `VERCEL_ENV`, `VITEST` eller `NEXT_PHASE` är satt. Ingen npm-script, build-steg eller workflow anropar skriptet. Testerna använder ett fejkat `fetch`. |

**Reproducerbarhet:** samma parametrar ger samma hash, men ElevenLabs lovar inte identiskt ljud (`seed` är "best effort"). Den
godkända filen är därför sanningen och checkas in. Parametrarna gör att en ny tagning kan göras på samma sätt.

## 5. Säkerhet för nyckeln

- Läses bara från `ELEVENLABS_API_KEY`, bara vid `--live`. Skrivs aldrig ut, loggas aldrig och sparas aldrig i manifest eller sidofiler (testas).
- Lägg den aldrig i `.env`, `.env.local`, `next.config.mjs` eller i Vercel. Inget i apparna läser den. Ett `NEXT_PUBLIC_`-prefix skulle bygga in den i klienten.
- Begränsa nyckeln i ElevenLabs (behörighet till Text to Speech och Sound Effects, kreditgräns om kontot har det) och återkalla den efter produktionen.
