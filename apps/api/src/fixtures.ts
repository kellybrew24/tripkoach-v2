// Loads the v2 consumer SPA fixtures (apps/web/kit/data.js) as the seed source of truth.
// The fixtures are browser globals (window.TK_DATA, TK_REVIEWS, …); we evaluate them in a VM
// sandbox where `window` === the global, exactly as the browser presents them. This is the ONLY
// place the SPA fixtures are read — they are the product reference the clean-room backend serves.

import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

export interface FxTier { minPax: number; price: number }
export interface FxPackage {
  id: string; name: string; tag?: string; blurb?: string; duration?: string;
  tiers: FxTier[]; stops?: string[]; includes?: string[];
}
export interface FxDeparture { id: string; date: string; time: string; price: number; spotsLeft: number }
export interface FxTour {
  id: string; title: string; region: string; duration: string; category: string;
  price: number; currency: string; rating?: number; reviews?: number; spotsLeft?: number;
  tag?: string; image: string; blurb: string;
  highlights?: string[]; included?: string[]; excluded?: string[];
  pricing?: [string, string][]; itinerary?: [string, string][];
  packages?: FxPackage[]; defaultPackage?: string; tiers?: FxTier[]; departures?: FxDeparture[];
}
export interface FxReview {
  id: string; tourId: string; tour: string; author: string; initials: string;
  rating: number; date: string; verified: boolean; status: string;
  title: string; text: string; reply?: string;
}
export interface Fixtures {
  tours: FxTour[];
  regions: string[];
  reviews: FxReview[];
}

const WEB_DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'kit', 'data.js');

export function loadFixtures(dataFile: string = WEB_DATA): Fixtures {
  const code = readFileSync(dataFile, 'utf8');
  const sandbox: any = {};
  sandbox.window = sandbox;         // browser convention: bare globals live on window
  sandbox.console = console;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: dataFile });

  const data = sandbox.TK_DATA;
  if (!data || !Array.isArray(data.tours)) throw new Error(`fixtures: TK_DATA.tours not found in ${dataFile}`);
  return {
    tours: data.tours as FxTour[],
    regions: (data.regions as string[]) || [],
    reviews: (sandbox.TK_REVIEWS as FxReview[]) || [],
  };
}
