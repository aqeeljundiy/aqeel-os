// API-equivalent cost of one logged run, shared by the server and the Usage page.
// Prices are USD per million tokens; reasoning tokens bill as output. null when the model has no price.
export function costOf(line,prices){const p=prices?.models?.[line.model];if(!p||p.input==null||p.output==null)return null;
 return ((line.input||0)*p.input+(line.cachedInput||0)*(p.cachedInput??p.input)+(line.cacheWrite||0)*(p.cacheWrite??p.input)+((line.output||0)+(line.reasoning||0))*p.output)/1e6}
