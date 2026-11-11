/**
 * Catalog of every object a prop player can disguise as. Sizes are in metres (w = x, h = y, d = z)
 * and match the scanned models in client/public/art/models (see tools/asset-list.mjs).
 */
export interface PropDef {
  id: string;
  name: string;
  w: number;
  h: number;
  d: number;
  /** Roughly radially symmetric: any yaw looks natural and collision ignores rotation. */
  round?: boolean;
}

export const PROPS: PropDef[] = [
  { id: 'duck', name: 'Rubber Duck', w: 0.38, h: 0.51, d: 0.54 },
  { id: 'barrel', name: 'Oil Barrel', w: 0.56, h: 0.88, d: 0.56, round: true },
  { id: 'winebarrel', name: 'Wine Barrel', w: 0.74, h: 0.87, d: 0.76, round: true },
  { id: 'crate', name: 'Wooden Crate', w: 0.48, h: 0.42, d: 1.05 },
  { id: 'box', name: 'Cardboard Box', w: 0.46, h: 0.41, d: 0.62 },
  { id: 'stool', name: 'Stool', w: 0.42, h: 0.64, d: 0.45 },
  { id: 'chair', name: 'Wooden Chair', w: 0.43, h: 0.96, d: 0.54 },
  { id: 'schoolchair', name: 'School Chair', w: 0.54, h: 0.96, d: 0.64 },
  { id: 'monobloc', name: 'Plastic Chair', w: 0.64, h: 0.88, d: 0.63 },
  { id: 'armchair', name: 'Armchair', w: 0.85, h: 1.06, d: 0.77 },
  { id: 'ottoman', name: 'Ottoman', w: 0.8, h: 0.56, d: 0.56 },
  { id: 'pillows', name: 'Cushions', w: 0.85, h: 0.41, d: 0.41 },
  { id: 'plant', name: 'Potted Plant', w: 0.7, h: 0.84, d: 0.66, round: true },
  { id: 'tallplant', name: 'Rubber Plant', w: 0.65, h: 1.47, d: 0.7, round: true },
  { id: 'vase', name: 'Vase', w: 0.38, h: 0.76, d: 0.38, round: true },
  { id: 'urn', name: 'Slim Vase', w: 0.25, h: 0.91, d: 0.25, round: true },
  { id: 'brassvase', name: 'Brass Vase', w: 0.3, h: 0.9, d: 0.3, round: true },
  { id: 'pot', name: 'Brass Pot', w: 0.48, h: 0.47, d: 0.48, round: true },
  { id: 'tv', name: 'Old Television', w: 0.66, h: 0.5, d: 0.52 },
  { id: 'boombox', name: 'Boombox', w: 0.72, h: 0.47, d: 0.19 },
  { id: 'register', name: 'Cash Register', w: 0.54, h: 0.56, d: 0.56 },
  { id: 'sign', name: 'Wet Floor Sign', w: 0.38, h: 0.79, d: 0.45 },
  { id: 'bust', name: 'Marble Bust', w: 0.46, h: 0.88, d: 0.51 },
  { id: 'extinguisher', name: 'Fire Extinguisher', w: 0.31, h: 0.72, d: 0.4 },
  { id: 'jerrycan', name: 'Jerrycan', w: 0.42, h: 0.55, d: 0.21 },
  { id: 'chest', name: 'Treasure Chest', w: 0.86, h: 0.55, d: 0.47 },
  { id: 'basket', name: 'Wicker Basket', w: 0.69, h: 0.21, d: 0.53 },
  { id: 'bucket', name: 'Wooden Bucket', w: 0.4, h: 0.61, d: 0.38, round: true },
  { id: 'football', name: 'Football', w: 0.49, h: 0.48, d: 0.48, round: true },
  { id: 'propane', name: 'Gas Bottle', w: 0.4, h: 0.66, d: 0.4, round: true },
  { id: 'trashbag', name: 'Bin Bag', w: 0.53, h: 0.57, d: 0.46, round: true },
  { id: 'clock', name: 'Grandfather Clock', w: 0.53, h: 1.86, d: 0.36 },
  { id: 'toolchest', name: 'Tool Chest', w: 0.69, h: 0.65, d: 0.41 },
  { id: 'nightstand', name: 'Nightstand', w: 0.6, h: 0.73, d: 0.45 },
  { id: 'sidetable', name: 'Side Table', w: 0.61, h: 0.61, d: 0.5 },
  { id: 'gnome', name: 'Garden Gnome', w: 0.35, h: 0.81, d: 0.28, round: true },
  { id: 'horse', name: 'Horse Statue', w: 0.65, h: 0.88, d: 0.43 },
  { id: 'cat', name: 'Cat Statue', w: 0.32, h: 0.59, d: 0.53 },
  { id: 'handtruck', name: 'Hand Truck', w: 0.53, h: 1.26, d: 0.62 },
  { id: 'chalkboard', name: 'Chalkboard', w: 0.78, h: 1.28, d: 0.65 },
  { id: 'tyre', name: 'Old Tyre', w: 0.72, h: 0.25, d: 0.72, round: true },
  { id: 'cement', name: 'Cement Bag', w: 0.51, h: 0.2, d: 0.77 },
  { id: 'plasticcrate', name: 'Plastic Crate', w: 0.66, h: 0.33, d: 0.53 },
  { id: 'cabinet', name: 'Cabinet', w: 1.08, h: 1.06, d: 0.56 },
  { id: 'alarmclock', name: 'Giant Alarm Clock', w: 0.46, h: 0.61, d: 0.23 },
  { id: 'megaphone', name: 'Megaphone', w: 0.59, h: 0.48, d: 0.36 },
  { id: 'oillamp', name: 'Oil Lamp', w: 0.29, h: 1.04, d: 0.29, round: true },
  { id: 'croissant', name: 'Giant Croissant', w: 0.64, h: 0.2, d: 0.24 },
  // ---- outdoors (Sunny Meadow)
  { id: 'rock', name: 'Boulder', w: 0.61, h: 0.58, d: 1.09 },
  { id: 'stone', name: 'Rock', w: 0.82, h: 0.32, d: 0.45 },
  { id: 'stump', name: 'Tree Stump', w: 0.86, h: 0.34, d: 0.95, round: true },
  { id: 'log', name: 'Log', w: 1.37, h: 0.43, d: 0.41 },
  { id: 'fern', name: 'Fern', w: 0.91, h: 0.47, d: 0.79, round: true },
  { id: 'planter', name: 'Planter Box', w: 1, h: 0.47, d: 0.46 },
  { id: 'claypot', name: 'Clay Pot', w: 0.53, h: 0.44, d: 0.53, round: true },
  { id: 'bench', name: 'Bench', w: 1.28, h: 0.98, d: 0.55 },
  { id: 'lantern', name: 'Lantern', w: 0.29, h: 0.69, d: 0.3, round: true },
  { id: 'watercan', name: 'Watering Can', w: 0.29, h: 0.3, d: 0.68 },
  { id: 'tub', name: 'Wooden Tub', w: 0.61, h: 0.35, d: 0.61, round: true },
  { id: 'oildrum', name: 'Steel Drum', w: 0.49, h: 0.88, d: 0.48, round: true },
  { id: 'hydrant', name: 'Fire Hydrant', w: 0.79, h: 0.72, d: 0.29 },
  { id: 'compost', name: 'Compost Bag', w: 0.59, h: 0.48, d: 0.52 },
  { id: 'lifebuoy', name: 'Lifebuoy', w: 0.78, h: 0.25, d: 0.84, round: true },
  { id: 'cooler', name: 'Storage Tub', w: 0.72, h: 0.34, d: 0.5 },
  { id: 'hamper', name: 'Picnic Basket', w: 0.69, h: 0.4, d: 0.51 },
  { id: 'boots', name: 'Wellies', w: 0.89, h: 0.37, d: 0.27 },
];

export const PROP_INDEX: Record<string, number> = {};
PROPS.forEach((p, i) => (PROP_INDEX[p.id] = i));

/** Disguises handed out at spawn so nobody starts as something huge. */
export const STARTER_PROPS = ['duck', 'pot', 'football', 'jerrycan', 'bucket', 'vase', 'box', 'stool'].map((id) => PROP_INDEX[id]);

export const MEADOW_STARTERS = ['stone', 'claypot', 'tub', 'lantern', 'bucket', 'gnome', 'football', 'hamper'].map((id) => PROP_INDEX[id]);

/** Collision body used while wearing a disguise. Width is clamped so big props stay manoeuvrable. */
export function propBody(def: PropDef): { hw: number; h: number } {
  const hw = Math.min(0.5, Math.max(0.18, Math.min(def.w, def.d) / 2));
  return { hw, h: Math.min(def.h, 1.9) };
}

/** Half extents on the ground plane of a prop rotated by yaw. */
export function footprint(def: PropDef, yaw: number): [number, number] {
  if (def.round) return [def.w / 2, def.d / 2];
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  return [(c * def.w + s * def.d) / 2, (s * def.w + c * def.d) / 2];
}
