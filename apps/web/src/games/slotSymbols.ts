import { SLOT_SYMBOLS, type SlotSymbol } from "@hashroll/fair";

/**
 * Original symbol art as SVG markup on a 64x64 box. Single source for the PixiJS reels
 * (`GraphicsContext.svg`) and the React icons, so it sticks to solid fills and simple shapes.
 */
const ART: Record<SlotSymbol, { color: number; svg: string }> = {
  wild: {
    color: 0x2cf0a4,
    svg: `<rect x="6" y="6" width="52" height="52" rx="14" fill="#0b7a53"/><rect x="9" y="8" width="46" height="46" rx="12" fill="#2cf0a4"/><polygon points="24,15 30,15 25,48 19,48" fill="#06281c"/><polygon points="39,15 45,15 40,48 34,48" fill="#06281c"/><rect x="15" y="22" width="35" height="6" fill="#06281c"/><rect x="14" y="35" width="35" height="6" fill="#06281c"/>`,
  },
  seven: {
    color: 0xff3d7f,
    svg: `<polygon points="10,10 54,10 54,22 34,58 18,58 36,24 22,24 22,30 10,30" fill="#8f0f3d"/><polygon points="10,7 54,7 54,19 34,55 18,55 36,21 22,21 22,27 10,27" fill="#ff3d7f"/><polygon points="13,10 51,10 51,13 13,13" fill="#ff9dbf"/>`,
  },
  gem: {
    color: 0x4cc9ff,
    svg: `<polygon points="18,10 46,10 60,26 32,58 4,26" fill="#1a7fd1"/><polygon points="18,10 46,10 42,26 22,26" fill="#b5ecff"/><polygon points="18,10 22,26 4,26" fill="#7fdcff"/><polygon points="46,10 60,26 42,26" fill="#4cc9ff"/><polygon points="22,26 42,26 32,58" fill="#4cc9ff"/><polygon points="4,26 22,26 32,58" fill="#2aa4ee"/>`,
  },
  bell: {
    color: 0xffc83d,
    svg: `<circle cx="32" cy="53" r="6" fill="#b06f00"/><path d="M32 8 C20 8 16 18 16 30 C16 40 12 42 9 48 L55 48 C52 42 48 40 48 30 C48 18 44 8 32 8 Z" fill="#ffc83d"/><path d="M26 14 C21 18 20 26 20 36 L25 36 C25 26 25 20 29 13 Z" fill="#fff0b8"/><rect x="8" y="45" width="48" height="6" rx="3" fill="#e09a0a"/><circle cx="32" cy="8" r="4" fill="#e09a0a"/>`,
  },
  clover: {
    color: 0x7be04a,
    svg: `<path d="M31 32 C33 44 36 50 43 58 L38 60 C31 52 29 44 28 34 Z" fill="#2f7d1b"/><circle cx="22" cy="18" r="11" fill="#58c22d"/><circle cx="42" cy="18" r="11" fill="#7be04a"/><circle cx="22" cy="36" r="11" fill="#7be04a"/><circle cx="42" cy="36" r="11" fill="#58c22d"/><circle cx="32" cy="27" r="8" fill="#a5f07c"/>`,
  },
  cherry: {
    color: 0xff5a3c,
    svg: `<path d="M22 40 C24 26 32 14 46 8 L48 11 C36 18 28 28 25 41 Z" fill="#3b8a22"/><path d="M44 42 C44 28 44 18 45 9 L49 9 C48 20 48 30 48 42 Z" fill="#3b8a22"/><ellipse cx="34" cy="12" rx="9" ry="5" fill="#7be04a"/><circle cx="20" cy="46" r="12" fill="#e0242f"/><circle cx="46" cy="46" r="12" fill="#e0242f"/><circle cx="16" cy="42" r="3.5" fill="#ff9d96"/><circle cx="42" cy="42" r="3.5" fill="#ff9d96"/>`,
  },
  lemon: {
    color: 0xffe14d,
    svg: `<ellipse cx="32" cy="34" rx="24" ry="17" fill="#d9a800"/><ellipse cx="32" cy="32" rx="24" ry="17" fill="#ffe14d"/><polygon points="54,26 62,32 54,38" fill="#ffe14d"/><polygon points="10,26 2,32 10,38" fill="#ffe14d"/><ellipse cx="24" cy="25" rx="9" ry="4" fill="#fff7c4"/>`,
  },
};

export const slotColor = (symbol: number) => ART[SLOT_SYMBOLS[symbol]].color;
export const slotSvg = (symbol: number) => ART[SLOT_SYMBOLS[symbol]].svg;
