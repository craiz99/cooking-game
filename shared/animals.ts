import type { AnimalDef, AnimalId, IngredientDef, IngredientId } from './types.js';

export const ANIMALS: readonly AnimalDef[] = [
  {
    id: 'purple_cat',
    name: 'Purple Cat',
    shortName: 'Cat',
    accentColor: '#9333ea',
    apronColor: '#c084fc',
    behaviorName: 'Moonbeam Bat',
    behaviorDesc: 'Purrs and bats glowing golden crescent moonbeams!',
    emoteDurationMs: 2200,
    spritePath: '/assets/chefs/purple_cat.png',
    emoteSpritePath: '/assets/chefs/emote_moonbeams.png',
  },
  {
    id: 'orange_dog',
    name: 'Orange Dog',
    shortName: 'Dog',
    accentColor: '#ea580c',
    apronColor: '#38bdf8',
    behaviorName: 'Happy Treat Spin',
    behaviorDesc: 'Wags excitedly and spins to catch a star treat!',
    emoteDurationMs: 2000,
    spritePath: '/assets/chefs/orange_dog.png',
    emoteSpritePath: '/assets/chefs/emote_star_treat.png',
  },
  {
    id: 'panda',
    name: 'Panda',
    shortName: 'Panda',
    accentColor: '#16a34a',
    apronColor: '#f59e0b',
    behaviorName: 'Bamboo Munch',
    behaviorDesc: 'Happily crunches a fresh green bamboo stalk!',
    emoteDurationMs: 2300,
    spritePath: '/assets/chefs/panda.png',
    emoteSpritePath: '/assets/chefs/emote_bamboo.png',
  },
  {
    id: 'fox',
    name: 'Fox',
    shortName: 'Fox',
    accentColor: '#d97706',
    apronColor: '#fbbf24',
    behaviorName: 'Autumn Tail Twirl',
    behaviorDesc: 'Does a playful pounce swirling golden maple leaves!',
    emoteDurationMs: 2100,
    spritePath: '/assets/chefs/fox.png',
    emoteSpritePath: '/assets/chefs/emote_leaves.png',
  },
  {
    id: 'skunk',
    name: 'Skunk',
    shortName: 'Skunk',
    accentColor: '#65a30d',
    apronColor: '#a855f7',
    behaviorName: 'Silly Giggle-Fart',
    behaviorDesc: 'Giggles and lets out a hilarious bubbly cartoon fart cloud!',
    emoteDurationMs: 2400,
    spritePath: '/assets/chefs/skunk.png',
    emoteSpritePath: '/assets/chefs/emote_fart_cloud.png',
  },
  {
    id: 'purple_bat',
    name: 'Purple Bat',
    shortName: 'Bat',
    accentColor: '#7c3aed',
    apronColor: '#e879f9',
    behaviorName: 'Loop-de-Loop Squeak',
    behaviorDesc: 'Flutters tiny wings in a happy flip with twinkle squeaks!',
    emoteDurationMs: 2100,
    isSmall: true,
    hovers: true,
    spritePath: '/assets/chefs/purple_bat.png',
    emoteSpritePath: '/assets/chefs/emote_twinkle.png',
  },
] as const;

export const ANIMAL_BY_ID: Record<AnimalId, AnimalDef> = Object.fromEntries(
  ANIMALS.map((a) => [a.id, a]),
) as Record<AnimalId, AnimalDef>;

export function isValidAnimalId(value: unknown): value is AnimalId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ANIMAL_BY_ID, value);
}

export const INGREDIENTS: readonly IngredientDef[] = [
  { id: 'seaweed', name: 'Crispy Seaweed', shortName: 'Seaweed', accentColor: '#15803d', spritePath: '/assets/food/ing_seaweed.png' },
  { id: 'pasta', name: 'Golden Pasta', shortName: 'Pasta', accentColor: '#eab308', spritePath: '/assets/food/ing_pasta.png' },
  { id: 'cheetos', name: 'Cheesy Cheetos', shortName: 'Cheetos', accentColor: '#f97316', spritePath: '/assets/food/ing_cheetos.png' },
  { id: 'gummy_bears', name: 'Rainbow Gummy Bears', shortName: 'Gummy Bears', accentColor: '#ec4899', spritePath: '/assets/food/ing_gummy_bears.png' },
  { id: 'french_fries', name: 'Crispy French Fries', shortName: 'Fries', accentColor: '#f59e0b', spritePath: '/assets/food/ing_french_fries.png' },
  { id: 'fish_eyes', name: 'Silly Fish Eyes', shortName: 'Fish Eyes', accentColor: '#0284c7', spritePath: '/assets/food/ing_fish_eyes.png' },
  { id: 'cheese', name: 'Mild Cheddar', shortName: 'Cheese', accentColor: '#facc15', spritePath: '/assets/food/ing_cheese.png' },
  { id: 'bread', name: 'Warm Bakery Bread', shortName: 'Bread', accentColor: '#b45309', spritePath: '/assets/food/ing_bread.png' },
  { id: 'rice', name: 'Fluffy Rice', shortName: 'Rice', accentColor: '#64748b', spritePath: '/assets/food/ing_rice.png' },
  { id: 'fish', name: 'Mild Lake Trout', shortName: 'Fish', accentColor: '#0d9488', spritePath: '/assets/food/ing_fish.png' },
  { id: 'sweet_corn', name: 'Sweet Butter Corn', shortName: 'Corn', accentColor: '#ca8a04', spritePath: '/assets/food/ing_sweet_corn.png' },
  { id: 'soup', name: 'Creamy Mild Chowder', shortName: 'Chowder', accentColor: '#d97706', spritePath: '/assets/food/ing_soup.png' },
  { id: 'ice_cream', name: 'Vanilla Swirl', shortName: 'Ice Cream', accentColor: '#38bdf8', spritePath: '/assets/food/ing_ice_cream.png' },
  { id: 'chocolate', name: 'Campfire S’mores', shortName: 'S’mores', accentColor: '#78350f', spritePath: '/assets/food/ing_chocolate.png' },
] as const;

export const INGREDIENT_BY_ID: Record<IngredientId, IngredientDef> = Object.fromEntries(
  INGREDIENTS.map((i) => [i.id, i]),
) as Record<IngredientId, IngredientDef>;
