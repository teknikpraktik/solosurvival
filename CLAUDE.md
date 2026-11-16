# OUTBREAK: Solo Survival

GPS-baserat zombiespel (Next.js/TypeScript). Kampanjer är huvudprodukten; Free Play är de fristående lägena.
Den här filen är en ingång till dokumentationen, inte en kopia av den. Skriv inte in berättelseinnehåll här.

## Två sanningskällor

| Fråga | Sanningskälla |
|---|---|
| Vad gör spelet faktiskt? | **Koden och testerna.** Kampanjtext, repliker och regler: `src/campaign/` |
| Vilka berättelsebeslut gäller för fortsatt utveckling? | **Story Bible:** [`docs/OUTBREAK_STORY_BIBLE_V2_2.md`](docs/OUTBREAK_STORY_BIBLE_V2_2.md) |

Vid avvikelse mellan dem: undersök orsaken och rapportera avvikelsen. Ändra inte automatiskt koden för att passa dokumentationen,
eller tvärtom. En avvikelse kan vara en bugg i koden, ett inaktuellt dokument eller ett beslut som inte har förts in någonstans.

Äldre versioner av Story Bible ligger i `docs/story/archive/` och är ersatta. Använd dem inte som underlag.

## Regler för berättelsearbete

- Läs relevanta delar av Story Bible innan du ändrar kampanjer, dialoger, radiorepliker, karaktärer, Safehouses, berättelsehändelser
  eller narrativa bilder och ljud.
- Berättelsen har exakt tre återkommande huvudroller: WATCHTOWER, RAVEN TWO och Dr. Elena Voss. Inför inga nya namngivna
  huvudroller och ändra inte fastställd bakgrundshistoria utan ett uttryckligt beslut.
- Bevara kontinuiteten mellan de fem kampanjerna och deras 25 uppdrag.
- Skilj mellan **[IMPLEMENTERAT]**, **[PLANERAT]** och **[KRÄVER NY MEKANIK]** i Story Bible. Kontrollera alltid koden innan du
  beskriver något som implementerat.
- När en beslutad berättelseändring implementeras: uppdatera relevanta avsnitt i Story Bible i samma PR.
- Ändra inte Story Bible för UI-, kart-, prestanda- eller motorändringar som inte påverkar berättelsen.
- Radiorepliker är inspelade. Ny text i en befintlig replik kräver ny inspelning, och replik-id:n byter aldrig namn. Se röstsystemet nedan.

## Automatisk kontinuitetskontroll

`src/tests/unit/story-bible.test.ts` (körs i `npm test` och CI) kontrollerar att varje ordagrant citat av THE FALL i Story Bible
avsnitt 7 och 11 är identiskt med rätt fält i `src/campaign/the-fall.ts`. Citaten är märkta med osynliga markörer,
`<!--q:the-fall/03.success-->…<!--/q-->` (se Story Bible avsnitt 0). Testet kräver också att varje intro-rad, success-text,
vinstreplik och epilograd är citerad, och att inga omärkta citat finns i de avsnitten.

Fallerar testet: avgör vilken sida som är fel innan du ändrar något (se ovan). Testet kontrollerar bara ordalydelse. Det ersätter
inte granskning av karaktärer, tidslinje eller berättelsemässiga motsägelser.

## Teknisk dokumentation

- THE FALL, implementation, balans, progression och tester: [`docs/CAMPAIGN-THE-FALL.md`](docs/CAMPAIGN-THE-FALL.md)
- Röstsystemet (ElevenLabs, manus, manifest): [`docs/CAMPAIGN-THE-FALL.md` avsnitt 6](docs/CAMPAIGN-THE-FALL.md#6-röstfiler-elevenlabs),
  manus `docs/campaign/the-fall-voice-script.csv`, `scripts/campaign-voice.ts`, `scripts/campaign-voice-generate.ts`
- Kända berättelsebuggar: [`docs/BUGG-THE-FALL-TVA-CHECKPOINTS.md`](docs/BUGG-THE-FALL-TVA-CHECKPOINTS.md)
- Övrigt ljud: [`docs/LJUD.md`](docs/LJUD.md)

## Kontroller

```bash
npm test
```

```bash
npm run lint
```

```bash
npm run campaign:voice -- --check
```

CI (`.github/workflows/ci.yml`) kör dessa, regressionsfingeravtrycket och produktionsbygget.
