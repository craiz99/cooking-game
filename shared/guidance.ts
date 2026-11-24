import { INGREDIENT_BY_ID } from './animals.js';
import { RECIPE_BY_ID, STOP_BY_ID } from './stops.js';
import type { GuidanceHint, KitchenSnapshot, RecipeDef, StationState } from './types.js';

function findCrateForIngredient(stations: StationState[], ingredientId: string): StationState | undefined {
  return stations.find((s) => s.kind === 'crate' && s.ingredientId === ingredientId);
}

function findMatchingRecipeForCooked(
  stopRecipes: readonly RecipeDef[],
  ingredientId: string,
  cookStation: string,
): RecipeDef | undefined {
  return stopRecipes.find(
    (r) => r.baseIngredient === ingredientId && r.cookStation === cookStation && r.toppingIngredient,
  );
}

/**
 * Computes the single clearest, most helpful next action for a 5-year-old chef
 * with Kid Helper Mode enabled.
 */
export function computeGuidanceHint(
  snapshot: KitchenSnapshot,
  playerId: string,
): GuidanceHint | null {
  if (snapshot.status !== 'running') return null;

  const chef = snapshot.chefs.find((c) => c.playerId === playerId);
  if (!chef) return null;

  // Priority 1: Active Adult Star Ping ("Help Here!")
  if (snapshot.ping && snapshot.ping.expiresAtMs > snapshot.serverTimeMs) {
    const pingedStation = snapshot.stations.find((s) => s.id === snapshot.ping?.stationId);
    if (pingedStation) {
      return {
        targetStationId: pingedStation.id,
        orderId: snapshot.orders[0]?.id ?? null,
        message: `${snapshot.ping.fromPlayerName} says: Tap ${pingedStation.label}!`,
        stepNumber: 1,
        isParentPing: true,
        ingredientSpritePath: pingedStation.ingredientId
          ? INGREDIENT_BY_ID[pingedStation.ingredientId]?.spritePath
          : undefined,
      };
    }
  }

  const stop = STOP_BY_ID[snapshot.stopId];
  const activeOrders = snapshot.orders;
  const activeRecipeIds = new Set(activeOrders.map((o) => o.recipeId));
  const primaryOrder = activeOrders[0];
  const primaryRecipe = primaryOrder ? RECIPE_BY_ID[primaryOrder.recipeId] : stop.recipes[0];

  // Priority 2: Holding a finished plated dish -> run it straight to the Serving Window!
  if (chef.holding?.kind === 'plated') {
    const serve = snapshot.stations.find((s) => s.kind === 'serve_window');
    if (serve) {
      return {
        targetStationId: serve.id,
        orderId: activeOrders.find((o) => o.recipeId === chef.holding?.recipeId)?.id ?? primaryOrder?.id ?? null,
        message: 'Bring your dish to the Serve Window!',
        stepNumber: 3,
        isParentPing: false,
      };
    }
  }

  // Priority 3: Holding a cooked component -> place on shared counter or combine with topping on counter
  if (chef.holding?.kind === 'cooked' && chef.holding.ingredientId && chef.holding.cookStation) {
    const rec = findMatchingRecipeForCooked(
      stop.recipes,
      chef.holding.ingredientId,
      chef.holding.cookStation,
    );
    if (rec?.toppingIngredient) {
      const counterWithTopping = snapshot.stations.find(
        (s) =>
          s.kind === 'counter' &&
          s.item?.kind === 'raw' &&
          s.item.ingredientId === rec.toppingIngredient,
      );
      if (counterWithTopping) {
        return {
          targetStationId: counterWithTopping.id,
          orderId: activeOrders.find((o) => o.recipeId === rec.id)?.id ?? null,
          message: `Combine on ${counterWithTopping.label}!`,
          stepNumber: 2,
          isParentPing: false,
        };
      }
      const emptyCounter = snapshot.stations.find((s) => s.kind === 'counter' && !s.item);
      if (emptyCounter) {
        return {
          targetStationId: emptyCounter.id,
          orderId: activeOrders.find((o) => o.recipeId === rec.id)?.id ?? null,
          message: `Set it on ${emptyCounter.label} for topping!`,
          stepNumber: 2,
          isParentPing: false,
        };
      }
    }
  }

  // Priority 4: Holding a raw ingredient
  if (chef.holding?.kind === 'raw' && chef.holding.ingredientId) {
    const heldIng = chef.holding.ingredientId;

    // 4a) Is there a cooked base waiting on any station/counter that needs THIS ingredient as topping?
    for (const st of snapshot.stations) {
      if (st.item?.kind === 'cooked' && st.item.ingredientId && st.item.cookStation) {
        const rec = stop.recipes.find(
          (r) =>
            r.baseIngredient === st.item?.ingredientId &&
            r.cookStation === st.item?.cookStation &&
            r.toppingIngredient === heldIng,
        );
        if (rec) {
          return {
            targetStationId: st.id,
            orderId: activeOrders.find((o) => o.recipeId === rec.id)?.id ?? null,
            message: `Add ${INGREDIENT_BY_ID[heldIng].shortName} at ${st.label}!`,
            stepNumber: 2,
            isParentPing: false,
            ingredientSpritePath: INGREDIENT_BY_ID[heldIng].spritePath,
          };
        }
      }
    }

    // 4b) Otherwise bring raw base to its matching cooking/prep station!
    const recipeByBase =
      stop.recipes.find((r) => activeRecipeIds.has(r.id) && r.baseIngredient === heldIng) ??
      stop.recipes.find((r) => r.baseIngredient === heldIng);

    if (recipeByBase) {
      const targetCook = snapshot.stations.find((s) => s.kind === recipeByBase.cookStation);
      if (targetCook) {
        return {
          targetStationId: targetCook.id,
          orderId: activeOrders.find((o) => o.recipeId === recipeByBase.id)?.id ?? null,
          message: `Bring ${INGREDIENT_BY_ID[heldIng].shortName} to ${targetCook.label}!`,
          stepNumber: 2,
          isParentPing: false,
          ingredientSpritePath: INGREDIENT_BY_ID[heldIng].spritePath,
        };
      }
    }

    // 4c) Held item is a topping with no cooked base ready yet -> place on counter
    const emptyCounter = snapshot.stations.find((s) => s.kind === 'counter' && !s.item);
    if (emptyCounter) {
      return {
        targetStationId: emptyCounter.id,
        orderId: primaryOrder?.id ?? null,
        message: `Set ${INGREDIENT_BY_ID[heldIng].shortName} on ${emptyCounter.label}!`,
        stepNumber: 2,
        isParentPing: false,
        ingredientSpritePath: INGREDIENT_BY_ID[heldIng].spritePath,
      };
    }
  }

  // Priority 5: Empty hands
  // 5a) Any ready plated dish sitting on a counter/station? Grab it!
  const readyPlatedStation = snapshot.stations.find(
    (s) => s.item?.kind === 'plated' && (!s.item.recipeId || activeRecipeIds.has(s.item.recipeId)),
  );
  if (readyPlatedStation) {
    return {
      targetStationId: readyPlatedStation.id,
      orderId:
        activeOrders.find((o) => o.recipeId === readyPlatedStation.item?.recipeId)?.id ??
        primaryOrder?.id ??
        null,
      message: `Grab the ready dish at ${readyPlatedStation.label}!`,
      stepNumber: 3,
      isParentPing: false,
    };
  }

  // 5b) Any cooked base waiting for a topping? Guide child to grab that topping crate!
  for (const st of snapshot.stations) {
    if (st.item?.kind === 'cooked' && st.item.ingredientId && st.item.cookStation) {
      const rec = stop.recipes.find(
        (r) =>
          activeRecipeIds.has(r.id) &&
          r.baseIngredient === st.item?.ingredientId &&
          r.cookStation === st.item?.cookStation &&
          r.toppingIngredient,
      );
      if (rec?.toppingIngredient) {
        const crate = findCrateForIngredient(snapshot.stations, rec.toppingIngredient);
        if (crate) {
          const ing = INGREDIENT_BY_ID[rec.toppingIngredient];
          return {
            targetStationId: crate.id,
            orderId: activeOrders.find((o) => o.recipeId === rec.id)?.id ?? null,
            message: `Grab ${ing.shortName} to top the dish!`,
            stepNumber: 2,
            isParentPing: false,
            ingredientSpritePath: ing.spritePath,
          };
        }
      }
    }
  }

  // 5c) Start the most urgent active order -> grab its base ingredient!
  if (primaryRecipe) {
    const crate = findCrateForIngredient(snapshot.stations, primaryRecipe.baseIngredient);
    if (crate) {
      const ing = INGREDIENT_BY_ID[primaryRecipe.baseIngredient];
      return {
        targetStationId: crate.id,
        orderId: primaryOrder?.id ?? null,
        message: `Step 1: Grab ${ing.shortName}!`,
        stepNumber: 1,
        isParentPing: false,
        ingredientSpritePath: ing.spritePath,
      };
    }
  }

  return null;
}
