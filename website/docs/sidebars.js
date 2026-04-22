/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: [
    'intro',
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/installation',
        'getting-started/quick-start',
        'getting-started/configuration',
      ],
    },
    {
      type: 'category',
      label: 'Core Concepts',
      items: [
        'concepts/entity-model',
        'concepts/service-catalog',
        'concepts/actions',
        'concepts/gitops',
      ],
    },
    {
      type: 'category',
      label: 'Plugins',
      items: [
        'plugins/overview',
        'plugins/kubernetes',
        'plugins/github',
        'plugins/argocd',
      ],
    },
    {
      type: 'category',
      label: 'API Reference',
      items: [
        'api/authentication',
        'api/rest-api',
        'api/mcp',
      ],
    },
    {
      type: 'category',
      label: 'Deployment',
      items: [
        'deployment/environment-variables',
        'deployment/docker',
        'deployment/production',
      ],
    },
    {
      type: 'category',
      label: 'Contributing',
      items: [
        'contributing/overview',
        'contributing/development-setup',
        'contributing/architecture',
        'contributing/coding-standards',
        'contributing/ai-contributors',
      ],
    },
  ],
};

module.exports = sidebars;
