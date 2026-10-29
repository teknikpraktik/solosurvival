# audio-production

Lokal produktion av röster, fiendeläten och ljudeffekter med ElevenLabs för Outbreak (`adult`) och Mini Outbreak (`mini`).
Ljuden genereras **en gång, lokalt, efter godkännande**. Apparna spelar sedan bara statiska filer från `public/audio/el/` och
`apps/mini/public/audio/el/`. Ingen runtime-koppling, ingen backend och ingen nyckel i klienten.

| Fil | Innehåll |
| --- | --- |
| `catalog.json` | Alla ljud: id, produkt, typ, händelse, prioritet, cooldown, längd, volym, avbrott, varianter (text/prompt), filnamn. Paket (`sample`). Priser med källa och datum. |
| `voices.json` | Röstprofiler `adult-operator` och `mini-narrator`: röst-id (ej valt än), modell, seed, röstinställningar, sökkriterier och Voice Design-prompt. |
| `lib.ts` | Validering, urval, kostnad, plan, generering, godkännande. Inga sidoeffekter (allt injiceras). |
| `generate.ts` | Kommandoraden. Torrkörning som standard. |
| `manifest.json` | Skapas vid första genereringen. Varje tagning med parametrar, hash, sha256, storlek, tid, status och svarshuvuden (request-id). Checkas in. |
| `output/` | Tagningar för granskning (`<produkt>/<variant>/take-N.mp3` + `.json`). Ignoreras av git. |

## Snabbstart

```bash
npx tsx audio-production/generate.ts --validate
npx tsx audio-production/generate.ts --list
npx tsx audio-production/generate.ts --pack sample            # torrkörning: plan + kostnad, inga anrop
```

Generera (först när röster, manus och kostnad är godkända):

```bash
export ELEVENLABS_API_KEY=...          # bara i det egna skalet, aldrig i en fil i repot
npx tsx audio-production/generate.ts --pack sample --product adult --voice <voiceId> --live --accept-uncertain-cost
npx tsx audio-production/generate.ts --approve adult.vo.game_start.1:1
```

`--live` frågar alltid efter `yes` (om inte `--yes` anges), vägrar över `--max-credits` (standard 1500), vägrar om priset är osäkert utan
`--accept-uncertain-cost`, och vägrar helt när `CI`, `GITHUB_ACTIONS`, `VERCEL`, `VITEST` eller `NEXT_PHASE` är satt.
Ingenting genereras om en tagning med samma parametrar redan finns. En godkänd fil byts bara med `--regenerate`.

Se [`docs/ELEVENLABS-WORKFLOW.md`](../docs/ELEVENLABS-WORKFLOW.md) för hela arbetsflödet och kostnaderna,
[`docs/AUDIO-DESIGN.md`](../docs/AUDIO-DESIGN.md) för arkitektur och integration, och
[`docs/AUDIO-SCRIPTS.md`](../docs/AUDIO-SCRIPTS.md) för manus.
