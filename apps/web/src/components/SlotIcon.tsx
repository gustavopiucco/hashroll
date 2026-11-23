import { SLOT_SYMBOLS } from "@hashroll/fair";
import { slotSvg } from "@/games/slotSymbols";

/** One slot symbol; `symbol` is an index into SLOT_SYMBOLS. The markup is a static constant. */
export function SlotIcon({ symbol, className = "h-8 w-8" }: { symbol: number; className?: string }) {
  return <svg viewBox="0 0 64 64" role="img" aria-label={SLOT_SYMBOLS[symbol]} className={className} dangerouslySetInnerHTML={{ __html: slotSvg(symbol) }} />;
}
