/**
 * Spelare utanför det kartlagda nätet (cykel). Zombier är bundna till nätet och jagar den närmaste nätpunkten; en spelare som står eller går
 * utanför nätet längre än infektionsradien kan därför aldrig nås. Utan terrängdata kan zombier inte följa efter, så spelet gör tre saker:
 *   1. Klassificerar spelaren som "utanför nätet" först vid varaktig avvikelse (avstånd minus GPS-osäkerhet, tidströskel, hysteres), så GPS-brus och korta avstikare inte räknas.
 *   2. Ger en budget (90 s, återfylls 0,3 s per s på nätet, alltså ca 5 min): den som tillfälligt lämnar vägen, tittar på kartan, korsar ett fält eller har en omapad väg påverkas inte.
 *   3. När budgeten är slut är spelaren exponerad: en zombie som väntar vid den närmaste nätpunkten (≤ 25 m) räknas som i kontakt. Ingen zombie flyttas av detta; den rör sig bara på nätet.
 * Samma princip som bakgrundsläget (docs/BIKE-NETWORK-IMPROVEMENTS.md): ett skydd som är begränsat, inte permanent.
 */
export const OFF_ENTER_M = 40;
export const OFF_EXIT_M = 25;
export const OFF_ENTER_S = 8;
export const OFF_EXIT_S = 3;
/** Så mycket av GPS-osäkerheten dras av från avståndet (ett dåligt fix ska inte ensamt kunna utlösa läget). */
export const OFF_ACCURACY_CREDIT_M = 25;
/** Sämre noggrannhet än så: positionen används inte för att ändra läge (hålls). */
export const OFF_MAX_ACCURACY_M = 40;
export const OFF_BUDGET_S = 90;
export const OFF_REGEN_PER_S = 0.3;
/** En zombie som väntar så nära den närmaste nätpunkten kan smitta den exponerade spelaren. */
export const OFF_WAIT_M = 25;

export interface OffNetworkState {
  active: boolean;
  /** Sammanhängande tid (s) med avvikelse över tröskeln, innan läget slås på. */
  candidateS: number;
  /** Sammanhängande tid (s) nära nätet, innan läget slås av. */
  clearS: number;
  budgetS: number;
  /** Senast beräknade effektiva avstånd (m) från nätet. */
  offsetM: number;
}

export type OffNetworkChange = "entered" | "left" | "exposed" | null;

export const initialOffNetwork = (): OffNetworkState => ({ active: false, candidateS: 0, clearS: 0, budgetS: OFF_BUDGET_S, offsetM: 0 });

/** Avstånd från nätet efter avdrag för GPS-osäkerhet. */
export const effectiveOffsetM = (rawOffsetM: number, accuracyM: number): number => Math.max(0, rawOffsetM - Math.min(Math.max(accuracyM, 0), OFF_ACCURACY_CREDIT_M));

export const isExposed = (s: OffNetworkState): boolean => s.active && s.budgetS <= 0;

/** Ett motorsteg. `rawOffsetM` är null när avståndet inte kan beräknas (då ändras inget läge). Muterar `s`. */
export function updateOffNetwork(s: OffNetworkState, dtS: number, rawOffsetM: number | null, accuracyM: number): OffNetworkChange {
  const wasExposed = isExposed(s);
  if (rawOffsetM !== null && accuracyM <= OFF_MAX_ACCURACY_M) {
    const off = effectiveOffsetM(rawOffsetM, accuracyM);
    s.offsetM = off;
    if (!s.active) {
      s.candidateS = off >= OFF_ENTER_M ? s.candidateS + dtS : 0;
      if (s.candidateS >= OFF_ENTER_S - 1e-9) {
        s.active = true;
        s.clearS = 0;
        return "entered";
      }
    } else {
      s.clearS = off <= OFF_EXIT_M ? s.clearS + dtS : 0;
      if (s.clearS >= OFF_EXIT_S - 1e-9) {
        s.active = false;
        s.candidateS = 0;
        s.clearS = 0;
        return "left";
      }
    }
  }
  s.budgetS = s.active ? Math.max(0, s.budgetS - dtS) : Math.min(OFF_BUDGET_S, s.budgetS + OFF_REGEN_PER_S * dtS);
  return !wasExposed && isExposed(s) ? "exposed" : null;
}
