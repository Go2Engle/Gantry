// @ts-check
const { themes: prismThemes } = require('prism-react-renderer');

const siteUrl = process.env.DOCS_SITE_URL || 'https://GantryIDP.dev';
const baseUrl = process.env.DOCS_BASE_URL || '/docs/';
const homeUrl = process.env.DOCS_HOME_URL || baseUrl.replace(/docs\/?$/, '');
const absoluteHomeUrl = new URL(homeUrl || '/', siteUrl).toString();

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Gantry',
  tagline: 'Open-source internal developer platform — single binary, zero dependencies.',
  favicon: 'img/favicon.svg',

  url: siteUrl,
  baseUrl,

  organizationName: 'go2engle',
  projectName: 'gantry',

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          // Serve docs at /docs/ root, not /docs/docs/
          routeBasePath: '/',
          editUrl: 'https://github.com/go2engle/gantry/edit/main/website/docs/',
          showLastUpdateTime: true,
          showLastUpdateAuthor: false,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        indexBlog: false,
        indexPages: false,
        docsRouteBasePath: '/',
        searchBarPosition: 'right',
        searchBarShortcut: true,
        searchBarShortcutHint: true,
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/og-image.png',

      navbar: {
        title: 'Gantry',
        logo: {
          alt: 'Gantry Logo',
          src: 'img/logo-white.png',
          srcDark: 'img/logo-white.png',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'docs',
            position: 'left',
            label: 'Documentation',
          },
          {
            href: absoluteHomeUrl,
            label: 'Home',
            position: 'left',
            target: '_self',
          },
          {
            href: 'https://github.com/go2engle/gantry',
            label: 'GitHub',
            position: 'right',
          },
          {
            href: 'https://github.com/go2engle/gantry/releases/latest',
            label: 'Download',
            position: 'right',
          },
        ],
      },

      footer: {
        style: 'dark',
        links: [
          {
            title: 'Documentation',
            items: [
              { label: 'Introduction', to: '/' },
              { label: 'Getting Started', to: '/getting-started/installation' },
              { label: 'Core Concepts', to: '/concepts/entity-model' },
              { label: 'Contributing', to: '/contributing/overview' },
            ],
          },
          {
            title: 'Community',
            items: [
              { label: 'GitHub', href: 'https://github.com/go2engle/gantry' },
              { label: 'Issues', href: 'https://github.com/go2engle/gantry/issues' },
              { label: 'Discussions', href: 'https://github.com/go2engle/gantry/discussions' },
            ],
          },
          {
            title: 'Releases',
            items: [
              { label: 'Latest Release', href: 'https://github.com/go2engle/gantry/releases/latest' },
              { label: 'All Releases', href: 'https://github.com/go2engle/gantry/releases' },
              { label: 'Changelog', href: 'https://github.com/go2engle/gantry/blob/main/CHANGELOG.md' },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Gantry Contributors. Apache 2.0 License.`,
      },

      prism: {
        theme: prismThemes.vsDark,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['bash', 'yaml', 'go', 'json', 'docker'],
      },

      colorMode: {
        defaultMode: 'light',
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },

      docs: {
        sidebar: {
          hideable: true,
          autoCollapseCategories: false,
        },
      },

      announcementBar: {
        id: 'alpha',
        content:
          '⚠️ Gantry is in active development. APIs and schemas may change between releases.',
        backgroundColor: '#1c1c1e',
        textColor: '#f5f5f7',
        isCloseable: true,
      },
    }),
};

module.exports = config;
