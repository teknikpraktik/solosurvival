/**
 * THE FALL: the first campaign. Five missions, on foot, each its own session started from wherever the player is.
 *
 * Story in one breath: an outbreak nobody can explain spreads and society comes apart. The player, alone outside, is picked up on the
 * radio by WATCHTOWER, a civil-defence radio operator who is still at her post. She gets the player through the first night (01), has
 * them fetch supplies for a group of survivors (02), sends them to the Waystation, a fallback shelter, when the evacuation route is cut
 * (03), needs them to bring an old relay network on the air when the evacuation force goes silent (04), and talks them onto the
 * helicopter (05). The epilogue holds the hook to GROUND ZERO: a broken call from the lost evacuation force.
 *
 * The story canon (characters, timeline, what comes next) is docs/OUTBREAK_STORY_BIBLE_V2_2.md. THE FALL never explains the outbreak.
 *
 * Writing rules for the radio lines: short, plain, procedural. Call signs, no speeches, no jokes. WATCHTOWER is calm and exact and only
 * raises her voice when the player is about to be caught. RAVEN TWO (the helicopter crew) is clipped aviation radio. A line is also shown
 * as text while the player is moving, so it must be readable at a glance.
 *
 * Voice files: one per beat, /campaign/the-fall/voice/<beat id>.mp3 (see docs/CAMPAIGN-THE-FALL.md). Ids are permanent.
 */
import type { CampaignDef, MissionDef } from "./types";

const IMG = "/campaign/the-fall";

const firstContact: MissionDef = {
  id: "01",
  title: "FIRST CONTACT",
  tagline: "The outbreak begins",
  mode: "survival",
  layout: { kind: "survive", durationS: 15 * 60 },
  tuning: {
    speed: 0.85,
    zombies: { easy: { initial: 1, max: 4 }, normal: { initial: 2, max: 6 }, hard: { initial: 3, max: 9 } },
    growthUntil: 0.8,
    interceptShare: { easy: 0, normal: 0, hard: 0 },
  },
  aboutMin: 15,
  image: `${IMG}/mission-01.jpg`,
  imagePosition: "50% 46%",
  intro: [
    "It started this afternoon. Sirens, then nothing.",
    "People are attacking each other in the streets. Nobody knows why.",
    "Then a voice breaks through the static.",
  ],
  objective: "Stay on the move and stay away from the infected for 15 minutes.",
  hud: "Survive",
  ending: "plain",
  success: "You made it through the first night. A group of survivors needs your help.",
  beats: [
    { id: "tf-m01-start", speaker: "watchtower", trigger: { on: "start" }, fallbackVoice: "keepMoving",
      text: "Any station, this is Watchtower. If you can hear me: stay outside, keep moving, and do not approach anyone." },
    { id: "tf-m01-signal", speaker: "watchtower", trigger: { on: "time", atS: 50 },
      text: "I have your signal. There are infected on the streets around you. Red on your map. Keep your distance." },
    { id: "tf-m01-hunt", speaker: "watchtower", trigger: { on: "hunt" },
      text: "They have seen you. They will not stop. Keep your distance, and pick a way out before you need it." },
    { id: "tf-m01-spread", speaker: "watchtower", trigger: { on: "time", atFrac: 0.4 },
      text: "More reports coming in. It is spreading faster than we can track. Expect more of them." },
    { id: "tf-m01-contact", speaker: "watchtower", trigger: { on: "contact" },
      text: "Too close! Break away, now!" },
    { id: "tf-m01-survivors", speaker: "watchtower", trigger: { on: "time", atFrac: 0.75 },
      text: "Stand by. I am picking up a second group on this channel. Survivors, not far from you." },
    { id: "tf-m01-minute", speaker: "watchtower", trigger: { on: "time", beforeEndS: 60 },
      text: "One more minute. Keep moving." },
    { id: "tf-m01-win", speaker: "watchtower", trigger: { on: "end", result: "survived" },
      text: "You are still on your feet. I am logging you as Runner Seven. That group needs medicine and supplies. Rest while you can." },
    { id: "tf-m01-caught", speaker: "watchtower", trigger: { on: "end", result: "infected" },
      text: "Station, respond. … Signal lost." },
  ],
};

const supplyRun: MissionDef = {
  id: "02",
  title: "THE SUPPLY RUN",
  tagline: "Supplies and survival",
  mode: "mission",
  // Exactly three: the intro, the objective and the radio ("Two to go", "That is all three") name the number.
  layout: { kind: "checkpoints", count: 3, minCount: 3, courseLengthM: 1500, anyOrder: true },
  tuning: {
    speed: 0.95,
    zombies: { easy: { initial: 3, max: 6 }, normal: { initial: 4, max: 9 }, hard: { initial: 6, max: 13 } },
    growthUntil: 0.7,
    interceptShare: { easy: 0, normal: 0, hard: 0.2 },
    spreadStart: { minDistanceM: 250 },
  },
  aboutMin: 20,
  image: `${IMG}/mission-02.jpg`,
  imagePosition: "45% 66%",
  intro: [
    "Eleven people in a cellar. Two of them will not last without medicine.",
    "Watchtower has found three places where supplies were left behind.",
    "You are the only one who can still move.",
  ],
  objective: "Reach the three supply sites, in any order. Plan your way around the infected.",
  hud: "Supplies",
  ending: "plain",
  success: "The supplies are in. The group can hold out, but the evacuation routes are closing.",
  beats: [
    { id: "tf-m02-start", speaker: "watchtower", trigger: { on: "start" }, fallbackVoice: "checkpointStart",
      text: "Runner Seven, Watchtower. Three supply sites on your map. Any order. Look where the infected are before you choose." },
    { id: "tf-m02-plan", speaker: "watchtower", trigger: { on: "time", atS: 75 },
      text: "The short way is not always the safe way. Go around them if you have to." },
    { id: "tf-m02-first", speaker: "watchtower", trigger: { on: "objective", which: "first" }, fallbackVoice: "checkpointSecured",
      text: "First site cleared. Good. Two to go." },
    { id: "tf-m02-middle", speaker: "watchtower", trigger: { on: "objective", which: "middle" }, fallbackVoice: "checkpointSecured",
      text: "Second site cleared. One left. They are gathering between you and it." },
    { id: "tf-m02-contact", speaker: "watchtower", trigger: { on: "contact" },
      text: "Runner, move! It is right on you!" },
    { id: "tf-m02-late", speaker: "watchtower", trigger: { on: "time", atFrac: 0.7 },
      text: "The group is running out of time. So are you." },
    { id: "tf-m02-win", speaker: "watchtower", trigger: { on: "objective", which: "last" },
      text: "That is all three. They will make it through the night. … Stand by, Runner. The evacuation routes are closing." },
    { id: "tf-m02-late-fail", speaker: "watchtower", trigger: { on: "end", result: "failed" },
      text: "We are out of time. Pull back, Runner. We try again." },
    { id: "tf-m02-caught", speaker: "watchtower", trigger: { on: "end", result: "infected" },
      text: "Runner Seven, respond. … Runner?" },
  ],
};

const noWayBack: MissionDef = {
  id: "03",
  title: "NO WAY BACK",
  tagline: "Escape and interception",
  mode: "escape",
  layout: { kind: "destination", routeLengthM: 1500 },
  tuning: {
    speed: 1,
    zombies: { easy: { initial: 4, max: 8 }, normal: { initial: 6, max: 12 }, hard: { initial: 8, max: 16 } },
    growthUntil: 0.6,
    interceptShare: { easy: 0.25, normal: 0.45, hard: 0.65 },
  },
  aboutMin: 20,
  image: `${IMG}/mission-03.jpg`,
  imagePosition: "50% 44%",
  intro: [
    "The evacuation road is blocked. Cars, barriers, and what is left of the people who tried.",
    "One shelter is still taking people: the Waystation. Not for long.",
    "And the infected have started to hunt differently.",
  ],
  objective: "Reach the safe zone before it is sealed. Some infected will try to cut you off: change your route to fool them.",
  hud: "Safe zone",
  ending: "safehouse",
  success: "You are inside the Waystation. But the evacuation force has gone silent.",
  beats: [
    { id: "tf-m03-start", speaker: "watchtower", trigger: { on: "start" }, fallbackVoice: "safehouseOnMap",
      text: "Runner Seven, the east road is gone. New safe zone on your map. Get there before they seal it." },
    { id: "tf-m03-intercept", speaker: "watchtower", trigger: { on: "intercept" },
      text: "Careful. Some of them are not following you. They are cutting ahead. Change your route." },
    { id: "tf-m03-half", speaker: "watchtower", trigger: { on: "goal", covered: 0.5 },
      text: "Halfway. Do not be predictable." },
    { id: "tf-m03-contact", speaker: "watchtower", trigger: { on: "contact" },
      text: "Break contact, Runner! Now!" },
    { id: "tf-m03-near", speaker: "watchtower", trigger: { on: "goal", withinM: 200 },
      text: "Two hundred metres. They are opening the gate for you." },
    { id: "tf-m03-win", speaker: "watchtower", trigger: { on: "end", result: "survived" }, fallbackVoice: "insideSafehouse",
      text: "You are in. Gate is sealed. … Runner, I have lost the evacuation force. Nothing on any channel. There is an old relay network near you. It may be the last way to reach them." },
    { id: "tf-m03-late-fail", speaker: "watchtower", trigger: { on: "end", result: "failed" },
      text: "They have sealed the zone. You did not make it in time. Find cover. We try again." },
    { id: "tf-m03-caught", speaker: "watchtower", trigger: { on: "end", result: "infected" },
      text: "Runner Seven, respond. … I have lost Runner Seven." },
  ],
};

const lastSignal: MissionDef = {
  id: "04",
  title: "THE LAST SIGNAL",
  tagline: "Establishing communication",
  mode: "mission",
  layout: {
    // Exactly three relays: the intro and the radio name the number, and "tf-m04-middle" is the second of three.
    kind: "checkpoints", count: 3, minCount: 3, courseLengthM: 2000, anyOrder: false,
    transmit: {
      holdS: { easy: 20, normal: 30, hard: 30 },
      lastHoldS: { easy: 30, normal: 45, hard: 45 },
      // Never tighter than 50 m: the zone has to hold GPS noise and leave room to keep moving.
      radiusM: { easy: 60, normal: 55, hard: 50 },
      spawn: { easy: 1, normal: 1, hard: 2 },
    },
  },
  tuning: {
    speed: 1,
    zombies: { easy: { initial: 3, max: 7 }, normal: { initial: 4, max: 10 }, hard: { initial: 6, max: 13 } },
    growthUntil: 0.7,
    interceptShare: { easy: 0, normal: 0.2, hard: 0.4 },
    spreadStart: { minDistanceM: 250 },
  },
  aboutMin: 25,
  image: `${IMG}/mission-04.jpg`,
  imagePosition: "60% 20%",
  intro: [
    "No one has heard from the evacuation force in six hours.",
    "An old relay network still has power. Three sites. Each has to be brought on the air by hand.",
    "A signal that strong will be heard by everything out there.",
  ],
  objective: "Reach each relay site and stay inside its zone while the signal is established. Leaving the zone only pauses it.",
  hud: "Relay",
  ending: "plain",
  success: "The signal is out. A helicopter is coming, if you can stay alive until it lands.",
  beats: [
    { id: "tf-m04-start", speaker: "watchtower", trigger: { on: "start" }, fallbackVoice: "checkpointStart",
      text: "Three relay sites on your map, in order. At each one, stay inside the zone while I push the signal out. If it gets too close, leave. The signal will wait for you." },
    { id: "tf-m04-tx-start", speaker: "watchtower", trigger: { on: "transmit", change: "started" }, repeatAfterS: 20,
      text: "Transmitting. Stay inside the zone. You can keep moving." },
    { id: "tf-m04-tx-paused", speaker: "watchtower", trigger: { on: "transmit", change: "paused" }, repeatAfterS: 20,
      text: "Signal paused. It holds where it is. Come back when it is clear." },
    { id: "tf-m04-tx-resumed", speaker: "watchtower", trigger: { on: "transmit", change: "resumed" }, repeatAfterS: 20,
      text: "Signal is back. Hold." },
    { id: "tf-m04-first", speaker: "watchtower", trigger: { on: "objective", which: "first" }, fallbackVoice: "checkpointSecured",
      text: "Relay one is live. Everything in range heard that. Move." },
    { id: "tf-m04-middle", speaker: "watchtower", trigger: { on: "objective", which: "middle" }, fallbackVoice: "checkpointSecured",
      text: "Relay two is live. One more. The main transmitter needs longer." },
    { id: "tf-m04-drawn", speaker: "watchtower", trigger: { on: "time", atFrac: 0.45 },
      text: "The transmissions are pulling them in. More infected heading your way." },
    { id: "tf-m04-contact", speaker: "watchtower", trigger: { on: "contact" },
      text: "Get out of there, Runner! The signal can wait!" },
    { id: "tf-m04-win", speaker: "watchtower", trigger: { on: "objective", which: "last" },
      text: "Signal is out on all bands. … Wait. I have a carrier. Someone is answering." },
    { id: "tf-m04-raven", speaker: "raven", trigger: { on: "end", result: "survived" },
      text: "Watchtower, Raven Two. We read your signal. One aircraft, one pickup. Tell your runner to stay alive until we get there." },
    { id: "tf-m04-late-fail", speaker: "watchtower", trigger: { on: "end", result: "failed" },
      text: "The relays have lost power. We are out of time. Pull back. We try again." },
    { id: "tf-m04-caught", speaker: "watchtower", trigger: { on: "end", result: "infected" },
      text: "Runner Seven, respond. … The signal is dead." },
  ],
};

const finalExtraction: MissionDef = {
  id: "05",
  title: "FINAL EXTRACTION",
  tagline: "The final escape",
  mode: "survival",
  layout: { kind: "extraction", durationS: 30 * 60, extractionAtS: 22 * 60, rushFactor: 1.3 },
  tuning: {
    speed: 1.05,
    zombies: { easy: { initial: 3, max: 9 }, normal: { initial: 5, max: 13 }, hard: { initial: 7, max: 17 } },
    growthUntil: 0.65,
    interceptShare: { easy: 0.3, normal: 0.5, hard: 0.65 },
    intensity: [{ atFrac: 0.45, speed: 1.05 }, { atFrac: 0.65, speed: 1.12 }],
  },
  aboutMin: 30,
  image: `${IMG}/mission-05.jpg`,
  imagePosition: "55% 34%",
  intro: [
    "Raven Two is in the air. Twenty-two minutes out.",
    "The district is being overrun. Every street has them now.",
    "One aircraft. One pickup. They will not wait.",
  ],
  objective: "Stay alive until the helicopter lands, then reach the landing zone before it has to leave.",
  hud: "Extraction",
  ending: "heli",
  success: "You are aboard. Raven Two is lifting off.",
  beats: [
    { id: "tf-m05-start", speaker: "watchtower", trigger: { on: "start" }, fallbackVoice: "keepMoving",
      text: "Runner Seven, Raven Two is airborne. Twenty-two minutes. The whole district is turning. Stay alive until they land." },
    { id: "tf-m05-packs", speaker: "watchtower", trigger: { on: "time", atFrac: 0.2 },
      text: "They are hunting in groups now. Some will cut ahead of you. Keep changing direction." },
    { id: "tf-m05-intercept", speaker: "watchtower", trigger: { on: "intercept" },
      text: "One is cutting ahead of you. Turn off before the next junction." },
    { id: "tf-m05-river", speaker: "raven", trigger: { on: "time", atFrac: 0.45 },
      text: "Watchtower, Raven Two. Crossing the river. Ten minutes. We see fires across the whole district." },
    { id: "tf-m05-overrun", speaker: "watchtower", trigger: { on: "time", atFrac: 0.65 },
      text: "The area is being overrun. They are faster when there are this many. Do not stop for anything." },
    { id: "tf-m05-contact", speaker: "watchtower", trigger: { on: "contact" },
      text: "Runner, break away! Not now, not this close!" },
    { id: "tf-m05-inbound", speaker: "raven", trigger: { on: "heli_inbound" }, fallbackVoice: "rescueInbound",
      text: "Runner Seven, Raven Two. One minute out. Stand by for the landing zone." },
    { id: "tf-m05-landed", speaker: "raven", trigger: { on: "heli_landed" }, fallbackVoice: "getToHelicopter",
      text: "Raven Two is down. Landing zone is on your map. We cannot hold this for long. Move!" },
    { id: "tf-m05-two-min", speaker: "watchtower", trigger: { on: "time", beforeEndS: 120 },
      text: "Two minutes, Runner. They will have to leave without you. Go!" },
    { id: "tf-m05-win", speaker: "raven", trigger: { on: "end", result: "survived" }, fallbackVoice: "liftingOff",
      text: "We have Runner Seven. Lifting off. Watchtower, you got one out." },
    { id: "tf-m05-late-fail", speaker: "raven", trigger: { on: "end", result: "failed" },
      text: "Raven Two is taking contact on the ground. We have to lift. Sorry, Runner." },
    { id: "tf-m05-caught", speaker: "watchtower", trigger: { on: "end", result: "infected" },
      text: "Raven Two, hold. … I have lost Runner Seven's signal." },
  ],
};

export const THE_FALL: CampaignDef = {
  id: "the-fall",
  title: "THE FALL",
  cover: `${IMG}/cover.jpg`,
  coverPosition: "40% 40%",
  description: "The outbreak, from the first sirens to the last helicopter. Five missions on foot, wherever you are.",
  speakers: [
    { id: "watchtower", name: "WATCHTOWER", elevenLabsVoiceId: "Qbw4VpyUrHEG7NigKzty", radio: "ground", voice: "Civil-defence radio operator, woman in her forties. Calm, exact, tired but in control. Procedural radio speech, no drama; urgent only in the contact lines." },
    { id: "raven", name: "RAVEN TWO", elevenLabsVoiceId: "SAxJUlDKRc79XAyeWyMu", radio: "aircraft", voice: "Military helicopter pilot, man. Clipped aviation radio, rotor noise behind the voice. Matter-of-fact, never hurried until the landing." },
  ],
  missions: [firstContact, supplyRun, noWayBack, lastSignal, finalExtraction],
  epilogue: {
    title: "THE FALL – CAMPAIGN COMPLETED",
    lines: [
      "From the air the fires reach the horizon.",
      "Watchtower's channel is still open. Other towns are calling in.",
      "One call does not belong. The evacuation force, hours after she lost them: “…NEXAGEN perimeter… do not…” Then static.",
      "You got out. Most did not. This is not over.",
    ],
  },
};
