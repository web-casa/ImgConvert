import type { SVGProps } from "react";

/**
 * Minimal inline stroke icons for the docs site home.
 * Keeping them inline avoids an extra icon-font / library dependency and
 * lets us color via the currentColor chain.
 */

export type IconName =
  | "shield"
  | "launch"
  | "scale"
  | "download"
  | "book"
  | "terminal"
  | "wrench"
  | "rocket"
  | "blueprint"
  | "image"
  | "camera"
  | "check"
  | "arrow";

interface IconDef {
  paths: string[];
  fill?: boolean;
}

const ICONS: Record<IconName, IconDef> = {
  shield: { paths: ["M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z"] },
  launch: {
    paths: ["M5 9 3 21l12-2", "M9 11a4 4 0 0 0 5.6 0L21 5", "M14 4h6v6"],
  },
  scale: {
    paths: ["M7 21h10", "M12 3v18", "M5 7h14", "M5 7 2 14h6L5 7Z", "M19 7l-3 7h6l-3-7Z"],
  },
  download: {
    paths: ["M12 4v10", "M7 10l5 5 5-5", "M5 19h14"],
  },
  book: {
    paths: ["M4 5a2 2 0 0 1 2-2h12v17H6a2 2 0 0 0-2 2V5Z", "M4 18a2 2 0 0 1 2-2h12"],
  },
  terminal: {
    paths: ["M5 7l4 4-4 4", "M12 15h7", "M3 4h18v16H3z"],
  },
  wrench: {
    paths: [
      "M14.5 6.5a3.5 3.5 0 0 0-4.7-3.9l2.7 2.7-2 2-2.7-2.7A3.5 3.5 0 0 0 9 11.3L4 16.3 7.7 20l5-5a3.5 3.5 0 0 0 1.8-1.5",
    ],
  },
  rocket: {
    paths: [
      "M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2",
      "M9 19c5-2 11-7 11-14 0-1.5-1-2-2-2-7 0-12 6-14 11",
      "M9 11l4 4",
    ],
  },
  blueprint: {
    paths: ["M3 4h18v16H3z", "M3 9h18", "M9 9v11", "M3 14h6"],
  },
  image: {
    paths: [
      "M3 4h18v16H3z",
      "M3 17l5-5 4 4 3-3 6 6",
      "M9 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z",
    ],
  },
  camera: {
    paths: [
      "M3 8a2 2 0 0 1 2-2h2l1.5-2h7L19 6h0a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z",
      "M12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z",
    ],
  },
  check: {
    paths: ["M5 12.5l4 4 10-11"],
  },
  arrow: {
    paths: ["M5 12h14", "M13 6l6 6-6 6"],
  },
};

interface NavIconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
}

export function NavIcon({ name, strokeWidth = 1.6, ...rest }: NavIconProps) {
  const def = ICONS[name];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {def.paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
