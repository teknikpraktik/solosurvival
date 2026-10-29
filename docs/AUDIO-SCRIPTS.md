# Ljudmanus – Outbreak och Mini Outbreak

Alla repliker och ljudbeskrivningar som skickas till ElevenLabs, på engelska. **Källan är `audio-production/catalog.json`.** Den här filen är en läsbar spegel av katalogen, och testet `src/tests/unit/audio-production.test.ts` kontrollerar att varje text i katalogen också står här. Ändra i katalogen först.

Status: **utkast för granskning**. Inget har genererats. Kolumnen *Trigger* anger om händelsen redan har ljud (`existing`), finns men är tyst (`existing-silent`) eller är ett förslag som kräver ny kod (`proposed`); se [AUDIO-INVENTORY.md](AUDIO-INVENTORY.md). ★ = ingår i provpaketet.

## Omfattning

| | Röst (ljud / filer) | Fiende (ljud / filer) | Effekt (ljud / filer) | Ambient (ljud / filer) |
| --- | --- | --- | --- | --- |
| Outbreak | 26 / 50 | 5 / 10 | 9 / 11 | 1 / 1 |
| Mini Outbreak | 18 / 36 | 4 / 12 | 7 / 7 | 0 / 0 |
| **Totalt** | **44 / 86** | **9 / 22** | **16 / 18** | **1 / 1** |

Varianter för samma händelse spelas slumpvis (aldrig samma två gånger i rad) när *Slump* = ja. Nedräkning, tidsvarning och Minis typrepliker väljs efter värde, inte slumpvis.

## Skrivregler

- Korta repliker (helst under 3 s, högst 120 tecken), en tanke per replik. Viktigast först.
- Ingen replik kräver att spelaren tittar på skärmen ("check your map" används aldrig). Avstånd och riktning sägs i ord.
- Inga uppmaningar att springa eller att strunta i omgivningen. Ordet *run* används inte i nya repliker.
- **Outbreak:** operatör på radio, lugn och kontrollerad, lite raspig. Vardagligt radiospråk ("Copy that", "Survivor"), inte militärjargong som kräver förklaring.
- **Mini:** vänlig berättare för barn i 6–10-årsåldern. Positiv även vid förlust. Inga ord som *dead*, *kill*, *scream*, *scary*, *infected* eller *run* (valideras automatiskt).
- Ljudbeskrivningar (SFX): ljudkälla, karaktär, avstånd/akustik och "no music" när det ska vara rent. Mini-prompter avslutas med "not scary"/"not creepy".

## Outbreak (vuxen)

### Röstmeddelanden (röstprofil `adult-operator`)

| Ljud-id | Händelse | Trigger | Prio | Cooldown | Slump | Repliker |
| --- | --- | --- | --- | --- | --- | --- |
| `adult.vo.game_start` | `match.start` | existing | P1 | 0 s | ja | 1. Survivor, this is Control. You're live. Move out. ★<br>2. Control here. The clock is running. Stay sharp.<br>3. Comms check complete. The infected are out there. Keep moving. |
| `adult.vo.resume` | `match.resume` | existing-silent | P3 | 10 s | ja | 1. Back on the grid. Keep moving.<br>2. Copy that. Resuming. |
| `adult.vo.pause` | `match.pause` | existing-silent | P3 | 10 s | nej | 1. Holding. Everything is on pause. |
| `adult.vo.first_contact` | `enemy.first_contact` | existing | P2 | 0 s | ja | 1. Survivor, hostile movement detected.<br>2. Heads up. I've got infected on the scope. |
| `adult.vo.enemy_nearby` | `enemy.approach` | existing | P2 | 30 s | ja | 1. Infected inside two hundred metres. Keep moving. ★<br>2. Hostiles closing on your position.<br>3. Contact, two hundred metres. Don't stop. |
| `adult.vo.hunted` | `enemy.detected` | existing-silent | P2 | 60 s | ja | 1. They've picked up your trail.<br>2. Multiple infected approaching. Keep moving.<br>3. You've been spotted. Move. |
| `adult.vo.danger_close` | `enemy.contact` | existing-silent | P0 | 8 s | ja | 1. Contact! Move away now!<br>2. Too close! Break away! |
| `adult.vo.countdown` | `enemy.countdown` | existing | P0 | 0 s | nej | 100. One hundred metres.<br>50. Fifty.<br>40. Forty.<br>30. Thirty.<br>20. Twenty!<br>10. Ten! |
| `adult.vo.sprint` | `enemy.sprint` | existing | P2 | 25 s | ja | 1. Sprinter on your trail!<br>2. One of them is sprinting toward you. |
| `adult.vo.checkpoint` | `objective.checkpoint` | existing | P3 | 0 s | ja | 1. Checkpoint secured.<br>2. Good. Checkpoint confirmed.<br>3. Checkpoint reached. On to the next one. |
| `adult.vo.all_checkpoints` | `objective.all_checkpoints` | existing | P3 | 0 s | ja | 1. All checkpoints secured. Head home.<br>2. That's the last one. Get back home. |
| `adult.vo.extraction_open` | `extraction.opened` | existing-silent | P1 | 0 s | ja | 1. Extraction point identified. Head there now. ★<br>2. Evac is open. Get to the pickup. |
| `adult.vo.extraction_unavailable` | `extraction.unavailable` | existing-silent | P1 | 0 s | nej | 1. No safe extraction available. Stay alive, survivor. |
| `adult.vo.extraction_soon` | `extraction.soon` | proposed | P1 | 0 s | nej | 1. Extraction opens in one minute. Stay alive. |
| `adult.vo.extraction_hold` | `extraction.holding` | proposed | P1 | 20 s | nej | 1. You're at the pickup. Hold position. |
| `adult.vo.victory` | `match.won` | existing-silent | P1 | 0 s | ja | 1. You made it. Good work, survivor.<br>2. Mission complete. You're safe. |
| `adult.vo.extracted` | `match.won` | existing-silent | P1 | 0 s | ja | 1. Extraction confirmed. You're out. Well done.<br>2. Wheels up. You survived. |
| `adult.vo.captured` | `match.captured` | existing | P1 | 0 s | ja | 1. Survivor down. I repeat, survivor down.<br>2. We've lost you. You've been caught. |
| `adult.vo.time_up` | `match.time_up` | existing-silent | P1 | 0 s | ja | 1. Time's up. Mission failed.<br>2. Out of time, survivor. We couldn't get you out. |
| `adult.vo.time_warning` | `time.warning` | proposed | P2 | 0 s | nej | 5. Five minutes remaining.<br>1. One minute left. Make it count. |
| `adult.vo.gps_lost` | `gps.lost_long` | existing-silent | P1 | 120 s | nej | 1. I've lost your signal. Everything is on hold until it's back. |
| `adult.vo.gps_restored` | `gps.restored` | proposed | P1 | 60 s | nej | 1. Signal restored. I've got you again. |
| `adult.vo.offnet_entered` | `offnet.entered` | existing-silent | P2 | 30 s | nej | 1. You're off the road network. Get back on a road. |
| `adult.vo.offnet_exposed` | `offnet.exposed` | existing-silent | P0 | 30 s | nej | 1. They've found you. Back to the road, now. |
| `adult.vo.offnet_left` | `offnet.left` | existing-silent | P3 | 30 s | nej | 1. Back on the network. Good. |
| `adult.vo.paused_away` | `app.paused_away` | existing-silent | P3 | 0 s | nej | 1. You were gone too long. We're on hold. Continue when you're ready. |

### Fiendeläten

| Ljud-id | Händelse | Trigger | Prio | Längd | Volym | Beskrivning till ElevenLabs |
| --- | --- | --- | --- | --- | --- | --- |
| `adult.enemy.growl` | `enemy.first_contact` | existing | P2 | 1.2 s | 0.7 | 1. Low guttural zombie growl, close by, wet rasping throat, single breath, horror game, no music ★<br>2. Hungry zombie snarl rising then falling, hoarse and menacing, dry outdoor acoustics, horror game, no music ★<br>3. Raspy rattling zombie breath with a short low moan, close and unsettling, no music |
| `adult.enemy.distant_scream` | `enemy.reveal` | proposed | P4 | 2.5 s | 0.45 | 1. Distant zombie scream echoing between buildings, far away, eerie reverb, no music<br>2. Several far-off infected howls answering each other across an empty town, distant, no music<br>3. Single distant inhuman shriek fading into wind, far away, no music |
| `adult.enemy.sprint_shriek` | `enemy.sprint` | existing | P2 | 1.5 s | 0.9 | 1. Zombie breaks into a sprint, sharp aggressive shriek with fast running footsteps on gravel, no music<br>2. Short piercing infected howl followed by rapid footsteps approaching, no music |
| `adult.enemy.capture` | `match.captured` | existing | P1 | 1.8 s | 0.9 | 1. Zombie lunges with a vicious snarl and a burst of radio static cutting out, cinematic horror sting, no gore |
| `adult.enemy.jump_scream` | `scare.jump` | existing | P4 | 1.2 s | 0.85 | 1. Sudden zombie screech right next to the listener, short and sharp, horror jump scare sting, no music |

### Ljudeffekter

| Ljud-id | Händelse | Trigger | Prio | Längd | Volym | Beskrivning till ElevenLabs |
| --- | --- | --- | --- | --- | --- | --- |
| `adult.sfx.radio_in` | `voice.chain` | existing | P4 | 0.5 s | 0.5 | 1. Short walkie-talkie squelch click, radio transmission start, clean, no voice<br>2. Military radio key-up chirp with a brief burst of static, no voice |
| `adult.sfx.radio_out` | `voice.chain` | existing | P4 | 0.5 s | 0.4 | 1. Short walkie-talkie release squelch, radio transmission end, soft static tail, no voice |
| `adult.sfx.warning` | `enemy.contact` | existing-silent | P0 | 1 s | 0.9 | 1. Urgent two-tone electronic warning beep, military proximity alarm, repeated twice, clean, no music ★ |
| `adult.sfx.tension` | `enemy.close_tension` | existing | P4 | 2.5 s | 0.6 | 1. Low ominous cinematic drone swell with a slow heartbeat pulse, tense, horror<br>2. Dark rising braam with dissonant strings, short, tense horror sting |
| `adult.sfx.checkpoint` | `objective.checkpoint` | existing | P3 | 1 s | 0.9 | 1. Clear confirmation tone, two rising digital notes, tactical interface success sound, bright, short |
| `adult.sfx.extraction_open` | `extraction.opened` | existing-silent | P1 | 2.5 s | 0.9 | 1. Distant helicopter rotor approaching with a radio beacon ping, cinematic, no music |
| `adult.sfx.victory` | `match.won` | existing-silent | P1 | 3 s | 0.9 | 1. Helicopter lifting off and flying away, rotor fading, with a soft hopeful synth swell, cinematic |
| `adult.sfx.game_over` | `match.time_up` | existing-silent | P1 | 2.5 s | 0.9 | 1. Deep cinematic boom followed by radio static fading to silence, bleak, horror game over |
| `adult.sfx.gps_lost` | `gps.lost_long` | existing-silent | P1 | 1 s | 0.6 | 1. Radio signal dropping out, short burst of static with a falling electronic tone |

### Atmosfär

| Ljud-id | Händelse | Trigger | Prio | Längd | Volym | Beskrivning till ElevenLabs |
| --- | --- | --- | --- | --- | --- | --- |
| `adult.amb.wind` | `match.playing` | proposed | P4 | 20 s (loop) | 0.2 | 1. Desolate abandoned town ambience, cold wind, distant creaking metal, very sparse, seamless loop, no music |

## Mini Outbreak (barn)

### Röstmeddelanden (röstprofil `mini-narrator`)

| Ljud-id | Händelse | Trigger | Prio | Cooldown | Slump | Repliker |
| --- | --- | --- | --- | --- | --- | --- |
| `mini.vo.game_start` | `match.start` | existing | P1 | 0 s | ja | 1. Ready, explorer? Your adventure starts now! ★<br>2. Here we go, explorer! Let's have an adventure!<br>3. Adventure time! Off we go! |
| `mini.vo.resume` | `match.resume` | existing-silent | P3 | 10 s | ja | 1. And we're back! Let's keep exploring!<br>2. Adventure on! |
| `mini.vo.pause` | `match.pause` | existing-silent | P3 | 10 s | nej | 1. Time for a little break! |
| `mini.vo.first_contact` | `enemy.first_contact` | existing-silent | P2 | 0 s | ja | 1. Ooh, I hear something silly out there!<br>2. Look out, explorer, the little monsters are awake! |
| `mini.vo.enemy_nearby` | `enemy.approach` | existing | P2 | 30 s | ja | 1. Uh-oh! Some little monsters are getting closer! ★<br>2. Watch out, explorer! Someone silly is coming!<br>3. Psst! A little monster is nearby. Keep going! |
| `mini.vo.nearby_kind` | `enemy.approach` | proposed | P2 | 30 s | nej | 1. [cute-zombie] A cute zombie is waddling your way!<br>2. [rainbow-ghost] A rainbow ghost is floating closer!<br>3. [rainbow-spider] A rainbow spider is scuttling nearby!<br>4. [mini-monster] A mini monster is bouncing your way! |
| `mini.vo.danger_close` | `enemy.contact` | existing-silent | P0 | 8 s | ja | 1. Too close! Move away, explorer!<br>2. Whoa, scoot away from that one! |
| `mini.vo.sprint` | `enemy.sprint` | existing-silent | P2 | 25 s | ja | 1. Whoa, that one is speedy!<br>2. Zoom! Someone is in a hurry! |
| `mini.vo.checkpoint` | `objective.checkpoint` | existing | P3 | 0 s | ja | 1. Awesome! You've reached a checkpoint! ★<br>2. Yay! Checkpoint found!<br>3. Great job! That's a checkpoint! |
| `mini.vo.all_checkpoints` | `objective.all_checkpoints` | existing | P3 | 0 s | ja | 1. You found them all! Now let's head home!<br>2. Every checkpoint done! Time to go home! |
| `mini.vo.extraction_open` | `extraction.opened` | existing-silent | P1 | 0 s | ja | 1. The helicopter has landed! Let's go there now!<br>2. Your ride is here, explorer! Head to the helicopter! |
| `mini.vo.victory` | `match.won` | existing | P1 | 0 s | ja | 1. You did it! What an amazing adventure!<br>2. Hooray! You made it, explorer! |
| `mini.vo.caught` | `match.captured` | existing | P1 | 0 s | ja | 1. Oh no, they caught you! Want to try again?<br>2. Gotcha! The little monsters win this time. Let's try again! |
| `mini.vo.time_up` | `match.time_up` | existing-silent | P1 | 0 s | ja | 1. Time's up! Great try, explorer!<br>2. That's the end of the clock. Nice exploring! |
| `mini.vo.time_warning` | `time.warning` | proposed | P2 | 0 s | nej | 1. Just one minute left, explorer! |
| `mini.vo.gps_lost` | `gps.lost_long` | existing-silent | P1 | 120 s | nej | 1. Hmm, I can't find you right now. Let's wait a moment. |
| `mini.vo.gps_restored` | `gps.restored` | proposed | P1 | 60 s | nej | 1. Found you! Let's keep going! |
| `mini.vo.paused_away` | `app.paused_away` | existing-silent | P3 | 0 s | nej | 1. Welcome back! The game took a little nap. Press continue when you're ready. |

### Fiendeläten

| Ljud-id | Händelse | Trigger | Prio | Längd | Volym | Beskrivning till ElevenLabs |
| --- | --- | --- | --- | --- | --- | --- |
| `mini.enemy.cute_zombie` | `enemy.approach` | proposed | P4 | 1 s | 0.6 | 1. Small comic cartoon zombie groan, goofy and sleepy, 'uhhh' sound, kids cartoon, soft volume, not scary ★<br>2. Silly little cartoon zombie mumble with a hiccup, playful, kids game, not scary<br>3. Tiny clumsy cartoon zombie yawn and grumble, funny, kids cartoon, not scary |
| `mini.enemy.rainbow_ghost` | `enemy.approach` | proposed | P4 | 1.2 s | 0.6 | 1. Soft airy playful cartoon ghost 'woooo' with a sparkly twinkle, gentle, kids game, not scary ★<br>2. Friendly floating ghost giggle with a breathy whoosh and soft chimes, kids cartoon, not scary<br>3. Gentle magical ghost hum gliding up and down with fairy sparkles, kids game, not scary |
| `mini.enemy.rainbow_spider` | `enemy.approach` | proposed | P4 | 0.8 s | 0.55 | 1. Tiny fast cartoon chittering clicks like a happy cricket, playful, kids game, not creepy<br>2. Quick little pitter-patter of tiny cartoon feet with cheerful chirps, kids cartoon, not creepy<br>3. Small giggly cartoon bug trill, bouncy and fast, kids game, not creepy |
| `mini.enemy.mini_monster` | `enemy.approach` | proposed | P4 | 1 s | 0.6 | 1. Bubbly cartoon monster gurgle with a happy squeak, kids game, cute, not scary<br>2. Little round monster boing and blubber, silly and friendly, kids cartoon, not scary<br>3. Cute small monster 'rawr' that sounds like a playful puppy, kids game, not scary |

### Ljudeffekter

| Ljud-id | Händelse | Trigger | Prio | Längd | Volym | Beskrivning till ElevenLabs |
| --- | --- | --- | --- | --- | --- | --- |
| `mini.sfx.warning` | `enemy.approach` | existing | P2 | 0.8 s | 0.6 | 1. Gentle two-note marimba alert going up, soft and friendly, kids game notification, no music bed ★ |
| `mini.sfx.checkpoint` | `objective.checkpoint` | existing | P3 | 1 s | 0.9 | 1. Bright cheerful sparkle chime, three rising bell notes, happy kids game reward sound |
| `mini.sfx.game_start` | `match.start` | existing | P1 | 1.5 s | 0.8 | 1. Short cheerful adventure start jingle, ukulele and xylophone, upbeat kids game |
| `mini.sfx.extraction_open` | `extraction.opened` | existing-silent | P1 | 2 s | 0.8 | 1. Friendly toy helicopter landing with magical twinkles, cartoon, kids game, soft |
| `mini.sfx.victory` | `match.won` | existing-silent | P1 | 2.5 s | 0.85 | 1. Short happy victory fanfare with toy trumpets, xylophone and a little cheer, kids game, not too loud |
| `mini.sfx.caught` | `match.captured` | existing-silent | P1 | 1.2 s | 0.7 | 1. Soft cartoon boing followed by a gentle descending slide whistle, funny and friendly, kids game, not sad |
| `mini.sfx.gps_lost` | `gps.lost_long` | existing-silent | P1 | 0.7 s | 0.6 | 1. Soft curious cartoon 'bloop' with a questioning upward pitch, kids game |

## Provpaket (12 filer)

Genereras separat med `npx tsx audio-production/generate.ts --pack sample` (torrkörning först). Syftet är att bedöma röstval, radiokaraktär och fiendelätenas nivå innan resten produceras.

| # | Variant | Typ | Text / beskrivning |
| --- | --- | --- | --- |
| 1 | `adult.vo.game_start.1` | adult voice | Survivor, this is Control. You're live. Move out. |
| 2 | `adult.vo.enemy_nearby.1` | adult voice | Infected inside two hundred metres. Keep moving. |
| 3 | `adult.vo.extraction_open.1` | adult voice | Extraction point identified. Head there now. |
| 4 | `adult.enemy.growl.1` | adult enemy | Low guttural zombie growl, close by, wet rasping throat, single breath, horror game, no music |
| 5 | `adult.enemy.growl.2` | adult enemy | Hungry zombie snarl rising then falling, hoarse and menacing, dry outdoor acoustics, horror game, no music |
| 6 | `adult.sfx.warning.1` | adult effect | Urgent two-tone electronic warning beep, military proximity alarm, repeated twice, clean, no music |
| 7 | `mini.vo.game_start.1` | mini voice | Ready, explorer? Your adventure starts now! |
| 8 | `mini.vo.enemy_nearby.1` | mini voice | Uh-oh! Some little monsters are getting closer! |
| 9 | `mini.vo.checkpoint.1` | mini voice | Awesome! You've reached a checkpoint! |
| 10 | `mini.enemy.cute_zombie.1` | mini enemy | Small comic cartoon zombie groan, goofy and sleepy, 'uhhh' sound, kids cartoon, soft volume, not scary |
| 11 | `mini.enemy.rainbow_ghost.1` | mini enemy | Soft airy playful cartoon ghost 'woooo' with a sparkly twinkle, gentle, kids game, not scary |
| 12 | `mini.sfx.warning.1` | mini effect | Gentle two-note marimba alert going up, soft and friendly, kids game notification, no music bed |
