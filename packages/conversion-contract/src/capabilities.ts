import {
  isImageInputFormat,
  isRasterOutputFormat,
  type ImageInputFormat,
  type RasterOutputFormat,
  type RasterizableInputFormat,
} from "./formats.js";
import { WEB_V1_DESKTOP_LIMITS, createResourceLimits, type ResourceLimits } from "./limits.js";

export const METADATA_POLICIES = ["stripAll", "preserveAll"] as const;

export type MetadataPolicy = (typeof METADATA_POLICIES)[number];
export type AnimationPolicy = "reject" | "firstFrame" | "preserve";
export type AlphaPolicy = "none" | "preserve" | "preserveOrFlatten";

const alphaPolicies = new Set<AlphaPolicy>(["none", "preserve", "preserveOrFlatten"]);
const animationPolicies = new Set<AnimationPolicy>(["reject", "firstFrame", "preserve"]);

export interface InputCapability {
  readonly alpha: AlphaPolicy;
  readonly animation: AnimationPolicy;
  readonly input: ImageInputFormat;
  readonly metadataPolicies: readonly MetadataPolicy[];
  readonly outputs: readonly RasterOutputFormat[];
}

export interface BackendCapabilities {
  readonly backendId: string;
  readonly inputs: readonly InputCapability[];
  readonly limits: ResourceLimits;
  readonly schemaVersion: 1;
}

export interface CapabilityMatch {
  readonly backendId: string;
  readonly capability: InputCapability;
  readonly limits: ResourceLimits;
}

export const WEB_001B_RASTER_CAPABILITIES = createBackendCapabilities({
  backendId: "independent-raster-codecs",
  inputs: [
    rasterInput("jpeg", "none"),
    rasterInput("png", "preserveOrFlatten"),
    rasterInput("webp", "preserveOrFlatten", "reject"),
    rasterInput("avif", "preserveOrFlatten"),
    rasterInput("bmp", "preserveOrFlatten"),
    rasterInput("gif", "preserveOrFlatten", "firstFrame"),
  ],
  limits: WEB_V1_DESKTOP_LIMITS,
  schemaVersion: 1,
});

export const WEB_006_SVG_CAPABILITIES = createBackendCapabilities({
  backendId: "safe-svg-resvg",
  inputs: [
    {
      alpha: "preserveOrFlatten",
      animation: "reject",
      input: "svg",
      metadataPolicies: ["stripAll"],
      outputs: ["jpeg", "png", "webp", "avif"],
    },
  ],
  limits: WEB_V1_DESKTOP_LIMITS,
  schemaVersion: 1,
});

export const WEB_007_PDF_CAPABILITIES = createBackendCapabilities({
  backendId: "bounded-pdfjs",
  inputs: [
    {
      alpha: "none",
      animation: "reject",
      input: "pdf",
      metadataPolicies: ["stripAll"],
      outputs: ["jpeg", "png", "webp", "avif"],
    },
  ],
  limits: WEB_V1_DESKTOP_LIMITS,
  schemaVersion: 1,
});

function rasterInput(
  input: Exclude<RasterizableInputFormat, "svg">,
  alpha: AlphaPolicy,
  animation: AnimationPolicy = "reject",
): InputCapability {
  return {
    alpha,
    animation,
    input,
    metadataPolicies: ["stripAll"],
    outputs: ["jpeg", "png", "webp", "avif"],
  };
}

function freezeInputCapability(capability: InputCapability): InputCapability {
  if (!isImageInputFormat(capability.input)) {
    throw new TypeError(`Unsupported input format: ${String(capability.input)}.`);
  }
  if (capability.outputs.length === 0 || !capability.outputs.every(isRasterOutputFormat)) {
    throw new TypeError(`${capability.input} must declare at least one valid raster output.`);
  }
  if (new Set(capability.outputs).size !== capability.outputs.length) {
    throw new TypeError(`${capability.input} contains duplicate output formats.`);
  }
  if (!alphaPolicies.has(capability.alpha)) {
    throw new TypeError(`${capability.input} declares an invalid alpha policy.`);
  }
  if (!animationPolicies.has(capability.animation)) {
    throw new TypeError(`${capability.input} declares an invalid animation policy.`);
  }
  if (
    capability.metadataPolicies.length === 0 ||
    !capability.metadataPolicies.every((policy) => METADATA_POLICIES.includes(policy))
  ) {
    throw new TypeError(`${capability.input} must declare a valid metadata policy.`);
  }
  if (new Set(capability.metadataPolicies).size !== capability.metadataPolicies.length) {
    throw new TypeError(`${capability.input} contains duplicate metadata policies.`);
  }
  return Object.freeze({
    ...capability,
    metadataPolicies: Object.freeze([...capability.metadataPolicies]),
    outputs: Object.freeze([...capability.outputs]),
  });
}

export function createBackendCapabilities(capabilities: BackendCapabilities): BackendCapabilities {
  if (capabilities.schemaVersion !== 1) {
    throw new TypeError("Only capability schema version 1 is supported.");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(capabilities.backendId)) {
    throw new TypeError("backendId must use lowercase kebab-case.");
  }
  if (capabilities.inputs.length === 0) {
    throw new TypeError("A backend must declare at least one input capability.");
  }
  const inputs = capabilities.inputs.map(freezeInputCapability);
  if (new Set(inputs.map(({ input }) => input)).size !== inputs.length) {
    throw new TypeError(`${capabilities.backendId} contains duplicate input formats.`);
  }
  return Object.freeze({
    backendId: capabilities.backendId,
    inputs: Object.freeze(inputs),
    limits: createResourceLimits(capabilities.limits),
    schemaVersion: 1,
  });
}

export class CapabilityRegistry {
  readonly #backends = new Map<string, BackendCapabilities>();

  constructor(backends: readonly BackendCapabilities[] = []) {
    for (const backend of backends) this.register(backend);
  }

  register(backend: BackendCapabilities): void {
    const frozen = createBackendCapabilities(backend);
    if (this.#backends.has(frozen.backendId)) {
      throw new Error(`Capability backend ${frozen.backendId} is already registered.`);
    }
    this.#backends.set(frozen.backendId, frozen);
  }

  find(input: ImageInputFormat, output: RasterOutputFormat): readonly CapabilityMatch[] {
    const matches: CapabilityMatch[] = [];
    for (const backend of this.#backends.values()) {
      const capability = backend.inputs.find(
        (candidate) => candidate.input === input && candidate.outputs.includes(output),
      );
      if (capability) {
        matches.push(
          Object.freeze({ backendId: backend.backendId, capability, limits: backend.limits }),
        );
      }
    }
    return Object.freeze(matches);
  }

  snapshot(): readonly BackendCapabilities[] {
    return Object.freeze(
      [...this.#backends.values()].sort((left, right) =>
        left.backendId.localeCompare(right.backendId, "en"),
      ),
    );
  }

  supports(input: ImageInputFormat, output: RasterOutputFormat): boolean {
    return this.find(input, output).length > 0;
  }
}
