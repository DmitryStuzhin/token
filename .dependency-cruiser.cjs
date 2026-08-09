module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-is-pure',
      severity: 'error',
      from: { path: '^modules/[^/]+/domain|^modules/shared/domain' },
      to: { path: '^(server|modules/.+/(application|infrastructure|http))' },
    },
    {
      name: 'application-does-not-depend-on-http-or-infrastructure',
      severity: 'error',
      from: { path: '^modules/[^/]+/application|^modules/shared/application' },
      to: { path: '^modules/.+/(http|infrastructure)' },
    },
    {
      name: 'http-does-not-use-database',
      severity: 'error',
      from: { path: '^(server/api|modules/.+/http)' },
      to: { path: '^(server/db|modules/.+/infrastructure)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require'] },
    exclude: '(^|/)node_modules/',
  },
};
