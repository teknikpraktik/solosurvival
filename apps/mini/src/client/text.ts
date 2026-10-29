import type { GameMode } from "@/engine/objectives/objectives";
import type { Difficulty } from "@/config/difficulty";

/** Mini Outbreaks texter (engelska). Lägesnamnen är desamma som i OUTBREAK så att båda apparna beskriver samma lägen likadant. */
export const MODE_LABEL: Record<GameMode, string> = { mission: "CHECKPOINTS", escape: "A TO B", survival: "SURVIVAL" };
export const MODE_HELP: Record<GameMode, string> = {
  mission: "Find the numbered checkpoints in order, then walk back home.",
  escape: "Pick a goal B on the map and walk there before the time runs out.",
  survival: "Stay away from the critters until the helicopter comes, then walk to it.",
};
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };
export const RESULT_LABEL: Record<string, string> = {
  survived: "You made it!", infected: "Caught", failed: "Out of time", aborted: "Stopped", incomplete: "Not finished", active: "In progress", interrupted: "Stopped (could not continue)",
};

/** Short safety text (HOW TO PLAY). Never claims that the game makes anything safe. */
export const SAFETY_POINTS = [
  "Play only in an area that a grown-up has said is OK.",
  "Watch out for cars, bikes and other people. Look up, not at the phone, when you move.",
  "Never run out onto a road. Stop and look before you cross, even if the game says go.",
  "Stay away from water, building sites and places you do not know.",
  "You can pause or stop at any time. Stopping is always OK.",
];
export const SAFETY_NOTE = "The map and GPS cannot tell what is safe. They can be wrong about roads, paths and where you are.";
