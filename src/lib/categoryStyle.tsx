import {
  Apple,
  Beef,
  CakeSlice,
  Candy,
  Carrot,
  ChefHat,
  Droplet,
  Egg,
  Fish,
  Flame,
  Leaf,
  Milk,
  Nut,
  Package,
  Pill,
  Sandwich,
  Shell,
  Soup,
  Sprout,
  Utensils,
  Wheat,
  type LucideIcon,
} from "lucide-react";

/**
 * Icon + colour per ingredient category. Gives the picker a visual rhythm so
 * staff can scan by shape and colour instead of reading every row.
 */
const STYLES: Record<string, { icon: LucideIcon; tone: string }> = {
  flour: { icon: Wheat, tone: "text-amber-700 bg-amber-100" },
  grain: { icon: Wheat, tone: "text-amber-700 bg-amber-100" },
  bread: { icon: Sandwich, tone: "text-amber-800 bg-amber-100" },
  fruit: { icon: Apple, tone: "text-rose-700 bg-rose-100" },
  vegetable: { icon: Carrot, tone: "text-emerald-700 bg-emerald-100" },
  herb: { icon: Leaf, tone: "text-emerald-800 bg-emerald-100" },
  seeds: { icon: Sprout, tone: "text-lime-800 bg-lime-100" },
  nuts: { icon: Nut, tone: "text-amber-800 bg-amber-100" },
  meat: { icon: Beef, tone: "text-red-800 bg-red-100" },
  fish: { icon: Fish, tone: "text-sky-800 bg-sky-100" },
  seafood: { icon: Shell, tone: "text-sky-800 bg-sky-100" },
  egg: { icon: Egg, tone: "text-yellow-800 bg-yellow-100" },
  dairy: { icon: Milk, tone: "text-blue-800 bg-blue-100" },
  oil: { icon: Droplet, tone: "text-yellow-700 bg-yellow-100" },
  sauce: { icon: Droplet, tone: "text-orange-800 bg-orange-100" },
  house_sauce: { icon: ChefHat, tone: "text-orange-900 bg-orange-100" },
  spice: { icon: Flame, tone: "text-orange-700 bg-orange-100" },
  house_spice: { icon: Flame, tone: "text-orange-900 bg-orange-100" },
  house_recipe: { icon: ChefHat, tone: "text-tomato-dark bg-tomato-soft/30" },
  prepared_food: { icon: Soup, tone: "text-stone-700 bg-stone-200" },
  dessert: { icon: CakeSlice, tone: "text-pink-700 bg-pink-100" },
  sweetener: { icon: Candy, tone: "text-pink-700 bg-pink-100" },
  pantry: { icon: Package, tone: "text-stone-700 bg-stone-200" },
  supplement: { icon: Pill, tone: "text-violet-700 bg-violet-100" },
};

const FALLBACK = { icon: Utensils, tone: "text-stone-700 bg-stone-200" };

export function categoryStyle(category: string) {
  return STYLES[category] ?? FALLBACK;
}
