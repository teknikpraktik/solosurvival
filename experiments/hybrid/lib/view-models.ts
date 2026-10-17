import type { ModelSpec } from "./experiment";
import { model, A } from "./presets";

/** Modeller som förbakas för visualiseringen. */
export const VIEW_MODELS: ModelSpec[] = [A, model("B1-25", 0.25, 100), model("B2-25", 0.25, 150), model("B3-25", 0.25, 400), model("B2-50", 0.5, 150), model("B2-50-nms", 0.5, 150, "verified", 40), model("B2-25-perm", 0.25, 150, "permissive")];
