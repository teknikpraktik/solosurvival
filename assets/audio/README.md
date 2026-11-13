# Ljudkällor (OUTBREAK, vuxenappen)

Originalfilerna som levererades för ljudbilden. De ligger här som källmaterial och ingår **inte** i appen (`public/` innehåller bara de
komprimerade filerna). Produktionsfilerna byggs med:

```bash
node scripts/build-audio.mjs   # kräver ffmpeg med libmp3lame; skriver public/audio/*.mp3 och assets/audio/levels.json
```

Mini Outbreak använder inga av dessa filer.

## Filer

| Källfil | Användning | Format (verkligt) | Längd | sha256 (original) |
| --- | --- | --- | --- | --- |
| `theme-outbreak.mp3` | Menymusik | MP3, 48 kHz stereo, ≈181 kbit/s VBR | 211,3 s (4,2 s tystnad i början, uttoning 207,5–210,6 s) | `a746174154e488cf7c54d7ab4874e2f678e3c2ee4cdfc0df92fd4653bb7defbf` |
| `threat-pulse-1.wav` … `-4.wav` | Hotpuls, fyra likvärdiga varianter | WAV PCM 16 bit, 48 kHz stereo | 15 s vardera | se nedan |
| `captured.wav` | Fångad | WAV PCM 16/48/stereo | 4 s | `d5433b2b…` |
| `safe-door-close.wav` | Vinst hemma / vid B | WAV | 5 s | `c95f3059…` |
| `heli-extraction-success.wav` | Lyckad helikopterräddning | WAV | 7 s | `5fa5440d…` |
| `heli-extraction.wav` | Helikoptern väntar (loop) | WAV | 30 s | `431ddfdc…` |
| `heli-approach.wav` | Helikoptern närmar sig (levererad som `heli-apch`) | WAV | 25 s | `808c25b4…` |
| `zombie-near.wav` | Zombie på nära håll | WAV | 3 s | `9059e77f…` |
| `position-revealed.wav` | Positionen avslöjad | WAV | 2 s | `faa68ec0…` |
| `checkpoint-reached.wav` | Checkpoint | WAV | 2 s | `42423750…` |
| `radio-open.wav` | Radioklick före operatörens röst | WAV | 0,49 s | `1bd9b0bc…` |

Operatörens röster (WAV PCM 16 bit, 48 kHz stereo, radioeffekt i filerna): keep-moving 8 s, safehouse-on-map 8 s, checkpoint-secured 5 s,
get-to-safehouse 7 s, rescue-inbound 6 s, get-to-helicopter 7 s, lifting-off 5 s, inside-safehouse 7 s. Nivå: integrerad −17 LUFS där
true peak tillåter (keep-moving −21,2 och inside-safehouse −21,9 begränsas av topparna); MP3 128 kbit/s, 81–129 kB styck (WAV 0,96–1,5 MB).

Hotpulser: 1 `81c21560…`, 2 `7d34016b…`, 3 `c06d5c67…`, 4 `00a9f3ef…` (fullständiga summor: `sha256sum assets/audio/source/*`).

## Nivåer och storlek

Fast förstärkning per fil (ingen dynamisk loudness-normalisering, ingen ändring av tonhöjd eller tempo). Mattor efter integrerad
ljudstyrka (I), korta händelseljud efter högsta momentana ljudstyrka (M, 400 ms). True peak högst −1 dBTP efter kodning. Bara
dörrsmällen (toppfaktor ≈ 20 dB) har fått en mjuk limiter; den är ändå ≈ 5 dB svagare än de andra händelseljuden och får full nivå i mixen.
Mätvärden före/efter finns i `levels.json`.

| Fil | Mått | Före | Förstärkning | Efter | TP efter | WAV → MP3 (128 kbit/s CBR) |
| --- | --- | --- | --- | --- | --- | --- |
| threat-pulse-1 | I | −28,5 | +4,5 dB | −24,4 | −7,1 | 2 880 078 → 240 768 B |
| threat-pulse-2 | I | −20,6 | −3,4 dB | −24,4 | −4,8 | 2 880 078 → 240 768 B |
| threat-pulse-3 | I | −23,7 | −0,3 dB | −24,5 | −10,5 | 2 880 078 → 240 768 B |
| threat-pulse-4 | I | −30,1 | +6,1 dB | −24,4 | −5,4 | 2 880 078 → 240 768 B |
| heli-extraction | I | −16,4 | −3,6 dB | −20,5 | −4,9 | 5 760 078 → 480 768 B |
| heli-approach | M | −14,0 | −2,0 dB | −16,4 | −3,1 | 4 800 078 → 400 896 B |
| heli-extraction-success | M | −14,8 | −1,5 dB (toppbegränsad) | −16,7 | −1,6 | 1 344 078 → 112 896 B |
| captured | M | −15,2 | +1,3 dB | −14,4 | −3,4 | 768 078 → 64 896 B |
| zombie-near | M | −15,3 | +1,3 dB | −14,4 | −3,5 | 576 078 → 48 768 B |
| position-revealed | M | −10,0 | −4,0 dB | −14,4 | −8,1 | 384 078 → 33 024 B |
| checkpoint-reached | M | −7,3 | −6,7 dB | −14,4 | −7,6 | 384 078 → 33 024 B |
| radio-open | M | −15,8 | −0,2 dB | −16,4 | −7,6 | 93 486 → 8 832 B |
| safe-door-close | M | −26,8 | +9,8 dB + limiter | −19,4 | −2,5 | 960 078 → 81 024 B |
| theme-outbreak | – | I −16,0 | kopierad oförändrad | – | 0,0 | 4 792 224 B (oförändrad) |

Totalt: 31,4 MB källmaterial → 7,0 MB i appen (2,2 MB effekter + 4,8 MB musik).

Menymusiken kodas inte om: den är redan MP3 i ≈181 kbit/s, och en omkodning hade bara gett en extra förlustgeneration utan att bli
mindre i den rekommenderade bithastigheten. Dess nivå (true peak 0,0 dBFS) hanteras i mixen (musikbussen ≈ −10 dB) och av
säkerhetslimitern.

## Loopar

Inget av originalen antas loopa sömlöst (mätt: hotpuls 3 och helikopterloopen har tydliga språng vid skarven). Spelaren gör därför
varje varv till en egen uppspelning på ljudklockan och överlappar skarven med en kort equal-power-övertoning (hotpuls 0,12 s,
helikopter 0,35 s). MP3-kodarens tystnad i början och slutet klipps bort vid uppspelningen. Musiken upprepas med en 3,5 s övertoning
in i låtens egen uttoning och börjar om vid 4,0 s (efter den inledande tystnaden).

Ingen har lyssnat på resultatet i den här miljön: skarvar och nivåer är mätta, inte provlyssnade.
