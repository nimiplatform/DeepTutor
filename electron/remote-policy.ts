import schema from '../web/contracts/schema/openapi.json' with { type: 'json' };

export type BusinessMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type BusinessRoute = Readonly<{ id: string; method: BusinessMethod; template: string; operation: string; parameters: readonly string[] }>;
const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);
const domains: Record<string, string> = {
  sessions: 'learning', dashboard: 'learning', capabilities: 'learning', books: 'learning', courses: 'learning',
  'mastery-paths': 'learning', 'question-notebook': 'learning', reading: 'learning', 'video-learning': 'learning',
  visualizers: 'learning', space: 'learning', voice: 'learning',
  'knowledge-bases': 'knowledge', documents: 'documents', notebooks: 'documents', imports: 'documents',
  memory: 'memory', personas: 'preferences', settings: 'preferences', 'agent-config': 'preferences',
  tools: 'preferences', skills: 'preferences', subagents: 'preferences',
  partners: 'partners', 'partner-groups': 'partners', auth: 'accounts', 'multi-user': 'accounts',
};

/** The existing backend contract owns the routes. Native machine/service setup stays on the PC. */
function exposed(method: string, route: string): boolean {
  if (route.startsWith('/files/')) return method === 'get';
  const domain = route.split('/')[2];
  if (!domain || !domains[domain]) return route === '/api/system/status' && method === 'get';
  if (/^\/api\/auth\/(?:device|devices|device-login|openai-codex)(?:\/|$)/.test(route)) return false;
  if (route.includes('/credentials/reset')) return false;
  if (/^\/api\/settings\/(?:providers|draft|apply|workspace)(?:\/|$)/.test(route)) return method === 'get';
  if (/^\/api\/knowledge-bases\/(?:connect-|probe-|list-ima|configs)/.test(route)) return method === 'get';
  if (/^\/api\/knowledge-bases\/.*\/(?:link-folder|linked-folders|github-source|web-source)(?:\/|$)/.test(route)) return method === 'get';
  if (/\/channel-onboarding(?:\/|$)|\/channels\/(?:reload|weixin)|\/links(?:\/|$)/.test(route)) return method === 'get';
  return true;
}

export const businessRoutes: readonly BusinessRoute[] = Object.entries(schema.paths).flatMap(([template, entry]) =>
  Object.keys(entry).filter(method => methods.has(method) && exposed(method, template)).map(method => {
    const domain = template.startsWith('/files/') ? 'documents' : domains[template.split('/')[2] ?? ''] ?? 'preferences';
    return { id: `${method.toUpperCase()} ${template}`, method: method.toUpperCase() as BusinessMethod,
      template, operation: `${domain}.${method === 'get' ? 'read' : 'write'}`,
      parameters: [...template.matchAll(/\{([^}]+)\}/g)].map(match => match[1]!) };
  }),
);
const byId = new Map(businessRoutes.map(route => [route.id, route]));

export function resolveBusinessRoute(operation: string, routeId: string, parameters: Record<string, string>, query: string): { route: BusinessRoute; path: string } {
  const route = byId.get(routeId);
  if (!route || route.operation !== operation) throw new Error('This operation is not exposed to the Web workspace. Use its PC control.');
  if (Object.keys(parameters).length !== route.parameters.length || route.parameters.some(key => !Object.hasOwn(parameters, key))) throw new Error('The request does not match its declared route parameters.');
  const pathname = route.template.replace(/\{([^}]+)\}/g, (_all, key: string) => {
    const value = parameters[key];
    if (typeof value !== 'string' || !value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)
      || value.startsWith('/') || value.startsWith('\\') || value.split(/[\\/]/).some(part => part === '.' || part === '..')) throw new Error('Invalid route parameter.');
    return encodeURIComponent(value);
  });
  if (query.length > 16384 || query.includes('#') || query.startsWith('?')) throw new Error('Invalid request query.');
  return { route, path: pathname + (query ? `?${query}` : '') };
}

const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const id = { type: 'string', minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9-]+$' };
const result = JSON.stringify({ type: 'object', additionalProperties: true });
const labels: Record<string, string> = {
  learning: 'Learning sessions and materials', knowledge: 'Knowledge libraries', documents: 'Documents and notebooks',
  memory: 'Learning memory', preferences: 'Learning preferences', partners: 'DeepTutor partners', accounts: 'DeepTutor business accounts',
};
export const routeDescriptors = [...new Set(businessRoutes.map(route => route.operation))].sort().map(operation => ({
  name: operation, displayName: `${operation.endsWith('.read') ? 'Read' : 'Manage'} ${labels[operation.split('.')[0]!]}`,
  description: operation.startsWith('accounts.')
    ? 'Use DeepTutor’s own account rules in this workspace. This does not log into or manage Nimi accounts; PC Host credentials never leave the PC.'
    : `Use the declared ${operation.split('.')[0]} routes in the existing PC DeepTutor workspace. Tasks and saved data remain owned by DeepTutor. Machine setup and credential onboarding stay on the PC.`,
  effect: operation.endsWith('.read') ? 'read' : 'write', supportsCancel: false, retryPolicy: 'none',
  inputSchemaJson: JSON.stringify(object({ sessionId: id, requestId: id,
    route: { type: 'string', enum: businessRoutes.filter(route => route.operation === operation).map(route => route.id) },
    parameters: { type: 'object', additionalProperties: { type: 'string', maxLength: 4096 } },
    query: { type: 'string', maxLength: 16384 },
    headers: { type: 'object', additionalProperties: { type: 'string', maxLength: 2048 }, maxProperties: 12 },
    bodyId: id,
  }, ['sessionId', 'requestId', 'route', 'parameters', 'query', 'headers'])), outputSchemaJson: result,
}));

export const remoteHeaders = new Set(['accept', 'content-type', 'range', 'if-none-match', 'if-modified-since']);
export const responseHeaders = new Set(['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition', 'etag', 'last-modified', 'x-correlation-id', 'x-request-id']);
