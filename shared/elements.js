export function elementMultiplier(a,b) {
  const strong={fire:["nature","ice"],water:["fire","earth"],nature:["water","earth"],earth:["electric","fire"],air:["nature"],electric:["water","air"],ice:["air","nature"],dark:["light"],light:["dark"]};
  const weak={fire:["water","earth"],water:["nature","electric"],nature:["fire","ice"],earth:["water","nature"],air:["electric","ice"],electric:["earth"],ice:["fire"],dark:["light"],light:["dark"]};
  if((strong[a]||[]).includes(b))return 1.25;
  if((weak[a]||[]).includes(b))return .8;
  return 1;
}
