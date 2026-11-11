/** Catalog of every object a prop player can disguise as. Sizes are in metres (w = x, h = y, d = z). */
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
  { id: 'duck', name: 'Rubber Duck', w: 0.5, h: 0.5, d: 0.6 },
  { id: 'ball', name: 'Beach Ball', w: 0.6, h: 0.6, d: 0.6, round: true },
  { id: 'blockA', name: 'Letter Block', w: 0.6, h: 0.6, d: 0.6 },
  { id: 'blockB', name: 'Number Block', w: 0.6, h: 0.6, d: 0.6 },
  { id: 'blockC', name: 'Jumbo Block', w: 0.9, h: 0.9, d: 0.9 },
  { id: 'teddy', name: 'Teddy Bear', w: 0.8, h: 1.0, d: 0.6 },
  { id: 'bigteddy', name: 'Giant Teddy', w: 1.5, h: 1.9, d: 1.2 },
  { id: 'robot', name: 'Toy Robot', w: 0.6, h: 1.0, d: 0.45 },
  { id: 'rocket', name: 'Rocket', w: 0.7, h: 1.6, d: 0.7, round: true },
  { id: 'car', name: 'Toy Car', w: 0.55, h: 0.45, d: 1.05 },
  { id: 'drum', name: 'Drum', w: 0.6, h: 0.5, d: 0.6, round: true },
  { id: 'cone', name: 'Traffic Cone', w: 0.45, h: 0.65, d: 0.45, round: true },
  { id: 'boxS', name: 'Cardboard Box', w: 0.6, h: 0.5, d: 0.6 },
  { id: 'boxL', name: 'Big Box', w: 1.0, h: 0.9, d: 1.0 },
  { id: 'crate', name: 'Wooden Crate', w: 0.9, h: 0.9, d: 0.9 },
  { id: 'gumball', name: 'Gumball Machine', w: 0.5, h: 1.3, d: 0.5, round: true },
  { id: 'arcade', name: 'Arcade Cabinet', w: 0.8, h: 1.8, d: 0.9 },
  { id: 'beanbag', name: 'Bean Bag', w: 1.0, h: 0.6, d: 1.0, round: true },
  { id: 'plant', name: 'Potted Plant', w: 0.6, h: 1.3, d: 0.6, round: true },
  { id: 'stool', name: 'Stool', w: 0.45, h: 0.6, d: 0.45, round: true },
  { id: 'basket', name: 'Shopping Basket', w: 0.55, h: 0.35, d: 0.4 },
  { id: 'register', name: 'Cash Register', w: 0.5, h: 0.45, d: 0.5 },
  { id: 'rings', name: 'Stacking Rings', w: 0.5, h: 0.6, d: 0.5, round: true },
  { id: 'train', name: 'Toy Train', w: 0.5, h: 0.55, d: 1.05 },
  { id: 'dino', name: 'Dino', w: 0.5, h: 0.9, d: 1.1 },
  { id: 'ufo', name: 'Toy UFO', w: 0.6, h: 0.4, d: 0.6, round: true },
  { id: 'bin', name: 'Trash Bin', w: 0.5, h: 0.75, d: 0.5, round: true },
  { id: 'sign', name: 'Wet Floor Sign', w: 0.5, h: 0.8, d: 0.4 },
  { id: 'barrel', name: 'Barrel', w: 0.65, h: 0.85, d: 0.65, round: true },
  { id: 'horse', name: 'Rocking Horse', w: 0.5, h: 1.0, d: 1.2 },
  { id: 'lamp', name: 'Floor Lamp', w: 0.45, h: 1.7, d: 0.45, round: true },
  { id: 'gift', name: 'Gift Box', w: 0.55, h: 0.55, d: 0.55 },
  // ---- outdoor toys and clutter (Sunny Meadow)
  { id: 'bush', name: 'Bush', w: 1.0, h: 0.8, d: 1.0, round: true },
  { id: 'rock', name: 'Rock', w: 0.9, h: 0.55, d: 0.8, round: true },
  { id: 'log', name: 'Log', w: 0.5, h: 0.5, d: 1.3 },
  { id: 'stump', name: 'Tree Stump', w: 0.65, h: 0.5, d: 0.65, round: true },
  { id: 'hay', name: 'Hay Bale', w: 1.1, h: 0.75, d: 0.75 },
  { id: 'pumpkin', name: 'Pumpkin', w: 0.6, h: 0.5, d: 0.6, round: true },
  { id: 'mushroom', name: 'Toadstool', w: 0.6, h: 0.7, d: 0.6, round: true },
  { id: 'hamper', name: 'Picnic Hamper', w: 0.6, h: 0.4, d: 0.45 },
  { id: 'cooler', name: 'Cooler', w: 0.65, h: 0.45, d: 0.45 },
  { id: 'tent', name: 'Tent', w: 1.7, h: 1.3, d: 2.0 },
  { id: 'scarecrow', name: 'Scarecrow', w: 0.9, h: 1.8, d: 0.4 },
  { id: 'lantern', name: 'Camp Lantern', w: 0.3, h: 0.45, d: 0.3, round: true },
  { id: 'wheelbarrow', name: 'Wheelbarrow', w: 0.65, h: 0.6, d: 1.3 },
  { id: 'signpost', name: 'Signpost', w: 0.8, h: 1.3, d: 0.2 },
  { id: 'gnome', name: 'Garden Gnome', w: 0.4, h: 0.75, d: 0.4, round: true },
  { id: 'watercan', name: 'Watering Can', w: 0.55, h: 0.4, d: 0.3 },
  { id: 'bench', name: 'Park Bench', w: 1.5, h: 0.85, d: 0.55 },
];

export const PROP_INDEX: Record<string, number> = {};
PROPS.forEach((p, i) => (PROP_INDEX[p.id] = i));

/** Disguises handed out at spawn so nobody starts as an obvious giant. */
export const STARTER_PROPS = ['duck', 'ball', 'blockA', 'boxS', 'cone', 'gift', 'drum', 'rings'].map((id) => PROP_INDEX[id]);

export const MEADOW_STARTERS = ['rock', 'pumpkin', 'stump', 'mushroom', 'lantern', 'hamper', 'gnome', 'bush'].map((id) => PROP_INDEX[id]);

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
