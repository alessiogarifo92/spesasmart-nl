// Basket optimisation: what a shopping list costs at each chain and the best combination of
// 1 to 3 chains, with reason codes for every choice. Pure functions: no database, network,
// clock or environment. Money is integer euro cents.
export * from "./types";
export { priceCandidate } from "./price";
export { optimizeBasket } from "./optimize";
export { explainPlan, type PlanNote } from "./explain";
export * from "./settings";
