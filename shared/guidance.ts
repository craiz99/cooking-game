import { INGREDIENT_BY_ID } from './animals.js';
import { RECIPE_BY_ID, STOP_BY_ID } from './stops.js';
import type { GuidanceHint, KitchenSnapshot, RecipeDef, StationState } from './types.js';

function findCrateForIngredient(stations: StationState[], ingredientId: string): StationState | undefined {
  return stations.find((s) => s.kind === 'crate' && s.ingredientId === ingredientId);
}

function findToppingSource(stations: StationState[], ingredientId: string): StationState | undefined {
  return (
    stations.find(
      (s) => s.kind === 'counter' && s.item?.kind === 'raw' && s.item.ingredientId === ingredientId,
    ) ?? findCrateForIngredient(stations, ingredientId)
  );
}

function findMatchingRecipeForCooked(
  stopRecipes: readonly RecipeDef[],
  activeRecipeIds: Set<string>,
  ingredientId: string,
  cookStation: string,
): RecipeDef | undefined {
  return (
    stopRecipes.find(
      (r) =>
        activeRecipeIds.has(r.id) &&
        r.baseIngredient === ingredientId &&
        r.cookStation === cookStation &&
        r.toppingIngredient,
    ) ??
    stopRecipes.find(
      (r) => r.baseIngredient === ingredientId && r.cookStation === cookStation && r.toppingIngredient,
    )
  );
}

function findRecipeForActivelyCooking(
  stopRecipes: readonly RecipeDef[],
  activeRecipeIds: Set<string>,
  st: StationState,
): RecipeDef | undefined {
  if (!st.cookingActive || st.item?.kind !== 'raw' || !st.item.ingredientId) return undefined;
  const ingId = st.item.ingredientId;
  return (
    stopRecipes.find(
      (r) => activeRecipeIds.has(r.id) && r.baseIngredient === ingId && r.cookStation === st.kind,
    ) ?? stopRecipes.find((r) => r.baseIngredient === ingId && r.cookStation === st.kind)
  );
}

/**
 * Computes the single clearest, strictly sequential next action for a young chef
 * with Kid Helper Mode enabled. Always follows an in-progress recipe through its
 * exact steps (base -> cook -> topping -> combine -> serve) and never tells the
 * child to re-grab the first ingredient while it is already cooking!
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
        message: `${snapshot.ping.fromPlayerName}: Tap ${pingedStation.label}!`,
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
      const platedRec = chef.holding.recipeId ? RECIPE_BY_ID[chef.holding.recipeId] : undefined;
      return {
        targetStationId: serve.id,
        orderId: activeOrders.find((o) => o.recipeId === chef.holding?.recipeId)?.id ?? primaryOrder?.id ?? null,
        message: 'Serve Dish!',
        stepNumber: 3,
        isParentPing: false,
        ingredientSpritePath: platedRec?.spritePath,
      };
    }
  }

  // Priority 3: Holding a cooked component -> combine with topping on counter or place on empty counter
  if (chef.holding?.kind === 'cooked' && chef.holding.ingredientId && chef.holding.cookStation) {
    const rec = findMatchingRecipeForCooked(
      stop.recipes,
      activeRecipeIds,
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
          message: 'Mix Dish!',
          stepNumber: 2,
          isParentPing: false,
          ingredientSpritePath: rec.spritePath,
        };
      }
      const emptyCounter = snapshot.stations.find((s) => s.kind === 'counter' && !s.item);
      if (emptyCounter) {
        return {
          targetStationId: emptyCounter.id,
          orderId: activeOrders.find((o) => o.recipeId === rec.id)?.id ?? null,
          message: 'Set on Counter!',
          stepNumber: 2,
          isParentPing: false,
          ingredientSpritePath: INGREDIENT_BY_ID[chef.holding.ingredientId]?.spritePath,
        };
      }
    }
  }

  // Priority 4: Holding a raw ingredient
  if (chef.holding?.kind === 'raw' && chef.holding.ingredientId) {
    const heldIng = chef.holding.ingredientId;
    const ingInfo = INGREDIENT_BY_ID[heldIng];

    // 4a) Is there a finished cooked base waiting on any station/counter that needs THIS topping?
    for (const st of snapshot.stations) {
      if (!st.cookingActive && st.item?.kind === 'cooked' && st.item.ingredientId && st.item.cookStation) {
        const rec =
          stop.recipes.find(
            (r) =>
              activeRecipeIds.has(r.id) &&
              r.baseIngredient === st.item?.ingredientId &&
              r.cookStation === st.item?.cookStation &&
              r.toppingIngredient === heldIng,
          ) ??
          stop.recipes.find(
            (r) =>
              r.baseIngredient === st.item?.ingredientId &&
              r.cookStation === st.item?.cookStation &&
              r.toppingIngredient === heldIng,
          );
        if (rec) {
          return {
            targetStationId: st.id,
            orderId: activeOrders.find((o) => o.recipeId === rec.id)?.id ?? null,
            message: `Add ${ingInfo.shortName}!`,
            stepNumber: 2,
            isParentPing: false,
            ingredientSpritePath: ingInfo.spritePath,
          };
        }
      }
    }

    // 4b) Is there a matching base ACTIVELY cooking right now that will need THIS topping next?
    for (const st of snapshot.stations) {
      const rec = findRecipeForActivelyCooking(stop.recipes, activeRecipeIds, st);
      if (rec?.toppingIngredient === heldIng) {
        return {
          targetStationId: st.id,
          orderId: activeOrders.find((o) => o.recipeId === rec.id)?.id ?? null,
          message: `Add ${ingInfo.shortName}!`,
          stepNumber: 2,
          isParentPing: false,
          ingredientSpritePath: ingInfo.spritePath,
        };
      }
    }

    // 4c) Bring raw base to its matching EMPTY cooking/prep station!
    const recipeByBase =
      stop.recipes.find((r) => activeRecipeIds.has(r.id) && r.baseIngredient === heldIng) ??
      stop.recipes.find((r) => r.baseIngredient === heldIng);

    if (recipeByBase) {
      const emptyCook = snapshot.stations.find((s) => s.kind === recipeByBase.cookStation && !s.item);
      if (emptyCook) {
        return {
          targetStationId: emptyCook.id,
          orderId: activeOrders.find((o) => o.recipeId === recipeByBase.id)?.id ?? null,
          message: `Cook ${ingInfo.shortName}!`,
          stepNumber: 2,
          isParentPing: false,
          ingredientSpritePath: ingInfo.spritePath,
        };
      }
    }

    // 4d) Station busy or topping without a base yet -> place neatly on an empty Pass Counter
    const emptyCounter = snapshot.stations.find((s) => s.kind === 'counter' && !s.item);
    if (emptyCounter) {
      return {
        targetStationId: emptyCounter.id,
        orderId: primaryOrder?.id ?? null,
        message: 'Set on Counter!',
        stepNumber: 2,
        isParentPing: false,
        ingredientSpritePath: ingInfo.spritePath,
      };
    }
  }

  // Priority 5: Empty hands — ALWAYS finish an in-progress dish before starting a new one!

  // 5a) Any ready plated dish sitting on a counter/station? Grab it!
  const readyPlatedStation = snapshot.stations.find(
    (s) => !s.cookingActive && s.item?.kind === 'plated' && (!s.item.recipeId || activeRecipeIds.has(s.item.recipeId)),
  );
  if (readyPlatedStation) {
    const platedRec = readyPlatedStation.item?.recipeId
      ? RECIPE_BY_ID[readyPlatedStation.item.recipeId]
      : undefined;
    return {
      targetStationId: readyPlatedStation.id,
      orderId:
        activeOrders.find((o) => o.recipeId === readyPlatedStation.item?.recipeId)?.id ??
        primaryOrder?.id ??
        null,
      message: 'Grab Dish!',
      stepNumber: 3,
      isParentPing: false,
      ingredientSpritePath: platedRec?.spritePath,
    };
  }

  // 5b) Any finished cooked base waiting for a topping? Guide child to grab that topping!
  for (const st of snapshot.stations) {
    if (!st.cookingActive && st.item?.kind === 'cooked' && st.item.ingredientId && st.item.cookStation) {
      const rec = findMatchingRecipeForCooked(
        stop.recipes,
        activeRecipeIds,
        st.item.ingredientId,
        st.item.cookStation,
      );
      if (rec?.toppingIngredient) {
        const source = findToppingSource(snapshot.stations, rec.toppingIngredient);
        if (source) {
          const ing = INGREDIENT_BY_ID[rec.toppingIngredient];
          return {
            targetStationId: source.id,
            orderId: activeOrders.find((o) => o.recipeId === rec.id)?.id ?? null,
            message: `Grab ${ing.shortName}!`,
            stepNumber: 2,
            isParentPing: false,
            ingredientSpritePath: ing.spritePath,
          };
        }
      }
    }
  }

  // 5c) Any base ACTIVELY cooking/prepping right now? Follow ITS sequence instead of repeating Step 1!
  const cookingStations = snapshot.stations
    .map((st) => ({ st, rec: findRecipeForActivelyCooking(stop.recipes, activeRecipeIds, st) }))
    .filter((entry): entry is { st: StationState; rec: RecipeDef } => Boolean(entry.rec))
    .sort((a, b) => Number(activeRecipeIds.has(b.rec.id)) - Number(activeRecipeIds.has(a.rec.id)));

  const activeCooking = cookingStations[0];
  if (activeCooking) {
    const { st, rec } = activeCooking;
    const orderId = activeOrders.find((o) => o.recipeId === rec.id)?.id ?? primaryOrder?.id ?? null;

    // 2-step dish: base is already sizzling, so Step 2 is grabbing its matching topping!
    if (rec.toppingIngredient) {
      const source = findToppingSource(snapshot.stations, rec.toppingIngredient);
      if (source) {
        const ing = INGREDIENT_BY_ID[rec.toppingIngredient];
        return {
          targetStationId: source.id,
          orderId,
          message: `Grab ${ing.shortName}!`,
          stepNumber: 2,
          isParentPing: false,
          ingredientSpritePath: ing.spritePath,
        };
      }
    }

    // 1-step dish (no topping, e.g. Seaweed Pack / Gummy Bear Sundae): wait at the station until done!
    return {
      targetStationId: st.id,
      orderId,
      message: 'Almost Done!',
      stepNumber: 2,
      isParentPing: false,
      ingredientSpritePath: rec.spritePath,
    };
  }

  // 5d) Raw base already sitting on a Pass Counter whose cook station is free -> grab it instead of a duplicate!
  for (const st of snapshot.stations) {
    if (st.kind === 'counter' && st.item?.kind === 'raw' && st.item.ingredientId) {
      const rec = stop.recipes.find(
        (r) => activeRecipeIds.has(r.id) && r.baseIngredient === st.item?.ingredientId,
      );
      if (rec) {
        const emptyCook = snapshot.stations.find((c) => c.kind === rec.cookStation && !c.item);
        if (emptyCook) {
          const ing = INGREDIENT_BY_ID[st.item.ingredientId];
          return {
            targetStationId: st.id,
            orderId: activeOrders.find((o) => o.recipeId === rec.id)?.id ?? null,
            message: `Grab ${ing.shortName}!`,
            stepNumber: 1,
            isParentPing: false,
            ingredientSpritePath: ing.spritePath,
          };
        }
      }
    }
  }

  // 5e) No dish currently in progress -> start the most urgent active order!
  if (primaryRecipe) {
    const crate = findCrateForIngredient(snapshot.stations, primaryRecipe.baseIngredient);
    if (crate) {
      const ing = INGREDIENT_BY_ID[primaryRecipe.baseIngredient];
      return {
        targetStationId: crate.id,
        orderId: primaryOrder?.id ?? null,
        message: `Grab ${ing.shortName}!`,
        stepNumber: 1,
        isParentPing: false,
        ingredientSpritePath: ing.spritePath,
      };
    }
  }

  return null;
}
