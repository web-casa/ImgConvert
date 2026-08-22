<!-- SPDX-License-Identifier: Apache-2.0 -->

# AUR packaging

The AUR package is named `imgconvert-bin`. AUR stores only the `PKGBUILD`,
`.SRCINFO`, wrapper, and license; the application binary remains on the
official GitHub Release. The AppImage is extracted into `/opt/imgconvert`, so
users do not need FUSE at runtime.

After the canonical x86_64 AppImage is public, generate release-specific AUR
files and validate them with Arch's own `makepkg`:

```bash
pnpm run release:aur:prepare
pnpm run release:aur:verify
pnpm run release:aur:verify:docker # compares .SRCINFO with Arch makepkg
```

Then clone `ssh://aur@aur.archlinux.org/imgconvert-bin.git`, copy the four
generated files from `target/aur/imgconvert-bin/`, review the diff, and push.
Never add the AppImage itself to the AUR Git repository.
