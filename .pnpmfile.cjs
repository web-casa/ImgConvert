// SPDX-License-Identifier: Apache-2.0

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === "next" && pkg.optionalDependencies?.sharp) {
        // ImgConvert keeps GPL/AGPL/LGPL packages out of the main dependency tree.
        // Next only uses sharp for optional image optimization; this docs site uses
        // regular <img> assets, so keep sharp/libvips out of pnpm-lock.yaml.
        delete pkg.optionalDependencies.sharp;
      }

      return pkg;
    },
  },
};
