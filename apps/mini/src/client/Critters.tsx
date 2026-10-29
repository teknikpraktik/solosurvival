import { ENEMY_KINDS, type EnemyKind } from "../config/product";
import { ENEMY_LABEL, enemyArt } from "./enemies";

/** De fyra fiendetyperna som illustration (startsida, instruktioner, resultat). Inline-SVG: inga bildförfrågningar. */
export function Critters({ size = 64, kinds = ENEMY_KINDS, labels = false, className = "critters" }: { size?: number; kinds?: readonly EnemyKind[]; labels?: boolean; className?: string }) {
  return (
    <div className={className} aria-hidden={labels ? undefined : true}>
      {kinds.map((k, i) => (
        <figure key={k} className={`critter c${i}`}>
          <span dangerouslySetInnerHTML={{ __html: enemyArt(k, `art-${className}-${k}`, size) }} />
          {labels && <figcaption>{ENEMY_LABEL[k]}</figcaption>}
        </figure>
      ))}
    </div>
  );
}
