// Same default as hetivo-mobile-driver (babel-preset-expo), plus one switch:
// LiraTek's core source (imported through the @liratek/core/* Metro alias) uses
// `declare readonly` class fields (packages/core/src/utils/errors.ts), which
// Babel 7's TypeScript transform rejects unless allowDeclareFields is on.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    overrides: [
      {
        test: /\.tsx?$/,
        plugins: [["@babel/plugin-transform-typescript", { allowDeclareFields: true, isTSX: true }]],
      },
    ],
  };
};
