// The tools of the one-page app, one tab each, in tab-bar order. To add a
// tool: put its files under site/tabs/<id>/, give its module a `mount`
// function (see site/tabs/parcels/js/app.js) and add an entry here.
// Paths are relative to the site root.

export const TABS = [
  {
    id: 'parcels',
    label: { en: 'Cadastre parcels', fr: 'Parcelles cadastrales' },
    module: 'tabs/parcels/js/app.js',
    css: 'tabs/parcels/css/parcels.css',
  },
];

export const DEFAULT_TAB = TABS[0].id;
