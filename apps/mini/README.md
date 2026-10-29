# Mini Outbreak Solo Survival

Barnversionen av OUTBREAK. En egen Next.js-PWA som delar spelmotor, zombie-AI, pathfinding, GPS, kartdata och karta med vuxenappen i repo-roten (`src/`). Inget av det delade är kopierat hit.

## Vad som skiljer (src/config/product.ts)

| | OUTBREAK (roten) | Mini Outbreak |
|---|---|---|
| Fiendefart | 1,0 | 0,8 (`enemySpeedMultiplier`, efter aktivitet och svårighet; spurt och terrängfart följer med) |
| Förflyttning | Till fots, cykel | Bara till fots (spärras även i den delade sessionen och vid återställning) |
| Spellägen | Checkpoints, A TO B, Survival (med extraction) | Samma tre, samma regler |
| Skrämmor | Ja | Nej (profilen stänger av dem) |
| Fiender | Zombie | Cute Zombie, Rainbow Ghost, Rainbow Spider, Cute Mini Monster, blandade (bara utseende) |
| Ljud | Skräckpaket | Bara checkpoint-klangen; allt annat tyst tills nya ljud finns |
| Lagring | IndexedDB `outbreak`, `outbreak.*` | IndexedDB `mini-outbreak`, `mini-outbreak.*` |
| PWA | `OUTBREAK – Solo Survival`, id `/` | `Mini Outbreak Solo Survival`, id `/?app=mini-outbreak` |

## Kommandon

Beroenden installeras **bara i repo-roten** (`npm ci` där). `apps/mini` har ingen egen `node_modules` (en `preinstall`-spärr stoppar det), så barnappen och den delade koden använder samma React.

```bash
cd apps/mini
npm run dev        # http://localhost:3001 (kopierar MapLibre-worker och kartdata till public/ först)
npm run typecheck
npm test           # enhetstester (Vitest)
npm run build
npx next start -p 3201 &
CHROMIUM_PATH=/path/to/chrome npm run e2e   # webbläsartest, mockad GPS
```

## Driftsättning (ej gjord)

Tänkt som ett eget Vercel-projekt från samma repo: Root Directory `apps/mini`, inställningar i `vercel.json` (installation i roten). Inget `ignoreCommand`: repo-rotens `.vercelignore` tar bort `.git` före bygget, så ett git-baserat ignore-steg kan inte köras i Vercel (projektet byggs därför vid varje push till `master`). Vuxenprojektet ändras inte. Barnappen ska ha en egen domän eller subdomän, aldrig en sökväg under vuxenappens domän: där skulle vuxenappens service worker (scope `/`) och lagring delas.

## Tillfällig grafik och ljud

- Fiendefigurerna, illustrationerna och ikonerna (`src/client/enemies.ts`, `public/icons/`, ritade med `scripts/make-icons.mts`) är enkla platshållare. De ska ersättas av slutliga illustrationer: fyra fiendetyper (kartmarkör cirka 38 px och illustration), app-ikon 192/512/maskable/Apple 180 och gärna en startbild.
- Ljud: bara `public/audio/checkpoint.wav` (samma glada klang som i OUTBREAK). Barnvänliga ljud för fiende nära, fångad, vinst och match slut läggs till i `MINI_SOUNDS` (`src/client/sounds.ts`).
