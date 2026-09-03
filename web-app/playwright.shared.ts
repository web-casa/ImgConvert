export const LOCAL_BASE_URL = "http://127.0.0.1:4175/convert/";

export function previewBaseUrl(): string | undefined {
  const value = process.env.IMGCONVERT_WEB_PREVIEW_ORIGIN?.trim();
  if (!value) return undefined;

  const origin = new URL(value);
  if (
    origin.protocol !== "https:" ||
    !origin.hostname.endsWith(".pages.dev") ||
    origin.port !== "" ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    throw new Error(
      "IMGCONVERT_WEB_PREVIEW_ORIGIN must be an HTTPS *.pages.dev origin without credentials, a port, path, query, or fragment.",
    );
  }
  return new URL("/convert/", origin).href;
}
